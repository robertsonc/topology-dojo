# Architecture

## Layers

```
vendor/topology-ds.ts   typed facade over the vendored TopologyDesigner engine.
                        The engine is the RENDERER only; we never use its
                        choreography. Browser-side it's a classic <script> that
                        sets window.TopologyDesigner.

pages/model.ts          the flipbook document model (Document → Page[]).
pages/persist.ts        (de)serialize + autosave to localStorage; defensive parse.
pages/playback.ts       the pure flipbook timing model (page durations →
                        schedule) shared by the editor's play control and the
                        standalone export (render/flipbook.ts).

api/                    headless authoring, DOM-free:
  builder.ts            pure ops + fluent builder (createDocument()…build()).
  edit.ts               mutation ops: updateElement / removeElement (cascade) /
                        upsertBySource (idempotent converge on external data).
  source.ts             SourceRef — stable external identity (system/kind/id).
  validate.ts           semantic validation (+ folds in the layout analyzer).
  catalog.ts            the capability catalog: every node/link/annotation type
                        and its editable fields — the machine-readable schema.
  builtins.ts           the built-in node/link vocabulary.
  layout.ts             layout ground-truth: rules + overlap/crowding analyzer.
  tidy.ts               auto-layout: grid-snap + de-overlap + keep-in-bounds.
  geometry.ts           pure node AABBs (shared by editor + layout).

render/core.ts          engine-agnostic render: (EngineClass, page) → SVG string.
server/render.ts        Node: load the engine via createRequire, call the core.

nodes/                  custom node types (data, not code): spec.ts (CustomNodeSpec),
                        render.ts (pure interpreter + browser registration),
                        data.ts (shapes/icons), designer.ts (the Node Designer modal).

editor/editor.ts        the canvas editor: an interaction overlay <svg> over the
                        engine-rendered art <svg>. Owns selection, drag, marquee,
                        smart guides, links + waypoint editing, undo/redo, tidy.

connect/                the live-data connector layer: types.ts (the vendor-neutral
                        TopologyProvider contract + normalized records), edgeconnect.ts
                        (EdgeConnect Orchestrator REST client; injectable fetch),
                        mock.ts (fixture fabric for tests/demos). Credentials come
                        from env/secrets only — never through tool arguments.

mcp/                    MCP server: tools.ts (pure handlers), store.ts (in-memory
                        registry), register.ts (adapter + runtime arg validation),
                        server.ts (stdio entry).
                        Shared by the Worker. (Remote auth lives in worker/, not here.)

workspace/              shared human-agent write protocol: revision/operation/
                        proposal types, local snapshot→operation adapter,
                        field-level conflict targets, browser API client.

worker/                 Cloudflare Worker: index.ts (serve app + route /mcp),
                        mcp.ts (transport/private-draft DO), document.ts (one
                        canonical coordinator per shared topology), workspaces.ts
                        (owner directory + lazy migration), render.ts.

core/                   the retired beat-model (model/resolve/tween) — dormant.
```

Dependency arrows point inward: `editor`, `server`, `worker`, and `mcp` depend on
`api` + `render` + `vendor` types; `api` depends on nothing DOM-specific. The
authoring/validation/layout core is DOM-free and unit-tested in isolation, which
is what lets the exact same logic run in the browser, in Node, and in a Worker.

## The document model

```ts
TopologyDocument = { title, pages: Page[], customNodes: CustomNodeSpec[],
                     layers?: LayerDef[] }      // declared planes, bottom → top
Page = { id, name, viewBox,
         nodes[], links[], anchors[],          // structure
         zones[], flowPaths[], policyMarkers[]  // annotation layer
       }
```

**Layers** (`api/layers.ts`): a document may declare named planes —
underlay / overlay / policy / service — and any element opts in via a `layer`
field. Declaration order is z-order (bottom → top); untagged elements form the
implicit base layer beneath all declared layers. Layers affect stacking and
visibility only (a `visibleLayers` render option filters; a layer can default
to hidden), never geometry — a page stays one standalone flipbook frame.

A **Page** is a complete, standalone frame. There is no inheritance between
pages: `duplicatePage` is a deep `structuredClone` with a fresh id, so editing
one frame never affects another. This is the deliberate simplicity of the
flipbook — the cost is no automatic tweening, which we accept.

