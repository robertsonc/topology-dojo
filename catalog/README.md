# Hardware catalog

Real hardware models for Topology Dojo wire sheets: physical panel geometry
(platforms), sellable models with OS-native interface names (models), the
optics table, panel glyphs, golden wiring fixtures, and the Python reference
tools that define the rules. Roadmap and phase status:
[`docs/futures/hw-catalog.md`](../docs/futures/hw-catalog.md).

```
catalog/
  schema/catalog.schema.json   v1 schema: platform (geometry) + model (SKUs, OS names, speeds, bonds, provenance)
  data/                        the catalog (source of truth)
    platforms/*.json           4 platforms (2 traced, 2 schematic)
    models/*.json              5 models
    glyphs/platforms/*.svg     front/rear panels with data-port anchors
    glyphs/symbols/*.svg       topology symbols (currentColor)
    optics.json                generic IEEE optic types + cage acceptance
  fixtures/
    wiring/*.json              15 golden wiring fixtures + expected rule codes (Python + TS)
    resolve/golden.json        resolve_interface parity golden (Python ⇄ TypeScript)
  tools/                       Python reference tools (stdlib + jsonschema)
    catalog_lib.py             loader + resolve_interface (the spec the TS port matches)
    check_seed.py              catalog linter (schema, cross-refs, SVG anchor contract)
    ref_validate.py            reference wiring validator (executable spec for rule codes)
    resolve_probe.py           writes / checks fixtures/resolve/golden.json
    build_seed.py              regenerates data/ from the curated seed definitions
```

## Commands

```bash
# Python reference tools (the spec). jsonschema is optional for the linter.
python3 -m pip install jsonschema==4.23.0
python3 -I -B catalog/tools/check_seed.py --catalog catalog/data --schema catalog/schema/catalog.schema.json
python3 -I -B catalog/tools/ref_validate.py --catalog catalog/data --fixtures catalog/fixtures/wiring
python3 -I -B catalog/tools/resolve_probe.py --catalog catalog/data --check catalog/fixtures/resolve/golden.json

# TypeScript build: lint with the check_seed.py port, publish the bundle.
npm run catalog:build     # -> public/catalog/catalog-<sha256-12>.json + manifest.json
npm run catalog:types     # regenerate src/catalog/types.generated.ts from the schema
npm run catalog:check     # CI: bundle and types are current

# Visio stencil: one master per GA-eligible model (--all: every model).
npm run catalog:stencil -- --out hw.vssx [--all] [--version <12-hex>]
```

After editing anything in `data/`: run the three Python tools, then
`npm run catalog:build`, and commit the new bundle (old bundles stay —
documents pin the version they were bound with). If a resolution changed,
regenerate the parity golden with
`python3 -I -B catalog/tools/resolve_probe.py --catalog catalog/data > catalog/fixtures/resolve/golden.json`.

## How the app uses it

- `src/catalog/catalog.ts` — bundle types, `Catalog`, `resolveInterface`.
- `src/catalog/build.ts` — loader, linter and bundle hashing (Node, build time).
- `src/catalog/loader.ts` — versioned loader with an in-memory LRU; sources in
  `src/server/catalog.ts` (disk) and `worker/catalog.ts` (ASSETS binding).
- The Worker refuses public HTTP requests for `/catalog/*`: provenance rows
  name internal documents.
- `src/catalog/validate.ts` — the `ref_validate.py` port behind
  `validate_topology`; `src/catalog/describe.ts`, `assign.ts`, `diff.ts` —
  the `list_hardware` / `describe_hardware`, `assign_interfaces` and
  `catalog_diff` MCP tools (`src/mcp/hardware-tools.ts`). Agent-facing views
  return provenance **tiers** only, never sources.
- `src/export/cable-schedule.ts` — `export_topology` `cable-schedule`
  (CSV / XLSX).
- `src/catalog/sanitize-svg.ts` — panel glyphs are untrusted: the build
  sanitizes each one into the bundle (`glyphs`), and the wire-sheet renderer
  (`src/render/wiresheet.ts`) sanitizes again before drawing.

## Seed provenance at a glance

| Model             | Ports from                                                 | Panel positions                                  | GA-eligible                   |
| ----------------- | ---------------------------------------------------------- | ------------------------------------------------ | ----------------------------- |
| EdgeConnect 10104 | EC-10104 install guide (official) + internal blan0 diagram | traced from the 9004 guide figure (same chassis) | yes, once SKUs are confirmed  |
| Aruba 9004        | 9004 install guide                                         | traced (shared chassis)                          | yes; interface names inferred |
| EdgeConnect EC-XS | Silver Peak port-layout sheet (internal)                   | traced from photo, relative units                | yes; speeds inferred          |
| Juniper SRX300    | Juniper chassis page (official)                            | schematic                                        | yes for ports; panel badged   |
| CX 6300M JL664A   | reseller listings only                                     | schematic                                        | **no**, until QuickSpecs      |

Every row with tier `inferred` or `reseller`, and every `todo`, is a gap the
data owner must close. The checker and renderer surface them; nothing hides
them.
