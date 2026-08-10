# Design Principles

The north star for Topology Dojo: **the product should be extremely intuitive,
and every feature should reduce — never add — cognitive load**, for both of its
authors: the **human** at the canvas and the **agent** at the API.

These principles are not decoration. Every PR is reviewed against them, and a
feature that violates one needs an explicit, written justification.

## 1. The flipbook: one concept, not three

A document is an ordered list of **pages**, each a complete, standalone frame.
That's it — no Acts/Steps/Phases, no deltas, no inheritance, no resolve step.
Duplicating a page deep-copies it; editing a frame can never have a spooky effect
on another. When tempted to add an organizing axis, first ask whether a page can
already express it. (The earlier beat/delta model is retired to `src/core`.)

## 2. The document is the complete authoring contract — no UI-only persisted fields

Every persisted diagram field the GUI can express must live in the document
JSON, and everything in the document must be reachable from the headless API.
We do not build authoring vocabulary that only a human can drive. If something
is genuinely human-only, it must carry no document-authoring value for an agent
(for example pan/zoom, view theme, or owner approval authority) — and we say so
explicitly.

This is what makes the product equally usable by people and by agents, and it's
the precondition for "topology as a framework for all of SASE."

**Workspace-authority carve-out (temporary).** A few _workspace_ actions are
deliberately gated to the browser owner rather than exposed to agents: accepting
proposals, and — as of Packet R3 — restoring or forking a named checkpoint.
Agents can still _create_ and _list_ checkpoints (to snapshot before a risky
batch); they just can't unilaterally roll the canonical document back or spawn a
fork. This is a limit on _authority_ over shared state, not on document
_vocabulary_ (the document contract stays fully agent-reachable), so it does not
violate #2. Revisit if a trusted-automation tier ever needs unattended
restore/fork.

## 3. One catalog as the source of truth

The capability catalog (`api/catalog.ts`) is the single machine-readable schema
of every node, link, and annotation type and its fields. The palette, the
inspector, validation, and MCP discovery all derive from it — never from
hand-maintained parallel lists. A parity test fails the build if the catalog
doesn't cover the whole vocabulary, which mechanically enforces principle #2.

## 4. Author by direct manipulation; expose the same as data

A human drags a node and the model updates; bends a link by dragging a waypoint;
groups nodes into a zone from the current selection. Every one of those gestures
maps to a plain document edit an agent can make through the API. The canvas is a
view over the contract, not a separate authoring language.

## 5. Fail loud at author time, never silent at present time

`validate` reports dangling references, duplicate ids, unknown types, and
out-of-range enums; the layout analyzer reports overlaps, crowding, off-page
elements, and zone collisions. Problems surface up front — in the editor and on
the MCP `validate` call — rather than as a quietly broken render.

## 6. Ground truth for machine authors

Agents generate coordinates badly if left to guess. So we publish the rules
(`layoutGuidelines`), check against them (`analyzeLayout`, folded into
`validate`), and can apply them automatically (`tidy`). Prevention + detection +
correction, all from the same numbers — so "no overlapping nodes/labels/zones"
is something the system upholds, not something a human re-tunes by hand.

## 7. Reuse proven art; own the interaction

We vendor the legacy rendering engine for its visual quality and drive it as a
pure renderer behind a typed facade, but we rebuild the editor and authoring API
ourselves in TypeScript. Borrow what's good and battle-tested; control the parts
where intuitiveness and the contract live.

## 8. Progressive disclosure

The default surface shows the few things you need now. The annotation layer, the
Node Designer, custom link styling, and renderer internals stay out of the way
until asked for. Calm-canvas and Tidy are one click when you want them, invisible
when you don't.

## How to use this doc

When proposing a feature, state which principle(s) it serves and confirm it
violates none. If it must violate one, say so explicitly and argue why the trade
is worth it — especially principle #2, which is the load-bearing one.
