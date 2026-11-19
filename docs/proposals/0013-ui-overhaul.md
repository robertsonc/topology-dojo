# Proposal 0013 — UI overhaul: placement first, then a flat skin

**Status:** Accepted (2026-11-19). P0 (foundations) is in progress on draft
PR #326: at `3765dc3` the stylesheet move, the token layer, the flat skin and
the icon sprite are in; the command registry is not yet. Nothing of P1–P4 is
on that branch at that commit. The section "What P0 changed from this text"
records where the implementation departed from the proposal as first written.

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

### P2 — Properties (large; fixes the panel)

- Selection, Page and Document tabs with the rules above.
- Regroup fields per the map; Link attachment promoted, with the inherited
  page value shown; colour popover; Data section.

_Done when:_ the default view of each state fits a 900 px window without
scrolling, asserted in a test; the anchor box and Distribute ends are visible
on selecting a node, with no clicks.

### P3 — Skin sweep (medium)

- Convert the remaining surfaces: Share, shortcuts, both wizards, agent
  workspace, preferences, admin, node designer, Problems.
- Light theme contrast pass (see
  [`futures/light-theme-contrast.md`](../futures/light-theme-contrast.md)).
- Motion and reduced-motion pass.

_Done when:_ no surface uses the old tokens; text meets 4.5 : 1 in both themes.

### P4 — Guardrails (small)

- Budget tests: a cap on top-bar controls, no text under 12 px, no nested
  scroll containers in the inspector.
- User guide and screenshots updated. A one-time "what moved" note in the app.

_Done when:_ the toolbar cannot grow past its budget without a failing test.

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
  the pages dock still float over the canvas until P1.

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
