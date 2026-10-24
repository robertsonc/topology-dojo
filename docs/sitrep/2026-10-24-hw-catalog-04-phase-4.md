# Sitrep 04 — hw-catalog Phase 4: wire-sheet rendering

Status: **done**, in review. Next: Phase 5 (native Visio masters). Phase 3
merged as PR #287.

## What landed

- **Glyphs in the bundle, sanitized.** `src/catalog/sanitize-svg.ts`
  parses each panel SVG (the existing XML parser, which refuses DTDs),
  rebuilds it from an element and attribute allowlist, and re-serializes
  it. Removed: `<script>`, `<foreignObject>`, `<style>`, `<image>`, `<a>`,
  animation, `on*` attributes, any `href` that is not `#id`, and any `url()`
  that is not `url(#id)`. Input is capped at 512 KB. The build sanitizes
  every glyph into the bundle (`glyphs`); the checker warns if sanitizing
  would remove anything (the seed is clean); and the renderer sanitizes the
  bundled copy again before drawing. New bundle **`868980b39f5b`**; the
  glyph-less `f78a0ae494f4` stays published for pinned documents.
- **Page fields.** `view: "logical" | "wiresheet"` (default logical) and
  `panelScale` (k in 1:k). Both are persisted, accepted by
  `set_page_properties` and workspace `PAGE_FIELDS`, kept in editor undo
  snapshots, and validated (an out-of-range scale, or a wire sheet with no
  bound node, is a warning).
- **The transform** (`src/render/wiresheet.ts`) is render-time only; the
  stored document never changes.
  - **Panels.** Each bound node is drawn as its panel. A per-(platform,
    face, scale, members) node type draws the art, and its hit box is the
    panel, registered with the engine and with the TypeScript mirrors
    (attachment, zones, inspect).
  - **Face.** The face shown is `hw.face` if the catalog has art for it,
    otherwise the face it does have, with a note. The EC-10104 / 9004
    chassis only has rear art, and its ports are on the rear.
  - **Stacks.** A VSF stack draws one chassis per member, and `n/1/x`
    resolves onto member n.
  - **Cable ends.** Each end is pinned with the engine's existing
    `fromPort` + `fromPortOffset` under `linkAttach {pad:0}`, exactly
    above or below its port, plus a lead waypoint so the cable leaves
    perpendicular whatever the line style.
  - **Exit edge.** Ports near the top or bottom leave by the nearest edge;
    single-row (mid-height) ports leave toward the far end. A stack leaves
    member 1 by the top and the last member by the bottom. A lead that has
    to leave away from its far end detours around the panel's nearer side.
  - **Overlay.** The overlay draws the plug (port to edge), a port pill
    naming the interface, and a two-line header (hostname; model, SKU,
    face). The header goes in the first spot clear of pills, panels,
    routes and labels, and stays on the page. Cable labels are drawn on the
    longest leg of the route.
  - **Badges.** `SCHEMATIC` on every schematic panel, `NOT TO SCALE` on
    relative-unit panels (EC-XS), `GEOMETRY ONLY` where the pinned catalog
    has no art (the panel is drawn from catalog port geometry, so positions
    stay true).
  - **Notes.** Scale, schematic models, face fallbacks and geometry-only
    models go into the title block notes, or into a notes box in the first
    clear corner when the document has no title block.
- **Scale.** 1 panel mm = 96 / 25.4 / k px. On a sheet the viewBox is
  96 px/in of paper, so the PDF is true to scale. The auto pick is the
  largest standard scale at which the widest panel fits 45 % of the page.
- **Render paths.** `RenderOptions.hardware` feeds
  `renderDocumentWithEngine`. Through MCP, `withHardware` (in
  `src/mcp/hardware-render.ts`) loads the pinned catalog for documents
  that have a wire-sheet page, and snapshots the document first. Every
  other document keeps the synchronous path and exactly today's output.
  Covered: `render_svg`, `export_topology` (PNG / PDF / PPTX image),
  `view_topology`, `export_flipbook` and `inspect_render`. With no
  catalog, the page renders logical.
- **`inspect_render`** inspects the sheet as drawn and adds
  `wiresheet: { scale, panels, cables, notes }`. Its checks:
  - a cable crossing a panel (problem);
  - port pills overlapping each other or a panel (problem);
  - a cable on a port the platform lacks — an assertion, reported as a
    problem and never a crash (a corrupt catalog makes `resolveInterface`
    throw; the layout catches it);
  - ends drawn at the panel edge, with no interface, a member off the
    sheet, or off-face (notes).

## Deviations and limits, with reason

- **Logical fallbacks.** The browser editor shows wire-sheet pages as
  logical, because it cannot load the catalog (it is Worker-internal by
  design). draw.io, `.vsdx` and PPTX-shapes exports are logical too; native
  Visio masters are Phase 5.
- **Approximate routes.** The engine draws the cables. My route model
  (used for labels, header placement and the cable-over-panel check) is
  exact for panel ends and approximate at unbound ends (node centre, not
  the engine's attach point).
- **EdgeHA port.** Which EC-10104 port carries EdgeHA in the exit fixture
  (wan1) is a drawing choice, not catalog data.
- **Collisions are reported, not solved.** Two cables in the same column on
  a stack's inner rows, or very dense panels at small scales, can still
  collide. `inspect_render` reports it; it is not auto-resolved.

## Verification

| Claim                                                                                                             | How it was verified                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sanitizer strips scripts / handlers / foreignObject / external refs / CSS url()                                   | `src/catalog/sanitize-svg.test.ts` (a hostile sample; idempotence; size cap; DTD refused; every seed glyph unchanged) and a tampered bundle rendered with nothing hostile in the output (`wiresheet.test.ts`)                                                                                          |
| Exit sheet renders correctly (EC-10104 HA pair to a CX VSF pair, EdgeHA, blan0 to LAG, schematic badge on the CX) | Looked at it: PNG (light and dark, plus a 2.5× crop showing the plugs on the port centres), PDF (`pdfinfo`: 1 page, 1224×792 pt = ANSI B; rasterized and inspected), and the real `VIEWER_HTML` in Chromium under a mock MCP Apps host (dark, then the light toggle re-rendering through `render_svg`) |
| Scale is true on paper                                                                                            | 442 mm CX at 1:2.5 → 668 px at 96 dpi → 176.8 mm on the ANSI B PDF                                                                                                                                                                                                                                     |
| Golden image per seed platform                                                                                    | `src/render/wiresheet-golden.test.ts`: 4 PNGs in `src/render/__goldens__/`, each looked at before commit; pixel compare with an anti-aliasing tolerance                                                                                                                                                |
| Layout facts (ports, members, exits, detours, notes)                                                              | `src/render/wiresheet.test.ts` (18)                                                                                                                                                                                                                                                                    |
| inspect checks fire                                                                                               | Forced cases: pills colliding at 1:10, a panel in a cable's path, a port missing from the platform                                                                                                                                                                                                     |
| MCP paths                                                                                                         | `src/mcp/wiresheet-tools.test.ts`: `render_svg` (async here, still sync elsewhere), no-catalog fallback, `inspect_render`, PNG + PDF, `view_topology`, flipbook, `set_page_properties`                                                                                                                 |
| Nothing else moved                                                                                                | Full suite 1624/1624, lint, typecheck (root + worker), build (both bundles in `dist/catalog`), `catalog:check`, Python tools (0 errors, 15/15)                                                                                                                                                         |

Not verified: a deployed Worker (no deploy made), and printing the PDF on
real paper.
