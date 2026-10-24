#!/usr/bin/env python3
"""Generate the seed hardware catalog: platform/model JSON plus front-panel and symbol SVGs.

The seed set is hand-curated from the sources cited in each entry's provenance. It exists
so the Dojo catalog, validator and wire-sheet renderer can be built and tested before the
official product-data feed and Brand Central SVG masters are available. When those arrive,
the feed importers replace these entries; nothing downstream should special-case seeds.

Usage:
    python3 tools/build_seed.py --out seed
"""
from __future__ import annotations

import argparse
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

LOG = logging.getLogger("build_seed")
RETRIEVED = "2026-10-24"

# --------------------------------------------------------------------------- sources
SRC_ECXS_PDF = "EdgeConnect - Port Layout - EC-XS Bonding.pdf (Silver Peak internal port-layout sheet)"
SRC_EC10104_PNG = "EC-10104 - blan0.png (internal design diagram: EdgeHA pair, blan0 to VSF LAG)"
SRC_EC10104_GUIDE = "https://arubanetworking.hpe.com/techdocs/sdwan-PDFs/hardware/appliance/EC-10104_Install_Guide.pdf"
SRC_9004_GUIDE = "Aruba 9004 Gateway Installation Guide (Table 2 port configuration; Figure 2 back panel; device dimensions)"
SRC_SRX300_DOC = "https://www.juniper.net/documentation/us/en/hardware/srx300/topics/topic-map/srx300-chassis.html"
SRC_JL664A_RESELLER = "https://www.networktigers.com/products/jl664a-hpe-switch"
SRC_JL664A_RESELLER2 = "https://www.xsnet.com.au/products/aruba-jl664a-24x-1g-rj45-poe-none-4x-sfp56-1-10-25-50g-uplinks-license-base-l3-included"
SRC_JL664A_QUICKSPECS = "https://www.hpe.com/psnow/doc/PSN1012183938JPJA"
SRC_EC10104_SKU_1 = "https://fleetnetwork.ca/aruba-s3n69a-edgeconnect-sd-wan-10104-gateway-2-wan-2-lan-ports-gigabit-ethernet-1u-rack-desktop/"
SRC_EC10104_SKU_2 = "https://www.lambda-tek.com/HPE-S3N78A-shUS/B50114347?viewSpec=y"

GIGE = [10, 100, 1000]


# --------------------------------------------------------------------------- model types
@dataclass
class Port:
    id: str
    kind: str
    x: float
    y: float
    w: float | None = None
    h: float | None = None
    label: str | None = None
    face: str = "front"

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {"id": self.id, "kind": self.kind, "x": round(self.x, 2), "y": round(self.y, 2)}
        if self.w is not None:
            out["w"] = self.w
        if self.h is not None:
            out["h"] = self.h
        if self.face != "front":
            out["face"] = self.face
        if self.label:
            out["label"] = self.label
        return out


@dataclass
class Platform:
    id: str
    name: str
    form_factor: str
    units: str
    width: float
    height: float
    ports: list[Port]
    position_confidence: str
    provenance: list[dict[str, str]]
    dims_mm: dict[str, float] | None = None
    silk: list[tuple[float, float, str]] = field(default_factory=list)
    face: str = "front"

    def to_json(self) -> dict[str, Any]:
        return {
            "kind": "platform",
            "id": self.id,
            "name": self.name,
            "form_factor": self.form_factor,
            "dims_mm": self.dims_mm,
            "panel": {"units": self.units, "width": self.width, "height": self.height},
            "ports": [p.to_json() for p in self.ports],
            "position_confidence": self.position_confidence,
            "glyphs": {self.face: f"glyphs/platforms/{self.id}.{self.face}.svg"},
            "provenance": self.provenance,
        }


def prov(tier: str, source: str, note: str | None = None) -> dict[str, str]:
    p = {"tier": tier, "source": source, "retrieved": RETRIEVED}
    if note:
        p["note"] = note
    return p


