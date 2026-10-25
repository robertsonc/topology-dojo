# Exports, imports and the inline view

Phase 1 ("remove adoption blockers") makes a Topology Dojo diagram usable
where network teams already work. This page is the fidelity contract: what
each format keeps, what it drops, and why. Every export is reachable from the
editor's **⤓ export…** menu and from MCP (`export_topology`); imports go
through **open** and `import_topology`.

| Format             | Direction | Editable in the target tool | Fidelity                                      | Where it runs                    |
| ------------------ | --------- | --------------------------- | --------------------------------------------- | -------------------------------- |
| SVG                | export    | (vector art)                | Pixel-identical to the canvas                 | browser, MCP `render_svg`        |
| PNG                | export    | no                          | Pixel-identical; print DPI stamped            | browser, MCP (server-side resvg) |
| PDF                | export    | no                          | Pixel-identical raster on real paper sizes    | browser, MCP (server-side resvg) |
| draw.io            | both      | yes                         | Structure + geometry; generic outlines        | browser, MCP                     |
| Visio `.vsdx`      | export    | yes                         | Structure + geometry; generic outlines        | browser, MCP                     |
| PowerPoint `.pptx` | export    | yes (shapes) / no (image)   | Shapes mode: structure; image mode: identical | browser (shapes), MCP (both)     |
| Mermaid            | both      | yes                         | Graph only (no coordinates)                   | browser, MCP                     |

The three editable office formats (draw.io, Visio, PowerPoint shapes) are built
from one shared, format-neutral scene (`src/export/scene.ts`), so they agree
on where a node sits, which zone holds it, which layer it is on and which way
a wire runs.

## Light theme

`theme: "light"` exports (SVG, PNG, PDF, flipbook frames, the inline view)
sit on white and draw links, flows, zone borders and labels solid: the
engine's dark-tuned translucent strokes and glows are themed per paint role,
and a render-level test holds primary strokes to ≥ 3:1 and labels to ≥
4.5:1 as composited ([`futures/light-theme-contrast.md`](futures/light-theme-contrast.md)).
Fill washes (cloud fills, zone tints) stay translucent.

## PNG and PDF — print-true raster

Rendered from the same engine SVG as the canvas (`calm`: animation frozen).
In the browser the canvas rasterizes; on the MCP servers resvg (WebAssembly)
does, with JetBrains Mono embedded because a Worker has no system fonts.

- **Sheet sizes print true.** When the document has a standard sheet
  (`set_sheet`: ANSI A–E, A4–A1) the page viewBox is the paper at 96 px/in.
  PDF pages are that paper size in points and the image is placed at true
  scale; PNGs carry a `pHYs` chunk with the DPI, so `dpi: 150` on ANSI C gives
  a 3300 × 2550 image that prints at 22 × 17 in.
- Any frame can be fitted onto a chosen `paper` (`fit` = its true CSS size).
- Default resolution: 150 DPI on paper; PNG without a sheet renders at 2×.
- **Pixel budget:** 40 MP per page on the stdio server, 16 MP in the Worker
  (memory). A larger request renders at a lower DPI and the result says so.
- **Not drawn server-side:** `https:` images inside a page (image nodes, a
  sheet logo) — a render never makes outbound requests. `data:` images work.
  The browser export draws whatever the browser can load.
- PDF is raster by design (like the browser exporter): the engine's SVG uses
  filters a vector converter would drop, so the PDF always matches the canvas.

## draw.io (`.drawio`) — "my team can still edit it"