Every element carries a stable string `id` (unique within its page). `customNodes`
are user-designed node types stored **as data** (`CustomNodeSpec`), not generated
code; one spec registers one node type with the engine via a single pure
interpreter (`renderCustomNode`).

## The render seam

We reuse the legacy engine purely as a renderer. To draw a page as a _static_
frame (no entrance animation), the render core:

1. builds a throwaway engine instance from the page's elements (nodes, links,
   anchors, then zones / flow paths / policy markers),
2. adds one Act + one all-showing Step, then a **trailing empty Step**, and sets
   `step = steps.length` so the all-showing step is in the past — every element
   renders fully with no replays on re-render,
3. returns `engine._renderSVG()`.

`render/core.ts` is engine-agnostic; the only difference between runtimes is how
the engine class is obtained — Node uses `createRequire` against
`public/vendor/topology-ds.js` (CommonJS), the Worker bundles it as a module.
A `{ calm }` option sets the engine's `reducedMotion` flag to suppress animation,
threaded through both paths for parity.

## The capability catalog

`api/catalog.ts` is the single machine-readable description of everything a
topology can express — each node type, link type, and annotation kind with its
fields (kind, enum options, animation flags, id-reference kinds). It is the
source of truth that three consumers align to:

- the **GUI** builds its palette and inspector from it,
- **validation** checks enum values and field shapes against it,
- **MCP** exposes it via `describe_capabilities` so an agent can discover the
  vocabulary before authoring.

A parity test asserts the catalog covers the whole built-in vocabulary, which is
how we enforce "no UI-only surfaces": a capability that isn't in the catalog
can't be reached by the API, so it isn't allowed to exist.

## Layout ground-truth

- `layoutGuidelines()` — quantitative rules (grid step, min node gap, edge
  margin, zone padding) + prose an agent reads before placing nodes.
- `analyzeLayout(doc)` — geometric checker flagging overlapping/crowded nodes
  (label-aware footprints), off-page nodes, zones that swallow non-members, and
  un-nested zone overlaps. All **warnings** (advisory; never block rendering).
  It is folded into `validate_topology` so an agent gets it on the same call.
- `tidyDocument(doc)` / `tidyPage(page)` — resolve those problems: snap to grid,
  iteratively push apart overlapping footprints, clamp into bounds. Pure +
  deterministic. The editor's **Tidy** button and the `tidy_topology` MCP tool
  both call it.

## MCP + Cloudflare

The MCP tool handlers (`mcp/tools.ts`) are pure functions over a `TopologyStore`
(an in-memory registry of documents by id) plus an injected renderer — no
runtime-specific imports, so they bundle for Workers. `register.ts` wraps them
onto an `McpServer` (return value → MCP text content, thrown errors → `isError`).

- **Local:** `server.ts` connects that server to a stdio transport (the Node
  renderer injected).
- **Remote draft:** `worker/mcp.ts` is an `McpAgent` Durable Object holding a
  private authoring store and registering the same tools with the bundled
  renderer.
- **Shared workspace:** `worker/document.ts` is one `TopologyDocument` Durable
  Object per owner/document. It serializes operation batches, revisions,
  proposals and scoped leases. Both `/api/workspaces/*` and remote MCP workspace
  tools use `worker/workspaces.ts`, so browser and agent cannot bypass the
  coordinator.
- **Identity:** new workspace directories and document addresses use GitHub's
  stable numeric user id. The old login-keyed registry is read only as a lazy
  migration source. `worker/index.ts` wraps the surfaces in OAuth 2.1 / GitHub
  sign-in and serves static assets.

## Deployment and environment boundary

The production Worker is stateful: its OAuth grants, public share snapshots,
transport/private-draft objects, owner registries, and canonical document
coordinators are part of one environment. A preview is therefore not just a
different bundle URL.

The deployment architecture uses a stable `topology-dojo-staging` Worker with
separate KV namespaces, Durable Object namespaces, GitHub OAuth App/secrets, and
public origin. This staging environment is live: it is deployed by a CI-gated
`deploy-staging.yml` workflow and has passed a fully-green gated deploy with
external smoke evidence. Cloudflare version uploads are not used for Durable
Object migration releases; staging receives a full environment-scoped deploy.
Production deploys through the same CI-gated Actions path
(`deploy-production.yml`, restricted to `main` behind a protected environment
approval); its cutover from the legacy Workers Builds path and the first gated
production deploy remain protected operator steps.

