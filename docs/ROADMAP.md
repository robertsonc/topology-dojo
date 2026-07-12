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
- **Connector layer** (`src/connect/`): vendor-neutral `TopologyProvider`
  (appliances / underlay+overlay tunnels / overlay policies / fabric-wide flow
  tables incl. ended flows), EdgeConnect Orchestrator client (appliance-API
  proxy, injectable fetch), fixture `MockProvider`, env/secret credential
  wiring (stdio + Worker), read-only MCP tools, and runtime Zod validation of
  all tool arguments ([proposal](proposals/0001-live-flow-visualization.md),
  E3).
- **Flow-to-topology compiler** (`src/connect/compile.ts`): provider records →
  layered, sourced, laid-out document — appliances as nodes, sites as zones,
  underlay/overlay tunnels as links on their layers, flows as animated flow
  paths with per-hop data (`FlowPathConfig.hops`) + policy markers for the
  steering overlay; convergent re-runs (upsert-by-source throughout);
  ingress/egress flow dedupe; the one-shot `build_flow_topology` MCP tool
  ([proposal](proposals/0001-live-flow-visualization.md), E4).
- **Flipbook playback**: `Page.duration` / `transition` in the contract
  (builder, persist, validate, `add_page` / `set_page_properties`), a shared
  pure timing model (`pages/playback.ts`), the filmstrip **play** control +
  inspector playback fields, and `export_flipbook` — a standalone,
  self-playing HTML artifact of every page on its duration
  ([proposal](proposals/0001-live-flow-visualization.md), E5; also delivers
  the "standalone HTML export" roadmap candidate).

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
  `/mcp`, a transport/private-draft Durable Object plus durable per-owner draft
  registry, OAuth 2.1 (GitHub) auth; the Worker also serves the app. Verified
  live end-to-end (auth → build → validate → tidy → render).

### Phase 0 — shared human-agent workspace (vertical slice)

- One canonical `TopologyDocument` coordinator per owner/document with atomic
  revisions, idempotent semantic operation batches, field-level optimistic
  rebase, and explicit conflicts.
- Per-page snapshots instead of one whole-document storage value; bounded
  change log, manifest, and targeted element hydration keep both storage and
  model context proportional to the affected region.
- **Suggest only** agent default: named proposals reviewed/accepted/rejected in
  the editor as one revision. Direct agent commits require a browser-granted,
  revocable ten-minute current-page lease.
- Failure-safe lazy migration from the login-keyed `tdoc:` registry into a
  stable numeric-owner directory. The source snapshot remains intact, while
  stale legacy mutation is refused after handoff.
- Agent Workspace UI: hand off the local document, open existing/legacy
  workspaces, see sync/revision/conflict state, review semantic proposal detail,
  and grant/revoke the page lease.
- Remote MCP delta surface: canonical workspace creation/listing, manifest,
  on-demand operation vocabulary, bounded changes, targeted elements, proposals,
  and leased operations. See
  [`proposals/0002-shared-human-agent-workspace.md`](proposals/0002-shared-human-agent-workspace.md).

## Next / candidate

- **Isolated staging and deployment safety** — disable broken non-production
  version uploads on the production Worker; provision separate staging OAuth,
  KV, and Durable Object resources; make GitHub Actions the single CI-gated
  deployment authority; add smoke/health checks; bootstrap migration `v3` with
  workspace entry points disabled; and exercise forward recovery before
  production activation. See
  [`proposals/0004-isolated-staging-and-deployment-pipeline.md`](proposals/0004-isolated-staging-and-deployment-pipeline.md).
- **Agentic implementation workflows** — build roadmap features from bounded
  implementation packets with explicit ownership, risk-based validation,
  adversarial architecture/UX review, durable Git handoff, and protected human
  merge/deployment gates. Pilot on deployment safety and one editor
  quality-of-life feature. See
  [`AGENTIC_IMPLEMENTATION_WORKFLOW.md`](AGENTIC_IMPLEMENTATION_WORKFLOW.md).
- **MCP auth hardening** — graduate the single shared secret to per-key KV
  (mint / revoke / label) or full OAuth, if multiple revocable credentials are
  needed.
- **Workspace review polish** — rendered before/after proposal preview,
  selective acceptance, named checkpoints, restore/fork, and revision timeline.
- **Workspace resilience/collaboration** — IndexedDB offline cache, WebSocket
  push/presence, explicit collaborator/organization ACLs, and finer element-set
  leases. Add CRDTs only if offline multi-master editing becomes a measured need.
- **Adaptive authoring profiles** — learn repeated, durable user corrections as
  scoped preference candidates; require confirmation before application; fetch
  only task-relevant rules under a hard token budget. MCP schemas remain stable,
  while product guidance evolves through reviewed/versioned packs. See
  [`proposals/0003-adaptive-agent-authoring-profiles.md`](proposals/0003-adaptive-agent-authoring-profiles.md).
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
