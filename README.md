# Topology Dojo

A studio for designing **network topology diagrams** — built so they are equally
authorable by **people** (a direct-manipulation canvas editor) and by **agents**
(a headless API exposed over MCP). Same document, same renderer, same
capabilities either way.

The long-term aim: one consistent topology framework for everything SASE, where
every diagram has the same look and feel whether a human drew it or an LLM
generated it.

## The model in one minute

- A **document** is an ordered list of **pages** — each page a complete,
  standalone topology frame (like a sheet of transparency film). Duplicating a
  page deep-copies it; "animation" is flipping between pages. No deltas, no
  choreography engine — you edit frames directly. (This "flipbook" model
  replaced an earlier beat/delta model, whose core still lives in `src/core`,
  dormant.)
- A page holds **nodes**, **links**, **anchors**, and an annotation layer of
  **zones**, **flow paths**, and **policy markers**.
- The document JSON is the **contract**: everything the GUI can express lives in
  it, and everything in it is reachable from the headless API — there are no
  UI-only surfaces.

## Quick start

```bash
npm install
npm run dev         # app at http://localhost:5173
npm test            # unit tests (Vitest)
npm run lint        # eslint + prettier
npm run build       # typecheck (app + worker) + production build
npm run mcp         # run the MCP server over stdio
```

## Three ways in

1. **The editor** — a canvas editor over the vendored rendering engine: select /
   marquee / drag, smart alignment + spacing guides, grid + snap, links with
   on-canvas waypoint editing, align / distribute, a calm-canvas toggle, a
   catalog-driven palette + inspector, a filmstrip of pages, a Node Designer for
   custom node types, and one-click **Tidy** (auto-layout).
2. **The headless API** (`src/api`) — build / mutate / validate / lay out /
   render a document in code, DOM-free. The GUI is just one client of it.
3. **MCP** (`src/mcp`, `worker/`) — the same API exposed as tools over the Model
   Context Protocol, both locally (stdio) and hosted on Cloudflare. See
   [`src/mcp/README.md`](src/mcp/README.md).

## Layout that holds up for AI

Agent-generated diagrams tend to overlap. The API ships a layout **ground
truth**: `layoutGuidelines` (machine-readable spacing/grid/zone rules), an
overlap **analyzer** folded into `validate`, and **`tidy`** auto-layout
(grid-snap + de-overlap + keep-in-bounds). The agent loop is **discover → build →
validate → tidy → render**.

## Structure

```
src/
  vendor/      typed facade over the vendored TopologyDesigner engine (the renderer)
  pages/       the flipbook document model + persistence (autosave / import / export)
  api/         headless authoring: builder · validate · catalog · layout · tidy · geometry
  render/      engine-agnostic render core (shared by Node and the Worker)
  server/      Node headless renderer (loads the engine via createRequire)
  nodes/       custom node types: spec · interpreter · Node Designer
  editor/      the canvas editor (selection, drag, guides, links, tidy)
  mcp/         MCP server: tools · store · auth · registration (used by stdio + worker)
  core/        the retired beat-model (dormant; kept for reference)
worker/        Cloudflare Worker: serves the app + /mcp (Durable Object sessions)
public/vendor/ the vendored engine + theme (classic script in the browser, CommonJS in Node)
```

## Docs

- [`docs/DESIGN.md`](docs/DESIGN.md) — the north star and the principles every PR
  is reviewed against.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the model, the render seam, the
  API surface, the MCP/Worker shape, and the locked decisions.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — what's built and what's next.
- [`docs/decisions/`](docs/decisions/) — architecture decision records (ADRs),
  e.g. [why flipbook over beats/ASP](docs/decisions/0001-flipbook-vs-beats.md).
- [`src/mcp/README.md`](src/mcp/README.md) — running and deploying the MCP server.

## Deployment

Hosted on **Cloudflare Workers** via the connected Git integration (Workers
Builds): `npm run build` produces `dist/`, and the Worker (`worker/index.ts`)
serves it as static assets while routing `/mcp` to the MCP server (a Durable
Object per session, bearer-authenticated). Config is in
[`wrangler.jsonc`](wrangler.jsonc).
