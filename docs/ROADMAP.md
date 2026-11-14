# Roadmap

Built methodically, one reviewable PR at a time, each reviewed against
[`DESIGN.md`](DESIGN.md).

_Reset 2026-07-19 and revalidated 2026-08-09 after a full-repository
documentation and quality audit; status lines revalidated 2026-11-13 against
`main` at `e99b012` (see
[`CAPABILITY_MATRIX.md`](CAPABILITY_MATRIX.md) for the evidence and
[`DISCREPANCY_REGISTER.md`](DISCREPANCY_REGISTER.md) for what this reset
corrected). The active implementation plan is
[`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md); its predecessor is
preserved at [`archive/IMPLEMENTATION_PLAN_2026-07-12.md`](archive/IMPLEMENTATION_PLAN_2026-07-12.md)._

## Current production baseline

Topology Dojo is a **production-hosted, collaborative, AI-agent-assisted
network-topology authoring platform** — not merely a diagram editor. As of
this reset, all three migration-backed feature flags are live in production
(`WORKSPACE_ENABLED`, `PROFILES_ENABLED`, `ANALYTICS_ENABLED` are all
`"true"` in the top-level `wrangler.jsonc`), and every Durable Object
migration through `v5` is applied and active. Two later, non-migration flags
are off in production: `API_KEYS_ENABLED` (on in staging) and
`LIVE_DATA_ENABLED` (off in both environments). Concretely, today a user can:

- Sign in with GitHub and author multi-page flipbook topology diagrams by
  hand, with full editing (selection, alignment guides, waypoint-edited
  links, custom node types), validation (semantic + layout), and export (SVG,
  self-playing HTML flipbook, PNG / PDF, draw.io, Visio, PowerPoint, Mermaid —
  see `docs/EXPORTS.md`). An SD-WAN wizard generates a vendor-aware fabric
  from intent (proposal 0010), and nodes can be bound to hardware-catalog
  models for catalog-aware wiring validation and wire-sheet pages
  (`futures/hw-catalog.md`).
- Connect an AI agent through the same catalog-driven API the GUI uses. Local
  stdio is process-local and has no hosted account, OAuth, or Durable Object;
  remote `/mcp` uses OAuth 2.1 with GitHub and owner-isolated Durable Object
  storage. There are 64 possible tool registrations (35 with no optional
  dependency; the rest are the hardware-catalog, share, workspace,
  authoring-guidance and live-fabric groups), plus nine document setters
  that are `edit_topology` operations only, kept out of the tool list to
  hold down what every agent session loads (`src/mcp/token-budget.test.ts`
  ratchets the size); actual discovery varies by runtime, flags, API-key
  scopes, and provider.
- **Collaborate with that agent in a shared workspace**: the agent proposes
  changes as one attributed revision (review/accept/reject, including a
  selective/partial accept), or — with a browser-granted, revocable
  page-scoped lease — commits directly. Named checkpoints, forward-only
  restore, fork, a revision timeline, live WebSocket presence, an IndexedDB
  offline cache with crash recovery, and gesture-native optimistic editing
  with a correctness-preserving referee fallback are all live.
- **Get the agent to author more like the user does over time**: an
  observe-only learner extracts deterministic features from every
  agent↔human correction, builds candidate authoring preferences, and — once
  the human explicitly confirms and scopes one in the Authoring Preferences
  panel — serves it back to the agent as bounded, token-budgeted guidance
  (≤5 rules, ≤400/800 tokens). Contradictions recalibrate confidence and
  flag rules for re-review; nothing is ever auto-promoted or agent-confirmed.
- **Conditionally pull from a real SD-WAN fabric**: a vendor-neutral provider
  abstraction and flow compiler exist and are tested, with a real but
  integration-unverified EdgeConnect Orchestrator HTTP client. The fabric
  tools register only when `LIVE_DATA_ENABLED` is `"true"` (it is `"false"`
  in both environments' `wrangler.jsonc`) _and_ the `ORCH_*` secrets exist.
  The repository cannot reveal whether Cloudflare secrets are currently
  provisioned; an operator must verify the environment and run the
  conditional QA/UAT track before making a support claim.
- **See who's using it**: the deployment owner has a private admin dashboard
  (login roster, per-user workspace metadata — never diagram content) behind
  their own GitHub identity, and a pre-login showcase filmstrip demonstrates
  the tool's output to visitors before they sign in.

Every production deploy goes through a CI-gated, `main`-only GitHub Actions
pipeline (`release.yml` — merge is the release since proposal 0007; migration
releases are held for a typed acknowledgement); Durable Object migrations
are append-only. Feature migrations `v3`–`v5` established the safer
inert-bootstrap-then-activate pattern for future feature classes. Recovery from
an activation is forward-only (a new deploy with the flag removed, never a
rollback across a migration boundary). Cloudflare error-rate policy state is
external and cannot be inferred from this repository; the operator checklist
and current alert-delivery evidence determine whether that operational gate is
closed. Repository-managed synthetic verification remains visible in Actions.

The original 2026-07-04 adversarial findings remain in
`docs/launch-readiness/FINDINGS_REGISTER.md` as an audit record; current
status must be read from appended closure notes and `CAPABILITY_MATRIX.md`,
not the historical top-line count. Former finding H1 is closed: algorithmic
layout now carries anchors and manual waypoints with their nodes (commits
`aa4e88c`, `7e3f8ed`). **M20 is closed (2026-08-17)**: publishing now records
owner metadata + a listing index, the browser Share dialog and the MCP
`list_shares`/`unpublish_topology` tools can take a link down early, and
snapshot caching dropped `immutable` for a bounded ~1-minute window (see the
register's closure note, `src/share/snapshot.ts`, and `worker/share.ts`).

## Now

The active initiatives, roughly in the order a blocking-prerequisite analysis
suggests (see the dependency graph in `IMPLEMENTATION_PLAN.md` for the full
packet-level ordering and what can run in parallel):

1. **Living product and quality documentation** — maintain the task-based user
   guide, QA/UAT plans, and feature-to-evidence traceability in the same PR as
   every user-visible capability, constraint, test gate, or operational change.
2. **Cloudflare alerting + production game day** — external evidence required
   for a fully monitored production posture. _Repo-side
   half landed 2026-07-19 (PR #197)_: alert matrix + severity model
   (`docs/ALERTS.md`), Cloudflare operator checklist
   (`docs/CLOUDFLARE_OPERATOR_RUNBOOK.md`), game-day framework + evidence
   template (`docs/GAME_DAY.md`), on-demand and scheduled production
   verification (`production-verify.yml`; daily then, hourly since proposal
   0007), a 14-check smoke suite (15 checks today), and a staging-only
   synthetic-fault mechanism; packet O3 (rollback generalization) is done.
   **Human-only verification**: inspect/configure the Cloudflare notification
   policies as needed (O1), prove delivery, and execute/record the drill (O2).
3. **Agent activity + explainability** — implemented and shipped on production
   (PR #243, SHA `5de7813`). Remote MCP sessions record a bounded metadata-only
   tool-call trail on the existing per-session `TopologyMcp` Durable Object and
   a bounded session index on already-live `AnalyticsLog` (migration `v5`). The
   owner admin dashboard lists recent sessions and drills into a trail; the
   workspace revision timeline shows an honest, non-causal “guidance was
   consulted before this edit” signal when `get_authoring_guidance` succeeded
   earlier in the same MCP session. Reuses `ANALYTICS_ENABLED` (already on);
   no new flag, no new Durable Object class, no migration. Packets A1–A6.
4. **Guided topology briefs + semantic templates** — today an agent (or a
   human) starts from either a blank page or one of six static starter
   templates (`list_templates`/`create_from_template`); there's no general
   structured "describe the topology you want" contract that compiles into a
   scaffolded, validated starting document. Packets: B1–B7. **Not started**
   (2026-11-13). One archetype now exists outside this plan: the SD-WAN
   generator (proposal 0010 — `generate_sdwan_topology` and the editor
   wizard) compiles intent into a document; re-scope B against it first.
5. **EdgeConnect live-import hardening + UI** — the provider/compiler code is
   shipped and tested against injectable mocks, but has never been run against
   a real or recorded Orchestrator payload, and there's no GUI surface for a
   human to trigger/review a live import (today it's MCP-tool-only). Packets:
   E1–E7. **Not started** (2026-11-13); the tools are additionally gated by
   `LIVE_DATA_ENABLED`, off in both environments.
6. **Time-aware flow and failure storytelling** — the flow compiler already
   produces animated, per-hop flow paths for a point-in-time fabric snapshot;
   there's no scenario model for "walk through this fabric before, during,
   and after a failure" the way the flipbook already does for static topology
   states. Packets: T1–T7. **Not started** (2026-11-13).

Items 4–6 can be scoped and start in parallel (see the
dependency graph); none of them share a Durable Object or migration, so they
don't block each other structurally. See `IMPLEMENTATION_PLAN.md` for full
packet specs, risk, and acceptance criteria for all six initiatives.

Since August the work that actually merged came from numbered proposals
(0005–0008, 0010, 0011) and the hardware-catalog plan rather than items 4–6;
it is recorded under "Completed historical milestones". Proposal 0009 (the
vendor-neutral diagramming-tool direction) is **Proposed, not accepted**; if
accepted it re-cuts _Now/Next_.

## Next

Capabilities that logically follow the active program, not yet scoped into
packets:

- **Hardware catalog + trustworthy wire sheets** — nodes bound to real
  models, catalog-aware wiring validation, real front panels on wire sheets,
  native Visio masters. Six phases; plan and status in
  [`futures/hw-catalog.md`](futures/hw-catalog.md). Phases 1–5 are merged
  (PRs #285–#288, #290; summarized under "Completed historical milestones");
  what remains is Phase 6 (feed importers, not started), the real-Visio
  verification of the Phase 5 masters, and official catalog data.

- ~~**Light-theme contrast fix**~~ — **shipped 2026-10-24 (PR #289)**:
  role-aware engine alphas, no glow underlays, white export background and
  measured light minimums, with a composited-contrast test
  (`src/testing/contrast.ts`, `src/testing/light-probe.ts`). Brief and
  outcome: [`futures/light-theme-contrast.md`](futures/light-theme-contrast.md).

- **Clean render profile for exports and the inline view** — measured on a
  7-node / 6-link template: the SVG defines 29 filters but references 3
  (`tds-glow`, `tds-dof-blur`, `tds-depth-lift`); `<defs>` is ~41% of a
  `calm` render (14 KB of 34 KB), and the default render carries 50
  `<animate>` elements (2 under `calm`). `render_svg` and `view_topology` do
  not expose `calm`, so agents pay for the animated build in context and
  transfer. Scope: emit only referenced defs, add a `profile: "clean"`
  render option (flat per `flattenViewer`, no background animation, no
  unused defs), and make it the default for `render_svg`, `view_topology`,
  PNG and PDF. Not started (no `profile` render option exists at `e99b012`). The editable exports (draw.io / Visio / PowerPoint shapes)
  are built from the export scene, not the SVG, so they are unaffected.
- **Link anchor box on by default for new documents** — on a dual-homed
  hub-and-spoke page (the most common SD-WAN shape), `inspect_render` flags
  spoke tunnels running through the hub labels until `linkAttach:
{distribute: true}` is set, which clears them; the fix is gated behind an
  EXPERIMENTAL flag. Make it the default for documents created by
  `create_topology`, templates and `build_flow_topology` (opt out with
  `linkAttach: "none"`). Stored documents keep rendering as they do today —
  flipping the engine default would move every existing diagram's wires,
  which the byte-identical-render promise rules out. Graduate the flag
  out of EXPERIMENTAL once it is the default. Not started: the opt-in
  mechanism shipped (PR #274, with a corner-pin warning in #275) and is
  still marked EXPERIMENTAL in `src/api/catalog.ts`.

- **Second fabric provider: Juniper Mist** — the `TopologyProvider`
  abstraction is vendor-neutral by design (`src/connect/types.ts`), and the
  second real implementation that will prove it (rather than just assert it)
  is now decided, not open-ended: **Juniper Mist**, targeting **Mist Campus
  Fabric** and **Mist WAN Assurance**
  ([decision 0002](decisions/0002-second-provider-juniper-mist.md),
  Corey Robertson, 2026-08-20). EdgeConnect Orchestrator (`src/connect/`)
  remains the first provider; this is a different vendor and product family,
  not a second EdgeConnect client. Vendor/product choice only — no packet
  scope or API design exists yet, and sequencing is unchanged (not started
  until the EdgeConnect provider is proven via initiative E).
- **Organization-level collaboration** — explicit collaborator/organization
  ACLs beyond the current single-owner-per-workspace model (proposal 0002's
  "Follow-on work" item 6, still deferred).
- **Reusable topology components / shared template libraries** — beyond the
  current 6 static starter templates: user-authored, shareable component
  groups (a "sub-topology" a person or agent can drop in and parameterize).
  Builds naturally on the guided-briefs work above once that contract exists.
- **Source-drift reconciliation** — `upsert_by_source` (drafts) and, since
  proposal 0006, `element.upsert` (workspaces) converge a re-import instead
  of duplicating, and `get_topology sources:true` / `get_workspace_elements
sourcedOnly:true` list what an importer owns; there's no surface yet for
  "this element's source data changed since last import, review the diff"
  the way workspace proposals do for human/agent edits.
- **Richer explainability analytics** — the agent-activity foundation (Now
  item 3) has shipped, so aggregate views (which guidance rules actually
  change agent behavior, correction-rate trends) are now possible; none is
  built yet.
- ~~**Share-link revocation (finding M20)**~~ — **shipped 2026-08-17**
  (snapshot owner metadata + `worker/share.ts` listing index, the browser
  Share dialog, MCP `list_shares` / `unpublish_topology`, and
  revocation-compatible snapshot caching).
- **More node/link art** — port additional renderers from the legacy
  monolith as needed; richer per-type inspector controls (ports, D2 waypoint
  UI).
- **Harness (bundled) cable routing** — the last packet of
  [proposal 0008](proposals/0008-wiring-diagram-conventions.md) (W8, second
  half): links sharing a side, class and target tier routed along a shared
  trunk with fan-in at each end, behind a page-level opt-in. The rest of the
  proposal (W1–W7 and rounded orthogonal corners) shipped; see the user
  guide's "Wiring sheets" section.
- **In-canvas `labelScale` drag handle** — the numeric inspector control
  ships today (validated `[0.25, 4]`); a drag gesture beside the existing
  `labelOffset` label-drag is the next increment.
- **Adjustable viewer styling** — expose the render aesthetic as
  user-adjustable UI settings (flat vs. glow, emphasis-glow intensity, canvas
  background). Builds on the flat-viewer seam (`flattenViewer` in
  `src/vendor/topology-ds.ts`); per `DESIGN.md` #2 this stays a presentation
  preference (no document-schema/agent surface), living with pan/zoom as a
  human-only view control.
- ~~**Server-side / MCP PNG export**~~ — **shipped** in Phase 1 (resvg
  WebAssembly rasterizer, `export_topology` png / pdf; see `docs/EXPORTS.md`).
- **Path analysis between elements ("visual traceroute")** — select two
  nodes (e.g. two hosts), right-click → "Analyze path": compute the
  traversal across the page's drawn link graph and present it as a focused
  view — the traversal set spotlit, everything else dimmed — with the hops
  optionally overlaid as an animated flow. Both rendering primitives already
  exist: the per-frame `emphasis` option (`src/render/core.ts` — spotlight a
  node/link id set, dim the rest to 25%) and page `flowPaths`
  (`add_flow_path` waypoints). The new pieces are a deterministic
  shortest/all-paths computation over the in-document graph, the two-node
  selection + context-menu UX, and — per the one-catalog rule (`DESIGN.md`
  #2/#3) — an agent-callable `analyze_path` equivalent of the same action.
  Static first: answers come only from what the document already draws
  (multiple candidate paths → present alternatives; disconnected → say so,
  which is itself diagnostic). Page-scoped presentation state (or emitted as
  a new flipbook page), never cross-page inheritance (decision 0001).

## Later

Valuable but non-blocking; no current evidence anything is waiting on these:

- **SD-WAN generator: more vendors (proposal 0010 slice 5)** — researched,
  not committed. [Proposal 0012](proposals/0012-sdwan-vendor-research.md)
  records how **Fortinet FortiGate** (per-transport IPsec overlays,
  independent dual hubs, FGCP cluster as one endpoint, optional ADVPN
  shortcuts, documented AWS / Azure / GCP and FortiSASE patterns) and
  **Juniper SSR** (tunnel-free SVR peer paths by neighborhood, per-node HA
  paths, Conductor or Mist management; cloud patterns undocumented) would be
  modelled, with sources, inferences and open questions. Recommended order:
  Fortinet first. Decisions pending: ADVPN shortcuts as a hidden layer; SSR
  standby paths dimmed or omitted. Re-verify against current vendor docs
  before building.
- **SD-WAN generator: per-vendor Azure peering label + management plane** —
  from the same research: the Azure cloud-hub label must become per vendor
  (Fortinet NVAs sit inside the vWAN hub, so "VNet NVA" is wrong for it), and
  every vendor would gain an optional management-plane layer (Orchestrator,
  Mist / Conductor, FortiManager + FortiAnalyzer) with dotted lines off the
  data path.

- **Finer element-set leases** — today leases are page-scoped only (proposal
  0002's "S4," explicitly skipped: "per-page leases are fine; revisit only on
  measured contention," `docs/HANDOFF.md`).
- **Comments, mentions, and review threads** on workspace proposals/revisions
  (proposal 0002's "Follow-on work" item 8, still deferred).
- **Standalone HTML/PNG export polish** — flipbook HTML export exists and
  server-side PNG / PDF shipped in Phase 1; further export format work is
  low-urgency.
- **Reverse agentic dispatch — live path discovery ("examine path to
  Teams")** — extend "Path analysis between elements" (Next) from _what the
  diagram says_ to _what the network actually does_: right-click a host →
  "examine path to <application or endpoint>", where answering requires live
  discovery (traceroute, SD-WAN policy/app-path lookup) that the Worker
  cannot and should not perform itself. This inverts today's flow — agents
  currently call _into_ Topology Dojo over MCP; here Topology Dojo
  dispatches a discovery task _out_ to an agent that has network access
  (the planned **SASE agentic harness** project is the intended executor,
  with the EdgeConnect provider work — initiative E — as the nearest
  existing live-data seam). The natural shape given existing machinery: a
  workspace-scoped "discovery request" an authorized agent picks up and
  answers **through the existing proposal pipeline** — the discovered path
  lands as a reviewable proposal adding flow paths/emphasis, preserving the
  agents-never-write-silently rule and the single commit path. Prerequisites
  before starting: the static path-analysis feature shipped; an agent
  runtime with real network reach; and an authorization story for which
  agents may receive dispatches. Pairs naturally with time-aware
  storytelling (initiative T) for before/during/after views of a discovered
  path.

## Evidence-triggered

Do not start until the repository shows the specific evidence listed:

- **CRDT-based multi-writer merge** — start only if the current
  field-granular optimistic-rebase-with-explicit-reject model
  (`src/workspace/operations.ts`) produces a measured pattern of rejected
  concurrent edits from genuinely simultaneous human+agent writers (not just
  theoretical possibility). No such measurement exists today; the current
  model has never been the source of a filed finding or incident.
- **Broad enterprise ACL system** (roles, groups, org-wide policies) — start
  only once "Organization-level collaboration" (Next) ships and a second
  real organization is using it with a concrete permission gap the simple
  owner+collaborator model can't express.
- **High-volume, long-term agent-trace retention** — "Agent activity +
  explainability" (Now item 3) has shipped; start only if actual usage
  shows the bounded/ephemeral trace model it establishes is insufficient
  (e.g., an owner needs to audit agent behavior from more than N days ago).
  Building unbounded retention up front risks exactly the kind of storage/PII
  surface the admin dashboard's MVP deliberately avoided.
- **Finer-grained (element-set) leases** — see "Later"; the trigger is
  measured lease contention (an agent's write blocked by another actor's
  lease on the same page often enough to matter), not a schedule.

## Deliberately excluded

Architectural or product directions this project is intentionally not taking,
so a future contributor doesn't have to re-litigate them:

- **A second document-mutation path.** Every write — human GUI, agent
  proposal, agent leased-commit, restore, fork — goes through the same
  `TopologyDocument` commit pipeline (`worker/document.ts`). No shortcut
  write path is introduced for performance or convenience.
- **Hidden cross-page inheritance.** Pages are independent, full-frame
  documents by design (`docs/decisions/0001-flipbook-vs-beats.md`); no
  delta/override machinery between pages, ever — see `DESIGN.md` #1.
- **Laptop-driven production deployment.** `npm run deploy` was deleted
  (finding L1, closed); the only production deploy path is the gated GitHub
  Actions pipeline (`release.yml` — merging to `main` is the release
  decision; the protected-environment approval click was removed
  2026-10-09).
- **Raw prompt/conversation logging.** The authoring-profile learner and the
  agent-explainability initiative (Now item 3) both operate on structured,
  deterministic _feature_ extraction from document operations — never on raw
  LLM prompts, completions, or conversation transcripts.
- **Silent agent writes without a proposal or a lease.** Every agent
  mutation to a shared workspace is either a reviewable proposal or a
  time-bounded, browser-granted, page-scoped lease commit. There is no
  "just write it" path for an agent, by construction (`worker/document.ts`
  `commit()` requires either `source: 'proposal'` acceptance or an active
  lease for `source: 'agent-lease'`).
- **Automatic deletion of provider-sourced objects on a single missing API
  response.** The flow compiler's `upsert_by_source` convergence model
  updates/creates from what a provider _does_ return; a transient empty or
  failed fetch must never be interpreted as "this appliance/tunnel/flow no
  longer exists" and cascade-delete it. Any future live-import hardening work
  (initiative 5, EdgeConnect) must preserve this — a real vendor API's
  transient failure is not evidence of a topology change.
- **A separate viewer/presenter codebase.** The editor and any renderer share
  one render path (`flattenViewer`); no second, divergent presentation
  engine.
- **UI-only capabilities that don't exist on the document.** See `DESIGN.md`
  #2 — anything a human can set, an agent can set identically through the
  same catalog-driven contract.

## Completed historical milestones

_Preserved from the original roadmap; corrected only where the discrepancy
register found something no longer true (see `DISCREPANCY_REGISTER.md`)._

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
  proxy, injectable fetch — real HTTP client, integration-unverified against a
  live Orchestrator), fixture `MockProvider` (stdio-only), env/secret
  credential wiring, read-only MCP tools, and runtime Zod validation of all
  tool arguments ([proposal](proposals/0001-live-flow-visualization.md), E3).
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
  ([proposal](proposals/0001-live-flow-visualization.md), E5).
- **Legacy importer** (`src/import/legacy.ts`): best-effort converter from
  legacy Topology Studio JSON → pages, validated against real fixtures, wired
  into the GUI open flow and exposed through a `format` parameter on the
  `import_topology` MCP tool.
- **Per-link `labelScale`**: a catalog field (`Label size`, `LINK_COMMON`)
  that scales all of a link's labels (centre + endpoints, every link type)
  about their anchor in the renderer, settable via the inspector Label group,
  MCP `add_link` / `update_element`, validated to `[0.25, 4]`.

### Layout for AI

- **Ground-truth guidelines** (`layoutGuidelines`) + an overlap/crowding/off-page
  **analyzer** (`analyzeLayout`), folded into `validate`.
- **Auto-layout** (`tidy`): grid-snap + de-overlap + keep-in-bounds; surfaced as
  the editor **Tidy** button and the `tidy_topology` MCP tool.

### MCP

- **stdio** server (`src/mcp`) exposing the whole API as MCP tools
  (`describe_capabilities`, create/get/list/import/delete, templates,
  add_page/node/link/anchor, add_zone/flow_path/policy_marker, set_node_metadata,
  define_node_type, validate, tidy, layout, balance, layout_guidelines,
  render_svg, export_flipbook). See [`src/mcp/README.md`](../src/mcp/README.md)
  for the full table — a unit test keeps it in sync with the server.
- **Remote on Cloudflare** (`worker/`): the same base tools over Streamable
  HTTP at `/mcp`, plus workspace/proposal/lease/checkpoint tools, read-only
  authoring-guidance tools, live-fabric tools (when a provider is
  configured), and `share_topology` — OAuth 2.1 (GitHub) auth, one Durable
  Object per MCP session. Verified live end-to-end (auth → build → validate →
  tidy → render).
- **User-tied API keys** (proposal 0005, 2026-09-20): a signed-in user mints
  scoped, optionally expiring keys at `/keys`; an unattended agent presents
  one as `Authorization: Bearer tdk_…` on `/mcp` and resolves to the same
  identity through the provider's `resolveExternalToken` hook. Hashed at
  rest, browser-only to manage, behind `API_KEYS_ENABLED` (staging on,
  production pending UAT-MCP-04). The machine-credential use case that the
  former _Later_ item was waiting for is the NetClaw integration.
- **Importer sync ergonomics** (proposal 0006, 2026-09-20): `element.upsert`
  for shared workspaces (schema revision 2; normalized by the coordinator into
  `element.add`/`element.patch`, stored vocabulary unchanged), sourced-element
  listings for drafts and workspaces, and `created` outcomes in
  `edit_topology` results — so a re-syncing importer such as NetClaw does
  idempotent writes and cheap diffs without hydrating pages.

### Phase 0 — shared human-agent workspace (vertical slice + follow-ons)

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
  proposal with changed elements highlighted, shown in the review flow.
- **Selective proposal acceptance**: the owner accepts a coherent subset of a
  proposal's operations as one attributed revision; the coordinator rejects a
  subset that references an element only an unselected op would create; the
  remainder stays reviewable (partially-accepted) and re-validates against the
  new revision.
- **Named checkpoints, restore & fork**: snapshot the document as a named
  checkpoint (agents may create/list; restore & fork are browser-owner actions),
  restore one forward-only as a new revision, or fork one into a fresh
  workspace.
- **Revision timeline**: the Agent Workspace panel shows recent revisions with
  actor, summary, a source badge (edit / agent / proposal / restore), and
  proposal-acceptance + checkpoint markers, from the stored change log.
- **WebSocket push + presence**: hibernation-friendly live presence and
  change notification, degrading cleanly to polling on any connection failure.
- **Gesture-native operations + referee fallback**: the editor emits
  field-granular operations at the gesture site; a referee always computes the
  reference diff and falls back to it whenever the emitted ops don't reproduce
  it byte-for-byte, so correctness can never regress from partial gesture
  coverage.
- **IndexedDB offline cache + crash recovery**: a feature-detected,
  fail-safe-to-no-op local cache of the confirmed snapshot plus any
  unacknowledged pending batch, replayed idempotently on reconnect.

**S4 (finer element-set leases) deliberately skipped** — per-page leases are
fine; revisit only on measured contention (see "Evidence-triggered" above).

### Deployment & release safety (proposal 0004)

Infrastructure delivered, proven on staging, **and now fully activated in
production** (workspace, profiles, and analytics flags are all `"true"` at
the top level as of this reset — see "Current production baseline" above).

- **Isolated staging environment**: a stable `topology-dojo-staging` Worker
  with its own KV namespaces, Durable Object namespaces, GitHub OAuth
  App/secret, and origin; a `check-wrangler-env.mjs` CI guard enforces that
  staging and production share no resource ids. Closed finding M14.
- **CI-gated deployment pipeline**: `deploy-staging.yml` and (since proposal
  0007, replacing the manual `deploy-production.yml` dispatch) `release.yml`
  re-run the CI `check` before deploying (`ci.yml` is reusable via
  `workflow_call`); production is restricted to `main`, released by the
  merge itself, guarded against unacknowledged migrations, and the CI
  `check` is a required status. The
  ungoverned `npm run deploy` laptop path was removed. Closed finding L1;
  closed finding H7 once Workers Builds was disconnected from production
  (operator O9, 2026-07-17) and the first gated production deploy ran
  (operator O10, 2026-07-17).
- **Feature flag + migration bootstrap, executed through `v5`**: `v1`–`v5`
  are all applied in production. Each new Durable Object class ships inert
  behind an opt-in/opt-out flag in its bootstrap deploy, then a separate
  activation deploy flips the flag — exercised for `WORKSPACE_ENABLED` (O11,
  2026-07-17), `PROFILES_ENABLED` (2026-07-17), and `ANALYTICS_ENABLED`
  (Gate C, 2026-07-18).
- **Smoke + health + recovery docs**: `scripts/smoke.mjs` external smoke suite
  (deployed-sha assertion, live-propagation wait), `GET /healthz` and
  `GET /readyz` endpoints, and written rollback / forward-recovery runbooks.
  Multiple fully-green gated production deploys since (O10 through the
  admin-dashboard Gate B/C, plus the M18/M19 security-fix deploy).
- **Nightly staging smoke** (`nightly-staging-smoke.yml`): unauthenticated
  daily liveness check, files/closes a GitHub issue on failure/recovery — no
  secrets required. Substantially closed finding M15; **Cloudflare
  error-rate alerting and a recorded staging game day remain open** (see "Now"
  item 2).

### Owner analytics / admin dashboard

Shipped (MVP) and live in production: a new `AnalyticsLog` SQLite Durable
Object (migration `v5`, single global instance) records a login roster and a
bounded recent-login log, best-effort, off the browser-login success path
(never blocking a login). The owner-gated `/api/admin/*` routes serve the
roster/totals and, per user, their workspace names/counts read live from the
existing registries — metadata only, never diagram contents — fail-closed if
`ADMIN_GITHUB_ID` is unset. Captures data going forward only (no historical
backfill). **Initiative A (shipped, PR #243)** closes the MVP
deferral for agents / MCP-session detail: a bounded per-session tool-call
trail (`{toolName, at, outcome}` only — never prompts or arguments) plus a
bounded session index on the same `AnalyticsLog`, owner-gated
`GET /api/admin/sessions` and `GET /api/admin/sessions/:id`, an Agent Sessions
section on the admin dashboard, and a non-causal guidance-consulted signal on
agent-authored revision timeline entries. Still deferred: session duration /
"last active" (needs activity heartbeats). Gated by the already-live
`ANALYTICS_ENABLED` flag; no new Durable Object or migration.

### Public showcase

_Since PR #292 (2026-11-03) the sign-in page is the cinematic landing page
(`worker/landing.ts`, assets under `public/landing/`); the film-strip below
is one section of it._

A pre-login film-strip on the sign-in page shows four topologies authored
through the MCP server (a hub-and-spoke WAN, a data-center spine-leaf fabric,
an SD-WAN/SASE path, a three-tier app with a DMZ) as looping animated WebP
stills, served ungated (image sub-resources aren't document navigations, so
they're never behind the sign-in gate) and self-contained (no dependency on
any ephemeral `/v/:id` share snapshot, so the landing page never rots).

### Phase 1 — adoption blockers (PR #283, 2026-10-23)

Dojo output usable where network teams already work, and findable where
agents look (fidelity contract: `docs/EXPORTS.md`):

- **Exports** from the editor and `export_topology`: server-side PNG / PDF
  (resvg wasm, embedded JetBrains Mono, print-true ANSI / A-series sizing,
  `pHYs` DPI), draw.io v2 (layers → draw.io layers, zones → containers,
  metadata as shape data), Visio `.vsdx` (shapes, glued dynamic connectors,
  page layers, Shape Data), PowerPoint `.pptx` (slide per page or per layer;
  editable shapes with layer groups, or image mode), Mermaid. One shared
  export scene (`src/export/scene.ts`) feeds the editable formats.
- **Imports:** draw.io (plain / compressed; layers, containers → zones,
  stencil type inference, round-trips the export); Mermaid round-trip (type
  classes, nested subgraphs).
- **Inline render in chat:** `view_topology` + the `ui://topology-dojo/viewer.html`
  MCP Apps view (pan / zoom / pages / layers / theme / downloads).
- **Discoverability:** `server.json` (MCP Registry format) and README
  install instructions.
- Not yet done: verifying `.vsdx` / `.pptx` in Microsoft Visio / PowerPoint
  (checked in LibreOffice only); publishing `server.json` to the registry
  (`mcp-publisher`, needs the repo owner's GitHub login).

### Hardware catalog and wire sheets (Phases 1–5, 2026-10-24/25)

Plan and per-phase status: [`futures/hw-catalog.md`](futures/hw-catalog.md).

- **Catalog core** (PR #285): `catalog/` data, schema and Python reference
  tools; generated TypeScript types and a content-hashed bundle
  (`npm run catalog:build` / `catalog:check`, both gated in CI) served to the
  Worker through the `ASSETS` binding (`worker/catalog.ts`).
- **Bind + validate** (PR #286): node `hw`, link interface / optic fields,
  catalog rules folded into `validate_topology`, `catalogVersion` pinning.
- **MCP tools** (PR #287): `list_hardware`, `describe_hardware`,
  `bind_hardware`, `assign_interfaces`, `catalog_diff`, and the
  `cable-schedule` export format.
- **Wire-sheet rendering** (PR #288): page `view: "wiresheet"` with panel
  glyphs and cables anchored at port positions.
- **Native Visio masters** (PR #290): per-model masters on wire-sheet
  `.vsdx` exports, `.vssx` stencil export (`npm run catalog:stencil`), and a
  LibreOffice render check as the CI `visio` job.
- Not yet done: Phase 6 feed importers; verification in real Microsoft
  Visio; official vendor data (the catalog is seeded from fixtures).

### SD-WAN generator, map backdrops and icons (proposals 0010 / 0011, 2026-11-08)

- **Generator** (`src/connect/generate.ts`, slice 1, PR #293): intent
  (vendor — EdgeConnect or Juniper SRX — regions, hubs, branches,
  transports, HA, LAN) expands into fabric records and runs through the
  existing flow compiler; exposed as the `generate_sdwan_topology` MCP tool
  and the editor wizard (`src/ui/sdwan-wizard.ts`).
- **Overview drill-down** (slice 2, PR #295): place tiles and page links
  (`src/api/page-link.ts`). **Cloud hubs and SSE on-ramp** (slice 4,
  PR #296). **Map backdrops** (slice 3, PRs #298, #299): Natural Earth
  region outlines behind a zone (`src/render/backdrops.ts`, built by
  `scripts/build-backdrops.ts`).
- **Icons** (proposal 0011): Places and tier 1 (PRs #294, #295), tier 2
  (PR #296).
- Not done: branch-to-branch mesh (deferred) and more vendors (slice 5 —
  research only, [proposal 0012](proposals/0012-sdwan-vendor-research.md)).

### Wiring-sheet conventions (proposal 0008, 2026-10-15)

- **Link styles** (`doc.linkStyles`, link `style`, the `ethernet-media`
  starter set) with legend line rows, columns and a Key title.
- **Tiers** (`doc.tiers`, node `tier`) and the `tiered` layout: zone-group
  units, barycentre ordering, `-01`/`-02` mirroring, tier-based port pinning,
  port-table margin reservation, optional tier zones; zones gain
  `labelPosition: 'bottom'`.
- **Port pills** (`page.portLabels: 'pill'`, node override) drawn on the
  node edge at the engine's attach point; a hit-box registry
  (`src/render/hit-boxes.ts`) sizes stock / custom types the same way in
  every headless mirror.
- **Bundles** (`fromBundle` / `toBundle`, `doc.bundles`) with LAG / ECMP
  rings and legend rows.
- **Derived port tables** (`node.portTable`) in the page margins.
- **Sheet frame** (`doc.sheet`: paper size, border, title, title block) and
  PDF paper sizing; **chassis** stock shape; rounded orthogonal corners.
- Fixture `fixtures/venue-distribution-leaf.json` built by
  `scripts/build-wiring-sheet-fixture.ts`; acceptance in
  `src/render/wiring-sheet.test.ts`.

### Competitive gap-closing batch (2026-08-17)

One vertical pass closing the highest-impact UI gaps against modern
diagramming tools (draw.io / Lucidchart / Excalidraw / Miro), each shipped
with catalog/validation/MCP parity where the document contract was touched
(see `CAPABILITY_MATRIX.md` rows for evidence):

- **Authoring velocity**: inline label editing (double-click a node / link /
  zone), quick-add (double-click empty canvas → type-to-place), quick-connect
  chevrons (click = create + connect the next node; drag to empty canvas =
  create-and-connect picker).
- **Sharing from the UI**: the browser Share dialog (publish / list / copy /
  revoke) over one shared publish path with the MCP tools — closing finding
  M20.
- **Content vocabulary**: hyperlinks + hover tooltips on nodes / links /
  zones (clickable SVG exports and `/v/:id`), an `image` node type (uploaded
  pictures downscaled to ≤256KB data URIs), and node `status` LEDs
  (ok / warn / down / maintenance / unknown) with legend integration.
- **Interchange**: Mermaid flowchart + CSV import (browser open flow and
  `import_topology`), PDF export (single / all frames), flipbook HTML export
  from the toolbar, clipboard PNG copy, and selection-only exports.
- **Canvas polish**: page-level line jumps at link crossings (arc / gap),
  full-screen Present mode, pinch-zoom + two-finger pan, a mini style bar
  floating above the selection, and metadata-aware find (Ctrl+F matches the
  IP/hostname/etc. stored on a node).
- **Stretch follow-ups (same batch)**: a callout / sticky-note node with a
  leader line, and one-way draw.io XML export (`.drawio`, documented lossy).
  Straight-link obstacle avoidance was confirmed already shipped (engine
  `_routeLink`, on by default); conditional formatting stays evidence-gated.

## Retired (kept dormant)

- The **beat / Act-Step-Phase choreography model**: `src/core` (`model` /
  `resolve` / `tween`), `src/render-svg`, `src/sample-scene.ts`. Preserved for
  reference per the "keep it alongside" decision
  (`docs/decisions/0001-flipbook-vs-beats.md`); not wired into the app.
