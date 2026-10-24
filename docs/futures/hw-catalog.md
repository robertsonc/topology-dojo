# Future: hardware catalog, catalog-aware validation, wire sheets, Visio masters

Make wire sheets trustworthy: nodes bind to real hardware models, every cable
lands on an interface that exists on that model with compatible media, optic
and speed, wire-sheet pages draw real front panels with cables at the true
port positions, and `.vsdx` export emits native Visio masters with named
connection points.

Source brief: [`hw-catalog-build-prompt.md`](hw-catalog-build-prompt.md).
Progress notes: [`../sitrep/`](../sitrep/) (`*-hw-catalog-*`).

Official data sources (HPE product catalog, QuickSpecs, Brand Central SVG
masters, Juniper hardware guides) are not available yet; every importer is
built as a working interface over fixtures, so real data is a data task.

## Status

| Phase                       | Scope                                                                                                                                                                                       | Status                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1. Catalog core             | `catalog/` layout, generated TS types, TS checker + content-hashed bundle published to the Worker, loader with LRU, `resolveInterface` parity with Python                                   | **Done** — merged, PR #285 ([sitrep 01](../sitrep/2026-10-24-hw-catalog-01-phase-1.md))   |
| 2. Bind hardware + validate | node `hw`, link `from/toInterface` + `from/toOptic`, LAG bundles as bonds, every `ref_validate.py` rule in `validate_topology`, 15 golden fixtures in TS + Python, `catalogVersion` pinning | **Done** — merged, PR #286 ([sitrep 02](../sitrep/2026-10-24-hw-catalog-02-phase-2.md))   |
| 3. MCP tools                | `list_hardware`, `describe_hardware`, `bind_hardware`, `assign_interfaces`, `catalog_diff`, `export_topology` `cable-schedule` (CSV / XLSX)                                                 | **Done** — merged, PR #287 ([sitrep 03](../sitrep/2026-10-24-hw-catalog-03-phase-3.md))   |
| 4. Wire-sheet rendering     | page `view: "wiresheet"`, panel glyphs at page scale, cables anchored at port positions, port pills, schematic badge, `inspect_render` checks, golden images                                | **Done** — PR pending review ([sitrep 04](../sitrep/2026-10-24-hw-catalog-04-phase-4.md)) |
| 5. Native Visio masters     | per-model masters with named connection points + Shape Data, glued connectors on wire-sheet pages, `.vssx` stencil export, LibreOffice + real-Visio verification                            | Not started                                                                               |
| 6. Feed importers           | drafts + `catalog promote`, SVG master / anchor mapper / VSSX / QuickSpecs / Juniper guide / product API sources, glyph contract doc, OWNERS                                                | Not started                                                                               |

Interleaved work: the light-theme contrast fix
([`light-theme-contrast.md`](light-theme-contrast.md)) runs after Phase 4
merges and before Phase 5 starts.

## Non-negotiables (from the brief)

- No invented specs: every port, speed, SKU and position traces to a provenance row; gaps go in `todo`. Reseller-only / inferred models are not GA-eligible.
- Schematic panels always render with their badge, on screen and in every export.
- SVG input is untrusted: sanitize on ingest, cap size, never render an unsanitized master.
- No network in tests; live fetchers behind explicit flags with timeouts and retries on idempotent GETs only.
- No credentials in code (`HPE_PRODUCT_API_URL`, `HPE_PRODUCT_API_TOKEN` from the environment, documented, not required).
- Backward compatible: unbound documents behave exactly as today; no existing field is repurposed.
- `describe_capabilities` gains one pointer line only.

## Seed coverage

Seeded: EdgeConnect EC-XS, EdgeConnect 10104, Aruba 9004, CX 6300M JL664A,
Juniper SRX300. Target families once the feed exists: AOS-CX, EdgeConnect
hardware and EC-V profiles, Aruba gateways, Aruba and Mist APs, Juniper
EX/QFX/SRX/MX/PTX/ACX, ClearPass. Virtual appliances (`form_factor: virtual`)
and modular chassis (`slots`, line cards as entries) each need a fixture
before shipping.