| Topology Dojo                                                   | draw.io                                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| page                                                            | one `<diagram>` (page) in one `<mxfile>`                                                                           |
| declared layer                                                  | draw.io layer (hidden when the layer's `defaultVisible` is false); untagged → the base layer                       |
| zone                                                            | container (`container=1`); same-layer members are children with relative geometry; zones nest                      |
| node                                                            | vertex wrapped in `<object>`: `dojoType`, label, sublabel, metadata as **Edit Data** properties, `link`, `tooltip` |
| router / firewall / server / load balancer / proxy / mail / NAS | draw.io network stencils (`mxgraph.networks.*`)                                                                    |
| cloud / database                                                | built-in cloud / `cylinder3`                                                                                       |
| basic shapes                                                    | matching built-in shapes                                                                                           |
| link                                                            | edge glued to both ends; waypoints, orthogonal / curved routing, colour, width, dash                               |
| port labels                                                     | edge-end labels                                                                                                    |
| anchor                                                          | 6 px endpoint stub                                                                                                 |

A zone member on a different layer than its zone stays a top-level cell of
its own layer (draw.io children always share their container's layer).

## Visio (`.vsdx`) — the enterprise must-have

| Topology Dojo  | Visio                                                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| page           | page (names de-duplicated — Visio rejects duplicates)                                                                                                                       |
| declared layer | page layer (with visibility); every shape's `LayerMember` set                                                                                                               |
| node           | 2D shape with real geometry (rect / rounded / ellipse / diamond / triangle / hexagon / pentagon / star / cross / arrow / cylinder; clouds as ellipses), 4 connection points |
| node data      | **Shape Data**: `DojoType`, `DojoId`, sublabel, every metadata key, tooltip; `href` → hyperlink                                                                             |
| label          | shape text — inside shapes, under device outlines                                                                                                                           |
| link           | 1D dynamic connector glued to both shapes (`Connects` + `_WALKGLUE` / `_XFTRIGGER`), colour / weight / dash, waypoints as the drawn path, label as connector text           |
| port labels    | small text shapes near each end, plus `FromPort` / `ToPort` Shape Data                                                                                                      |
| zone           | background rectangle in the zone colour and dash, label top-left (bottom for tier bands)                                                                                    |
| image node     | foreign (bitmap) shape for embedded PNG / JPEG / GIF                                                                                                                        |

**Drops:** device glyph art (a generic outline stands in), glow and
animation, flow paths, policy markers, port pills and port tables, the sheet
frame and the legend, `https:` images. Zones are plain rectangles, not Visio
containers (no membership), and Visio may re-route a dynamic connector the
first time a glued shape moves. The export summary lists the flow paths and
policy markers each page dropped.

## PowerPoint (`.pptx`) — one slide per page or per layer

- `slides: "pages"` (default) — one 16:9 slide per page, titled with the page
  name, caption at the bottom, the diagram framed to its content.
- `slides: "layers"` — per page, the full page, then the base plus one
  declared layer at a time: an underlay → overlay → policy walk-through.
- **Shapes mode** (default): preset outlines (rounded rect, ellipse, diamond,
  hexagon, cloud, can, …); straight links are connectors glued to their
  shapes (they follow when a shape moves); orthogonal or waypointed links are
  freeform polylines; link and port labels are text boxes. Each layer's shapes
  are a group named `Layer: …`, so the Selection Pane hides and shows planes
  like layers (hidden on open when the layer is). Node type and metadata go in
  the shape's alt text. Drops the same as Visio; a link to a cloud is glued at
  the other end only (clouds have no simple side connection sites).
- **Image mode** (`pptxMode: "image"`, MCP): the pixel-faithful render as one
  picture per slide — exactly the canvas look, not editable.

## Mermaid — round-trip as text

Export: a `flowchart` per page (direction inferred from the layout), zones as
nested `subgraph`s, links as `---` / `-.-` / `===` with labels, node types as
Mermaid classes (`class r1 router` + a `classDef` for the accent colour).
Import reads those classes back as node types, splits `<br/>` labels into
label + sublabel, nests subgraphs as `parentZone`, then auto-lays the graph
out. Mermaid has no coordinates, layers, port labels or metadata — those drop.

## Wire-sheet pages

A page with `view: "wiresheet"` (hw-catalog) draws hardware-bound nodes as
their real panels with cables at the true ports. PNG, PDF, PPTX image mode,
SVG, the flipbook and the inline view render it (true to scale on the
sheet's paper — see the MCP README). draw.io and PPTX shapes export the page
logical.

**`.vsdx` on wire sheets** (hw-catalog Phase 5) uses native Visio masters:

- **One master per model** (per model, face and stack size), in the
  document stencil, at the panel's real size in inches. Instances on the
  page are sized to the page scale.
  - The geometry is the sanitized panel glyph's rectangles and circles:
    the chassis body filled, ports and other features as outlines.
  - Where the catalog has no art, the master is drawn from the port
    geometry.
- **A named connection point at every port.** The row name is the
  interface with Visio-safe characters (`1/1/1` → `P_1_1_1`). The prompt
  (the tooltip) is the exact OS-native name (`1/1/1`, `wan0`, `ge-0/0/0`).
  A VSF stack master repeats the per-member ports (`2/1/1` …).
- **Shape Data:** Vendor, Model, ModelId, SKU, CatalogVersion, Hostname,
  Confidence (panel position confidence), GAEligible and Face. Instances
  set Hostname, SKU and `DojoId`.
- **Cables glued to the port:** each cable end is a point glue
  (`PAR(PNT(Sheet.N!Connections.Xi, …))` plus a `Connect` to that row). The
  drawn path follows the wire-sheet route, and the interface name is the
  end label.

**Lossy:**

- one fill per master: no silkscreen text, no per-port colour, no glyph
  paths or transformed elements;
- Visio may re-route a dynamic connector when a panel moves (the ends stay
  on their ports);
- port pills, panel badges and the notes box are not drawn.

Without the catalog (or with an unknown pinned version) the page exports
logical, as before.

**Stencil:** `npm run catalog:stencil -- --out hw.vssx` writes a `.vssx` with
one master per GA-eligible model (`--all` adds the rest, `--version` picks a
published bundle). These are the same masters, single-chassis, front face
(rear where only the rear has art).

## Cable schedule (CSV / XLSX) — the sheet installers work from

`format: "cable-schedule"`, `scheduleFormat: "csv"` (default) or `"xlsx"`.
One row per link with the columns `cable id`, `A device`, `A model`,
`A interface`, `A optic`, `Z device`, `Z model`, `Z interface`, `Z optic`,
`media`, `negotiated speed`, `bundle`, `layer`, `notes` (a leading `page`
column when a multi-page document is exported whole). Devices are node
labels; models are catalog names (with the SKU when bound with one);
interfaces fall back to the author's port label on unbound ends. Media and
negotiated speed come from the hardware catalog's wiring checks and stay
blank where the catalog cannot know (unbound ends, a cage with no declared
optic on both sides). `notes` is the link label plus the catalog rule codes
on that cable (e.g. `W_OPTIC_UNDECLARED`).

CSV is RFC 4180 with CRLF line ends; a cell starting with `=`, `+`, `-`,
`@`, tab or CR is prefixed with `'` so spreadsheet apps do not run it as a
formula. XLSX is one sheet of inline strings (never formulas), bold frozen
header row, autofilter, sized columns.

## draw.io import — migrate existing diagrams in

`import_topology` and the editor's **open** accept `.drawio` / `.xml`
(`<mxfile>` or a bare `<mxGraphModel>`, plain or compressed):

- pages → pages; extra layers → declared layers (visibility kept);
- containers, swimlanes and groups → zones (nested → `parentZone`);
- vertices → nodes centred where the shapes were; the type is the exported
  `dojoType` when present, else inferred from the stencil or style (router,
  switch, firewall, server, AP, load balancer, cloud, database, host, …), else
  the matching basic shape; text cells → text nodes; images → image nodes;
- edges → links with routing, dash, colour, width and waypoints; edge-end
  labels → port labels; an end not attached to a shape → an anchor;
- `<object>` / `<UserObject>` data → node metadata; `link` / `tooltip` kept.

Dropped with a warning: custom (Node Designer) types the file names but the
document does not declare, unresolvable edges. draw.io-only styling,
rotation and rich HTML formatting drop silently. The parser does no DTD or
entity expansion and bounds size, depth, pages and cells.

## Inline view in chat (MCP Apps)

`view_topology` opens an interactive view in hosts that support MCP Apps:
pan, zoom, pinch, page switching, layer toggles, light / dark, full screen,
and downloads in every format above (handed to the host with
`ui/download-file`, so files never pass through the model). See
[`src/mcp/README.md`](../src/mcp/README.md#inline-view-mcp-apps).

## Verification

The wire-sheet `.vsdx` is converted by LibreOffice headless in CI (the
`visio` job, `src/export/visio-render.test.ts`). The test checks the page
count, the paper size and a low-DPI golden, and renders one catalog-sheet
page per seed model.

Structure is unit-tested (`src/export/*.test.ts`, `src/import/drawio.test.ts`,
`src/mcp/export-tools.test.ts`; Worker rasterization in
`src/testing/worker-raster.test.ts`). Rendering of `.vsdx` and `.pptx` was
checked by opening the files in LibreOffice (Draw / Impress) — **not yet in
Microsoft Visio or PowerPoint**; do that before claiming Office fidelity to a
customer.

The cable-schedule XLSX was read back with openpyxl 3.1.5 (no warnings) and
converted with LibreOffice headless; both see the same strings, and a
formula-looking label stays a string cell.
