# Roadmap

Built methodically, one reviewable PR at a time, each reviewed against
[`DESIGN.md`](DESIGN.md).

## Shipped

### Foundation — flipbook + vendored renderer

- Vendored the proven legacy **TopologyDesigner** engine + theme behind a typed
  facade (`src/vendor/topology-ds.ts`); the engine is used as a renderer only.
- Flipbook document model (`src/pages/model.ts`): independent full-frame pages;
  add / duplicate / reorder / rename; the static-frame render seam.
- Persistence (`src/pages/persist.ts`): autosave to localStorage, JSON
  import/export, defensive parse.

### Editor

- Selection (click / shift / marquee), drag-move, grid + snap, zoom / pan,
  undo / redo, delete.
- Smart **alignment + spacing guides**; align / distribute tools.
- **Links**: draw tool, link types + styling, routing (straight / orthogonal /
  curved), and on-canvas **waypoint editing** (drag handles, add via segment
  midpoints, double-click to remove).
- Catalog-driven **palette** + **inspector**; **filmstrip** of pages.
- **Node Designer**: create/edit custom node types (a declarative
  `CustomNodeSpec` rendered by a pure interpreter; the engine's
  `registerNodeType` plugin API).
- **Calm canvas** toggle (pause animation) and self-hosted JetBrains Mono.

### Headless API + contract

- Authoring API (`src/api`): pure ops + fluent builder, DOM-free.
- **Capability catalog**: machine-readable schema of every node / link /
  annotation type and its fields, with a parity test enforcing coverage.
- **Validation**: dangling refs, duplicate ids, unknown types, enum checks.
- **Annotation layer**: zones, flow paths, policy markers — across model,
  builder, catalog, validation, render (browser + headless), persistence, GUI.
- **Document layers** (underlay / overlay / policy / service): declared
  bottom → top on the document, opt-in per element via `layer`, stacking +
  visibility at render time (`visibleLayers`), validated refs — across model,
  builder, catalog, validation, both render paths, persistence, MCP
  (`define_layer`). Groundwork for live SD-WAN flow visualization
  ([proposal](proposals/0001-live-flow-visualization.md), E1).
- **External identity + full CRUD** (`api/source.ts`, `api/edit.ts`): a
  `source` ref (system/kind/id + freshness) on every element, update / remove
  (with dependent cascade) / upsert-by-source ops, validated shape + duplicate
  identity warnings, MCP tools (`update_element`, `remove_element`,
  `upsert_by_source`) — re-running a live import converges instead of
  duplicating ([proposal](proposals/0001-live-flow-visualization.md), E2).

### Layout for AI

- **Ground-truth guidelines** (`layoutGuidelines`) + an overlap/crowding/off-page
  **analyzer** (`analyzeLayout`), folded into `validate`.
- **Auto-layout** (`tidy`): grid-snap + de-overlap + keep-in-bounds; surfaced as
  the editor **Tidy** button and the `tidy_topology` MCP tool.

### MCP

- **stdio** server (`src/mcp`) exposing the whole API as MCP tools
  (`describe_capabilities`, create/get/list/import/delete, templates,
  add_page/node/link/anchor, add_zone/flow_path/policy_marker, set_node_metadata,
  define_node_type, validate, tidy, layout_guidelines, render_svg,
  share_topology). See [`src/mcp/README.md`](../src/mcp/README.md) for the full
  table — a unit test keeps it in sync with the server.
- **Remote on Cloudflare** (`worker/`): the same tools over Streamable HTTP at
  `/mcp`, per-session Durable Object state, OAuth 2.1 (GitHub) auth; the Worker
  also serves the app. Verified live end-to-end (auth → build → validate →
  tidy → render).

## Next / candidate

- **MCP auth hardening** — graduate the single shared secret to per-key KV
  (mint / revoke / label) or full OAuth, if multiple revocable credentials are
  needed.
- **Durable session persistence** — persist a remote session's topology to DO
  storage so it survives hibernation (today it's in-memory for the session).
- **Surface layout warnings in the GUI** — show `analyzeLayout` results in the
  editor (inline badges), not just via the API.
- **More node/link art** — port additional renderers from the legacy monolith as
  needed; richer per-type inspector controls (ports, D2 waypoint UI).
- **Export / share** — standalone HTML or PNG/SVG export of a page or flipbook.
- **Importer** — best-effort import from legacy Topology Studio JSON → pages.

## Retired (kept dormant)

- The **beat / Act-Step-Phase choreography model**: `src/core` (`model` /
  `resolve` / `tween`), `src/render-svg`, `src/sample-scene.ts`. Preserved for
  reference per the "keep it alongside" decision; not wired into the app.

## Out of scope (deliberately)

- A separate viewer/presenter codebase — the editor and any renderer share one
  render path.
- Cross-page inheritance / deltas — pages are independent by design.
- UI-only capabilities — see [`DESIGN.md`](DESIGN.md) #2.
