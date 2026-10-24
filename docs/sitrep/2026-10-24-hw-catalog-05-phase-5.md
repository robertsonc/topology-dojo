# Sitrep 05 — hw-catalog Phase 5: native Visio masters

Status: **implemented, in review; the real-Visio check is pending** (the
owner opens the files by hand). Next: Phase 6 (feed importers). Phase 4
merged as PR #288; the light-theme contrast fix merged as PR #289.

## What landed

- **Model masters** (`src/export/visio-masters.ts`). One master per
  (model, face, stack members).
  - **Size.** Real size in inches (panel mm / 25.4). A VSF stack master
    holds one chassis per member, 4 mm apart, as the wire sheet draws it.
  - **Geometry.** The rectangles, circles and ellipses of the _sanitized_
    panel glyph (`sanitizeSvg` again, so a hostile bundle cannot reach
    Visio).
    - Visio geometry cells are expressed as fractions of Width / Height,
      so instances scale.
    - The chassis body (the first rect covering ≥ 80 % of the panel) is
      filled; everything else is an outline.
    - Platforms with no art fall back to their port geometry.
  - **Connection points.** One named row per interface on the face, per
    member for `{member}` interfaces. The row name is a Visio-safe form of
    the interface (`1/1/1` → `P_1_1_1`, `wan0` → `wan0`). The **Prompt is
    the exact OS-native name**, so the tooltip reads `1/1/1`.
  - **Shape Data:** Vendor, Model, ModelId, SKU, CatalogVersion, Hostname,
    Confidence (panel `position_confidence`), GAEligible and Face.
  - **IDs.** UniqueID and BaseID are deterministic GUIDs, so the same
    catalog gives byte-identical masters.
- **`.vsdx` wire sheets** (`src/export/vsdx.ts`).
  - **Instances.** On a `view: "wiresheet"` page each bound node becomes
    an instance of its model master, at the panel's page-scale size.
    - Instances override Hostname, SKU (the bound SKU) and `DojoId`.
    - They also carry evaluated local values (`F="Inh"`) for geometry,
      connection points and text, because readers that do not evaluate
      formulas (libvisio) would otherwise draw the master's size.
  - **Glue.** Every cable end on a port is point-glued:
    `BeginX = PAR(PNT(Sheet.N!Connections.Xi, Sheet.N!Connections.Yi))`
    plus `<Connect ToCell="Connections.Xi" ToPart="100+i-1">`.
  - **Routes.** The drawn path is the wire-sheet route (leads, detours),
    and the end labels are the interface names.
  - **Other pages.** Logical pages, and wire sheets exported without a
    catalog, are unchanged.
  - **MCP.** `export_topology format:"vsdx"` passes the catalog it already
    loads for wire sheets (`withHardware`).
- **Connector labels.** Connectors with text now get a text box (`TxtPinX/Y`,
  `TxtWidth`, `TxtLocPin*`). This fixes vertical labels wrapping one letter
  per line in LibreOffice, and it applies to every `.vsdx` export.
- **Stencil** (`src/export/vssx.ts`, `scripts/catalog-export-stencil.ts`).
  - `npm run catalog:stencil -- --out hw.vssx [--all] [--version <hash>]`
    writes a `.vssx` with one single-chassis master per **GA-eligible**
    model: 4 of the 5 seed models.
  - The CX 6300M JL664A is schematic (not GA-eligible), so it needs
    `--all`, which gives 5.
  - The masters are the same code as the `.vsdx` masters.
- **CI.** A new `visio` job installs LibreOffice Draw and poppler and runs
  `src/export/visio-render.test.ts` with `REQUIRE_LIBREOFFICE=1`. Locally
  the test skips when `soffice` is missing.

## Deviations and limits, with reason

- **"Stencils for all seed models" vs "GA-eligible".** The brief asks for
  both. The default follows the CLI spec (GA only); `--all` covers every
  seed model. The CX master also exists in every `.vsdx` that binds it.
- **Geometry is approximate art.**
  - Only untransformed rect / circle / ellipse elements convert.
  - Paths, text (silkscreen labels), gradients and per-element colours do
    not.
  - One fill per master: a dark body with light outlines.
  - Embedding the SVG as a foreign object was not used: libvisio does not
    render SVG foreign data, and a picture has no geometry to glue to.
- **Visio may re-route** a dynamic connector when a glued panel moves. The
  ends stay on their ports (that is the glue); the path between them is
  Visio's.
- **Not carried:** port pills, the SCHEMATIC / NOT TO SCALE / GEOMETRY ONLY
  badges and the notes box. The interface name is on the connector end and
  in the connection-point prompt instead.
- **A `.vssx` cannot be rendered by LibreOffice** (no pages: it opens
  blank). The render check therefore uses a catalog sheet: one wire-sheet
  page per seed model, each instancing its master. The stencil itself is
  checked structurally.

## Verification

| Claim                                                       | How it was verified                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One connection point per port, named by interface           | `src/export/visio-masters.test.ts`, every seed model: the count equals the interfaces on the face; row names are valid and unique; prompts equal the interface names, in order; positions are within the shape; a stack master repeats only the per-member ports, with member 1 above member 2                                                                                              |
| Shape Data present                                          | The same test: the six brief fields plus GAEligible; CatalogVersion equals the bundle                                                                                                                                                                                                                                                                                                       |
| Connectors glued to the right ports                         | The same test, on the Phase 4 branch sheet: every pinned cable end (≥ 10) has a `Connect` to a master instance; the `PAR(PNT(...))` formula references that instance and row; and the **master's prompt at that row is the end's interface**                                                                                                                                                |
| Package valid                                               | Every override exists; every relationship target exists; every part parses (`.vsdx` with masters, `.vsdx` without the catalog, `.vssx`)                                                                                                                                                                                                                                                     |
| Opens in a real Visio reader                                | LibreOffice 24.2 headless (libvisio) → PDF. Branch sheet: 1 page, 1224 × 792 pt (ANSI B); rasterized at 24 dpi it matches a golden (`src/export/__goldens__/vsdx-branch-wiresheet.png`) that I looked at before commit: panels at page scale, cables on the right ports including VSF member 2, detours intact. Catalog sheet: 5 pages, one per seed model, each with ink (its master drew) |
| MCP path                                                    | `src/mcp/wiresheet-tools.test.ts`: `export_topology` vsdx has masters and point glue; without a catalog it has none                                                                                                                                                                                                                                                                         |
| Stencil                                                     | 4 GA masters by default (CX skipped and reported); 5 with `--all`; stencil content type; no pages                                                                                                                                                                                                                                                                                           |
| Nothing else moved                                          | Full suite 1648 / 1648, lint, typecheck (root + worker), build                                                                                                                                                                                                                                                                                                                              |
| **Opens in Microsoft Visio with connectors glued on ports** | **Pending: the owner's hand check.** Files: the branch wire sheet `.vsdx`, the catalog sheet `.vsdx`, and the GA and `--all` `.vssx` stencils. Not claimed until observed                                                                                                                                                                                                                   |

Real-Visio checklist (to record here once done):

1. Each file opens without a repair prompt.
2. The Document Stencil (More Shapes → Document Stencil) shows the model
   masters; the `.vssx` opens as a stencil.
3. Hovering a port connection point shows the interface name.
4. Dragging a panel keeps every cable end on its port.
5. Shape Data on a panel shows Vendor / Model / SKU / CatalogVersion /
   Hostname / Confidence.
