# Roadmap

Built methodically, one reviewable phase at a time. Each phase is a PR reviewed
against [`DESIGN.md`](DESIGN.md).

## Phase 1 — Foundation ✅ (this PR)

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
