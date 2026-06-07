# Design Principles

The north star for Topology Dojo: **the product should be extremely intuitive,
and every feature should reduce — never add — cognitive load on the author.**

These principles are not decoration. Every PR is reviewed against them, and a
feature that violates one needs an explicit, written justification.

## 1. One concept, not three

The old model made authors juggle Acts, Steps, and Phases plus a parallel
layer-visibility timeline. The beat model collapses that to **one ordered list
of beats**. When tempted to add an organizing axis, first ask whether a beat
can already express it.

## 2. Author states, not motion

The author describes _what the diagram looks like_ at each beat. The engine
(`tween.diff()`) derives the motion — what enters, exits, moves, changes
emphasis. Authors never key-frame animations by hand. This is the single
biggest cognitive-load win and it is non-negotiable.

## 3. Deltas, with set-and-hold inheritance

A beat stores only what changed from the beat before it. An author editing
beat 4 sees the _resolved_ world (everything beats 1–3 established) and only has
to express the delta. Inheritance means you never re-state unchanged elements.

## 4. One source of truth: `resolve()`

There is exactly one function that turns the document into something renderable,
and both the editor and the presenter use it. No second viewer codebase, no
"export" that can drift from what you authored. What you edit is what you
present.

## 5. Fail loud at author time, never silent at present time

The worst failure of the old model was a beat silently rendering nothing. The
new model throws on a reference to an unknown element, and `validate()` surfaces
every problem in the editor _before_ you present. A broken scene should be
impossible to miss and impossible to present.

## 6. Direct manipulation over forms

Wherever an author would otherwise fill in a form or a coordinate, prefer direct
manipulation on the canvas. Dragging a node to a new position at beat N should
_write the override for you_. (This is the key open UX bet — see ROADMAP.)

## 7. Progressive disclosure

The default surface shows the few things you need now. Layers, advanced link
types, and renderer internals stay out of the way until asked for. Demoting
layers from a playback axis to an editor-only grouping convenience is an
instance of this.

## How to use this doc

When proposing a feature, state which principle(s) it serves and confirm it
violates none. If it must violate one (e.g. an advanced power-user feature that
adds a concept), say so explicitly and argue why the trade is worth it.
