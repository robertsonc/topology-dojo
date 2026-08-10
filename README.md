# Topology Dojo

A studio for designing **network topology diagrams** — built so the persisted
diagram vocabulary is equally authorable by **people** (a direct-manipulation
canvas editor) and by **agents** (a headless API exposed over MCP). Both use the
same document contract and renderer; browser-only view preferences and
owner-only governance actions remain intentionally human-facing.

The long-term aim: one consistent topology framework for everything SASE, where
every diagram has the same look and feel whether a human drew it or an LLM
generated it.

New here? Start with the **[User Guide](docs/USER_GUIDE.md)**. Release testers
should use the living [QA plan](docs/launch-readiness/QA_TEST_PLAN.md),
[UAT plan](docs/launch-readiness/UAT_PLAN.md), and
[traceability matrix](docs/launch-readiness/TRACEABILITY_MATRIX.md).

## The model in one minute

- A **document** is an ordered list of **pages** — each page a complete,
  standalone topology frame (like a sheet of transparency film). Duplicating a
  page deep-copies it; "animation" is flipping between pages. No deltas, no
  choreography engine — you edit frames directly. (This "flipbook" model
  replaced an earlier beat/delta model, whose core still lives in `src/core`,
  dormant.)
- A page holds **nodes**, **links**, **anchors**, and an annotation layer of
  **zones**, **flow paths**, and **policy markers**.
- The document JSON is the **authoring contract**: every persisted diagram field
  exposed by the GUI is reachable from the headless API. Transient view state
  (pan/zoom, theme, panel layout) and browser-owner actions are outside that
  parity invariant.
- A handed-off document is a **revisioned shared workspace**. Browser gestures
  become compact semantic operations; agents read bounded deltas and propose
  change sets by default, so collaboration does not require repeatedly placing
  the whole document in model context.

## Quick start

```bash
npm ci
npm run dev         # app at http://localhost:5173
npm test            # unit tests (Vitest)
npm run lint        # eslint + prettier
npm run typecheck   # typecheck app + Cloudflare Worker
npm run build       # app typecheck + production bundle
npm run test:e2e    # Chromium browser release gate (Linux visual baselines)
npm run mcp         # run the MCP server over stdio
```

## Three ways in

1. **The editor** — a canvas editor over the vendored rendering engine: select /
   marquee / drag, space-drag pan, smart alignment + spacing guides, grid + snap,
   links with on-canvas waypoint editing, anchors (free-floating link endpoints)
   via the anchor tool, select-by (type / color / connected / invert), find /
   jump-to-element (Ctrl+F), a minimap overview, a right-click context menu,
   align / distribute, light / dark + calm-canvas toggles, a catalog-driven
   palette (with live node-art previews) + inspector (incl. document/page
   properties), a filmstrip of pages, a
   live status bar, a Node Designer for custom node types, reusable stencils,
   per-page undo, recoverable frame deletion, and one-click **Tidy** / **Balance**
   layout. The hosted editor also includes an **Agent Workspace** for handoff,
   geometry-aware proposal review, selective acceptance, checkpoints, presence,
   offline recovery, conflicts, and a revocable ten-minute current-page lease;
   confirmed authoring preferences and a metadata-only owner dashboard are
   feature-gated companion surfaces.
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
  workspace/   semantic operations · conflict targets · browser API client
  core/        the retired beat-model (dormant; kept for reference)
worker/        Cloudflare Worker: app + /mcp + per-document coordinators
public/vendor/ the vendored engine + theme (classic script in the browser, CommonJS in Node)
```

## Docs

- [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) — task-based guidance for human
  authors, public-link recipients, workspace owners, MCP operators, and admins.
- [`docs/launch-readiness/QA_TEST_PLAN.md`](docs/launch-readiness/QA_TEST_PLAN.md),
  [`UAT_PLAN.md`](docs/launch-readiness/UAT_PLAN.md), and
  [`TRACEABILITY_MATRIX.md`](docs/launch-readiness/TRACEABILITY_MATRIX.md) —
  living release-quality plans and feature-to-evidence coverage.
- [`docs/DESIGN.md`](docs/DESIGN.md) — the north star and the principles every PR
  is reviewed against.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the model, the render seam, the
  API surface, the MCP/Worker shape, and the locked decisions.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — what's built and what's next.
- [`docs/decisions/`](docs/decisions/) — architecture decision records (ADRs),
  e.g. [why flipbook over beats/ASP](docs/decisions/0001-flipbook-vs-beats.md).
- [`docs/proposals/0002-shared-human-agent-workspace.md`](docs/proposals/0002-shared-human-agent-workspace.md)
  — revision, operation, proposal, lease, conflict, and migration contract.
- [`docs/proposals/0003-adaptive-agent-authoring-profiles.md`](docs/proposals/0003-adaptive-agent-authoring-profiles.md)
  — bounded, explainable learning from repeated user corrections without
  self-modifying or context-bloating MCP tools.
- [`docs/AGENTIC_IMPLEMENTATION_WORKFLOW.md`](docs/AGENTIC_IMPLEMENTATION_WORKFLOW.md)
  — bounded task packets, implementation/review roles, context discipline, and
  human-controlled merge/release gates for agent-built features.
- [`docs/proposals/0004-isolated-staging-and-deployment-pipeline.md`](docs/proposals/0004-isolated-staging-and-deployment-pipeline.md)
  — implementation plan for isolated staging, gated deployments, Durable Object
  migrations, and smoke evidence.
- [`docs/DEPLOYMENT_RUNBOOK.md`](docs/DEPLOYMENT_RUNBOOK.md) and
  [`docs/ROLLBACK.md`](docs/ROLLBACK.md) — operator procedures for routine and
  migration-bearing releases, error 10211, rollback, and forward recovery.
- [`src/mcp/README.md`](src/mcp/README.md) — running and deploying the MCP server.

## Deployment

Hosted on **Cloudflare Workers**: `npm run build` produces `dist/`, and the
Worker (`worker/index.ts`) serves it as static assets while routing `/mcp` to
the MCP server. Transport sessions and canonical per-document coordinators are
separate Durable Objects behind OAuth 2.1 / GitHub sign-in. Config is in
[`wrangler.jsonc`](wrangler.jsonc).

Production and isolated staging deploy through CI-gated GitHub Actions; the
production workflow is restricted to `main` and requires protected-environment
approval. A Worker containing a new Durable Object migration must use a full
environment-scoped `wrangler deploy`; `wrangler versions upload` fails with
Cloudflare error 10211 and is not an approved preview path. See the
[deployment plan](docs/proposals/0004-isolated-staging-and-deployment-pipeline.md)
and [runbook](docs/DEPLOYMENT_RUNBOOK.md).
