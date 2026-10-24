# Sitrep 00 — hw-catalog: where things live (pre-Phase 1 map)

Written before any catalog code, as `docs/futures/hw-catalog-build-prompt.md`
asks. Paths are as of `main` @ `e7777dd`.

## Document types

| What                                                                          | Where                                                                                                       |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `TopologyDocument`, `Page`, legend, stencils                                  | `src/pages/model.ts`                                                                                        |
| `NodeConfig`, `LinkConfig`, `ZoneConfig`, `AnchorConfig`, flow paths, markers | `src/vendor/topology-ds.ts` (typed facade over the vendored engine)                                         |
| Layers / bundles / tiers / link styles / sheet                                | `src/api/layers.ts`, `src/api/bundles.ts`, `src/api/tiers.ts`, `src/api/link-styles.ts`, `src/api/sheet.ts` |
| Source identity (`upsert_by_source`)                                          | `src/api/source.ts`, `src/api/edit.ts`                                                                      |
| Parse / sanitize on load (text caps, unknown fields)                          | `src/pages/persist.ts` (`parseDoc`), `src/api/text.ts`                                                      |
| Field catalog (`describe_capabilities`, inspector)                            | `src/api/catalog.ts`                                                                                        |

Link fields the catalog work must reuse, not repurpose:

- `fromPort` / `toPort` — the node **side** (`n`/`e`/`s`/`w`/corners), not an interface.
- `fromLabel` / `toLabel` — free-text port labels (drawn as chips or pills).
- `fromBundle` / `toBundle` — the bundle name per end; kinds (`lag`/`ecmp`/`icl`) come from `doc.bundles` (`BundleDef { id, kind?, label? }`).

## Validation

| What                       | Where                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Semantic validation        | `src/api/validate.ts` → `validateDocument(doc): Problem[]` (`Problem { level: 'error' \| 'warning', message, where }`) |
| Layout analysis            | `src/api/layout.ts` → `analyzeLayout`                                                                                  |
| MCP `validate_topology`    | `src/mcp/tools.ts` — returns `{ valid, problems, layoutClean }`; `valid` = no `error`-level problem                    |
| Workspace operation checks | `src/workspace/operations.ts`                                                                                          |

## Rendering

| What                                                                | Where                                                                                                                              |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Vendored engine (browser classic script + CommonJS in Node)         | `public/vendor/topology-ds.js`                                                                                                     |
| Engine-agnostic render core                                         | `src/render/core.ts`                                                                                                               |
| Node renderer / Worker renderer                                     | `src/server/render.ts` / `worker/render.ts`                                                                                        |
| Overlays: port pills, port tables, sheet frame, legend, wire labels | `src/render/port-pills.ts`, `src/render/port-table.ts`, `src/render/sheet.ts`, `src/editor/legend.ts`, `src/render/wire-labels.ts` |
| Link attach points / anchor box / hit boxes                         | `src/render/link-attach.ts`, `src/render/hit-boxes.ts`                                                                             |
| Render QA (`inspect_render`)                                        | `src/render/inspect.ts`                                                                                                            |

## Exporters

| What                                    | Where                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| Shared editable-export scene            | `src/export/scene.ts`                                                                       |
| draw.io / Visio / PowerPoint / Mermaid  | `src/export/drawio.ts`, `src/export/vsdx.ts`, `src/export/pptx.ts`, `src/export/mermaid.ts` |
| PNG / PDF (server-side resvg)           | `src/export/raster.ts`, `src/export/print.ts`, `src/export/pdf.ts`                          |
| Browser PNG / PDF / SVG                 | `src/editor/export.ts`                                                                      |
| MCP `export_topology` / `view_topology` | `src/mcp/export-tools.ts`, `src/mcp/viewer-html.ts`                                         |

## MCP + Worker

| What                               | Where                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Tool definitions (pure handlers)   | `src/mcp/tools.ts`                                                                                      |
| Registration (stdio + Worker)      | `src/mcp/register.ts`, `src/mcp/server.ts`, `worker/mcp.ts`                                             |
| Worker HTTP routing, static assets | `worker/default-handler.ts` (falls through to `env.ASSETS` with no sign-in for non-navigation requests) |

## Findings that shape later phases

1. **Static assets are public.** Any path the Worker does not route is served
   from `dist/` without sign-in. Catalog provenance names internal documents,
   so Phase 1 publishes bundles under `public/catalog/` but the Worker refuses
   public `/catalog/*` and reads them only through `env.ASSETS`.
2. **`validate_topology` already returns warnings inside `problems`**
   (`level: 'warning'`, layout findings included), and `valid` only counts
   errors. Phase 2's "W*/I* codes in new `warnings` / `notes` arrays" therefore
   needs care: putting catalog `W_*` in `problems` would not change `valid`,
   but a separate array is what the prompt asks for. Plan: add `warnings` /
   `notes` arrays (additive — existing clients ignore unknown keys) and keep
   `problems` semantics unchanged; record rule codes on each finding.
3. **Bundles are document-level names, not per-node.** A LAG on two nodes
   (e.g. `ae0` on each switch of an ESI-LAG) shares one `BundleDef`; the link
   end says which node. Phase 2's per-node `lacp` therefore needs a per-node
   shape on the bundle definition (e.g. `lacp?: boolean | Record<nodeId, boolean>`),
   to be settled in Phase 2.
4. **Python reference bugs found while porting** (fixed in Phase 1, see
   sitrep 01): `resolve_interface` accepted a trailing newline
   (`re.match(...$)`), and `check_svg` silently passed an anchor missing
   `data-cx`/`data-cy` (NaN comparisons are always false).