# --------------------------------------------------------------------------- SVG drawing
STYLE = {
    "chassis_fill": "#23272e",
    "chassis_stroke": "#59626e",
    "port_stroke": "#c9d1d9",
    "port_fill": "#0f1115",
    "silk": "#9aa4af",
}
DEFAULT_SIZE = {
    "rj45": (13.6, 11.4), "console_rj45": (13.6, 11.4),
    "sfp": (14.0, 9.4), "sfp_plus": (14.0, 9.4), "sfp28": (14.0, 9.4), "sfp56": (14.0, 9.4),
    "qsfp28": (18.4, 8.6), "usb_a": (12.5, 5.0), "usb_c": (8.9, 3.2), "usb_micro": (7.5, 2.6),
    "usb_mini": (7.7, 3.4), "power_dc": (7.0, 7.0), "button": (3.2, 3.2), "lock": (3.2, 6.0),
}


def _port_shape(p: Port, w: float, h: float) -> str:
    x0, y0 = p.x - w / 2, p.y - h / 2
    s, f = STYLE["port_stroke"], STYLE["port_fill"]
    sw = max(0.25, min(w, h) * 0.04)
    if p.kind in ("rj45", "console_rj45"):
        latch_w, latch_h = w * 0.42, h * 0.24
        return (
            f'<rect x="{x0:.2f}" y="{y0:.2f}" width="{w}" height="{h}" rx="0.6" fill="{f}" stroke="{s}" stroke-width="{sw:.2f}"/>'
            f'<rect x="{p.x - latch_w / 2:.2f}" y="{y0 + h - latch_h:.2f}" width="{latch_w:.2f}" height="{latch_h:.2f}" fill="{s}" opacity="0.55"/>'
        )
    if p.kind.startswith("sfp") or p.kind.startswith("qsfp"):
        inset = min(w, h) * 0.18
        return (
            f'<rect x="{x0:.2f}" y="{y0:.2f}" width="{w}" height="{h}" rx="0.4" fill="{f}" stroke="{s}" stroke-width="{sw:.2f}"/>'
            f'<rect x="{x0 + inset:.2f}" y="{y0 + inset:.2f}" width="{w - 2 * inset:.2f}" height="{h - 2 * inset:.2f}" fill="none" stroke="{s}" stroke-width="{sw * 0.6:.2f}" opacity="0.6"/>'
        )
    if p.kind in ("usb_c", "usb_micro", "usb_mini"):
        return f'<rect x="{x0:.2f}" y="{y0:.2f}" width="{w}" height="{h}" rx="{h / 2:.2f}" fill="{f}" stroke="{s}" stroke-width="{sw:.2f}"/>'
    if p.kind == "usb_a":
        return (
            f'<rect x="{x0:.2f}" y="{y0:.2f}" width="{w}" height="{h}" rx="0.3" fill="{f}" stroke="{s}" stroke-width="{sw:.2f}"/>'
            f'<rect x="{x0 + w * 0.12:.2f}" y="{y0 + h * 0.18:.2f}" width="{w * 0.76:.2f}" height="{h * 0.3:.2f}" fill="{s}" opacity="0.5"/>'
        )
    if p.kind == "power_dc":
        r = w / 2
        return (
            f'<circle cx="{p.x}" cy="{p.y}" r="{r:.2f}" fill="{f}" stroke="{s}" stroke-width="{sw:.2f}"/>'
            f'<circle cx="{p.x}" cy="{p.y}" r="{r * 0.35:.2f}" fill="{s}" opacity="0.7"/>'
        )
    if p.kind == "button":
        return f'<circle cx="{p.x}" cy="{p.y}" r="{w / 2:.2f}" fill="{f}" stroke="{s}" stroke-width="{sw:.2f}"/>'
    if p.kind == "lock":
        return f'<rect x="{x0:.2f}" y="{y0:.2f}" width="{w}" height="{h}" rx="0.8" fill="{f}" stroke="{s}" stroke-width="{sw:.2f}"/>'
    raise ValueError(f"no shape for port kind {p.kind!r} on {p.id}")


