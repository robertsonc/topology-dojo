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
- **Inline layout warning badges**: `analyzeLayout` / `validateDocument`
  problems render as small badges anchored to the offending elements on the
  canvas, alongside the existing clickable problems panel.
- **Flat viewer**: glow is an emphasis-only channel — nodes/links/zones/labels
  render flat and crisp on a single flat background; only playback-emphasis
  (spotlight) elements get one soft glow. Applied at the shared render seam
  (`flattenViewer`), so the live canvas and exported SVG/PNG/flipbook match.

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
- **Legacy importer** (`src/import/legacy.ts`): best-effort converter from
  legacy Topology Studio JSON → pages, validated against real fixtures, wired
  into the GUI open flow and exposed through a `format` parameter on the
  `import_topology` MCP tool.

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
- **Rendered proposal preview**: a before/after render of a pending agent
  proposal with changed elements highlighted, shown in the review flow (first
  of the workspace review-polish follow-ons).
- **Selective proposal acceptance**: the owner accepts a coherent subset of a
  proposal's operations as one attributed revision; the coordinator rejects a
  subset that references an element only an unselected op would create; the
  remainder stays reviewable (partially-accepted) and re-validates against the
  new revision.
- **Named checkpoints, restore & fork**: snapshot the document as a named
  checkpoint (agents may create/list; restore & fork are browser-owner actions),
  restore one forward-only as a new revision, or fork one into a fresh
  workspace. `create_checkpoint` / `list_checkpoints` MCP tools (a temporary
  DESIGN #2 authority carve-out).
- **Revision timeline**: the Agent Workspace panel shows recent revisions with
  actor, summary, a source badge (edit / agent / proposal / restore), and
  proposal-acceptance + checkpoint markers, from the stored change log.

### Deployment & release safety (proposal 0004)

Infrastructure delivered and proven on staging; production activation of the
shared workspace remains a protected operator step (see the residual item under
Next / candidate).

- **Isolated staging environment**: a stable `topology-dojo-staging` Worker
  with its own KV namespaces, Durable Object namespaces, GitHub OAuth
  App/secret, and origin; a `check-wrangler-env.mjs` CI guard enforces that
  staging and production share no resource ids. Closes finding M14.
- **CI-gated deployment pipeline**: `deploy-staging.yml` and
  `deploy-production.yml` re-run the CI `check` before deploying (`ci.yml` is
  reusable via `workflow_call`); production is restricted to `main`, requires a
  protected environment approval, and the CI `check` is a required status. The
  ungoverned `npm run deploy` laptop path was removed. Closes finding L1;
  closes H7 once Workers Builds is disconnected from production (operator O9/O10).
- **Feature flag + migration bootstrap**: a `WORKSPACE_ENABLED` flag 503-gates
  the workspace API, hides the workspace MCP tools, and disables the panel, so
  migration `v3` can bootstrap the `TopologyDocument` namespace in production
  with workspace entry points disabled.
- **Smoke + health + recovery docs**: `scripts/smoke.mjs` external smoke suite
  (deployed-sha assertion, live-propagation wait), `GET /healthz` and
  `GET /readyz` endpoints, and written rollback / forward-recovery runbooks.
  First fully-green gated staging deploy: run #4. Substantially closes M15
  (alerting + staging game day remain — operator O12 and the ROLLBACK.md game
  day).

## Next / candidate

The items below are sequenced into dependency-ordered implementation packets
in [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).

- **Production workspace activation** — the residual operator steps after the
  staging pipeline (now shipped, above): run the staging forward-recovery game
  day; bootstrap migration `v3` in production with `WORKSPACE_ENABLED=false`;
  disconnect Workers Builds and make GitHub Actions the sole production deploy
  authority; configure Cloudflare error-rate alerting + nightly staging smoke;
  then flip the workspace flag under the agreed observation window. See
  [`proposals/0004-isolated-staging-and-deployment-pipeline.md`](proposals/0004-isolated-staging-and-deployment-pipeline.md)
  and the operator checklist in
  [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) §4.7.
- **Agentic implementation workflows** — build roadmap features from bounded
  implementation packets with explicit ownership, risk-based validation,
  adversarial architecture/UX review, durable Git handoff, and protected human
  merge/deployment gates. Pilot on deployment safety and one editor
  quality-of-life feature. See
  [`AGENTIC_IMPLEMENTATION_WORKFLOW.md`](AGENTIC_IMPLEMENTATION_WORKFLOW.md).
- **MCP auth hardening** — graduate the single shared secret to per-key KV
  (mint / revoke / label) or full OAuth, if multiple revocable credentials are
  needed.
- **Workspace resilience/collaboration** — IndexedDB offline cache, WebSocket
  push/presence, explicit collaborator/organization ACLs, and finer element-set
  leases. Add CRDTs only if offline multi-master editing becomes a measured need.
- ~~**Adaptive authoring profiles**~~ — **shipped** (proposal 0003, packets
  P1–P5): deterministic feature extraction, observe-only learner
  (`AuthoringProfile` DO, migration `v4`), the Authoring Preferences panel,
  browser-owner confirmation & scoping, bounded read-only guidance MCP tools
  under hard token budgets, and outcome refinement (contradictions →
  workspace-scoped exceptions + decay toward review). Live in production.
  0003-D (governed product guidance) remains deliberately out of scope. See
  [`proposals/0003-adaptive-agent-authoring-profiles.md`](proposals/0003-adaptive-agent-authoring-profiles.md).
- ~~**Owner analytics / admin dashboard**~~ — **shipped (MVP), live in
  production**. An owner-only dashboard (reachable only by the deployment
  owner's GitHub login) over a new `AnalyticsLog` SQLite Durable Object
  (migration `v5`, single global instance): a login roster
  (`{ uid, login, name?, firstSeenAt, lastLoginAt, loginCount }`) + a bounded
  recent-login log, recorded best-effort off the browser-login success path
  (`ctx.waitUntil`, never blocking a login). The owner-gated `/api/admin/*`
  routes serve the roster/totals and, per user, their workspace names/counts
  read **live** from the existing registries — **metadata only, never diagram
  contents**. Gated server-side and fail-closed (no `ADMIN_GITHUB_ID` match ⇒
  403). Shipped inert behind `ANALYTICS_ENABLED` (opt-in, like profiles): `v5`
  bootstrapped off in production (Gate B) then activated by a flag-flip deploy
  (Gate C). Captures data going forward only (no historical backfill).
  **Follow-ups (deferred from the MVP):** session duration / "last active"
  (needs activity heartbeats), and agents / MCP-session detail (instrument the
  `TopologyMcp` DO `init()`).
- **More node/link art** — port additional renderers from the legacy monolith as
  needed; richer per-type inspector controls (ports, D2 waypoint UI).
- **Resize link labels** — per-link `labelScale` on the document contract:
  **shipped** as a catalog field (`Label size`, `LINK_COMMON`) that scales all
  of a link's labels (centre + endpoints, every link type) about their anchor
  in the renderer, settable via the inspector Label group, MCP `add_link` /
  `update_element`, validated to [0.25, 4]. **Follow-up:** an in-canvas drag
  handle beside the existing `labelOffset` label-drag (the numeric inspector
  control ships now; the drag gesture is the next increment).
- **Adjustable viewer styling** — expose the render aesthetic as user-adjustable
  UI settings: flat vs. glow, emphasis-glow intensity, and canvas background.
  Builds on the flat-viewer seam (`flattenViewer` in `src/vendor/topology-ds.ts`)
  and the `--canvas-bg` / `--glow-none` / `--glow-emphasis` tokens; per DESIGN #2
  it stays a presentation preference (no document-schema/agent surface), so it
  lives with pan/zoom as a human-only view control.
- **Export / share** — standalone HTML or PNG/SVG export of a page or flipbook.

## Retired (kept dormant)

- The **beat / Act-Step-Phase choreography model**: `src/core` (`model` /
  `resolve` / `tween`), `src/render-svg`, `src/sample-scene.ts`. Preserved for
  reference per the "keep it alongside" decision; not wired into the app.

## Out of scope (deliberately)

- A separate viewer/presenter codebase — the editor and any renderer share one
  render path.
- Cross-page inheritance / deltas — pages are independent by design.
- UI-only capabilities — see [`DESIGN.md`](DESIGN.md) #2.
