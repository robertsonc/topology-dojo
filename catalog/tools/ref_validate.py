#!/usr/bin/env python3
"""Reference implementation of catalog-aware wiring validation, plus a golden-fixture runner.

This is the executable spec for the rules Topology Dojo's validate_topology must enforce once
nodes are bound to catalog models. The Dojo implementation must produce the same rule codes
for every fixture in fixtures/wiring/ (codes are compared as a multiset).

Rule codes
  E_MODEL_UNKNOWN      node bound to a model id not in the catalog
  E_PORT_UNKNOWN       interface name does not exist on the bound model
  E_MEMBER_RANGE       {member} exceeds the node's stack size or the model's VSF/VC max
  E_ROLE_NOT_DATA      cabled link lands on a console/usb interface
  E_PORT_REUSED        one interface carries more than one cable
  E_OPTIC_ON_FIXED     optic declared on a fixed RJ45 port
  E_OPTIC_UNKNOWN      optic type not in the optics table
  E_OPTIC_CAGE         optic form factor does not fit the cage
  E_MEDIA_MISMATCH     endpoint media differ (copper vs fiber vs DAC)
  E_FIBER_TYPE         single-mode on one end, multimode on the other
  E_SPEED_NO_OVERLAP   no common speed across both endpoints (port speeds intersected with optic)
  E_BOND_UNKNOWN_MEMBER bond member has no cabled link on that node
  E_BOND_PAIR          model has fixed bond pairs and the bond's members are not one of them
  E_BOND_LACP          LACP requested on a bond group that does not support it
  E_BOND_SPEED         bond members negotiate different speeds
  W_OPTIC_UNDECLARED   cage port cabled without an optic, so media cannot be checked
  W_INTERFACE_UNASSIGNED endpoint on a bound node names no interface yet (unchecked, not an error)
  I_SCHEMATIC_PANEL    node's platform panel is schematic; wire sheet must badge it

Usage:
    python3 -I tools/ref_validate.py --catalog seed --fixtures fixtures/wiring
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from catalog_lib import CAGE_KINDS, DATA_ROLES, Catalog, CatalogError, ResolvedInterface  # noqa: E402

LOG = logging.getLogger("ref_validate")


@dataclass(frozen=True)
class Finding:
    code: str
    where: str
    detail: str

    def __str__(self) -> str:
        return f"{self.code:<20} {self.where:<28} {self.detail}"


@dataclass
class Endpoint:
    node: str
    iface: ResolvedInterface | None
    media: str | None          # copper | mmf | smf | dac | None (unknown)
    speeds: frozenset[int] | None  # None = unconstrained (unmodeled endpoint)


def _resolve_endpoint(cat: Catalog, nodes: dict[str, dict[str, Any]], end: dict[str, Any], link_id: str,
                      findings: list[Finding], cabled: Counter[tuple[str, str]]) -> Endpoint:
    node_id = end["node"]
    node = nodes.get(node_id, {})
    model_id = node.get("model")
    where = f"{link_id}:{node_id}"
    if model_id is None:
        return Endpoint(node_id, None, None, None)
    if model_id not in cat.models:
        findings.append(Finding("E_MODEL_UNKNOWN", where, model_id))
        return Endpoint(node_id, None, None, None)
    if not end.get("if"):
        # Bound but not yet assigned: the normal state between binding a node
        # and assigning its interfaces, so a warning, and the end stays
        # unconstrained (no media / speed opinion).
        findings.append(Finding("W_INTERFACE_UNASSIGNED", where, "no interface"))
        return Endpoint(node_id, None, None, None)
    iface = cat.resolve_interface(model_id, end["if"])
    if iface is None:
        findings.append(Finding("E_PORT_UNKNOWN", where, f"{end.get('if')!r} not on {model_id}"))
        return Endpoint(node_id, None, None, None)
    cabled[(node_id, iface.name)] += 1
    if iface.member is not None:
        stack = cat.models[model_id].get("stackable") or {}
        limit = node.get("stack_members") or stack.get("max_members") or 1
        if iface.member > limit:
            findings.append(Finding("E_MEMBER_RANGE", where, f"member {iface.member} > {limit}"))
    if iface.role not in DATA_ROLES:
        findings.append(Finding("E_ROLE_NOT_DATA", where, f"{iface.name} is a {iface.role} port"))
        return Endpoint(node_id, iface, None, None)

    optic_name = end.get("optic")
    if iface.physical_kind not in CAGE_KINDS:
        if optic_name:
            findings.append(Finding("E_OPTIC_ON_FIXED", where, f"{optic_name} on {iface.physical_kind}"))
        return Endpoint(node_id, iface, "copper", iface.speeds)
    if not optic_name:
        findings.append(Finding("W_OPTIC_UNDECLARED", where, f"{iface.name} ({iface.physical_kind})"))
        return Endpoint(node_id, iface, None, iface.speeds)
    optic = cat.optics["types"].get(optic_name)
    if optic is None:
        findings.append(Finding("E_OPTIC_UNKNOWN", where, optic_name))
        return Endpoint(node_id, iface, None, iface.speeds)
    accepts = cat.optics["cage_accepts"].get(iface.physical_kind, [iface.physical_kind])
    if optic["form"] not in accepts:
        findings.append(Finding("E_OPTIC_CAGE", where, f"{optic_name} ({optic['form']}) in {iface.physical_kind}"))
        return Endpoint(node_id, iface, None, None)
    return Endpoint(node_id, iface, optic["media"], iface.speeds & frozenset(optic["speeds_mbps"]))


def validate(cat: Catalog, topo: dict[str, Any]) -> list[Finding]:
    findings: list[Finding] = []
    nodes = {n["id"]: n for n in topo.get("nodes", [])}
    cabled: Counter[tuple[str, str]] = Counter()
    link_speed: dict[tuple[str, str], int | None] = {}

    for node in nodes.values():
        mid = node.get("model")
        if mid in cat.models and cat.platform_for(mid)["position_confidence"] == "schematic":
            findings.append(Finding("I_SCHEMATIC_PANEL", node["id"], cat.platform_for(mid)["id"]))

    for link in topo.get("links", []):
        lid = link["id"]
        a = _resolve_endpoint(cat, nodes, link["a"], lid, findings, cabled)
        z = _resolve_endpoint(cat, nodes, link["z"], lid, findings, cabled)
        if a.media and z.media and a.media != z.media:
            if {a.media, z.media} == {"mmf", "smf"}:
                findings.append(Finding("E_FIBER_TYPE", lid, f"{a.media} vs {z.media}"))
            else:
                findings.append(Finding("E_MEDIA_MISMATCH", lid, f"{a.media} vs {z.media}"))
        common: frozenset[int] | None
        if a.speeds is None:
            common = z.speeds
        elif z.speeds is None:
            common = a.speeds
        else:
            common = a.speeds & z.speeds
            if not common:
                findings.append(Finding("E_SPEED_NO_OVERLAP", lid, f"{sorted(a.speeds)} vs {sorted(z.speeds)}"))
        negotiated = max(common) if common else None
        for ep in (a, z):
            if ep.iface is not None:
                link_speed[(ep.node, ep.iface.name)] = negotiated

    for (node_id, name), count in cabled.items():
        if count > 1:
            findings.append(Finding("E_PORT_REUSED", node_id, f"{name} cabled {count}x"))

    for bond in topo.get("bonds", []):
        node_id, bname = bond["node"], bond["name"]
        where = f"{node_id}:{bname}"
        node = nodes.get(node_id, {})
        model = cat.models.get(node.get("model", ""))
        members = bond["members"]
        missing = [m for m in members if (node_id, m) not in link_speed]
        if missing:
            findings.append(Finding("E_BOND_UNKNOWN_MEMBER", where, f"uncabled: {missing}"))
        if model is not None and model.get("bond_groups"):
            group = next((g for g in model["bond_groups"] if set(g["members"]) == set(members)), None)
            if group is None:
                allowed = [g["members"] for g in model["bond_groups"]]
                findings.append(Finding("E_BOND_PAIR", where, f"{members} not in {allowed}"))
            elif bond.get("lacp") and group["lacp"] == "unsupported":
                findings.append(Finding("E_BOND_LACP", where, f"{group['name']} is static-only"))
        speeds = {link_speed[(node_id, m)] for m in members if (node_id, m) in link_speed}
        speeds.discard(None)
        if len(speeds) > 1:
            findings.append(Finding("E_BOND_SPEED", where, f"members at {sorted(speeds)} Mb/s"))
    return findings


def run_fixtures(cat: Catalog, folder: Path) -> int:
    failures = 0
    paths = sorted(folder.glob("*.json"))
    if not paths:
        LOG.error("no fixtures in %s", folder)
        return 1
    for path in paths:
        fx = json.loads(path.read_text(encoding="utf-8"))
        got = validate(cat, fx)
        got_codes = Counter(f.code for f in got)
        want = Counter(fx["expect"])
        ok = got_codes == want
        failures += not ok
        print(f"{'PASS' if ok else 'FAIL'}  {path.stem:<28} {fx.get('description', '')}")
        if not ok:
            print(f"      want {sorted(want.elements())}\n      got  {sorted(got_codes.elements())}")
            for f in got:
                print(f"        {f}")
    print(f"{len(paths) - failures}/{len(paths)} fixtures pass")
    return 1 if failures else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--catalog", type=Path, required=True)
    ap.add_argument("--fixtures", type=Path, help="Folder of golden fixtures to run")
    ap.add_argument("--topology", type=Path, help="Validate one topology file and print findings")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        cat = Catalog.load(args.catalog)
    except CatalogError as exc:
        LOG.error("%s", exc)
        return 2
    if args.fixtures:
        return run_fixtures(cat, args.fixtures)
    if args.topology:
        for f in validate(cat, json.loads(args.topology.read_text(encoding="utf-8"))):
            print(f)
        return 0
    ap.error("give --fixtures or --topology")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
