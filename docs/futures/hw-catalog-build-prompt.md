# Build prompt: Topology Dojo hardware catalog, catalog-aware validation, wire sheets, Visio masters

Paste everything below the line into Claude Code at the root of the Topology Dojo repo, after copying this package's `schema/`, `seed/`, `fixtures/`, and `tools/` folders into the repo under `hw-catalog/`.

---

## Goal

Make Topology Dojo's wire sheets trustworthy. Nodes bind to real hardware models; every cable lands on an interface that exists on that model, with compatible media, optic, and speed. Wire-sheet pages draw real front panels with cables attached at the true port positions. `.vsdx` export emits native Visio masters with named connection points.

The official data sources (HPE product catalog, QuickSpecs, Brand Central SVG masters, Juniper hardware guides) are NOT available yet. Build every importer as a working interface with fixtures and stubs, so that dropping in real data is a data task, not an engineering task.

## What already exists (read before writing code)

1. `hw-catalog/schema/catalog.schema.json`: JSON Schema v1. Two entry kinds:
   - **platform**: physical geometry. Panel size, ports with centers in panel units, `position_confidence` (traced | schematic), glyph paths.
   - **model**: a sellable model. SKUs, OS, OS-native interface names mapped onto platform ports, speeds, PoE, fixed bond groups, provenance with tiers (official_doc | internal_doc | reseller | inferred), and `todo`.
   - Several models can share one platform. The Aruba 9004 and EdgeConnect 10104 are the same chassis with different interface names, and fixture 14 proves the validator respects that.
2. `hw-catalog/seed/`: five models on four platforms, front/rear panel SVGs with `data-port` anchors, four topology symbols, and `optics.json` (generic IEEE optic types plus cage-acceptance rules).
3. `hw-catalog/fixtures/wiring/*.json`: 14 golden fixtures. Each is a mini topology plus the exact multiset of rule codes it must produce.
4. `hw-catalog/tools/`:
   - `check_seed.py`: catalog linter (schema, cross-references, SVG anchor contract).
   - `ref_validate.py`: the reference validator, the **executable spec** for the rules. Its module docstring lists every rule code.
   - `build_seed.py`: regenerates the seed.

   Run `python3 -I hw-catalog/tools/check_seed.py --catalog hw-catalog/seed --schema hw-catalog/schema/catalog.schema.json` and `python3 -I hw-catalog/tools/ref_validate.py --catalog hw-catalog/seed --fixtures hw-catalog/fixtures/wiring`. Both must pass before you change anything.
5. The Dojo document model already has fields you must reuse, not duplicate:
   - Link `fromPort`/`toPort` is the **side** of the node (n/s/e/w), not the interface.
   - `fromLabel`/`toLabel` are free-text port labels.
   - Bundles (`define_bundle`, kinds lag/ecmp/icl) plus `fromBundle`/`toBundle` already model LAGs; catalog bonds map onto lag bundles.
   - `portLabels`, `set_port_table`, `set_sheet`, layers, and `upsert_by_source` exist.

   Read the document types, the validator, the renderer, and the exporters first, and write a short map of where each lives into `docs/sitrep/` before Phase 1.

## Non-negotiables

- **No invented specs.** Every port, speed, SKU, and position traces to a provenance row. If you don't have a source, it goes in `todo`, not in the data. Reseller-only or inferred models are flagged not-GA by the checker; keep that behaviour.
- **Schematic stays visible.** A schematic panel always renders with its badge, on screen and in every export.
- **Treat SVG input as untrusted.** Sanitize on ingest: strip `<script>`, `on*` attributes, `<foreignObject>`, external `href`/`xlink:href`, and CSS `url()`. Cap file size. Never render an unsanitized master.
- **No network in tests.** Importers run against fixtures. Live fetchers sit behind explicit CLI flags, with timeouts on every call and retries with backoff only on idempotent GETs.
- **No credentials in code.** Future product-catalog API credentials come from env vars (`HPE_PRODUCT_API_URL`, `HPE_PRODUCT_API_TOKEN`); document them, don't require them.
- **Backward compatible.** Documents without hardware bindings behave exactly as today. Never repurpose an existing field.
- **Don't bloat `describe_capabilities`.** The catalog is queried through its own tools. `describe_capabilities` gains one line pointing to them.
- **Code standards.** TypeScript in the Worker, strict mode; Python tooling with type hints, `logging`, no bare except, argparse, no `shell=True`.

## Phases

Each phase lands as its own PR with tests. Each phase ends with a sitrep entry in `docs/sitrep/` and a status update in `docs/futures/hw-catalog.md`; create that futures file in Phase 1 from this prompt's phase list.

### Phase 1: Catalog core

- Move `hw-catalog/` to wherever data and tooling belong in this repo. Keep `schema/`, catalog data, fixtures, and Python tools together, and record the final layout in the sitrep.
- Generate TypeScript types from `catalog.schema.json`, generated rather than hand-written so the two cannot drift.
- Add a catalog build step that:
  - validates every entry (port the checks from `check_seed.py`, keeping the Python version as the CLI);
  - bundles all entries plus `optics.json` into one JSON artifact named by content hash (`catalog-<sha256-12>.json`);
  - publishes it to the Worker's existing static or KV/R2 path.
