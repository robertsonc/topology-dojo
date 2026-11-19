# Proposal 0013 — UI overhaul: placement first, then a flat skin

**Status:** Accepted (2026-11-19). P0 (foundations), P1 (shell) and P2
(properties panel) are merged. P3 (skin sweep) and P4 (guardrails) are built
for PR #328 (not merged) on the integration branch `wip/int2`, not yet pushed: the pull request's own head is still `01c21db`, and are not in `main`. Two pull requests merged into
`main` on 2026-11-19. PR #326 merged as `e9d0d7f` (its Release run completed
with success the same day): the stylesheet move, the token layer, the flat
skin, the docked chrome, the neutral scrollbars and the icon sprite. PR #327,
"UI overhaul: command registry, shell, properties panel (proposal 0013: rest
of P0, P1, P2, part of P3)", merged as `d224979`: the command registry
(`src/ui/commands.ts`), the top bar with its menus, the left rail, the docked
library, the pages bar, the zoom control, the selection bar's align,
distribute, order and lock buttons, the command palette on Ctrl/Cmd+K, the
context menu on the shared menu component, the properties panel's three tabs
and regrouped sections, and the shared controls on the wizards, the
workspace, preferences and admin panels and the node designer. The Release
run for `d224979` (run 44554032473) failed in CI's browser job, so its
`stage` and `production` jobs were skipped: that run deployed nothing.