def platform_svg(pl: Platform) -> str:
    W, H = pl.width, pl.height
    font = max(1.6, H * 0.055)
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
        f'data-platform="{pl.id}" data-units="{pl.units}" data-confidence="{pl.position_confidence}" data-face="{pl.face}">',
        f"<title>{escape(pl.name)} ({pl.face} panel)</title>",
        f'<g id="chassis"><rect x="0.4" y="0.4" width="{W - 0.8}" height="{H - 0.8}" rx="{min(2.0, H * 0.06):.2f}" '
        f'fill="{STYLE["chassis_fill"]}" stroke="{STYLE["chassis_stroke"]}" stroke-width="0.5"/></g>',
        '<g id="silkscreen" font-family="Helvetica, Arial, sans-serif" fill="%s" text-anchor="middle" font-size="%.2f">'
        % (STYLE["silk"], font),
    ]
    for (sx, sy, txt) in pl.silk:
        parts.append(f'<text x="{sx:.2f}" y="{sy:.2f}">{escape(txt)}</text>')
    parts.append("</g>")
    parts.append('<g id="ports">')
    for p in pl.ports:
        w, h = (p.w, p.h) if p.w and p.h else DEFAULT_SIZE[p.kind]
        p.w, p.h = w, h
        parts.append(
            f'<g id="port-{p.id}" data-port="{p.id}" data-kind="{p.kind}" data-cx="{p.x:.2f}" data-cy="{p.y:.2f}">'
            + _port_shape(p, w, h)
            + "</g>"
        )
    parts.append("</g>")
    if pl.position_confidence == "schematic":
        parts.append(
            f'<text x="{W - 2:.2f}" y="{H - 1.6:.2f}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" '
            f'font-size="{font * 0.9:.2f}" fill="#e0a43a">SCHEMATIC - port positions not physically accurate</text>'
        )
    parts.append("</svg>")
    return "\n".join(parts) + "\n"


SYMBOLS: dict[str, str] = {
    # 64x64, stroke-only, currentColor so the renderer themes them. Original drawings, not vendor icons.
    "sdwan-gateway": (
        '<rect x="6" y="16" width="52" height="32" rx="7"/>'
        '<path d="M16 32h12l8-8h10M36 40h10M28 32l8 8"/>'
        '<path d="M42 20l5 4-5 4M42 36l5 4-5 4"/>'
    ),
    "wlan-gateway": (
        '<rect x="6" y="28" width="52" height="22" rx="6"/>'
        '<path d="M20 20a17 17 0 0 1 24 0M25 25a10 10 0 0 1 14 0"/>'
        '<circle cx="32" cy="29" r="1.6" fill="currentColor"/>'
        '<path d="M16 39h32"/>'
    ),
    "switch": (
        '<rect x="6" y="18" width="52" height="28" rx="4"/>'
        '<path d="M14 27h30l-5-4M14 27l5 4M50 37H20l5 4M50 37l-5-4"/>'
    ),
    "firewall": (
        '<rect x="8" y="14" width="48" height="36" rx="3"/>'
        '<path d="M8 26h48M8 38h48M24 14v12M40 14v12M16 26v12M32 26v12M48 26v12M24 38v12M40 38v12"/>'
    ),
}


def symbol_svg(sym_id: str, body: str) -> str:
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" '
        f'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" data-symbol="{sym_id}">'
        f"<title>{sym_id}</title>{body}</svg>\n"
    )


