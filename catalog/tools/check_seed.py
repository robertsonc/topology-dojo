#!/usr/bin/env python3
"""Lint a catalog directory: schema, cross-references, and SVG port-anchor contract.

Exit code 0 = clean, 1 = findings, 2 = could not run.

Usage:
    python3 -I tools/check_seed.py --catalog seed --schema schema/catalog.schema.json
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from catalog_lib import DATA_ROLES, Catalog, CatalogError  # noqa: E402

LOG = logging.getLogger("check_seed")
SVG_NS = "{http://www.w3.org/2000/svg}"
ANCHOR_TOLERANCE = 0.05


def check(cat: Catalog, schema_path: Path) -> list[str]:
    findings: list[str] = []
    try:
        import jsonschema  # type: ignore[import-untyped]
    except ImportError:
        findings.append("SKIP schema validation: pip install jsonschema")
        jsonschema = None  # type: ignore[assignment]
    if jsonschema is not None:
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        validator = jsonschema.Draft202012Validator(schema)
        for entry in [*cat.platforms.values(), *cat.models.values()]:
            for err in validator.iter_errors(entry):
                findings.append(f"SCHEMA {entry.get('id')}: {err.message} at /{'/'.join(map(str, err.path))}")

    for pid, pl in cat.platforms.items():
        ids = [p["id"] for p in pl["ports"]]
        dupes = {i for i in ids if ids.count(i) > 1}
        if dupes:
            findings.append(f"PLATFORM {pid}: duplicate port ids {sorted(dupes)}")
        for p in pl["ports"]:
            if not (0 <= p["x"] <= pl["panel"]["width"] and 0 <= p["y"] <= pl["panel"]["height"]):
                findings.append(f"PLATFORM {pid}: port {p['id']} center outside panel")
        for face, rel in pl.get("glyphs", {}).items():
            findings.extend(check_svg(cat.root / rel, pid, {p["id"]: p for p in pl["ports"] if p.get("face", "front") == face}))

    for mid, m in cat.models.items():
        if m["platform"] not in cat.platforms:
            findings.append(f"MODEL {mid}: unknown platform {m['platform']!r}")
            continue
        phys = {p["id"] for p in cat.platforms[m["platform"]]["ports"]}
        names = [i["name"] for i in m["interfaces"]]
        if len(names) != len(set(names)):
            findings.append(f"MODEL {mid}: duplicate interface names")
        used: dict[str, str] = {}
        for i in m["interfaces"]:
            if i["physical"] not in phys:
                findings.append(f"MODEL {mid}: interface {i['name']} -> unknown physical {i['physical']!r}")
            if i["physical"] in used:
                findings.append(f"MODEL {mid}: physical {i['physical']} bound twice ({used[i['physical']]}, {i['name']})")
            used[i["physical"]] = i["name"]
            if i["role"] in DATA_ROLES and not i.get("speeds_mbps"):
                findings.append(f"MODEL {mid}: {i['name']} role {i['role']} needs speeds_mbps")
            ref = i.get("provenance_ref", 0)
            if ref >= len(m["provenance"]):
                findings.append(f"MODEL {mid}: {i['name']} provenance_ref {ref} out of range")
        for s in m.get("skus", []):
            if s["provenance_ref"] >= len(m["provenance"]):
                findings.append(f"MODEL {mid}: sku {s['sku']} provenance_ref out of range")
        for b in m.get("bond_groups", []):
            missing = [x for x in b["members"] if x not in names]
            if missing:
                findings.append(f"MODEL {mid}: bond {b['name']} members not on model: {missing}")
        sym = cat.root / f"glyphs/symbols/{m['symbol']}.svg"
        if not sym.is_file():
            findings.append(f"MODEL {mid}: missing symbol {sym}")
        tiers = {p["tier"] for p in m["provenance"]}
        if tiers <= {"reseller", "inferred"}:
            findings.append(f"WARN MODEL {mid}: no official_doc/internal_doc provenance; not GA-eligible")
    return findings


def check_svg(path: Path, pid: str, ports: dict[str, dict]) -> list[str]:
    out: list[str] = []
    try:
        root = ET.parse(path).getroot()
    except (OSError, ET.ParseError) as exc:
        return [f"SVG {path}: cannot parse ({exc})"]
    if root.get("data-platform") != pid:
        out.append(f"SVG {path}: data-platform={root.get('data-platform')!r}, expected {pid!r}")
    seen: dict[str, ET.Element] = {}
    for el in root.iter(f"{SVG_NS}g"):
        port = el.get("data-port")
        if port is None:
            continue
        if port in seen:
            out.append(f"SVG {path}: duplicate anchor for port {port}")
        seen[port] = el
    for port_id, spec in ports.items():
        el = seen.get(port_id)
        if el is None:
            out.append(f"SVG {path}: no data-port anchor for {port_id}")
            continue
        try:
            cx, cy = float(el.get("data-cx", "nan")), float(el.get("data-cy", "nan"))
        except ValueError:
            cx = cy = math.nan
        # A missing coordinate parses to NaN, and NaN never compares greater
        # than the tolerance, so it must be rejected explicitly.
        if not (math.isfinite(cx) and math.isfinite(cy)):
            out.append(f"SVG {path}: {port_id} anchor not numeric")
            continue
        if abs(cx - spec["x"]) > ANCHOR_TOLERANCE or abs(cy - spec["y"]) > ANCHOR_TOLERANCE:
            out.append(f"SVG {path}: {port_id} anchor ({cx},{cy}) != catalog ({spec['x']},{spec['y']})")
    extra = set(seen) - set(ports)
    if extra:
        out.append(f"SVG {path}: anchors with no catalog port: {sorted(extra)}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--catalog", type=Path, required=True)
    ap.add_argument("--schema", type=Path, required=True)
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        cat = Catalog.load(args.catalog)
    except CatalogError as exc:
        LOG.error("%s", exc)
        return 2
    findings = check(cat, args.schema)
    for f in findings:
        print(f)
    hard = [f for f in findings if not f.startswith(("WARN", "SKIP"))]
    print(f"{len(cat.platforms)} platforms, {len(cat.models)} models, {len(hard)} errors, {len(findings) - len(hard)} warnings")
    return 1 if hard else 0


if __name__ == "__main__":
    raise SystemExit(main())
