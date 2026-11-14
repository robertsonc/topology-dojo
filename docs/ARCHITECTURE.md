# Architecture

_Revalidated 2026-11-13 against `main` at `e99b012`: the module map below was
extended for the directories added since August (exports, imports, hardware
catalog, SD-WAN generator, API keys) and the deployment section corrected
for proposal 0007._

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
  autolayout.ts         arrange from scratch (hierarchical / grid / circular /
                        force / tiered); templates.ts builds the six starters.
  geometry.ts           pure node AABBs (shared by editor + layout).
  layers.ts, link-styles.ts, tiers.ts, bundles.ts, sheet.ts, page-link.ts,
  hardware.ts           document vocabulary added since: layers, wire classes,
                        tiers, LAG/ECMP bundles, the sheet frame, page links,
                        and hardware bindings (proposals 0008 / 0010, hw-catalog).

render/core.ts          engine-agnostic render: (EngineClass, page) → SVG string.
render/                 TypeScript overlays + headless mirrors around the core:
                        theme.ts (light theme remap), inspect.ts (the
                        inspect_render QA report), link-attach.ts / hit-boxes.ts
                        (mirror the engine's link trimming and node footprints),
                        port-pills.ts, port-table.ts, sheet.ts, wire-labels.ts,
                        zone-box.ts, wiresheet.ts (hardware panel pages),
                        backdrops.ts (map backdrops), flipbook.ts (HTML export).
server/render.ts        Node: load the engine via createRequire, call the core.
server/                 other Node/shared helpers: raster.ts (resvg loader),
                        catalog.ts, export-file.ts + safe-path.ts (stdio export
                        to disk), session.ts (signed cookies), api-key.ts.

export/                 output formats. scene.ts is the one format-neutral
                        geometry model behind the editable exports (drawio.ts,
                        vsdx.ts + visio-masters.ts + vssx.ts, pptx.ts);
                        raster.ts / png.ts / pdf.ts rasterize the engine SVG
                        with resvg (wasm); mermaid.ts; cable-schedule.ts.
                        Fidelity contract: docs/EXPORTS.md.
import/                 inputs: legacy.ts (Topology Studio), drawio.ts,
                        mermaid.ts, csv.ts, open.ts (file-kind detection).

catalog/                hardware catalog (hw-catalog): loader.ts (versioned
                        bundle + LRU), validate.ts (wiring rules, a port of the
                        Python reference in /catalog/tools), assign.ts,
                        describe.ts, diff.ts, sanitize-svg.ts. Data, schema and
                        fixtures live in the top-level /catalog directory.

nodes/                  custom node types (data, not code): spec.ts (CustomNodeSpec),
                        render.ts (pure interpreter + browser registration),
                        data.ts (shapes/icons), designer.ts (the Node Designer modal).

editor/editor.ts        the canvas editor: an interaction overlay <svg> over the
                        engine-rendered art <svg>. Owns selection, drag, marquee,
                        smart guides, links + waypoint editing, undo/redo, tidy.

connect/                the live-data connector layer: types.ts (the vendor-neutral
                        TopologyProvider contract + normalized records), edgeconnect.ts
                        (EdgeConnect Orchestrator REST client; injectable fetch),
                        mock.ts (fixture fabric for tests/demos), compile.ts (the
                        flow-to-topology compiler), generate.ts (the SD-WAN
                        generator: intent → fabric records → the same compiler;
                        proposal 0010). Credentials come from env/secrets only —
                        never through tool arguments.

stories/                scenario stories (initiative T): types.ts (the
                        FlowScenario contract — a base fabric plus named steps
                        of changes — and its validator), compile.ts
                        (compileFlowStory: one full page per step), frame.ts
                        (the one layout every page shares), annotate.ts (what
                        marks a failure on its page). A library with no MCP
                        tool or GUI yet. See "Scenario stories" below.

mcp/                    MCP server: tools.ts (pure handlers), export-tools.ts
                        (export_topology / view_topology), hardware-tools.ts,
                        store.ts (in-memory registry), persist-store.ts (durable
                        mirror), rate-limit.ts, workspace-reads.ts, viewer-html.ts
                        (the MCP Apps inline view), register.ts (adapter + runtime
                        arg validation), server.ts (stdio entry).
                        Shared by the Worker. (Remote auth lives in worker/, not here.)

workspace/              shared human-agent write protocol: revision/operation/
                        proposal types, local snapshot→operation adapter,
                        field-level conflict targets, browser API client,
                        upsert.ts, preview.ts, presence.ts, offline.ts.

profile/                adaptive authoring profiles (proposal 0003): features.ts,
                        learner.ts, refinement.ts, guidance.ts — pure, DOM-free.
share/                  public share snapshots: snapshot.ts (KV contract), copy.ts.
agent-activity/, admin/ MCP-session trail shaping and the owner dashboard's
                        client/model (Initiative A, admin dashboard).
ui/                     browser panels outside the canvas: workspace-panel.ts,
                        profile-panel.ts, admin-dashboard.ts, sdwan-wizard.ts.

worker/                 Cloudflare Worker: index.ts (OAuth provider wrapper +
                        Durable Object exports), default-handler.ts (routes),
                        mcp.ts (transport/private-draft DO), registry.ts (per-owner
                        drafts + directory DO), document.ts (one canonical
                        coordinator per shared topology), workspaces.ts (owner
                        directory + lazy migration), profile.ts, analytics.ts,
                        auth.ts + landing.ts, api-keys.ts, share.ts, catalog.ts,
                        raster.ts, render.ts, staging-fault.ts.

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

That is the core shape. `src/pages/model.ts` is authoritative for the
optional fields added since: on the document, `legend`, `stencils`,
`linkStyles`, `tiers`, `bundles`, `sheet`, `palette` and `catalogVersion`;
on a page, `duration` / `transition`, `caption` / `emphasis`, `lineJumps`,
`linkAttach`, `portLabels`, and `view: 'logical' | 'wiresheet'` with
`panelScale`.

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

### Scenario stories

`src/stories` turns a `FlowScenario` into a flipbook with one page per step
(`compileFlowStory`). A scenario is a fabric state — plain appliance, tunnel
and flow records, from a provider snapshot or from the SD-WAN generator
(`sdwanFabricRecords`) — plus an ordered list of named steps, each a set of
changes to those records: this tunnel goes down, this flow takes that
tunnel. It is pure and needs no provider.

**The steps are changes; the pages are not.** The compiler applies the
changes to the records to get the fabric state at each step, then compiles
every state from scratch with the flow compiler (`compileFabric` +
`compileFlow`, unchanged). No page is stored as a difference from another,
refers to another, or is derived from another page's content: delete or
rewrite one and the rest are untouched. That is the rule above, kept on
purpose. A change to `src/stories` that needs one page to read another is
the wrong change.

What pages have in common is computed, never stored as a link between them:

- **Element ids.** The flow compiler's ids are deterministic, so the same
  appliance, tunnel or flow has the same id on every page.
- **Node positions.** Before any page, `frame.ts` compiles every state onto
  one throwaway page, so that it holds each node that appears anywhere in
  the story, and places the nodes once: spokes in a column, hubs facing
  them, endpoints beside their appliance. Each page copies its x/y from
  that frame, so a node does not move when the story flips. (Laying each
  page out on its own moves nodes whenever a flow comes or goes. Converging
  one page into the next re-seeds positions and leaves stale keys;
  `src/connect/compile.test.ts` pins both.)

`annotate.ts` then marks the step on its own page, with vocabulary the
document already had: `status` for an unreachable appliance, a `deny` marker
where a down tunnel leaves, a `redirect` marker on the appliance a rerouted
flow now leaves through, a stopped red path for a flow that cannot flow, and
the page's `emphasis` on whatever the step changed.

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

## Untrusted documents

A document can come from an opened file, an import, a public share link or a
workspace commit, so its content is untrusted everywhere it is drawn. Two
layers keep it from becoming markup, and each is tested on its own.

1. **The gate: `parseDoc` (`src/pages/persist.ts`).** Every document passes it:
   native files, imports (`classifyOpenedFile` runs each importer's output
   through it), share links, autosave, the MCP stores and workspace commits.
   Behind the gate an element is a plain object with a string id; every field
   the catalog declares is the declared kind (a finite number, a safe colour,
   a boolean, an id string) or absent (`src/pages/typed-fields.ts`); a
   `viewBox` is four numbers; free text is length-bounded. Nothing behind the
   gate checks types again.
2. **The sinks.** The engine builds SVG by interpolation. Element configs are
   made safe once on the way in (`_safeCfg` in
   `public/vendor/topology-ds.js`): any string that is not free text and not
   an id has `"`, `<` and `>` turned into entities. Free text is escaped where
   it is drawn, and ids where they are written out. Markup the renderer writes
   as is (wire-sheet panel art) travels beside the config, never in it
   (`WiresheetLayout.art`), so a document cannot supply it.

A new free-text property is either escaped where it is drawn and added to the
engine's `_TEXT_KEYS`, or left out of that list, in which case the input pass
escapes it. `src/server/untrusted.test.ts` renders a document whose every
field is a markup payload; `e2e/untrusted-document.spec.ts` opens one in the
browser, by file, by share link and by CSV import.

## The capability catalog

`api/catalog.ts` is the single machine-readable description of the persisted
diagram semantics a topology can express — each node type, link type, and
annotation kind with its fields (kind, enum options, animation flags,
id-reference kinds). It is the source of truth that three consumers align to:

- the **GUI** builds its palette and inspector from it,
- **validation** checks enum values and field shapes against it,
- **MCP** exposes it via `describe_capabilities` so an agent can discover the
  vocabulary before authoring.

A parity test asserts the catalog covers the whole built-in vocabulary, which is
how we enforce "no UI-only authoring fields": a persisted diagram capability
that is not in the catalog cannot be reached by the API, so it is not allowed to
exist. Transient view preferences and browser-owner authority are intentionally
outside this invariant.

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
  coordinator. Its input vocabulary accepts `element.upsert` (proposal 0006),
  which `src/workspace/upsert.ts` normalizes into `element.add` /
  `element.patch` by source identity before validation, conflict detection,
  and storage — the stored vocabulary never grows.
- **Identity:** new workspace directories and document addresses use GitHub's
  stable numeric user id. The old login-keyed registry is read only as a lazy
  migration source. `worker/index.ts` wraps the surfaces in OAuth 2.1 / GitHub
  sign-in and serves static assets. Behind `API_KEYS_ENABLED`, a user-minted
  `tdk_` API key (`worker/api-keys.ts`, proposal 0005) resolves through the
  provider's `resolveExternalToken` hook to the same `{ id, login, name }`
  props plus `auth`/`scopes`, so the coordinator, registry, quotas, and share
  ownership see one identity model.

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
Production deploys through the same CI-gated Actions path: since proposal
0007 (2026-10-10) that is `release.yml`, which runs on every non-docs push
to `main` — CI on the merge SHA, a staging rehearsal, a Durable Object
migration guard (`scripts/migration-guard.mjs`), then production — through
the `deploy-worker.yml` implementation it shares with `deploy-staging.yml`.
Merging to `main` is the release decision; the earlier manual
`deploy-production.yml` dispatch and its protected-environment approval were
removed. The cutover from the legacy Workers Builds path and the first gated
production deploy are complete; laptop-driven production deployment remains
deliberately unavailable.

The Worker declares five Durable Object classes, one migration tag each
(`wrangler.jsonc`, identical in `env.staging`): `v1` `TopologyMcp`, `v2`
`TopologyRegistry`, `v3` `TopologyDocument`, `v4` `AuthoringProfile`, `v5`
`AnalyticsLog`. Feature flags are plain `vars`: `WORKSPACE_ENABLED`,
`PROFILES_ENABLED` and `ANALYTICS_ENABLED` are `"true"` in both
environments; `API_KEYS_ENABLED` is `"true"` on staging and `"false"` in
production; `LIVE_DATA_ENABLED` is `"false"` in both.

Migration-bearing feature releases separate namespace creation from feature
activation. Migrations `v3`–`v5` are the historical examples of that pattern:
production first exported and bound each new feature Durable Object with its
entry points disabled, then a later compatible deployment activated the feature
after smoke and acceptance evidence. Migrations `v1` and `v2` predate this
feature-activation pattern. Recovery across any migration boundary is always
forward-only: keep the class, binding, and migration history while disabling
the feature where possible and deploying a compatible repair.

See
[`proposals/0004-isolated-staging-and-deployment-pipeline.md`](proposals/0004-isolated-staging-and-deployment-pipeline.md),
[`proposals/0007-merge-is-the-release.md`](proposals/0007-merge-is-the-release.md),
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
Proposal acceptance creates one atomic revision. Only an authenticated browser
owner may initialize a legacy draft as a canonical workspace; agent workspace
reads reject the legacy id without migrating it. The directory marker is
written only after successful initialization, and legacy mutation is then
refused. See
[`proposals/0002-shared-human-agent-workspace.md`](proposals/0002-shared-human-agent-workspace.md).

## Locked decisions

1. **Flipbook over choreography.** Pages are independent full frames; no
   beat/delta/resolve machinery in the live product. (Rationale + revisit
   triggers: [`decisions/0001-flipbook-vs-beats.md`](decisions/0001-flipbook-vs-beats.md).)
2. **Vendor the renderer, rebuild the editor.** Reuse the proven engine's visual
   quality; own the interaction layer in TypeScript.
3. **The document is the complete authoring contract; no UI-only persisted
   diagram fields.** Enforced by the catalog + its parity test. View state and
   owner-only governance actions are explicit exceptions, not document fields.
4. **One render core** shared across Node and Workers; **one capability catalog**
   shared across GUI, validation, and MCP.
5. **TypeScript strict** (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`,
   `isolatedModules`); the engine is vendored and used only as a renderer.
   It is no longer byte-for-byte the upstream file: targeted edits are
   listed under "Known constraints".
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
  slice of its surface and avoid editing it. The first sanctioned exceptions,
  additive and default-preserving: (1) a per-marker `icon` override so the
  catalog — not the engine — owns the policy-marker glyph set (`src/api/markers.ts`);
  (2) per-link flow controls (`flowSpeed` / `flowParticles` / `reverseFlow`) honored
  by the flow/tunnel/wireguard renderers, defaulting to the original animation;
  (3) per-node `opacity` multiplied into the primary node-render path so it is a
  real document field (the engine's other render path already honored it) —
  values below 0.9 also pick up the engine's existing depth-of-field blur.
  Since August 2026 `public/vendor/topology-ds.js` has taken further targeted
  edits (`git log -- public/vendor/topology-ds.js`): flow paths that follow
  link geometry (on by default; `followLinks: false` opts out), wire-label
  wrapping and placement, the callout/text `body` field, zone boxes sized to
  member labels, the opt-in link anchor box, tiers / zone bottom captions /
  the chassis shape, rounded orthogonal corners, role-aware light-theme
  knobs, node-label placement, and zone map backdrops. Each new headless
  mirror (`src/render/link-attach.ts`, `src/render/hit-boxes.ts`) exists so
  TypeScript code measures what the edited engine actually draws.