- Version pinning: a document records `catalogVersion` (the hash) the first time a node is bound. Validation uses the pinned version. A `catalog_diff` capability (Phase 3 tool) reports what changed for that document's models between two versions.
- Add a catalog loader in the Worker with an in-memory LRU, and expose `resolveInterface(model, name)` with `{member}` template expansion, matching `catalog_lib.py` exactly.

Exit: the build produces the bundle, the TS loader resolves every seed interface, and a TS port of `catalog_lib` tests matches the Python results on all seed models.

### Phase 2: Bind hardware and validate

- **Node binding.** Add an optional `hw` object to nodes: `{ model: string, sku?: string, stackMembers?: number, face?: "front"|"rear" }`. Binding sets the node's logical symbol from the model's `category`/`symbol` unless the author already set a custom type.
- **Link endpoints.** Add `fromInterface`, `toInterface`, `fromOptic`, and `toOptic`. When an interface is set and the label is empty, render the interface name as the port label.
- **Bonds.** A bundle of kind `lag` whose members are links on a bound node is that node's bond. The bundle needs a per-node `lacp?: boolean`; put it on the bundle definition. Map `ref_validate.py`'s `bonds[]` onto bundles.
- **Validation.** Port every rule in `ref_validate.py` into `validate_topology`:
  - `E_*` codes go into `problems` (which makes `valid=false`);
  - `W_*` and `I_*` codes go into new `warnings` and `notes` arrays. If the result object can't take new arrays without breaking clients, add them behind a response field and document it.
  - Rules run only for endpoints on bound nodes.
  - Message text is free-form, but codes are a contract.
- **Golden tests.** A TS test converts each fixture into a Dojo document (nodes with `hw`, links with interfaces/optics, lag bundles), runs `validate_topology`, and asserts the code multiset equals `expect`. All 14 must pass. Add a fixture for every new rule you introduce, and keep the Python reference and the TS implementation in lockstep. A CI step runs both against the same fixtures and fails on divergence.

Exit: 14/14 fixtures pass in TS and Python, and unbound documents validate exactly as before (prove it with the existing test suite plus a snapshot of three existing documents).

### Phase 3: MCP tools for agents

Keep schemas tight; agents pay tokens for every field.

- `list_hardware({ query?, vendor?, family?, category?, limit=20 })` returns `[{ model, name, category, skus, portSummary, confidence, gaEligible }]`. `portSummary` is a compact string such as `"4x RJ45 1G (lan0-1,wan0-1)"` or `"24x RJ45 1G + 4x SFP56 1-50G"`.
- `describe_hardware({ model })` returns interfaces grouped by role and speed, with ranges collapsed (`1/1/1-24`), plus bond groups, provenance tiers, todo, and panel confidence. Never return raw geometry.
- `bind_hardware({ topologyId, nodeId, model, sku?, stackMembers?, face? })` validates the model id and pins `catalogVersion` on first use.
- `assign_interfaces({ topologyId, linkIds?, strategy: "first-free"|"by-role"|"keep" })` picks free, compatible interfaces for unbound endpoints, preferring role matches (wan for ISP links, lan toward switches, uplinks toward cores). It returns the proposed assignments and applies them only when `apply: true`. This is the tool that makes agents useful on wire sheets.
- `catalog_diff({ topologyId, toVersion? })` lists models in the document whose catalog data changed, and which links would now fail.
- Extend `export_topology` with a `cable-schedule` format (CSV and XLSX) with columns: cable id, A device, A model, A interface, A optic, Z device, Z model, Z interface, Z optic, media, negotiated speed, bundle, layer, notes. This is the wire sheet most customers actually hand to installers.

Exit: tool schemas documented, each tool has tests, and `describe_capabilities` grows by one pointer line only.

### Phase 4: Wire-sheet rendering

- **Page view mode.** Add `view: "logical" | "wiresheet"` (default logical). In `wiresheet` mode, a bound node renders its platform glyph (`front` or `rear` per `hw.face`) instead of the topology symbol, scaled so that panel units map to a page scale chosen per page (mm-accurate on ANSI/ISO sheets).
- **Anchoring.** Link endpoints attach at the interface's port anchor (`data-cx`/`data-cy`), not at node sides. Route cables out of the panel along the nearest edge. Draw a port pill showing the interface name at each used port, and mute unused ports.
- **Schematic badge.** Draw it on every schematic panel, and list schematic models in the sheet's title block notes.
- **Unbound nodes** keep rendering as today on wire-sheet pages.
- **inspect_render.** Add `inspect_render` checks for wire-sheet pages: cable-over-panel overlap, pills overlapping each other, and a cable attached to a port that doesn't exist (this should be impossible after Phase 2; assert it).
- **Exports.** PNG, PDF, and the inline view must all render wire-sheet pages. Add one golden image test per seed platform.