# --------------------------------------------------------------------------- platforms
def platforms() -> list[Platform]:
    out: list[Platform] = []

    # Aruba 9004 class desktop chassis. Positions traced from the 9004 install guide Figure 2
    # (back panel), scaled to the published 198.5 mm width. EC-10104 shares this chassis:
    # identical published dimensions (3.82 x 19.85 x 15.31 cm) and the same port block.
    px = [52.0, 67.6, 83.2, 98.8]
    out.append(Platform(
        id="aruba-9004-class", name="Aruba 9004-class desktop chassis", form_factor="desktop",
        units="mm", width=198.5, height=38.2, dims_mm={"w": 198.5, "h": 38.2, "d": 153.1},
        face="rear", position_confidence="traced",
        ports=[
            Port("dc", "power_dc", 21.9, 16.3, face="rear", label="12V"),
            Port("reset", "button", 36.5, 19.0, face="rear", label="RESET"),
            *[Port(f"p{i}", "rj45", x, 17.0, face="rear", label=str(i)) for i, x in enumerate(px)],
            Port("console", "console_rj45", 114.3, 10.6, face="rear", label="CONSOLE"),
            Port("console-usb", "usb_micro", 114.3, 24.8, face="rear"),
            Port("usb", "usb_a", 153.2, 24.4, face="rear"),
            Port("lock", "lock", 190.7, 22.0, face="rear"),
        ],
        silk=[(x, 27.8, str(i)) for i, x in enumerate(px)] + [(114.3, 30.6, "CONSOLE"), (21.9, 25.0, "12V")],
        provenance=[
            prov("internal_doc", SRC_9004_GUIDE, "Positions traced from Figure 2 at ~0.49 mm/px; +/-1.5 mm."),
            prov("official_doc", SRC_EC10104_GUIDE, "Same HxWxD as 9004; same port complement."),
        ],
    ))

    # EC-XS. Positions traced from the Silver Peak port-layout photo; true dimensions unknown,
    # so panel uses relative units (300 wide) at the photo's aspect ratio.
    rj = (19.4, 14.6)
    xs = {"mgmt0": 138.4, "mgmt1": 165.1, "lan0": 191.8, "wan0": 218.0, "lan1": 244.7, "wan1": 271.4}
    out.append(Platform(
        id="ec-xs", name="EdgeConnect EC-XS chassis", form_factor="desktop",
        units="relative", width=300.0, height=56.8, dims_mm=None, position_confidence="traced",
        ports=[
            Port("reset", "button", 38.8, 34.9, w=4.2, h=4.2, label="RESET"),
            Port("dc", "power_dc", 55.8, 30.2, w=11.0, h=11.0, label="DC+12V"),
            Port("power", "button", 67.5, 34.9, w=5.0, h=5.0, label="POWER"),
            Port("console", "console_rj45", 87.4, 38.8, w=rj[0], h=rj[1], label="Console"),
            Port("aux-usb1", "usb_a", 114.6, 33.0, w=13.0, h=6.2, label="aux"),
            Port("aux-usb2", "usb_a", 114.6, 43.0, w=13.0, h=6.2),
            *[Port(pid, "rj45", x, 38.8, w=rj[0], h=rj[1], label=pid) for pid, x in xs.items()],
        ],
        silk=[(87.4, 26.5, "Console"), (114.6, 26.0, "aux")] + [(x, 26.5, pid) for pid, x in xs.items()],
        provenance=[prov("internal_doc", SRC_ECXS_PDF, "Traced from standalone-panel photo; relative units, face not stated.")],
    ))

    # CX 6300M 24G + 4 SFP56 (JL664A). No figure in hand: SCHEMATIC until QuickSpecs art arrives.
    sp = 14.6
    def col_x(i: int) -> float:
        return 70.0 + i * sp + (i // 6) * 4.0
    ports_cx: list[Port] = [
        Port("console", "usb_c", 12.0, 12.5, label="Console"),
        Port("usb", "usb_a", 12.0, 22.0),
        Port("oobm", "rj45", 32.0, 22.0, label="OOBM"),
    ]
    for n in range(1, 25):
        i = (n - 1) // 2
        ports_cx.append(Port(f"p{n}", "rj45", col_x(i), 14.5 if n % 2 else 29.5, label=str(n)))
    for k, (x, y) in enumerate([(380.0, 14.5), (380.0, 29.5), (398.0, 14.5), (398.0, 29.5)]):
        ports_cx.append(Port(f"p{25 + k}", "sfp56", x, y, label=str(25 + k)))
    out.append(Platform(
        id="cx-6300m-24g-4sfp56", name="CX 6300M 24-port 1GbE + 4-port SFP56 chassis", form_factor="rack_1u",
        units="mm", width=442.0, height=43.9, dims_mm=None, position_confidence="schematic",
        ports=ports_cx,
        silk=[(col_x(i), 7.0, str(2 * i + 1)) for i in range(12)] + [(col_x(i), 39.0, str(2 * i + 2)) for i in range(12)]
             + [(380.0, 7.0, "25"), (398.0, 7.0, "27"), (380.0, 39.0, "26"), (398.0, 39.0, "28")],
        provenance=[prov("inferred", "Layout convention for 1U access switches (odd ports top row)",
                         "Replace with traced positions from HPE QuickSpecs / Brand Central front-panel art.")],
    ))

    # Juniper SRX300. Component list and dimensions from Juniper's chassis page; order schematic.
    ge = [52.0 + i * 15.2 for i in range(6)]
    out.append(Platform(
        id="srx300", name="Juniper SRX300 chassis", form_factor="desktop",
        units="mm", width=320.8, height=34.8, dims_mm={"w": 320.8, "h": 34.8, "d": 191.0},
        position_confidence="schematic",
        ports=[
            Port("reset", "button", 12.0, 17.0, label="RESET CONFIG"),
            Port("console", "console_rj45", 30.0, 17.0, label="CONSOLE"),
            *[Port(f"p{i}", "rj45", x, 17.0, label=f"0/{i}") for i, x in enumerate(ge)],
            Port("p6", "sfp", 150.0, 17.0, label="0/6"),
            Port("p7", "sfp", 167.0, 17.0, label="0/7"),
            Port("console-usb", "usb_mini", 192.0, 11.5),
            Port("usb", "usb_a", 192.0, 23.5),
            Port("power", "button", 305.0, 17.0, w=4.0, h=4.0, label="POWER"),
        ],
        silk=[(x, 27.6, f"0/{i}") for i, x in enumerate(ge)] + [(150.0, 27.6, "0/6"), (167.0, 27.6, "0/7"), (30.0, 27.6, "CONSOLE")],
        provenance=[
            prov("official_doc", SRC_SRX300_DOC, "Component list and 12.63 x 1.37 x 7.52 in dimensions."),
            prov("inferred", "Left-to-right order assumed from the component table numbering", "Positions SCHEMATIC."),
        ],
    ))
    return out


# --------------------------------------------------------------------------- models
def iface(name: str, physical: str, role: str, speeds: list[int] | None = None, ref: int = 0, poe: Any = None) -> dict[str, Any]:
    d: dict[str, Any] = {"name": name, "physical": physical, "role": role}
    if speeds is not None:
        d["speeds_mbps"] = speeds
    if poe is not None:
        d["poe"] = poe
    d["provenance_ref"] = ref
    return d


def models() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    out.append({
        "kind": "model", "id": "edgeconnect-ec-xs", "vendor": "hpe-aruba", "family": "edgeconnect",
        "name": "EdgeConnect EC-XS", "skus": [], "os": "ecos", "platform": "ec-xs", "category": "sdwan-gateway",
        "symbol": "sdwan-gateway", "lifecycle": "unknown",
        "interfaces": [
            iface("mgmt0", "mgmt0", "mgmt", GIGE, 1), iface("mgmt1", "mgmt1", "mgmt", GIGE, 1),
            iface("lan0", "lan0", "lan", GIGE, 1), iface("wan0", "wan0", "wan", GIGE, 1),
            iface("lan1", "lan1", "lan", GIGE, 1), iface("wan1", "wan1", "wan", GIGE, 1),
            iface("console", "console", "console", None, 0),
        ],
        "bond_groups": [
            {"name": "blan0", "members": ["lan0", "lan1"], "lacp": "unsupported",
             "note": "Static only; peer must be static. Max 2 members; pairs not configurable."},
            {"name": "bwan0", "members": ["wan0", "wan1"], "lacp": "unsupported",
             "note": "Before ECOS 9.0.3, bonding LAN also bonds WAN (coupled). From 9.0.3, independent."},
        ],
        "provenance": [
            prov("internal_doc", SRC_ECXS_PDF, "Port names, physical order, bond pairs, LACP and 9.0.3 rule."),
            prov("inferred", "EC-XS ports assumed 10/100/1000 copper", "Confirm speeds from the EC-XS spec sheet."),
        ],
        "todo": ["Confirm port speeds", "Add SKU(s)", "Real chassis dimensions", "Lifecycle status"],
    })

    out.append({
        "kind": "model", "id": "edgeconnect-ec-10104", "vendor": "hpe-aruba", "family": "edgeconnect",
        "name": "EdgeConnect 10104", "os": "ecos", "platform": "aruba-9004-class", "category": "sdwan-gateway",
        "symbol": "sdwan-gateway", "lifecycle": "current",
        "skus": [
            {"sku": "S3N69A", "variant": "unknown", "provenance_ref": 2},
            {"sku": "S3N78A", "variant": "TAA", "provenance_ref": 3},
        ],
        "interfaces": [
            iface("lan0", "p0", "lan", GIGE, 0), iface("lan1", "p1", "lan", GIGE, 0),
            iface("wan0", "p2", "wan", GIGE, 0), iface("wan1", "p3", "wan", GIGE, 0),
            iface("console", "console", "console", None, 0), iface("console-usb", "console-usb", "console", None, 0),
            iface("usb", "usb", "usb", None, 0),
        ],
        "bond_groups": [
            {"name": "blan0", "members": ["lan0", "lan1"], "lacp": "unknown",
             "note": "blan0 shown in internal EdgeHA design; LACP behavior not documented in hand."},
        ],
        "provenance": [
            prov("official_doc", SRC_EC10104_GUIDE, "Table 2: 4x 10/100/1000BASE-T LAN0, LAN1, WAN0, WAN1; RJ-45 + micro-USB console; USB 3.0."),
            prov("internal_doc", SRC_EC10104_PNG, "Physical order lan0, lan1, wan0, wan1; blan0 bond."),
            prov("reseller", SRC_EC10104_SKU_1, "S3N69A listed as EdgeConnect SD-WAN 10104."),
            prov("reseller", SRC_EC10104_SKU_2, "S3N78A listed as EdgeConnect 10104 4x RJ45 TAA."),
        ],
        "todo": ["Confirm SKUs and variants from the HPE product catalog", "Confirm bwan0 support and LACP on blan0"],
    })

    out.append({
        "kind": "model", "id": "aruba-9004", "vendor": "hpe-aruba", "family": "aruba-gateway",
        "name": "Aruba 9004 Gateway", "skus": [], "os": "aos-8", "platform": "aruba-9004-class",
        "category": "wlan-gateway", "symbol": "wlan-gateway", "lifecycle": "unknown",
        "interfaces": [
            *[iface(f"GE0/0/{i}", f"p{i}", "data", [100, 1000], 0) for i in range(4)],
            iface("console", "console", "console", None, 0), iface("console-usb", "console-usb", "console", None, 0),
            iface("usb", "usb", "usb", None, 0),
        ],
        "provenance": [
            prov("internal_doc", SRC_9004_GUIDE, "4x 100/1000BASE-T ports numbered 0-3; RJ45 + micro-USB console; USB 3.0."),
            prov("inferred", "ArubaOS interface naming GE0/0/N", "Guide numbers ports 0-3 only; confirm CLI names on AOS 8 and AOS 10."),
        ],
        "todo": ["Add SKU(s)", "Confirm interface names on AOS 10", "Lifecycle status"],
    })

    out.append({
        "kind": "model", "id": "aruba-cx-6300m-jl664a", "vendor": "hpe-aruba", "family": "aos-cx",
        "name": "CX 6300M 24-port 1GbE and 4-port SFP56 Switch", "os": "aos-cx",
        "platform": "cx-6300m-24g-4sfp56", "category": "switch", "symbol": "switch", "lifecycle": "current",
        "skus": [{"sku": "JL664A", "variant": "base", "provenance_ref": 0}],
        "stackable": {"tech": "vsf", "max_members": 10},
        "interfaces": [
            *[iface(f"{{member}}/1/{n}", f"p{n}", "data", GIGE, 0) for n in range(1, 25)],
            *[iface(f"{{member}}/1/{n}", f"p{n}", "data", [1000, 10000, 25000, 50000], 1) for n in range(25, 29)],
            iface("mgmt", "oobm", "mgmt", GIGE, 0),
            iface("console", "console", "console", None, 0),
            iface("usb", "usb", "usb", None, 0),
        ],
        "provenance": [
            prov("reseller", SRC_JL664A_RESELLER, "24x 1GbE RJ45, 4x SFP56, USB-C console, OOBM, USB-A, VSF up to 10."),
            prov("reseller", SRC_JL664A_RESELLER2, "SFP56 1/10/25/50G; non-PoE."),
            prov("inferred", "AOS-CX interface naming member/slot/port", "Confirm in QuickSpecs: " + SRC_JL664A_QUICKSPECS),
        ],
        "todo": ["Replace reseller rows with HPE QuickSpecs", "Trace front panel from official art", "Confirm 10/100 support on RJ45"],
    })

    out.append({
        "kind": "model", "id": "juniper-srx300", "vendor": "juniper", "family": "srx",
        "name": "SRX300", "skus": [], "os": "junos", "platform": "srx300", "category": "firewall",
        "symbol": "firewall", "lifecycle": "unknown",
        "interfaces": [
            *[iface(f"ge-0/0/{i}", f"p{i}", "data", GIGE, 0) for i in range(6)],
            *[iface(f"ge-0/0/{i}", f"p{i}", "data", [1000], 0) for i in (6, 7)],
            iface("console", "console", "console", None, 0), iface("console-usb", "console-usb", "console", None, 0),
            iface("usb", "usb", "usb", None, 0),
        ],
        "provenance": [
            prov("official_doc", SRC_SRX300_DOC, "Six 1GbE RJ-45 LAN ports (0/0-0/5); two 1GbE SFP ports; RJ-45 and mini-USB console; USB."),
            prov("inferred", "Junos naming ge-0/0/N", "Doc lists ports 0/0-0/7; ge- prefix by Junos convention."),
        ],
        "todo": ["Add SKU(s) (-SYS-JB / -SYS-JE variants)", "Trace front panel positions", "Confirm whether 0/0-0/5 accept 10/100"],
    })
    return out


# --------------------------------------------------------------------------- optics
def optics() -> dict[str, Any]:
    """Generic IEEE-style transceiver types. Vendor optic SKUs map onto these in the feed."""
    return {
        "cage_accepts": {
            "sfp": ["sfp"],
            "sfp_plus": ["sfp_plus", "sfp"],
            "sfp28": ["sfp28", "sfp_plus"],
            "sfp56": ["sfp56", "sfp28", "sfp_plus", "sfp"],
            "qsfp28": ["qsfp28", "qsfp_plus"],
        },
        "cage_accepts_note": "Per-platform overrides belong on the model; e.g. some SFP28 cages also take 1G SFP.",
        "types": {
            "1000BASE-T": {"form": "sfp", "media": "copper", "speeds_mbps": [1000]},
            "1000BASE-SX": {"form": "sfp", "media": "mmf", "speeds_mbps": [1000]},
            "1000BASE-LX": {"form": "sfp", "media": "smf", "speeds_mbps": [1000]},
            "10GBASE-T": {"form": "sfp_plus", "media": "copper", "speeds_mbps": [10000, 1000]},
            "10GBASE-SR": {"form": "sfp_plus", "media": "mmf", "speeds_mbps": [10000]},
            "10GBASE-LR": {"form": "sfp_plus", "media": "smf", "speeds_mbps": [10000]},
            "10G-DAC": {"form": "sfp_plus", "media": "dac", "speeds_mbps": [10000]},
            "25GBASE-SR": {"form": "sfp28", "media": "mmf", "speeds_mbps": [25000]},
            "25GBASE-LR": {"form": "sfp28", "media": "smf", "speeds_mbps": [25000]},
            "50GBASE-SR": {"form": "sfp56", "media": "mmf", "speeds_mbps": [50000]},
            "100GBASE-SR4": {"form": "qsfp28", "media": "mmf", "speeds_mbps": [100000]},
            "100GBASE-LR4": {"form": "qsfp28", "media": "smf", "speeds_mbps": [100000]},
        },
    }


# --------------------------------------------------------------------------- main
def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, required=True, help="Output directory for the seed catalog")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(levelname)s %(message)s")

    out: Path = args.out
    for pl in platforms():
        svg = platform_svg(pl)  # fills default port sizes before JSON is written
        svg_path = out / f"glyphs/platforms/{pl.id}.{pl.face}.svg"
        svg_path.parent.mkdir(parents=True, exist_ok=True)
        svg_path.write_text(svg, encoding="utf-8")
        write_json(out / f"platforms/{pl.id}.json", pl.to_json())
        LOG.info("platform %s (%d ports, %s)", pl.id, len(pl.ports), pl.position_confidence)
    for m in models():
        write_json(out / f"models/{m['id']}.json", m)
        LOG.info("model %s -> %s", m["id"], m["platform"])
    for sym_id, body in SYMBOLS.items():
        p = out / f"glyphs/symbols/{sym_id}.svg"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(symbol_svg(sym_id, body), encoding="utf-8")
    write_json(out / "optics.json", optics())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
