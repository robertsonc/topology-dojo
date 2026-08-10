# Proposal: groundwork for live SD-WAN flow visualization

- **Status:** Implemented — E1 (#65), E2 (#66), E3 (#67), E4 (#68), E5
- **Date:** 2026-06-09
- **Scope:** code review of the current repo + the five enhancements that lay
  the groundwork for an agent to (1) gather live flow details from an
  EdgeConnect SD-WAN Orchestrator for any active or recently-ended flow in the
  fabric's flow tables, and (2) build a hop-by-hop topology showing the
  underlay, overlay, and policy layers, with the data flow animated end to end.

## Part 1 — Code review

### Health

At this proposal's 2026-06-09 baseline, `npm test` (102 tests / 14 files),
`npm run typecheck` (app + worker), and `eslint` + `prettier` were green on
`main`. These counts are historical evidence, not the current release gate;
use the living [QA test plan](../launch-readiness/QA_TEST_PLAN.md).

### What the architecture already gets right for this use case

- **DOM-free authoring core** (`src/api`) shared by the editor, Node, and the
  Worker — a live-data importer can be pure, unit-tested, and run anywhere.
- **The document is the complete contract** (`docs/DESIGN.md` #2) with a
  machine-readable **capability catalog** (`src/api/catalog.ts`) and a parity
  test — any new vocabulary (layers, hops, sources) lands once and is
  automatically reachable from GUI, validation, and MCP.
- **Flow paths already exist** (`FlowPathConfig`, `src/vendor/topology-ds.ts:92`)
  with ordered waypoints, `animation: 'particles' | 'dashed' | 'pulse'`,
  `speed`, `direction`, width/opacity — the visual substrate for an animated
  flow is in place.
- **Policy markers** (`PolicyMarkerConfig`, `src/vendor/topology-ds.ts:114`)
  attach enforcement glyphs (inspect/allow/deny/encrypt/NAT/…) to nodes and can
  reference a `flowPathId` — the substrate for the policy layer.
- **Zones** (incl. `parentZone` nesting) can visually group sites/transports.
- **Node `meta`** (`Record<string, string | number | boolean>`) carries
  arbitrary flat metadata (serials, IPs, versions) and is validated.
- **24 MCP tools** (`src/mcp/tools.ts`) over a per-session store, with the
  discover → build → validate → tidy → render loop, both stdio and hosted
  (Durable Object per session, OAuth 2.1/GitHub on the Worker).
- **`share_topology`** publishes durable KV snapshots viewable in the editor —
  the natural way for an agent to hand a human a finished flow diagram.

### Findings (gaps and defects relevant to the goal)

| #   | Finding                                                                                                                                                                                                                                                                                                                | Severity         | Where                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------- |
| 1   | **No outbound data integration at all.** The only `fetch` calls are GitHub OAuth and the SPA snapshot load. There is no client for any orchestrator, no provider abstraction, and no place to hold third-party credentials beyond the OAuth secrets pattern.                                                           | Blocker for goal | `worker/default-handler.ts:90–116`                |
| 2   | **The authoring surface is add-only.** Builder + MCP expose `add_*` but no update/move/remove of nodes, links, zones, flow paths, or markers (only `set_node_metadata`, `set_page_properties`, `set_document_title`). A live importer cannot refresh a topology in place — it can only append or rebuild from scratch. | High             | `src/api/builder.ts`, `src/mcp/tools.ts`          |
| 3   | **No layer concept.** Underlay vs. overlay vs. policy can only be implied by node type or color. Zones are visual-only; there is no per-element layer tag, no z-order control, no layer toggle.                                                                                                                        | High             | `src/pages/model.ts`, `src/vendor/topology-ds.ts` |
| 4   | **Flow paths carry no per-hop data.** `waypoints: string[]` is bare ids — nothing can record "hop 2 rode tunnel X with 23 ms latency" or which underlay link a hop traversed.                                                                                                                                          | High             | `src/vendor/topology-ds.ts:92–104`                |
| 5   | **No stable external identity.** Node ids are session-generated (`n<timestamp><seq>`); `meta` is free-form. There is no convention to correlate a node with an appliance `nePk`/serial, so re-imports can't match, diff, or upsert.                                                                                    | High             | `src/api/builder.ts:26`                           |
| 6   | **MCP tool inputs are not runtime-validated.** Zod schemas are passed to the MCP SDK as metadata, but handlers coerce raw `Record<string, unknown>` themselves (`String(a.type)`, `Number(a.x)` → `NaN` passes silently). Must be fixed before tools start carrying orchestrator queries.                              | Medium           | `src/mcp/tools.ts`                                |
| 7   | **No playback/timing.** Pages are static frames with no duration; the editor filmstrip has no play-through. Per-page flow animation loops, but "animate the flow end to end" across states has no machinery.                                                                                                           | Medium           | `src/pages/model.ts`, `src/editor/editor.ts`      |
| 8   | **Silent error swallowing in the Worker OAuth callback** (`catch { return 400 }`) — no logging, hard to debug live auth; the same care will be needed for orchestrator-call failures.                                                                                                                                  | Low              | `worker/default-handler.ts:82`                    |
| 9   | **Quadratic layout algorithms** (force layout O(n²)·90 iters; tidy O(n²)·120 iters) — fine today, will be felt when importing fabric-scale topologies (hundreds of appliances/tunnels).                                                                                                                                | Low              | `src/api/autolayout.ts`, `src/api/tidy.ts`        |
| 10  | Dormant beat model (`src/core`) is healthy dead code per ADR-0001; the playback enhancement below deliberately does **not** revive it.                                                                                                                                                                                 | Info             | `src/core/`                                       |

## Part 2 — The five key enhancements

Ordered as a dependency chain; each is a reviewable PR-sized track that runs
through the full contract (model → builder → catalog → validate → render →
editor → MCP), per DESIGN.md #2/#3.

### E1. First-class layers in the document contract (underlay / overlay / policy)

**What:** Add a `layers` axis to the document so one page can express the three
planes of the same fabric and a viewer can fade/isolate them.

- `TopologyDocument.layers?: LayerDef[]` — `{ id, name, kind?: 'underlay' | 'overlay' | 'policy' | 'service', color?, defaultVisible? }`.
- `layer?: string` on `NodeConfig`, `LinkConfig`, `ZoneConfig`,
  `FlowPathConfig`, `PolicyMarkerConfig` (optional ⇒ fully backward compatible;
  absent = base layer).
- Render: deterministic z-order underlay → overlay → policy; a
  `RenderOptions.visibleLayers?: string[]` filter (and dimming for hidden
  layers) threaded through all three render paths.
- Editor: a layer chips bar (show/hide/dim); inspector shows the element's
  layer. MCP: `layer` accepted on every `add_*` tool; catalog + `validate`
  learn the field (dangling layer ref = warning).

**Why first:** every downstream artifact (imported topology, flow path, policy
marker) needs somewhere to declare which plane it belongs to. An overlay tunnel
_link_ between two EdgeConnect nodes and the three underlay _links_ it rides
can finally coexist on one page, visually disambiguated.

### E2. External identity + full CRUD: make the document refreshable

**What:** Give elements a stable identity in the source system, and complete
the mutation surface so live data can be re-applied idempotently.

- `source?: SourceRef` on nodes/links/zones/flowPaths —
  `{ system: string; kind: string; id: string; fetchedAt?: string }`
  (e.g. `{ system: 'edgeconnect', kind: 'appliance', id: 'nePk:77.NE' }`,
  `kind: 'tunnel' | 'overlay' | 'flow'`). Document-level
  `sources?: SourceDescriptor[]` records where the data came from and when.
- New pure ops + MCP tools: `update_node` / `update_link` / `update_zone` /
  `update_flow_path` / `update_policy_marker`, `remove_element`, `move_node`,
  and `upsert_by_source` (match on `source.system+kind+id`, else create).
- `validate` checks `SourceRef` shape; catalog exposes the field.

**Why:** flows end and tunnels bounce. The difference between a screenshot and
a _live_ view is being able to run the importer again and have the diagram
converge instead of duplicate. This also fixes review finding #2 for human
agents generally — today nothing built through MCP can be edited afterward.

### E3. The connector layer: a `TopologyProvider` interface + EdgeConnect Orchestrator client

**What:** A new DOM-free `src/connect/` package that owns all outbound data
access, hidden behind an interface so the fabric vendor is swappable and tests
use a fixture provider.

```ts
interface TopologyProvider {
  describe(): ProviderInfo; // system name, capabilities
  getAppliances(): Promise<ApplianceRecord[]>; // gateways/EC devices + sites
  getTunnels(scope: 'underlay' | 'overlay'): Promise<TunnelRecord[]>;
  getOverlayPolicies(): Promise<OverlayPolicyRecord[]>; // BIOs, route/QoS/security policy
  getFlows(query: FlowQuery): Promise<FlowRecord[]>; // active + ended, fabric-wide
  getFlowDetails(ref: FlowRef): Promise<FlowDetail>; // per-hop/tunnel detail
}
```

- `EdgeConnectProvider` implements it over the Orchestrator REST API
  (`/gms/rest/...`): appliance inventory (`/appliance`), physical + bonded
  tunnels (`/tunnels2/...` — underlay vs. overlay), Business Intent Overlay
  config (`/gms/overlays/...`), and the per-appliance **flow table** reached
  through the Orchestrator's appliance-API proxy
  (`/appliance/rest/{nePk}/flow`, `flow/flowDetails`) so both _active and
  recently-ended_ flows are queryable across the fabric without talking to
  gateways directly. Auth = Orchestrator API key header; pagination, retry,
  and normalization live here and nowhere else.
- Credentials follow the existing secret pattern: `ORCH_BASE_URL` /
  `ORCH_API_KEY` as Worker secrets / env / stdio-server env — **never** passed
  through MCP tool arguments.
- Wired in via `ToolDeps` (exactly how `publishTopology` is injected today),
  and exposed as read-only MCP tools: `list_appliances`, `list_tunnels`,
  `list_flows`, `get_flow_details`, `get_overlay_policies`. A
  `MockProvider` with recorded fixtures keeps `src/connect` fully unit-tested
  offline.
- Prerequisite folded in: runtime Zod validation of tool inputs (finding #6)
  before any tool starts accepting query strings destined for an external API.

**Why:** this is the literal "method to query the Orchestrator and SD-WAN
gateways for flow, topology, and overlay policy data" — isolated where
credentials are safe, the vendor API is normalized once, and the rest of the
codebase stays pure.

### E4. The flow-to-topology compiler: records → layered document

**What:** A pure, deterministic mapping pipeline in `src/connect/compile.ts`
that turns provider records into a valid, tidy `TopologyDocument` — the step
that makes "agent builds a hop-by-hop topology" a single tool call instead of
forty.

- `compileFabric(appliances, tunnels, policies) → TopologyDocument` — sites as
  zones, appliances/gateways as nodes (`source` refs + `meta`: serial, model,
  sw version, WAN labels), underlay circuits as `layer: 'underlay'` links,
  overlay/BIO tunnels as `layer: 'overlay'` links.
- `compileFlow(doc, flowDetail, policies) → Page` — resolves the flow's
  ingress appliance, chosen overlay, tunnel sequence, and egress into an
  ordered hop list; emits a `FlowPathConfig` whose waypoints follow the hops,
  with **per-hop annotations**: extend `FlowPathConfig` with
  `hops?: { ref: string; linkId?: string; layer?: string; meta?: Record<string, string | number | boolean> }[]`
  (waypoints stay the render contract; `hops` carries latency/loss/tunnel-id
  per segment for inspector display and labeling). Policy decisions from the
  matched BIO/security rules become `policyMarkers` (`layer: 'policy'`,
  `flowPathId` set) at the hops where they apply.
- Ends with the existing loop: `validateDocument` + `tidyDocument` (or
  hierarchical `layoutDocument` LR for fabrics) before returning.
- One orchestrating MCP tool: `build_flow_topology({ flowQuery })` →
  fetches via E3, compiles, stores, returns `{ topologyId, problems }`; the
  agent then `render_svg`s or `share_topology`s it. Re-running it upserts via
  E2 instead of duplicating.

**Why:** keeps intelligence out of the prompt. The mapping from EdgeConnect's
data model to the diagram vocabulary is encoded once, tested against fixtures,
and identical no matter which agent (or human) asks.

### E5. Playback: timed flipbook + end-to-end flow animation

**What:** the animation groundwork, staying inside the flipbook decision
(ADR-0001 — no beat revival).

- Contract: `Page.duration?: number` (ms) and optional `Page.transition?:
'cut' | 'fade'` — catalog'd, validated, defaulted.
- Editor: a play/pause/step control on the filmstrip that advances pages on
  their durations; per-page `flowPath` animation (already shipped) keeps
  running within each frame, so "animate the data flow end to end" composes
  from (a) the flow path's own particle motion along the full hop sequence
  and (b) page-by-page progression (e.g. page 1 underlay handshake, page 2
  overlay path active, page 3 policy verdict).
- Headless parity: `render_svg` gains `animate?: boolean` (today's behavior
  effectively freezes motion via the trailing-step trick; expose the moving
  variant) and an `export_flipbook` path — standalone HTML that embeds page
  SVGs and the timing track (also closes the roadmap's "Export / share" item).
- The compiler (E4) can emit a multi-page sequence per flow (setup → steady
  state → teardown for ended flows) so an agent's answer to "show me this
  flow" is a self-playing artifact.

**Why:** without timing in the _contract_, playback would be a UI-only feature
and violate DESIGN.md #2. With it, an agent can author the animation, the
editor can play it, and a share link can replay it.

## Sequencing & dependencies

```
E1 layers ──► E4 compiler ◄── E3 connector (+ Zod runtime validation)
E2 identity/CRUD ──► E4        E5 playback (independent; lands anytime)
```

E1 and E2 are pure contract work (no network), each its own PR. E3 lands with
a mock provider + fixtures; E4 builds on all three; E5 is parallel. Every
track keeps the catalog parity test green so nothing becomes UI-only or
API-only.