Migration-bearing releases separate namespace creation from feature
activation. For `v3`, production first exports and binds `TopologyDocument`
with workspace entry points disabled. A later compatible deployment enables
the shared-workspace feature after smoke and UAT. Recovery across the migration
boundary is forward-only: keep the class, binding, and migration history while
disabling the feature and deploying a compatible repair.

See
[`proposals/0004-isolated-staging-and-deployment-pipeline.md`](proposals/0004-isolated-staging-and-deployment-pipeline.md),
[`DEPLOYMENT_RUNBOOK.md`](DEPLOYMENT_RUNBOOK.md), and
[`ROLLBACK.md`](ROLLBACK.md).

## Shared workspace protocol

The canonical document is stored as metadata plus one `page:<id>` value per
page, never one whole-document value. Each accepted batch supplies a
`baseRevision`, idempotency id and semantic operations. The coordinator rebases
field-disjoint changes and explicitly rejects overlapping targets. A bounded
operation log supports `get_workspace_changes`; agents hydrate only selected
page elements when needed.

Agent writes are proposals unless the browser has granted a live current-page
lease. A lease grants limited authority but does not block the human editor.
Proposal acceptance creates one atomic revision. Existing registry documents
initialize their coordinator on first workspace access; the directory marker is
written only after successful initialization, and legacy mutation is then
refused. See
[`proposals/0002-shared-human-agent-workspace.md`](proposals/0002-shared-human-agent-workspace.md).

## Locked decisions

1. **Flipbook over choreography.** Pages are independent full frames; no
   beat/delta/resolve machinery in the live product. (Rationale + revisit
   triggers: [`decisions/0001-flipbook-vs-beats.md`](decisions/0001-flipbook-vs-beats.md).)
2. **Vendor the renderer, rebuild the editor.** Reuse the proven engine's visual
   quality; own the interaction layer in TypeScript.
3. **The document is the complete contract; no UI-only surfaces.** Enforced by
   the catalog + its parity test.
4. **One render core** shared across Node and Workers; **one capability catalog**
   shared across GUI, validation, and MCP.
5. **TypeScript strict** (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`,
   `isolatedModules`); the engine is vendored unmodified.
6. **Operations, not document checkout, for collaboration.** Agents suggest by
   default; short UI-granted leases are scoped authority, not a global mutex.
7. **Repository state, not chat history, for implementation.** Agentic feature
   work uses bounded packets, one active writer per branch, deterministic
   evidence, adversarial review, and human-controlled merge/release gates. See
   [`AGENTIC_IMPLEMENTATION_WORKFLOW.md`](AGENTIC_IMPLEMENTATION_WORKFLOW.md).

## Known constraints

- Custom node types render as static art (no morph-tween) — the flipbook model
  has no tweening by design.
- Local stdio and pre-handoff remote authoring remain private draft workflows.
  Once handed off, the canonical workspace survives MCP transport/session
  turnover; legacy tools are intentionally rejected for that document.
- The first workspace slice is single-owner. Multi-human presence, visual
  proposal diffs, and IndexedDB offline recovery have since shipped (Packets
  S1, R1, S3 — see `ROADMAP.md`'s "Completed historical milestones").
  Organization ACLs and CRDT-style offline multi-master editing remain
  follow-on work; the latter is explicitly evidence-triggered — see
  `ROADMAP.md` §"Evidence-triggered." _(Corrected 2026-07-19; see
  `DISCREPANCY_REGISTER.md` row 10.)_
- The vendored engine is treated as an opaque renderer; we drive a small, typed
  slice of its surface and avoid editing it. Sanctioned exceptions so far, both
  additive and default-preserving: (1) a per-marker `icon` override so the
  catalog — not the engine — owns the policy-marker glyph set (`src/api/markers.ts`);
  (2) per-link flow controls (`flowSpeed` / `flowParticles` / `reverseFlow`) honored
  by the flow/tunnel/wireguard renderers, defaulting to the original animation;
  (3) per-node `opacity` multiplied into the primary node-render path so it is a
  real document field (the engine's other render path already honored it) —
  values below 0.9 also pick up the engine's existing depth-of-field blur.
