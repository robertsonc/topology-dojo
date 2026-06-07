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

## Phase 2 — Authoring UX (the key bet) ✅

Canvas-first authoring, replacing the prototype's side-panel chip table. Design
decisions made in review:

- **Canvas-first.** Click an element on the diagram to select it; contextual
  controls (visible / emphasis / flow) appear inline on it. The side panel
  demotes to a beat inspector + element list.
- **Drag = authoring.** Dragging a node writes an `x`/`y` override into the
  current beat automatically — direct manipulation, no coordinate forms
  ([DESIGN.md #6](DESIGN.md)).
- **Base = structure, no third mode.** On the **Base**, a drag moves the model's
  real position; on a **beat**, the same gesture writes an override. The
  existing Base/beat selector _is_ the mode.
- **Deltas visible on canvas.** Elements a beat authors get a badge; moved nodes
  show a ghost at their previous position + a motion line. The author sees what a
  beat does without reading a panel.

The pure write-side logic lives in `core/edits.ts` (unit-tested); the DOM glue
in `main.ts` + `app/svg-coords.ts`. Verified end-to-end in a headless browser
(selection, drag-writes-override, inline toggles, presenter walk).

Deferred (presentation-only scope): adding/removing nodes, drawing links,
renaming/retyping — structural editing comes in a later phase.

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
