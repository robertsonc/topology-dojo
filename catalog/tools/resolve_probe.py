#!/usr/bin/env python3
"""Probe resolve_interface across every catalog model and emit the results as JSON.

The output is the parity golden shared with the TypeScript port
(src/catalog/catalog.ts): CI regenerates it from this script and fails if it
differs from the committed file, and the TS suite asserts its own results
against the same file. Probes cover every interface row (each {member}
template at member 1, 2, the stack max and max+1), plus negative cases a
port must reject identically (member 0, a leading zero, a trailing newline,
wrong case, a suffix, an empty name).

Usage:
    python3 -I tools/resolve_probe.py --catalog data > fixtures/resolve/golden.json
    python3 -I tools/resolve_probe.py --catalog data --check fixtures/resolve/golden.json
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from catalog_lib import Catalog, CatalogError  # noqa: E402

LOG = logging.getLogger("resolve_probe")


def probe_names(model: dict[str, Any]) -> list[str]:
    stack = model.get("stackable") or {}
    top = int(stack.get("max_members") or 1)
    names: list[str] = []
    for row in model["interfaces"]:
        template: str = row["name"]
        if "{member}" in template:
            for member in (1, 2, top, top + 1):
                names.append(template.replace("{member}", str(member)))
            names.append(template.replace("{member}", "0"))
            names.append(template.replace("{member}", "01"))
            names.append(template)
        else:
            names.append(template)
            names.append(template.upper())
            names.append(template + "x")
        names.append(names[-1] + "\n")
    names.append("")
    seen: set[str] = set()
    return [n for n in names if not (n in seen or seen.add(n))]


def probe(cat: Catalog) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for model_id in sorted(cat.models):
        for name in probe_names(cat.models[model_id]):
            r = cat.resolve_interface(model_id, name)
            out.append({
                "model": model_id,
                "name": name,
                "result": None if r is None else {
                    "name": r.name,
                    "model_id": r.model_id,
                    "physical_id": r.physical_id,
                    "physical_kind": r.physical_kind,
                    "role": r.role,
                    "speeds": sorted(r.speeds),
                    "member": r.member,
                },
            })
    return out


def render(cat: Catalog) -> str:
    return json.dumps({"probes": probe(cat)}, indent=2, ensure_ascii=False) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--catalog", type=Path, required=True)
    ap.add_argument("--check", type=Path, help="Compare against this golden file instead of printing")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        cat = Catalog.load(args.catalog)
    except CatalogError as exc:
        LOG.error("%s", exc)
        return 2
    text = render(cat)
    if args.check:
        try:
            current = args.check.read_text(encoding="utf-8")
        except OSError as exc:
            LOG.error("cannot read %s: %s", args.check, exc)
            return 2
        if current != text:
            LOG.error("%s is stale; regenerate with --catalog %s > %s", args.check, args.catalog, args.check)
            return 1
        LOG.info("%s matches (%d probes)", args.check, text.count('"model"'))
        return 0
    sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
