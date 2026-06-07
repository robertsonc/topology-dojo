# Architecture

## Layers

```
core/        model.ts   — the document types (Topology, Beat, Scene) + resolved types
             resolve.ts — resolve(scene, beatIndex) → ResolvedScene; validate(scene)
             tween.ts   — diff(prev, next) → Transition; what changed between two beats

render-svg/  render.ts  — renderScene(ResolvedScene) → SVG string. Pure. No beat knowledge.

main.ts                 — app shell. Holds UI state, calls resolve() + renderScene().
                          Editor and presenter are two views over the same pipeline.
```

The dependency arrow points one way: `render-svg` depends on `core` types;
`core` depends on nothing. The core is DOM-free and unit-tested in isolation.

## The data model

- **`Topology`** — the beat-independent design: `nodes`, `links`, `zones`,
  `layers`, `viewBox`, `title`. This is the "base" diagram. Every element has a
  stable string `id`; identity must be stable across beats because tweening
  diffs on it.
- **`Beat`** — a named checkpoint holding `overrides: Record<id, ElementOverride>`
  plus an optional presenter `note`. An override only sets the fields that
  change (`visible`, `x`, `y`, `emphasis`, `flowActive`); `undefined` means
  _inherit_.
- **`Scene`** — `{ topology, beats[] }`. The whole document of record.

### Resolution

`resolve(scene, beatIndex)`:

- `beatIndex = -1` → base topology only (the editor's "no beat" view), everything
  visible at model positions, neutral emphasis.
- `beatIndex = n` → base with beats `0..n` applied in order, each layered on the
  previous resolved state (set-and-hold).

It returns a `ResolvedScene` where every element has a _concrete_
`ResolvedElement` (no `undefined`, no inheritance left to compute). That is what
the renderer consumes.

`resolve()` throws `ResolveError` if a beat references an element that does not
exist. `validate(scene)` runs `resolve` across all beats and collects every
problem without throwing — the editor shows these live.

### Tweening

`diff(prev, next)` compares two resolved scenes and returns per-element
`ElementTransition`s flagging `entering` / `exiting` / `moved` / `emphasisChanged`
/ `flowChanged` with from/to values. The presenter uses this to animate **only
what actually changed**. Authors never describe motion; it is derived here.

## Locked decisions

These came out of the prototype and are settled unless we have a strong reason
to revisit (see `reference/` MIGRATION notes):

1. **TypeScript + Vite**, `strict` + `noUncheckedIndexedAccess`. The two model
   bugs found while building the prototype were caught by the compiler.
2. **Beats replace Act/Step/Phase.** One ordered list of deltas.
3. **Layers are demoted** to an editor-only grouping convenience
   (`hiddenInEditor` / `locked`), not a playback axis. This removes the
   dual-timeline conflict.
4. **`resolve()` is the only seam.** No separate viewer codebase.

## Known constraints

- Custom/complex node renderers cross-fade rather than morph-tween between
  beats. Accepted.
- Links carry no position of their own; the renderer reads endpoints from the
  resolved node positions, so links tween for free when their nodes move.