PR #328 (not merged) adds the compact layout (below 1,024 px the node library
and the properties panel are drawers over the canvas,
`src/ui/compact-layout.ts`), brings the browser tests back inside CI's
30-second limit (`menuCommand` in `e2e/helpers.ts` goes straight to a menu
item, and CI records a trace only when it retries a failed test), finishes the
rest of P3 (no `.tbtn` is left, `toolbar.css` is deleted, `NOT_YET` in
`src/styles/styles.test.ts` is gone so no stylesheet sets text under 12 px,
accent text uses `--accent-fg`, a dark scope for present mode, duration
tokens for motion) and the guardrails of P4 (budget tests for the top bar, the
rail and the pages bar, a text-size walk of the shell's surfaces in both
themes at two window sizes, a no-sideways-scroll test from 360 to 1,920 px,
and the one-time "what moved" note), and brings the documentation up to date.
What is not done: Find and quick-add were not folded into the command palette,
and the light-theme contrast of each surface was measured while the surfaces
were converted but no test asserts it (the tokens' contrast is asserted). The
section "What P0 changed from this text" and the section "What P1 to P4
changed from this text" record where the implementation departed from the
proposal as first written; each phase's "Status" line says what is done, with
the files and tests. Checked 2026-11-19 against the code at `d224979` and, for
what PR #328 adds, against its branch.

**Captured:** 2026-11-18

**Decisions this proposal records** (Corey Robertson, 2026-11-19):

1. **Surface style: flat.** Three elevation levels, no backdrop blur. The
   "panel blur (glass)" display setting goes away.
2. **Label typeface: sans for labels and menus, mono for data.** JetBrains
   Mono stays for IDs, addresses, coordinates, counts and everything drawn on
   the canvas.
3. **Shell: a menu bar plus a left tool rail.** Not a single app menu with a
   floating tool pill.

**Addresses:** three operator complaints (2026-11-18): the scrollbars look
chunky and dated, the top toolbar has outgrown the window, and the properties
panel is too dense, with the link anchor box and Distribute ends buried.

## Thesis

The three complaints have one cause: **the chrome has no hierarchy.** Every
control sits on one row, every property sits in one scroll, and the scrollbars
are what that overflow looks like. A reskin alone does not fix that. This
proposal moves each control to the place that matches its scope first, and
applies the new look on top.

Nothing here changes the document schema, the canvas rendering, node art,
exports or the MCP tools. Tab state, panel widths and open sections are view
state in local storage, so principle 2 of [`DESIGN.md`](../DESIGN.md) (no
UI-only persisted document fields) holds and agent authoring is untouched.

## What the audit measured

Headless Chromium against `main` at `f9b2bc6`, sample scene, signed out. Panel
figures are from a 1,440 × 900 window. Signed in adds four more toolbar chips.

| Finding                                 | Measured                                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Toolbar width needed                    | 2,113 px for its 39 controls. It fits only in windows wider than about 2,150 px.                                 |
| Toolbar after labels hide (under 1,480) | Still 1,846 px at a 1,440 px window and 1,738 px at 1,280 px. The export dropdown alone is 341 px.               |
| Align and Distribute group              | Renders at x = 1,854 on a 1,440 px screen: entirely off-screen, behind a horizontal scroll.                      |
| Properties panel, one link selected     | 78 rows, 162 controls, 1,363 px of content in a 657 px panel.                                                    |
| Properties panel, one node / nothing    | 61 rows (1,164 px) / 48 rows (1,275 px).                                                                         |
| Label text contrast                     | `#7d8a92` on `#22252e` is 4.32 : 1, at 10–11 px. AA needs 4.5 : 1.                                               |
| Accent on white (light theme)           | `#01a982` on `#ffffff` is 3.0 : 1.                                                                               |
| Stylesheet                              | 3,560 lines inline in `index.html`; 8 font sizes (9–14 px), 13 radii, 13 z-index values, a second override skin. |
| Icons                                   | Unicode glyphs and emoji, rendered by whatever fonts the OS has.                                                 |
| `color-scheme`, `theme-color`           | Not set. Native steppers and dropdown lists render light on the dark theme.                                      |

### Root causes

1. **Scrollbars.** The slim hover-reveal style is written only for
   `::-webkit-scrollbar`. Firefox-family browsers take the fallback:
   `scrollbar-width: thin` with a green thumb that is always painted. Two of
   the bars should not exist at all: the toolbar's (it overflows) and the
   emphasis list's (a scroller nested in a scroller).
2. **Top toolbar.** 39 controls at one level. Nine view toggles hold the
   centre. Selection actions (delete, align, order) sit in a global bar far
   from the selection. Four native `<select>`s act as menus, and "template…"
   is filed with the export controls. Fit view exists three times.
3. **Properties panel.** Sections follow the implementation, not the task.
   The anchor box and Distribute ends sit under _Playback_ for a page and under
   _Advanced_ for a node. Page and document settings appear only when nothing
   is selected, and the annotations list is appended to every selection. Each
   colour row expands a nine-swatch grid, and swatches scale with panel width.

## Placement rules

1. **The top bar is the document.** Name, save state, history, output,
   people. Nothing up there depends on what is selected.
2. **Left is for making.** Tools and the node library sit together, next to
   where a drag starts. The hand tool joins the other tools.
3. **Right is the thing you clicked.** Selection, Page and Document are tabs,
   so page settings are one click away without deselecting first.
4. **Bottom is time and view.** Pages run along the bottom with grid, snap
   and calm at their right. Zoom floats in the canvas corner with the minimap
   above it.
5. **Selection actions travel.** Align, order, lock and colour appear on the
   floating bar next to the selection and at the top of its tab.
6. **Every command has one home.** One command registry feeds the menus,
   Ctrl+K, the context menu and the shortcut sheet. A new feature gets a menu
   entry by default, not a new toolbar button.

## Target layout

```text
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ◇ File Edit View Arrange Help │ Title … ✓ Saved   ↶ ↷ │ Tidy▾ │ Present Export▾ Share │ Agent · ◉ │
├───┬───────────┬──────────────────────────────────────────────┬───────────────────────┤
│ ▸ │ Library   │                                              │ Selection│Page│Document│
│ ✥ │ search    │                                              ├───────────────────────┤
│ ╱ │           │                 canvas                       │ header: name, type    │
│ ◇ │ tiles     │                                              │ Text                  │
│ ─ │           │          [ floating selection bar ]          │ Style                 │
│ ▦ │           │                                              │ Link attachment       │
│   │           │                              ┌ minimap ┐     │ Wiring ▸              │
│   │           │                              └─────────┘     │ … options ▸           │
│ ⌕ │           │                              [− 66% + ⤢]     │ Position and order ▸  │
│ ? │           ├──────────────────────────────────────────────┤ Data ▸                │
│   │           │ ▶ 1 2 3 [4] 5 +            grid snap calm │ map │                       │
├───┴───────────┴──────────────────────────────────────────────┴───────────────────────┤
│ ⚠ 1 problem   1 selected   x 462, y 340                    16 nodes · 25 links · Page 4 of 5 │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

Below 1,100 px the five menus fold into one. On phones the rail becomes a
bottom strip.

## Where every toolbar control goes

All 39 controls keep their keyboard shortcuts.

| Control today                                                           | New home                                                          | Why                                                                                |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Stays in the top bar**                                                |                                                                   |                                                                                    |
| Logo                                                                    | Top left                                                          | Identity.                                                                          |
| undo, redo                                                              | Top bar, as icons; also Edit                                      | History is document scope, and the buttons show whether there is anything to undo. |
| share                                                                   | Top bar, the one filled button                                    | Primary output action.                                                             |
| present ▶                                                               | Top bar, labelled "Present"                                       | Primary output action. An unlabelled ▶ sat among view toggles.                     |
| svg, png, export… (11 formats)                                          | One Export menu: image, document, editable, selection             | Three controls for one job. The result message stays beside the button.            |
| agent chip                                                              | Top bar, right                                                    | Collaboration state belongs with the document. Gains a pending-proposal count.     |
| account chip                                                            | Avatar, top right                                                 | Convention.                                                                        |
| save status                                                             | Beside the document title                                         | Reads as "this document is saved".                                                 |
| **Top bar, condensed**                                                  |                                                                   |                                                                                    |
| tidy, balance, arrange…                                                 | One Tidy button with a menu; also Arrange                         | Tidy stays one click (principle 8). Balance and the algorithms are its variants.   |
| **Moves to menus**                                                      |                                                                   |                                                                                    |
| new, open, download                                                     | File                                                              | Used once or twice per session.                                                    |
| template…                                                               | File › New from template…                                         | It creates a document. It was filed with the export controls.                      |
| delete                                                                  | Edit, selection bar, context menu                                 | Operators press Del.                                                               |
| select… (type, colour, connected, invert, all)                          | Edit › Select, and Ctrl+K                                         | Occasional. Reads better as named commands.                                        |
| theme                                                                   | View › Theme, and the account menu                                | Set once.                                                                          |
| display settings                                                        | View › Display…                                                   | Set once.                                                                          |
| problem badges                                                          | View, and the Problems panel header                               | The toggle belongs beside the thing it controls.                                   |
| prefs                                                                   | Account menu › Authoring preferences, linked from the agent panel | About how agents author for you.                                                   |
| admin                                                                   | Account menu › Admin                                              | Owner only, rare.                                                                  |
| help                                                                    | Bottom of the left rail, and Help                                 | A fixed corner for help.                                                           |
| **Moves next to the canvas**                                            |                                                                   |                                                                                    |
| select, link, anchor tools                                              | Left rail                                                         | Beside the library, where making starts.                                           |
| hand tool (bottom right)                                                | Left rail, with the other tools                                   | One place for modes.                                                               |
| grid, snap, calm                                                        | Right end of the pages bar; also View                             | Beside the canvas they affect.                                                     |
| fit view (toolbar)                                                      | Removed. Fit stays in the zoom control.                           | It existed three times.                                                            |
| minimap (inside the library card)                                       | Toggle in the pages bar; opens above the zoom control             | It no longer shortens the library list.                                            |
| "nodes ◂", "hide ▸" panel toggles                                       | Library button in the rail; Properties in View                    | Same shortcuts.                                                                    |
| **Moves to the selection**                                              |                                                                   |                                                                                    |
| align × 6, distribute × 2                                               | Selection bar, top of the Selection tab, Arrange                  | Today they render off-screen.                                                      |
| order, lock, format painter                                             | Selection bar and the header of the Selection tab                 | They were at the very bottom of the inspector.                                     |
| **Moves within the properties panel**                                   |                                                                   |                                                                                    |
| Document › Title                                                        | Top bar, and the Document tab                                     | Where every editor puts it.                                                        |
| Playback › Crossings, Port labels, anchor box, padding, Distribute ends | Page tab › Links, open by default                                 | None of them are playback.                                                         |
| Node › Advanced › Link anchor box                                       | Selection tab › Link attachment, open by default                  | Shows the inherited page value and an explicit override.                           |
| Frame › Caption, Emphasis                                               | Page tab › Story                                                  | Emphasis becomes a count with a picker, not a nested list.                         |
| Legend, Sheet, Layers                                                   | Document tab                                                      | Document scope, reachable while something is selected.                             |
| Annotations list                                                        | Page tab                                                          | No longer appended to every selection.                                             |
| Advanced › URL, tooltip, layer, source; Metadata                        | Selection tab › Data                                              | "Advanced" said nothing about what was inside.                                     |
| "pages" and "frames"                                                    | "Page" everywhere                                                 | The strip says pages, its buttons say frame, the panel has both.                   |

## Properties panel

Sections are renamed for the task and ordered by how often an operator
touches them.

**Node selected** (today 61 rows): header (name, type, lock, more) · Text ·
Style · **Link attachment** (inherited page value, override, padding,
distribute; open by default) · Wiring · _type_ options · Position and order ·
Data.

**Nothing selected** (today 48 rows in one scroll): _Page tab_ — Page ·
**Links** (anchor box, padding, distribute, crossings, port labels; open by
default) · Story · Playback · Annotations. _Document tab_ — Document · Legend ·
Sheet · Layers.

**Link selected** (today 78 rows): header (endpoints, type, swap) · Label ·
Style · Routing · Wiring · Animation · Data.

Tab rules: selecting something activates the Selection tab; clearing the
selection returns to the tab last chosen; a tab picked by hand sticks while
the selection is unchanged; Problems entries open the tab and field they refer
to, so a tab never hides the cause of a warning.

Density: text goes from 10–11 px to 12 px with 14 px section titles in
sentence case; rows are 28 px; default width goes from 240 to 300 px; swatches
are a fixed 20 px; colour is one chip that opens the palette; fields are
filled, not outlined. Field grouping stays in one table beside the capability
catalog, so the inspector remains catalog-driven (principle 3).

## Look and feel

The chrome already uses a palette of dark neutral greys with a green accent,
but in the wrong roles: label text is one step too dark for its surface. The
proposal assigns explicit roles and names them neutrally. The product stays
vendor-neutral (proposal 0009, decision 1): no vendor fonts, logos or token
names ship.

| Role       | Before                                                                   | After                                                                                                    |
| ---------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Surfaces   | Glass: 26 px blur, 20 px radius cards, an override layer of `!important` | Three flat levels: back `#1d1f27`, front `#292d3a`, floating `#22252e` with a shadow.                    |
| Label text | `#7d8a92`, 4.32 : 1 on panels                                            | `#b1b9be`, 8.26 : 1 on back, 6.89 on front.                                                              |
| Accent     | `#01a982` on hovers, borders, scrollbars, focus rings                    | Kept for the primary action and selected state only. Dark stays `#01a982`; light is `#03785b` (5.1 : 1). |
| Borders    | `#3e4550` around every field and section                                 | White at 12% for dividers. Fields are filled at white 6%, bordered only on hover and focus.              |
| Type       | 8 sizes, all mono, lowercase buttons and ALL CAPS headers                | 12 and 14 px. Sentence case. Sans labels, mono data.                                                     |
| Icons      | Unicode glyphs and emoji                                                 | One SVG set, 16 px in a 28 px target, `currentColor`, shipped as a sprite.                               |
| Shape      | 13 radius values, 13 z-index values up to 1000                           | Radius 4 / 6 / 8 / 12 / full. Z-index values come from one named scale.                                  |
| Motion     | Hover lifts on most controls; one reduced-motion rule                    | 150 ms colour and opacity only. Everything honours `prefers-reduced-motion`.                             |

Canvas colours (`--canvas-bg`, the engine's `--accent`, problem-severity
colours shared with on-canvas badges) keep their values, so the canvas and
exports do not change.

### Scrollbars

The thumb is a neutral tint, invisible at rest, shown while the pointer is
over the scroll container or keyboard focus is inside it. Chromium and Safari
keep the `::-webkit-scrollbar` pill (an 8 px hit area with a 4 px visible
thumb). Firefox has no such pseudo-elements, so it gets `scrollbar-width:
thin` with `scrollbar-color` switching from transparent to the tint on
`:hover` and `:focus-within`. `color-scheme` is set per theme so native
steppers, dropdown lists and any unstyled scrollbar follow dark or light. The
toolbar and the status bar stop being scroll containers, and the emphasis
picker leaves the inspector's scroll (P1/P2).

## Phases

Each phase is shippable on its own. New components are built once, in the new
skin; existing surfaces convert as each phase touches them.

### P0 — Foundations (medium; fixes scrollbars)

- Move the inline CSS out of `index.html` into `src/styles/`.
- Semantic tokens for both themes, `color-scheme`, `theme-color`, a z-index
  scale. Fold the glass override layer into flat base rules.
- Scrollbar rewrite, fixed-size swatches, SVG icon sprite on the existing
  buttons.
- Command registry (`src/ui/commands.ts`): id, title, group, shortcut, icon,
  enabled, checked, run. The key handler, context menu and shortcut sheet read
  from it.

_Done when:_ the end-to-end suite passes; no hex colour appears outside the
tokens file; every shortcut is unique, checked by a unit test.

_Status (2026-11-19): done._ PR #326 (`e9d0d7f`) moved the stylesheet into
`src/styles/`, added the tokens, the scrollbars and the icon sprite; PR #327
(`d224979`) added the command registry. No colour outside the tokens file is
checked by `src/styles/styles.test.ts` ("names every colour in tokens.css and
nowhere else"); unique shortcuts by `src/ui/commands.test.ts` ("never put two
commands on one key"). The end-to-end suite was not run for this note.

### P1 — Shell (large; fixes the top bar)

- Menu component with full keyboard support, reused for Export, Tidy, account
  and the context menu.
- Top bar: title and save state, undo and redo, Tidy, Present, Export, Share,
  agent chip, account.
- Left rail with tools and the docked library. Pages bar with the canvas
  toggles, floating zoom and minimap. Slim status bar.
- Selection bar gains align, distribute, order and lock. Command palette on
  Ctrl+K absorbs Find and Quick-add.

_Done when:_ the top bar has no horizontal overflow at 1,024 px and up,
asserted in a test; every former toolbar control is reachable from a menu and
from Ctrl+K.

_Status (2026-11-19): merged in PR #327, apart from what the next two
paragraphs name._ Built: `src/ui/menu.ts` (the menu component) and
`src/ui/menus.ts` (File, Edit, View, Arrange, Help, the folded menu, Export,
Tidy, the account menu and the context menu, as data); the top bar, the left
rail, the docked library, the pages bar, the zoom control and the status bar
(`src/styles/shell.css`, the shell template in `src/main.ts`); the selection
bar's align, distribute, order and lock buttons and its placement
(`src/ui/selection-bar-place.ts`); the command palette
(`src/ui/command-palette.ts`, `src/ui/palette-sources.ts`), opened by
Ctrl/Cmd+K. Not built as the text says: Ctrl+K does not absorb Find or
quick-add, which remain (see "What P1 to P4 changed from this text").
_Done when_, checked: the top bar's width is asserted at 1,024, 1,280, 1,440
and 1,920 px signed in, and at 700, 1,101 and 1,160 px with a long login
(`e2e/shell-menus.spec.ts`, "the top bar never scrolls sideways at ${width}px,
signed in" and "... with a long login"); every former toolbar control is in a
menu (`src/ui/former-toolbar.ts` is the list, used by `src/ui/menus.test.ts`,
"has every command it ran in at least one menu", and by `e2e/shell-menus.spec.ts`,
"every command the old toolbar ran is in a menu"); the palette lists every
command that can run now (`src/ui/palette-sources.test.ts`, "every command that
can run now, by title, group and shortcut"). That the palette finds a command
by its old label (the Risks table) is not asserted by a test and was not
checked.

PR #328 (not merged) changes the narrow layout: below 1,024 px the node
library and the properties panel are drawers over the canvas
(`src/ui/compact-layout.ts`, `e2e/shell-layout.spec.ts`).

### P2 — Properties (large; fixes the panel)

- Selection, Page and Document tabs with the rules above.
- Regroup fields per the map; Link attachment promoted, with the inherited
  page value shown; colour popover; Data section.

_Done when:_ the default view of each state fits a 900 px window without
scrolling, asserted in a test; the anchor box and Distribute ends are visible
on selecting a node, with no clicks.

_Status (2026-11-19): merged in PR #327; one "Done when" is met in part._
Built: `src/ui/inspector-tabs.ts` and `src/ui/inspector/tabs.ts` (the tabs and
their rules), `src/ui/inspector/field-groups.ts` (the sections of a node and of
a link), `src/ui/inspector/sections.ts` (each section remembers whether it is
open), `src/ui/inspector/selection-header.ts` (the header with its lock and
"more" menu), `src/ui/inspector/color-control.ts` (the colour button and its
popover), `src/ui/inspector/page-tab.ts` and `document-tab.ts`,
`src/ui/inspector/link-attachment.ts`, `src/styles/inspector.css`. Fit is
asserted at 1,440 x 900 for the Page tab, the Document tab, one node, one node
with type options, one link and two nodes (`e2e/shell-inspector-layout.spec.ts`,
"nothing selected: the Page tab fits without scrolling" and the five tests
after it). The anchor box and Distribute ends are not visible with no clicks:
a node shows what the page gives it as a line of text and the override switch,
and the override's two fields only once the switch is on (see "What P1 to P4
changed from this text"). That no text in the panel is under 12 px is asserted by "no text in the
panel is under 12px" in the same spec.

### P3 — Skin sweep (medium)

- Convert the remaining surfaces: Share, shortcuts, both wizards, agent
  workspace, preferences, admin, node designer, Problems.
- Light theme contrast pass (see
  [`futures/light-theme-contrast.md`](../futures/light-theme-contrast.md)).
- Motion and reduced-motion pass.

_Done when:_ no surface uses the old tokens; text meets 4.5 : 1 in both themes.

_Status (2026-11-19): built for PR #328 (not merged) on the integration
branch `wip/int2`, not yet pushed: the pull request's own head is still `01c21db`; in `main`, P3 is
partly done as PR #327 left it._ In `main` (PR #327), the top bar, rail, pages bar,
status bar, menus, command palette, properties panel, the shared-copy banner,
both wizards, the workspace, preferences and admin panels and the node
designer were on the shared controls (`src/styles/controls.css`); the Share
dialog, the presentation controls, the shortcut sheet's close button and the
path bar used `.tbtn`, seven `font-size` rules under 12 px were left
(`NOT_YET` in `src/styles/styles.test.ts`), and several surfaces set
`color: var(--accent)` as a text colour. The integration branch for PR #328
changes this: `grep -rn tbtn
src e2e` finds nothing and `src/styles/toolbar.css` is deleted (the shared-copy
banner and the sign-in prompt moved into `shell.css`); the library's tiles, the
canvas overlays (Find, the path bar, quick-add, the rename editor, the drag
ghost, the selection bar), Display settings, the Share dialog, the shortcut
sheet, the Problems dock and the annotation editors are on the shared controls;
`NOT_YET` is gone and `styles.test.ts` asserts that no stylesheet sets text
under 12 px ("sets no text under 12px"); accent as text or an icon is
`--accent-fg` and `--accent-fg` is no longer on the "reserved, unused" list.
Present mode has a dark scope (`.dark-scope` in `src/styles/tokens.css`) so its
bar reads in the light theme. A document's brand accent no longer has to be
readable by luck: `readableAccentText` (`src/ui/contrast.ts`) mixes it toward
the theme's foreground until it reaches 4.5 : 1 on every surface of the chrome and on every tint laid over one (a hovered or pressed control, `--accent-soft`, `--accent-soft-strong`) and
`setChromeAccent` sets `--accent-fg` from it (`src/ui/contrast.test.ts`). The
motion pass: every `transition` and `animation` takes a duration token
(`--dur-fast`, `--dur`, `--dur-slow`, `--dur-flash`), asserted by "times every
transition and animation with the duration tokens"; under reduced motion the
slider thumb's halo no longer animates. Contrast of the tokens in both
themes is asserted (`src/styles/styles.test.ts`, "dark: text, outlines and
the focus ring read on every surface" and the light twin). Contrast of each
surface was measured in the browser in both themes while it was converted;
no test asserts it, and the "Done when" line ("text meets 4.5 : 1 in both
themes") is therefore met by measurement, not by a test. SVG animation drawn
by `src/render-svg` and by the editor's pulses is outside the stylesheets and
not covered by the motion test. The light-theme page linked above is about
the rendered output (PR #289), not the chrome: it does not cover this pass.

### P4 — Guardrails (small)

- Budget tests: a cap on top-bar controls, no text under 12 px, no nested
  scroll containers in the inspector.
- User guide and screenshots updated. A one-time "what moved" note in the app.

_Done when:_ the toolbar cannot grow past its budget without a failing test.

_Status (2026-11-19): built for PR #328 (not merged) on the integration
branch `wip/int2`, not yet pushed; in `main`, mostly not done._ In `main` there is the 12 px ratchet, the panel's layout spec
(`e2e/shell-inspector-layout.spec.ts`), the top bar's width test and the list
of former toolbar controls. The branch adds:

- the control budgets (`e2e/shell-budget.spec.ts`, "the top bar, the rail and
  the pages bar hold no more controls than their budgets", and
  `src/ui/shell-budget.test.ts` without a browser): 15 controls in the top
  bar signed in with every chip showing, 7 in the rail, 5 at the right end of
  the pages bar. Each says in a comment that raising it is a design decision;
- the text-size walk in the same spec: every visible text node outside SVG
  drawings is 12 px or more at boot, with a node or a link selected, in each
  menu, the palette, Display settings, the shortcut sheet, the note, Share,
  both wizards, the node designer, the workspace, preferences and admin panels
  and present mode, at 1,440 x 900 and 390 x 844, in both themes (16 tests);
- the sideways-scroll test, every 40 px from 360 to 1,920, signed out and
  under a 30-character login: the document, and the top bar, the status bar,
  the pages bar and the stage each within its box, and every visible control
  outside the canvas inside the window;
- no scroll container inside the properties panel, now for every state the
  panel draws (`e2e/shell-inspector-layout.spec.ts`);
- the one-time "what moved" note (`src/ui/shell-note.ts`,
  `src/ui/shell-note.test.ts`, `e2e/shell-note.spec.ts`) and the command
  `help.whatMoved` ("What moved") in the Help menu and the palette;
- the user guide, the QA plan and the README image, brought up to date.

_Done when_ ("the toolbar cannot grow past its budget without a failing
test") is met. Checked on 2026-11-19 by trying it: an extra button in the top
bar's markup fails `src/ui/shell-budget.test.ts`, and a rule setting text at
11 px fails "sets no text under 12px" in `src/styles/styles.test.ts`; both
changes were undone. The browser versions were tried the same way on
2026-11-19, against the browser suite with CI's settings: an extra button
beside Present fails "the top bar, the rail and the pages bar hold no more
controls than their budgets" in `e2e/shell-budget.spec.ts` (at most 15,
found 16), and `.hint` set at 11 px fails 12 of its 16 "no text under 12px"
walks (the four "menus, each open, and present mode" walks show no hint and
pass); both changes were undone.

## Risks

| Risk               | Detail                                                                                                | Mitigation                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Test churn         | 69 end-to-end references to toolbar ids; 24 call `selectOption` on the four native selects.           | Ids stay on the relocated controls. One helper runs a command by id. Selects convert last. |
| Rewrite creep      | `src/main.ts` is 6,340 lines and builds the whole shell from one template string.                     | Each phase extracts only the code it touches. No big-bang rewrite.                         |
| Muscle memory      | Buttons move.                                                                                         | Shortcuts do not change. Menus show them. Ctrl+K finds a command by its old label.         |
| Hidden state       | Tabs can hide the setting that causes a warning.                                                      | Problems entries deep-link to tab and field.                                               |
| Menu accessibility | Custom menus need arrow keys, typeahead, Escape and focus return, which native selects gave for free. | One menu component, tested once, built on the existing overlay helper.                     |
| Narrow and touch   | The 640 px breakpoints from issue 221 were tuned for the current layout.                              | Re-verified in P1.                                                                         |
| Visual baselines   | The three canvas baselines include the library and pages dock, and their size follows the chrome's.   | Regenerated and looked at in each phase that changes them.                                 |

## What P0 changed from this text

- **Accent on dark stays `#01a982`.** The proposal first named `#05cc93`. The
  canvas draws selection handles and quick-connect arrows in the literal
  `#01a982` (`ACCENT` in `src/editor/editor.ts`), and the canvas is out of
  scope, so a brighter chrome accent would sit beside a darker canvas one.
  `#01a982` is 5.5 : 1 on the back surface and 5.1 : 1 on floating surfaces.
  The light theme uses `#03785b`, because `#01a982` is 3 : 1 on white.
- **Accent tints follow the brand palette.** The 20 `rgba(1, 169, 130, …)`
  literals became `color-mix` on `--accent`, so a document's brand palette
  now recolours selected and focused chrome as well. Before, those tints
  stayed green under any palette.
- **No vendor font in the stack.** The first draft put a vendor typeface ahead
  of the bundled one for machines that have it installed. Proposal 0009
  decision 1 keeps the product vendor-neutral, and screenshots and visual
  baselines should not depend on what a machine has installed. `--font-ui` is
  Inter with system fallbacks; surfaces adopt it as P1–P3 rebuild them.
- **Z-index: one named scale, same values.** "Five layers" would have changed
  which surface wins where two overlap. P0 names the existing values in
  stacking order (`--z-canvas-ui` … `--z-menu`) and changes none of them.
- **The canvas container is flush.** The vendored engine styles the canvas
  container as a glass card (24 px backdrop blur, rounded border, deep
  shadow). The blur was invisible behind the opaque canvas fill but paid for
  on every frame; the three are switched off. The drawing is unchanged.
- **Docking came with the fold.** The glass layer was also what floated the
  toolbar, the properties panel and the status bar on 12 px margins. Without
  it they sit docked, as the base rules always had them. The node library and
  the pages dock still floated over the canvas until P1 (PR #327, `f70720c`)
  docked them.
- **The command registry splits the table from the handlers (PR #327, merged
  as `d224979`).** The proposal listed "id, title, group, shortcut, icon,
  enabled, checked, run" as one record. In `src/ui/commands.ts` the table
  (`COMMAND_SPECS`) is pure data: id, title, group, icon and the key bindings;
  `enabled`, `checked` and `run` are bound once in `src/main.ts` through
  `createCommandRegistry`, because they need the editor. "Every shortcut is
  unique" holds in this form, checked by `src/ui/commands.test.ts`: no two
  commands share a key, modifiers and context; two bindings may fit one press
  only where one names a physical key (`code`), and then a fixed order decides
  (the browser's layout decides what such a key types). The change claims no
  new behaviour: the table is checked against a transcription of the key
  handler it replaced, and `e2e/command-keys.spec.ts` and
  `e2e/command-surfaces.spec.ts` pin the keys, the context menus, the tooltips
  and the sheet. Two inspector tooltips were wrong and are corrected: "Send to
  back ([Ctrl+[)" is now "Send to back (Ctrl/Cmd+[)", and "Bring to front
  (Ctrl+])" is now "Bring to front (Ctrl/Cmd+])".

## What P1 to P4 changed from this text

Read against the tree at `d224979` ("Target layout", "Where every toolbar
control goes" and "Properties panel"), with the running app for what a
control looks like and where it is; the lines about P3 and P4 and the ones
marked PR #328 (not merged) were read against that branch. Each line is a place where the
implementation differs from the text above; a reason is given where a commit
message gives one, and "no reason recorded" where none does. Where the text
and the tree agree, nothing is listed. Short hashes name the commit.

**The shell**

- **On a phone the rail stays a left column.** The text says it "becomes a
  bottom strip". At 390 px the rail is the same 44 px column (checked in the
  app; no rule in `src/styles/shell.css` moves it). No reason recorded.
- **A tool strip came and went.** Not in the text. The commit that built the
  top bar (`a0a6c42`) added a strip of tools and view toggles under it
  (`#toolStrip`, `.tool-strip`); the commit that built the rail, the docked
  library and the pages bar (`f70720c`) removed it, and the tools went to the
  rail and the toggles to the pages bar and the View menu. It was never in
  `main`: PR #327 merged after both commits, with no strip in the tree.
- **The menus fold at 1,100 px and below, in steps.** The text says "below
  1,100 px". The bar gives way in this order: the wordmark at 1,360 px and
  below; the words on Tidy and Present at 1,279 px and below, so the
  document title keeps 120 px; the five menus into one **Menu** button at
  1,100 px and below; the words on Export and Share at 1,023 px and below;
  the layout menu
  beside Tidy and the chips' words at 760 px and below; Present and the logo
  at 640 px and below (`src/styles/shell.css`). Reason (`a0a6c42`, `59c30b0`): the bar never scrolls
  sideways, and a long login had pushed the account chip off the bar between
  1,101 and 1,161 px.
- **The top bar's controls differ from the sketch in four ways.** Tidy is a
  button with a separate menu button beside it (`#tTidy`, `#tTidyMenu`). The
  account control is a chip with a person icon, the login and a caret, not an
  avatar. Share is hidden until the deployment offers sharing. The save state
  appears beside the title after an edit, not before. No reason recorded.
- **The agent chip's pending-proposal count is not new.** The text says the
  chip "gains" it; the label `agent · N proposals` was already in
  `computeWorkspaceChipState` (`src/ui/workspace-panel.ts`) before P1.
- **The status bar has no page count.** The sketch shows "Page 4 of 5" and
  "1 problem" at its left. The bar keeps the spans it had (tool, cursor,
  counts, selected, history, zoom; `f70720c` says "the same spans and text"),
  with the problems indicator, an icon at rest, after the zoom (first in a
  window 700 px wide or less); the page count is in the pages bar's toggle
  ("Pages 1/1"). The Problems list stays where it was, at the foot of the
  right-hand column.
- **Properties and Display settings keep a button as well as a menu entry.**
  The text puts "Properties in View" and Display settings under View. Both
  entries are there (View ▸ Properties, View ▸ Display…), and so are a
  **hide** button at the end of the tab row (a **props** button in the
  canvas's top-right corner while the panel is hidden) and a gear button at
  the right of the pages bar. Reason for the corner button (`2bdb496`): with
  the panel closed its column stayed and left a notch.
- **Problem badges are in View only.** The text also puts the toggle in the
  Problems panel's header; the header has none (`src/main.ts`, the Problems
  dock).
- **Authoring preferences are not linked from the agent panel.** The text says
  "linked from the agent panel". Only the account menu opens them
  (`account.preferences`); `src/ui/workspace-panel.ts` has no link.
- **Ctrl/Cmd+K does not absorb Find or quick-add.** The text says it
  "absorbs" them. **Edit ▸ Find…** (Ctrl/Cmd+F) and quick-add (a double-click
  on empty canvas) are unchanged; the palette also offers "Go to <label>" and
  "Add <node type>" entries that do the same jobs (`4068b49`). Ctrl/Cmd+K is
  the one key that changed meaning: before, the browser had it, and
  `src/ui/commands.test.ts` lists it as an intended change (`INTENDED_CHANGES`).
- **A format painter is not on the selection bar.** The text puts "order, lock,
  format painter" on the bar and in the header. The bar has Bring to front,
  Send to back and Lock (and the align and distribute buttons for two or more
  nodes); Copy format and Paste format are in the header's "more" menu, in
  Edit, in the context menu and on Ctrl/Cmd+Alt+C and +V (`1268f59`,
  `be6cdc3`).
- **Delete is not on the selection bar.** The text puts delete in Edit, the
  selection bar and the context menu. It is in Edit, the context menu and the
  header's **More actions** menu (and on Del); the bar has no Delete button
  (`MINI_BAR_ORDER` in `src/main.ts`). No reason recorded.
- **Edit ▸ Tools exists.** Not in the text. Select, Hand, Draw link and Drop
  anchor had toolbar controls before the shell was rebuilt, but no menu
  offered them (`796a763`).
- **The selection bar is placed from what is drawn.** The text only says
  "floating". It sits above the selection's box, below it when there is no
  room above, and on it only when the selection fills the canvas from top to
  bottom; it wraps onto a second row in a narrow canvas
  (`src/ui/selection-bar-place.ts`; reason in `f9c873e`: it had sat on the
  route of a link and taken the presses meant for its handles). In PR #328
  (not merged) it also keeps clear of the four quick-connect arrows around a
  selected node (`Editor.quickConnectBox()`), which it had covered.
- **The minimap starts closed.** The text does not say. With nothing stored it
  is closed, so the canvas keeps its room (`f70720c`, "as in the approved
  mock").
- **"Page" is everywhere a person reads it, from PR #328 (not merged).** The
  text says "'Page' everywhere". In `main` (PR #327) the menus, the pages bar,
  the command titles and the shortcut sheet's command rows said page, and
  these still said frame: the Find box, the presentation bar's buttons and the
  shortcut sheet's Presentation rows, the path bar's "new frame" button and
  its tooltips, the path analysis messages, the Page tab's Caption
  placeholder, empty-list line and Story hint (which named the context-menu
  item "Emphasize on this frame", an item titled "Emphasize on this page"),
  the Analyze path tooltip and the confirmation when deleting a page that has
  content. PR #328 changes each of them to page. What still says frame is not
  read by a person as a label: a new page is named "Frame N" (a page's name is
  document data), and command ids (`path.newFrame`, `view.toggleFrames`), CSS
  classes, a stored key (`tds-frames-collapsed`) and code comments keep the
  old word.
- **Below 1,024 px the panels are drawers (PR #328, not merged).** The text
  leaves the narrow layouts to be "re-verified in P1". In PR #327 only a phone
  (640 px and below) had a library drawer; PR #328 moves the breakpoint to
  1,023 px for both panels (`src/ui/compact-layout.ts`). Also in PR #328: on
  a phone, and wherever the two open drawers would leave under 160 px of
  canvas, opening one drawer closes the other (`drawersCrowd` in the same
  file); the closed drawer's remembered setting is not changed.
- **Find and the path bar sit over the canvas (PR #328, not merged).** Not in
  the text. They were fixed at a distance from the top of the window, and the
  path bar could run under the library and the properties panel; they are now
  centred over the canvas, a little below its top edge, never wider than it,
  and follow it as the panels open and close (`overCanvas` in
  `src/main.ts`).
- **The properties toggle says whether the panel is open (PR #328, not
  merged).** `#inspector-toggle` has `aria-controls` and `aria-expanded`, as
  the library's toggle does.

**The properties panel**

- **Rows are on a 4 px gap.** The text says rows are 28 px; the stylesheet
  also fixes the gap between rows at 4 px, a 32 px pitch
  (`src/styles/inspector.css`).
- **Section titles are 13 px, not 14 px.** The text says "14 px section
  titles". `src/styles/inspector.css` sets them at 13 px, weight 600
  (`06dd40b`). No reason recorded. Rows are 28 px, labels 12 px, the default
  width 300 px (stored width 240 to 480 px) and swatches a fixed 20 px, as
  the text says.
- **A field is marked by a line under it at rest.** The text says fields are
  "bordered only on hover and focus". `.field` draws its bottom edge in
  `--line-strong` at rest (`src/styles/controls.css`). Reason (`2345e95`): a
  field's fill is 1.1 to 1.2 : 1 against the panel, and nothing marked it as a
  field when it was not hovered.
- **Link attachment shows the page's value as a line, and the node's fields
  only under the override switch.** The text says it holds the inherited
  value, the override, padding and distribute, and that the anchor box and
  Distribute ends are visible on selecting a node with no clicks. The section
  is open by default and opens with a line such as "From page: off. Links meet
  the icon edge."; **Override for this node** is a switch, and **Box padding**
  and **Distribute ends** appear only while it is on (in PR #328, not merged,
  the two share one row, so the state fits a 1,440 x 900 window). On the Page
  tab,
  **Box padding** and **Distribute ends** appear only while **Anchor box** is
  on. So the "Done when" line for P2 is met for the fit test and not for the
  two fields.
- **Label offsets are under "Fine tune", closed at first.** The text lists
  one Text section for a node. In it **Label**, **Sublabel** and the
  **Placement** compass come first; the label offsets and **Label width** are
  in a nested section titled **Fine tune** that starts closed, and **Label
  color** follows it (`NODE_GROUPS` in `src/ui/inspector/field-groups.ts`).
- **A header's contents depend on what is selected.** The text gives one
  header, "name, type, lock, more". A node's or link's header has the lock and
  **More actions**; an anchor's or a zone's has **More actions** and no lock;
  with several nodes selected the header names them by their labels over the
  line "Selection (2 nodes)".
- **A link's ends and Swap are a row under the header.** The text puts the
  endpoints, type and swap in the header. The header has the icon, the title
  ("EC-Hub → App"), the kind with the type picker, the lock and the "more"
  menu; the two end pickers with Swap between them follow it as their own row.
- **Problems entries open the tab, and the field only from PR #328.** The
  text says they "open the tab and field they refer to". In `main` (PR #327)
  a jump selected the element and showed the Selection tab even when the Page
  or Document tab had been picked by hand (`966b231`); it did not open the
  section or focus the field, and nothing called the tabs' `reveal`. PR #328
  (not merged) does: a problem about a field opens the section that holds it
  and focuses it (`problemField` in `src/ui/problems-dock.ts`), and a problem
  about a page or the document shows the Page or Document tab
  (`InspectorTabs.reveal`).
- **Annotations start closed, and several selections have sections of their
  own.** Not in the text. The Annotations list on the Page tab starts closed
  (`4fac2ea`). Two or more nodes get **Arrange**, **Annotate** and **Format**
  and no shared fields, so QA-2026-11-14-UI-04 stays open. A zone picked on the canvas has the header and its rows on the panel's grid, with no card (`5ba843f`). A single node's tab ends with an annotate row (zone, policy marker) after
  Data, which the text's node list does not have (`5ba843f`). Placement rule
  5 puts colour "at the top of its tab"; colour is in the Style section, and
  the header holds the lock and, in **More actions**, the order commands.
- **The emphasis picker opens in place.** The text says "a count with a
  picker". It reads "N of M" with **Choose…** and **Clear**; the list opens
  below with a filter field and no scroll area of its own, and stays open while
  it has focus, or for the rest of the visit once something is ticked
  (`be6cdc3`).

**The look, P3 and P4 (PR #328, not merged)**

- **Motion tokens are 120 and 180 ms, with two longer ones.** The text says
  "150 ms colour and opacity only". `--dur-fast` is 120 ms and `--dur` 180 ms;
  `--dur-slow` (500 ms, a page fading in, a highlight's pulse) and
  `--dur-flash` (600 ms, one beat of an attention flash) keep the two long
  motions the app already had. Nothing says why 120 and 180 were chosen: no
  reason recorded.
- **Accent as text is its own token, computed for a brand colour.** The text
  says the accent is "kept for the primary action and selected state only".
  Accent-coloured text and icons use `--accent-fg`, a lighter mix of the
  accent; for a document's own brand colour the editor works the mix out so it
  reaches 4.5 : 1 on every surface and on the tints over them
  (`readableAccentText`, `accentTextGrounds`).
- **Present mode has a dark scope.** Not in the text. The presentation's bar
  sits on a stage that is dark in both themes, so its root takes the dark
  foreground, line and fill tokens (`.dark-scope`) and reads in the light
  theme.
- **`--on-status` is gone.** The token had no user once the Problems count
  became a badge (`.badge-warn`, `.badge-error`).
- **Display settings keeps two selects.** The convention for a choice of two
  to four is `.seg`. **Ambient backdrop** and **Wheel** are `select.field`:
  specs drive them with `selectOption` and the code writes their value, and
  the rule that a control keeps its id and what it writes won. There is no
  on/off setting in the popover, so no `.switch`.
- **The note is shown only to a browser that has used the editor.** The text
  says "a one-time 'what moved' note" and no more. It shows when some
  `topology-dojo:` or `tds-` key is in storage and the note has not been
  dismissed; a first-time visitor never sees it, and a visit that opens a
  shared link does not show it.
- **The 16 text-size tests mock the server.** The walk is run with a mocked
  `/api/me` for an admin and empty lists, so it does not need a deployment;
  nothing in it looks at an SVG drawing, which scales with zoom.

What the text and the tree agree on, checked: the five menus and their
contents by name; the three tabs, the Selection tab named for what is
selected, and the tab rules (`src/ui/inspector-tabs.ts`); the sections of a
node, a link, the Page tab and the Document tab (`NODE_GROUPS`,
`LINK_GROUPS`, `src/ui/inspector/page-tab.ts`, `document-tab.ts`); and the
place each toolbar control went, apart from the departures above
(`src/ui/former-toolbar.ts` lists the old controls).

## Non-goals

Canvas rendering, node art, exports, the document schema, MCP tools, and an
outline panel that would merge the emphasis, annotation and layer lists.

## Guideline cross-check

Vercel's Web Interface Guidelines served as the audit checklist. Already
right: one visible `:focus-visible` ring on every control; `aria-label` on
icon-only buttons; live regions for save and export status; no
`transition: all`; tabular numerals on number fields; canvas deletes go on
the undo stack. Gaps this proposal closes: no `color-scheme` or `theme-color`;
content wider than the viewport; Unicode and emoji as icons; label contrast
under 4.5 : 1; eight font sizes and thirteen z-index values; clipped labels;
hover transforms that ignore reduced motion.
