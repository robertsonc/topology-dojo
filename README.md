# Topology Dojo

A studio for choreographing **network topology walkthroughs**. You draw a
topology once, then author a sequence of **beats** — each beat says only what
_changes_ — and present it as an animated story that tweens between states.

It replaces the old Acts → Steps → Phases model with a single ordered list of
beats. One concept instead of three. That is the core bet of this project:
**reduce what the author has to hold in their head.**

## Status

Early. The foundation here is a faithful, fully-tested port of the validated
[beat-model prototype](reference/topology-studio-prototype.zip). See
[`docs/ROADMAP.md`](docs/ROADMAP.md) for what's built and what's next.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # core model tests
npm run lint       # eslint + prettier
npm run build      # type-check + production build
```

## The two things to understand

1. **Beats are deltas.** A beat stores only the overrides that differ from the
   beat before it (set-and-hold inheritance). Authoring a beat = toggling what
   changed, not re-describing the whole scene.

2. **`resolve()` is the seam.** `resolve(scene, beatIndex)` turns the document
   into a concrete `ResolvedScene`. The editor and the presenter both render the
   output of `resolve()` — there is no separate viewer codebase, and no
   editor/viewer drift.

```
src/
  core/        model · resolve · tween   ← pure, typed, tested. No DOM.
  render-svg/  render                     ← ResolvedScene → SVG. Knows nothing of beats.
  main.ts                                 ← app shell: editor + presenter, both call resolve()
```

## Docs

- [`docs/DESIGN.md`](docs/DESIGN.md) — design principles (the "intuitive / low
  cognitive load" north star) and how they translate to concrete rules.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the model, the resolve seam,
  the locked decisions.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — phased build plan and open design bets.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Cloudflare Pages hosting via
  GitHub Actions, and the one-time secret setup.
