# 1. Flipbook over beats / acts-steps-phases

- **Status:** Accepted
- **Date:** 2026-06-07
- **Supersedes:** the beat/delta model (dormant in `src/core`); the engine's
  native Acts/Steps/Phases choreography (used as a renderer only).

## Context

Topology Dojo has tried three document models for representing a topology that
may change across a sequence of states:

- **Acts / Steps / Phases (ASP)** — the vendored `TopologyDesigner` engine's
  native model: a nested timeline (Acts ⊃ Steps ⊃ Phases) plus a parallel
  layer-visibility track. Purpose-built for fine-grained animated orchestration.
- **Beats** — one flat list of deltas; each beat stores only what changed from
  the one before (set-and-hold inheritance). `resolve(base, 0..n)` collapses to a
  concrete frame; `tween.diff()` derives motion between consecutive resolved
  frames. _Author states; the engine derives motion._
- **Flipbook (current)** — one list of fully independent frames (deep copies, no
  inheritance). "Animation" is flipping between frames. _Author each frame as it
  should look; nothing is derived._

The lineage was ASP → beats (to kill cognitive load) → flipbook (to drop the
delta/resolve/tween machinery once the product's center of gravity became
**static topology diagrams**, and the top priority became **API/agent
authoring** via MCP, under the principle that _the document is the complete
contract — no UI-only surfaces_).

This ADR records why we stay on flipbook long-term, and the conditions under
which we'd extend or revisit it.

## Decision

**Keep flipbook as the document model.** Do not return to beats as the model, and
do not adopt ASP. Treat the two known flipbook weaknesses (animation, DRY) as
_additive, derived layers_ to be built only when a concrete requirement forces
them — not as reasons to change the core model.

## Rationale

Scored against the project's actual priorities:

| Axis (weighted to our goals)                 | ASP | Beats             | Flipbook             |
| -------------------------------------------- | --- | ----------------- | -------------------- |
| Agent/API authorability (priority #1)        | ✗   | ~ medium          | ✓✓ best              |
| Human cognitive load (per frame)             | ✗   | ~ deltas+inherit. | ✓ "just draw it"     |
| "Document = complete contract" (DESIGN #2)   | ✗   | ✗ derived state   | ✓✓ JSON is the truth |
| Determinism / testability / DO-shardability  | ~   | ~ frame N ← 0..n  | ✓✓ pages independent |
| Implementation surface to maintain           | n/a | ✗ resolve+tween   | ✓ ~trivial           |
| Animated walkthroughs                        | ✓✓  | ✓ Magic-Move      | ✗ hard cuts          |
| DRY across many similar frames               | ✓   | ✓✓ base+deltas    | ✗ N copies, drift    |
| Payload size (big topologies, token budgets) | ~   | ✓ deltas small    | ✗ full frame each    |

The top four axes are our stated north stars (API-first, agent-authored,
contract-as-document, operationally simple), and flipbook wins all of them
decisively. Beats and ASP introduce _derived_ state (resolve/tween) that an agent
can't read directly off a frame and that creates non-local edits (changing an
early beat silently changes later ones) — friction precisely where we want least.

## Consequences

Positive:

- An agent emits a self-contained frame; `render_svg` / `validate` / `tidy` are
  well-defined on one page with no global context.
- Independent frames give trivial determinism, caching, and per-session Durable
  Object isolation, and a near-zero model-maintenance surface.
- "What you edit is what you get" — maximal alignment with the contract
  principle.

Negative (accepted, with mitigations below):

- **Not DRY.** "One topology, many near-identical variants/frames" duplicates
  structure; editing the shared base is O(frames) and drift-prone.
- **Weak animation.** Hard cuts; no element-level morph between frames.
- **Larger documents.** N full copies cost more storage/bandwidth/tokens than
  base+deltas.

## Mitigations (build only when needed — do not pre-build)

- **Animation → a render-time concern, not a model concern.** A "tween-on-flip"
  presenter can diff _consecutive pages by id_ and Magic-Move between them.
  Authoring stays pure flipbook. The dormant `tween.diff()` in `src/core` is
  essentially this algorithm and is kept for that latent option value.
- **DRY → opt-in page inheritance.** A page may _optionally_ reference a
  `basePageId` + overrides (beats, but as an explicit power-user feature, never
  the default). Adding it later is non-breaking; baking deltas in now would
  re-import the complexity we deliberately shed.
- **Payload → a delta wire-format / page references** as a transport
  optimization, leaving the model unchanged.

## Invariant to preserve

Keep **element-id stability across duplicated and edited pages** (today
`duplicatePage` is a `structuredClone`, so ids carry over). This is the hinge
that keeps both escape hatches cheap: tween-on-flip needs stable ids to match
elements across frames, and opt-in inheritance needs them to attach overrides.

## Revisit triggers

Reopen this decision (in that order of preference — extend before replacing) if:

1. **Animated walkthroughs become first-class** → build tween-on-flip (view
   layer) _before_ touching the model.
2. **Many-variants authoring becomes common** and base-edit pain is measured →
   add opt-in page inheritance; flipbook stays the default.
3. **Large-topology agent workflows exceed token/payload budgets** → add a delta
   wire-format / page references.

Only if all three pressures land at once _and_ the additive layers prove
insufficient should a return to a delta-native model be reconsidered. ASP is not
on the table regardless: it loses on the two axes we weight highest.
