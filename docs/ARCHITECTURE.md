# Architecture

## Layers

```
vendor/topology-ds.ts   typed facade over the vendored TopologyDesigner engine.
                        The engine is the RENDERER only; we never use its
                        choreography. Browser-side it's a classic <script> that
                        sets window.TopologyDesigner.

pages/model.ts          the flipbook document model (Document → Page[]).
pages/persist.ts        (de)serialize + autosave to localStorage; defensive parse.

api/                    headless authoring, DOM-free:
  builder.ts            pure ops + fluent builder (createDocument()…build()).
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

mcp/                    MCP server: tools.ts (pure handlers), store.ts (in-memory
                        registry), register.ts (adapter), server.ts (stdio entry).
                        Shared by the Worker. (Remote auth lives in worker/, not here.)

worker/                 Cloudflare Worker: index.ts (serve app + route /mcp),
                        mcp.ts (McpAgent Durable Object), render.ts (bundled engine).

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
- **Remote:** `worker/mcp.ts` is an `McpAgent` Durable Object (one per MCP
  session, holding that session's store) registering the same tools with the
  bundled Worker renderer. `worker/index.ts` wraps it in an OAuth 2.1 provider
  (`@cloudflare/workers-oauth-provider`, GitHub sign-in) that gates `/mcp`, and
  serves everything else from static assets.

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

## Known constraints

- Custom node types render as static art (no morph-tween) — the flipbook model
  has no tweening by design.
- Remote MCP session state lives in the Durable Object's memory for the session
  lifetime; `get_topology` exports the portable JSON to persist it.
- The vendored engine is treated as an opaque renderer; we drive a small, typed
  slice of its surface and avoid editing it. Sanctioned exceptions so far, both
  additive and default-preserving: (1) a per-marker `icon` override so the
  catalog — not the engine — owns the policy-marker glyph set (`src/api/markers.ts`);
  (2) per-link flow controls (`flowSpeed` / `flowParticles` / `reverseFlow`) honored
  by the flow/tunnel/wireguard renderers, defaulting to the original animation;
  (3) per-node `opacity` multiplied into the primary node-render path so it is a
  real document field (the engine's other render path already honored it) —
  values below 0.9 also pick up the engine's existing depth-of-field blur.
