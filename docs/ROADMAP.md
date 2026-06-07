# Roadmap

Built methodically, one reviewable phase at a time. Each phase is a PR reviewed
against [`DESIGN.md`](DESIGN.md).

## Direction change — flipbook + vendored editor (current)

The choreography/beat model (below) is **set aside** in favour of a simpler
**flipbook** model: a document is an ordered list of **pages**, each a complete,
standalone topology frame (like transparency film). Duplicating a page is a deep,
independent copy; "animation" is flipping between pages. No deltas, no
`resolve()`, no tween — you edit frames directly.

We also **vendor the proven legacy Topology Studio renderers + theme** (the
`TopologyDesigner` engine, `public/vendor/`) and rebuild the editor on top in
TypeScript, reusing its visual quality while dropping the choreography
orchestrator and the global-state editor shell.

The beat-model code (`core/resolve`, `core/tween`, `core/edits`, `render-svg`)
stays in the repo, **dormant**, per the "keep it alongside" decision.

### New phase plan

- **Phase A — Vendor + Pages foundation ✅** _(this PR)_ — vendor the engine +
  theme behind a typed facade (`src/vendor/topology-ds.ts`); pages document model
  (`src/pages/model.ts`, independent frames); `renderPage()`; flipbook app shell
  (render / add / duplicate / flip).
- **Phase B — Editor core** — select (single / multi / marquee), drag-move,
  grid + snap, zoom/pan, undo/redo, delete, add-node palette.
- **Phase C — Smart guides** — alignment + spacing/distribution hints, align /
  distribute tools (port from the legacy editor).
- **Phase D — Links** — create, endpoint/port attachment, routing
  (straight / orthogonal / curved), waypoints, full link-type art + styling.
- **Phase E — Inspector & polish** — property panels, remaining node types,
  ambient/theme polish, keyboard shortcuts, context menus.
- **Phase F — Node Designer** — create/edit custom node types (ports the legacy
  `node-designer.html` + the engine's `registerNodeType` plugin API).

---

_The original beat-model plan (dormant) is preserved below for reference._

## Phase 1 — Foundation ✅

- Faithful, fully-tested port of the validated beat-model prototype core
  (`model` / `resolve` / `tween`) and the SVG renderer.
- Project toolchain: TypeScript strict, Vite, Vitest, ESLint, Prettier.
- CI on every push/PR (typecheck · test · lint · build).
- SessionStart hook so Claude Code web sessions can run tests/lint immediately.
- Design docs capturing the north star and locked decisions.
- A minimal runnable app shell (editor + presenter) ported from the prototype,
  to be redesigned in Phase 2. **This UI is intentionally provisional.**

## Phase 2 — Authoring UX (the key bet) 🔜

The prototype authors a beat via a side-panel table of toggle chips. That works
but it is not the intuitive surface we want. The bet
([DESIGN.md #6](DESIGN.md)):

> Dragging a node on the canvas writes an `x`/`y` override into the current beat
> automatically. Direct manipulation, no coordinate forms.

Open questions to settle in design review before building:

- Does drag-to-move replace the chip table, or sit alongside it?
- How do we make "this beat changed X" _visible_ on the canvas (so authors
  always know what a beat is doing without reading a side panel)?
- Selection model: click-to-select, then toggle visible/emphasis/flow inline?
- How does adding/removing nodes (topology editing) coexist with beat authoring
  (presentation editing) without the two modes becoming a hidden third concept?

## Phase 3 — Presenter polish

- Real Magic-Move tweening driven by `tween.diff()` (the prototype relies on CSS
  transitions; we want explicit, controllable transitions).
- Speaker view / notes, keyboard-driven walkthrough, fullscreen.

## Phase 4 — Persistence & import

- Save/load scenes (the document is plain JSON already).
- Best-effort importer from the old acts/steps/phases JSON → beats. Lossy by
  design; flatten + flag for manual cleanup.

## Later / candidate

- Node renderer plugin registry (keep the old `registerNodeType` API shape).
- Additional node and link renderers ported from the monolith as needed.
- Export to standalone HTML for sharing a presentation.

## Out of scope (deliberately cut)

- Standalone viewer codebase.
- Act/Step/Phase model.
- Parallel layer-visibility timeline.