Exit: a branch wire sheet (EC-10104 HA pair to a CX 6300M VSF pair, EdgeHA link, blan0 to LAG) renders correctly in the inline view, PNG, and PDF, with the schematic badge on the CX.

### Phase 5: Native Visio masters in `.vsdx`

- For each platform, generate a Visio master:
  - geometry from the sanitized SVG (rect/circle/path into Geometry sections), or the SVG embedded as the shape's image fill where geometry conversion is lossy;
  - a **named connection point** at every port anchor, with Connections section rows named by OS-native interface name per model (one master per model, sharing platform geometry);
  - Shape Data (Prop) rows for Vendor, Model, SKU, CatalogVersion, Hostname, and Confidence.
- In `.vsdx` export, bound nodes on wire-sheet pages use their model master. Connectors glue to the named connection points, so moving the shape in Visio keeps cables attached.
- Add a `catalog export-stencil` CLI that writes a `.vssx` stencil pack of all GA-eligible models, for people who draw by hand.
- **Verification.** Open the output with LibreOffice headless (`soffice --headless --convert-to pdf`; LibreOffice reads `.vsdx` through libvisio) in a container test. Check that it parses and the PDF has the expected page count, then compare against a golden PDF raster at low DPI. Also hand-check one file in real Visio and record the result in the sitrep. Do not claim Visio fidelity you didn't observe.

Exit: the Phase 4 branch wire sheet exports to `.vsdx`, opens in Visio with glued connectors on the right ports, and has `.vssx` stencils for all seed models.

### Phase 6: Feed importers (scaffold now, real data later)

Every importer writes **drafts** to `catalog/drafts/` with provenance and never writes to the catalog directly. `catalog promote <draft>` runs the checker and the fixture suite, then moves the draft into place. Each importer gets a fixture-backed test.

| Importer | Input | Status now |
|---|---|---|
| `SvgMasterSource` | Brand Central / product-marketing SVG masters dropped in `catalog/inbox/svg/<platform>/{front,rear}.svg` | Full: sanitize, lint against the glyph contract below, extract anchors, update the platform with `position_confidence: traced` and an `official_doc` provenance row |
| `AnchorMapper` CLI | Vendor art that lacks `data-port` attributes | Full: lists port-like shapes (by size and aspect), renders a numbered preview PNG, applies a YAML mapping `shapeIndex -> portId` to write anchors |
| `VssxSource` | `.vssx` stencil packs (OPC zip; masters in `visio/masters/masterN.xml`) | Full parser to candidate platform SVG plus connection points; legacy `.vss` through optional `vss2xhtml` (libvisio-tools) run via `subprocess` with a list argv and timeout, behind a flag |
| `QuickSpecsSource` | HPE QuickSpecs PDF/HTML | Parser for port and SKU tables to a draft model; fixture = one saved QuickSpecs page; human review required |
| `JuniperHwGuideSource` | Juniper hardware-guide HTML (chassis/port tables) | Parser to a draft model; fixture = saved SRX300 chassis page |
| `ProductCatalogApiSource` | Future internal product API | Interface, config from env, contract tests against a mock; no real calls |

**Glyph contract for real masters.** Write it to `docs/catalog-glyph-contract.md`. This is the spec you hand to Brand Central or product marketing:
- viewBox in millimetres at 1:1 with the physical face;
- one `<g data-port="<platform-port-id>" data-cx data-cy>` per port, with centers in viewBox units;
- `id`s stable across revisions;
- no raster, no external references, no scripts;
- text outlined to paths, or Helvetica/Arial only;
- one file per face;
- `data-platform` on the root.

The seed SVGs already follow it; `check_seed.py` enforces it.

**Ownership.** Add `catalog/OWNERS.md` naming the *role* that owns the data feed (HPE product data / TME catalog owner), plus a CODEOWNERS entry with a placeholder team handle. Engineering owns the pipeline, not the data.

Exit: each importer passes its fixture test, `catalog promote` round-trips one draft, and the glyph-contract doc is reviewed.

## Seed coverage and what to add next

Seeded: EdgeConnect EC-XS, EdgeConnect 10104, Aruba 9004, CX 6300M JL664A, Juniper SRX300.

Target families once the feed exists: AOS-CX (6000/6100/6200/6300/6400/8xxx/10000), EdgeConnect hardware (EC-10104/10106/10108, EC-XS/S/M/L/XL successors) and EC-V profiles, Aruba gateways (9000/7000 series), Aruba and Mist APs, Juniper EX/QFX/SRX/MX/PTX/ACX, and ClearPass appliances.

Two modeling patterns to support:
- **Virtual appliances** (EC-V, vSRX) use `form_factor: virtual` with no panel; interfaces come from the deployment profile.
- **Modular chassis** (MX, PTX, CX 6400/8400) use `slots`, with line cards as their own catalog entries.

Add a fixture for each before shipping it.

## Done means

- Both Python tools and the TS suite pass.
- The Phase 4 branch wire sheet renders and exports (PNG, PDF, `.vsdx`, cable schedule).
- Unbound documents are unchanged.
- `docs/futures/hw-catalog.md` shows every phase's status.
- The final sitrep lists what was verified by observation versus by test only.
