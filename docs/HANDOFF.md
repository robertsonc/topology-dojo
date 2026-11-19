# Handoff

_The primary entry point for picking up work on this repo. Rewritten
2026-07-19; revalidated 2026-08-09 (`4add174`) and again 2026-11-13 against
`main` at `e99b012` (see
[`ROADMAP.md`](ROADMAP.md), [`CAPABILITY_MATRIX.md`](CAPABILITY_MATRIX.md),
[`DISCREPANCY_REGISTER.md`](DISCREPANCY_REGISTER.md)). Earlier handoff notes
and the pre-reset implementation plan are preserved under
[`archive/`](archive/) — do not treat anything there as current status; each
carries a banner pointing back here._

_PRs #311–#319 merged on 2026-11-14, after that revalidation (`main` at
`916fb14`). Only the passages dated 2026-11-14 or 2026-11-15 below were
updated for them; the rest of this file was not re-checked. An independent
audit is planned before any change to the core layers: start from
[`sitrep/2026-11-15-pre-audit-handoff.md`](sitrep/2026-11-15-pre-audit-handoff.md),
which records the state at hand-over, what was and was not verified, and the
problems known to be open._

_2026-11-16 (scheduled docs audit, `main` at `60e5812`): PRs #320–#324 merged
after that note. #322 added the MCP consent page and `/connections`; #323 and
#324 scoped custom node types to one document and closed the custom node spec
injection (see "Known risks"). Only this passage and the dated paragraph under
"Known risks" were updated; the baseline, counts, initiative table and key
files below were not re-checked._

_2026-11-19 (the branch of draft PR #326 at `3765dc3`, based on `main` at
`f9b2bc6`; not merged): [proposal 0013](proposals/0013-ui-overhaul.md), the
UI overhaul of the editor chrome, was accepted this date. The first part of
its phase P0 is on that branch at that commit: the editor stylesheet moved
out of `index.html` into `src/styles/` with a token layer; the chrome is
flat, with the toolbar, the properties panel and the status bar docked (the
node library and the pages dock still float over the canvas); panel
scrollbars are neutral and appear on hover or keyboard focus; the chrome's
icons are one SVG set instead of symbol characters (Lucide, a third-party
set; `src/ui/icons.generated.ts` reproduces its ISC and MIT license text);
and the "Panel blur (glass)" display setting is gone. The command registry
P0 also lists is not on the branch at that commit, and neither is anything
of P1–P4. Only this passage, the paragraph dated 2026-11-19 under "Active
implementation program", the `docs/proposals/0005`–`0013` entry under
"Documentation map and history" and three new "Key files" rows were written;
nothing else in this file was re-checked._

_2026-11-19 (later the same day; `main` at `e9d0d7f`): PR #326 merged, so the
note above, which describes the branch at `3765dc3` as not merged, is
superseded. The merge commit is `e9d0d7f` (parents `f9b2bc6` and `8881941`).
Merged (the Release run for `e9d0d7f` was still in progress when this was
written, so production may not have it yet): the stylesheet in `src/styles/`, the token layer and flat skin, the
docked toolbar, properties panel and status bar, hover-reveal neutral
scrollbars, `color-scheme` and `theme-color` following the theme, one SVG icon
set, ink chosen for contrast on the brand accent, and no "Panel blur (glass)"
setting. On `main` but used by no surface yet: the shared control classes
(`src/styles/controls.css`), the self-hosted Inter typeface (imported in
`src/main.ts`, applied only by `controls.css` and the two components below),
the menu component (`src/ui/menu.ts`), the command palette
(`src/ui/command-palette.ts`) and the properties-panel tab rules
(`src/ui/inspector-tabs.ts`); a user sees none of them. Not on `main`: the
command registry (`src/ui/commands.ts`), which is the rest of P0 and is in
progress, and no change to a surface from P1–P4. Only this passage,
"Recently completed", the paragraph dated 2026-11-19 under "Active
implementation program", the `docs/proposals/0005`–`0013` entry and one new
"Key files" row (chrome building blocks) were written; nothing else in this file was
re-checked._

_2026-11-19 (still later the same day): the Release run for `e9d0d7f` (GitHub
Actions run 44491161125, workflow "Release": CI, then the staging and
production Worker deploys) completed with success at 09:12 UTC, so the caveat
in the note above, that the run was still in progress and production may not
have the merge yet, is out of date: the run finished and its production deploy
job succeeded. Only this note and the "Recently completed" entry for PR #326
were changed for it._

_2026-11-19 (the branch of draft PR #327 at `1ebbccb`, on top of `main` at
`e9d0d7f`; not merged): PR #327, "Command registry: one table for keys,
context menu and shortcut sheet", is the rest of proposal 0013's P0. On that
branch `src/ui/commands.ts` holds the command table (id, title, group, icon and
the key bindings of every command) and `matchKey`, which decides which command
a key press means, and `createCommandRegistry` (run, enabled, checked, shortcut
text, the shortcut sheet's rows) and `HELP_GESTURES`; it is pure, with no DOM.
`src/main.ts` creates one registry and binds every command once, and the window
key handler, the toolbar and canvas controls, the context menu and the shortcut
sheet read it. `src/ui/canvas-keys.ts` is removed; `src/ui/canvas-keys.test.ts`
remains and tests `matchKey`. The shortcut sheet (`?`, or the toolbar's
shortcuts button) lists one row per command under File, Edit, Selection,
Arrange, Tools, View, Frames and Help, then the mouse and touch gestures, the
keys of dialogs and menus, of the presentation, and of Find and the node
library; each shortcut is its own key cap. Two inspector tooltips were
corrected to "Send to back (Ctrl/Cmd+[)" and "Bring to front (Ctrl/Cmd+])". No
key and no command is meant to behave differently: `src/ui/commands.test.ts`,
`e2e/command-keys.spec.ts` and `e2e/command-surfaces.spec.ts` pin that. Not
started as a change to any surface: P1 (shell), P2 (properties panel), P3 (skin
sweep) and P4 (guardrails). Until #327 merges, `main` has none of this. Only
this note, the "Not done" line of the PR #326 entry under "Recently completed",
the paragraph dated 2026-11-19 under "Active implementation program", the
`docs/proposals/0005`–`0013` entry, a "Key files" row and the "Chrome building
blocks" row (from which a sentence saying the registry is not on `main` was
removed) were written for it; nothing else in this file was re-checked. The
statement in the `e9d0d7f` note above that the registry "is in progress" is
superseded: it is draft PR #327._

_2026-11-19 (later still the same day; `main` at `d224979`, and the branch of
PR #328, not merged, at `d24f6a4`): PR #327, "UI overhaul: command registry,
shell, properties panel (proposal 0013: rest of P0, P1, P2, part of P3)",
merged into `main` as `d224979`. The Release run for that merge (run 44554032473) failed in CI's browser job (three tests in that run: two past the
30-second limit and the pages bar's layout at 720 x 450), so its `stage` and
`production` jobs were skipped and it deployed nothing. PR #328 fixes both
causes: the compact layout, and the browser tests' time (the menu helper goes
straight to an item; CI records a trace only when it retries a failed test,
`playwright.config.ts`); CI passed on its commit `ee278eb`. That supersedes the note above, dated for the
branch of draft PR #327 at `1ebbccb`: #327 is not a draft and is merged, `main`
has the registry, and P1 and P2 have changed surfaces. It also supersedes the
sentence in the `e9d0d7f` note that the menu component, the command palette,
the shared control classes and the tab rules are used by no surface: PR #327
uses them. On `main` now: the command registry; the top bar (File, Edit, View,
Arrange and Help, folded into one **Menu** button at 1,100 px and below; the
document title with the save state beside it; Undo and Redo; Tidy; Present;
Export; and, where the deployment offers them, Share and the workspace and
account chips), built from `src/ui/menus.ts` on the menu component
(`src/ui/menu.ts`); the left rail (the four tools, the library toggle, the
command palette and the shortcut sheet); the node library docked at 208 px;
the canvas over a pages bar, with the zoom control and the minimap card (closed
until opened) in the canvas's corner; a 24 px status bar; the selection bar with
align, distribute, order and lock; the context menu on the menu component; the
command palette on Ctrl/Cmd+K (`src/ui/command-palette.ts`,
`src/ui/palette-sources.ts`); the properties panel as three tabs (Selection,
Page, Document) with sections that each remember whether they are open
(`src/ui/inspector/`, `src/ui/inspector-tabs.ts`), a selection header with a
lock toggle and a "more" menu, a colour button that opens a popover, and a
Link attachment section; the panel is 300 px wide at first (240 to 480 px); the
shared controls on both wizards, the workspace, preferences and admin panels
and the node designer. In the app's own words a page is a "page", not a
"frame", in the menus, the pages bar, the command titles and the shortcut
sheet's command rows; the sheet's Presentation rows still say "Previous frame"
and "Next frame". Not done: the
Share dialog, the presentation controls, the shortcut sheet's close button and
the path bar still use the old `.tbtn` buttons; seven font-size rules under
12 px remain; no test caps the top bar's controls and there is no "what moved"
note; Find and quick-add were not folded into the palette; "frame" is still in
the Find box, the presentation controls and the shortcut sheet's Presentation
rows, the path bar and the path analysis messages, the Page tab's Story hint
(which names the context-menu item "Emphasize on this frame"; the item is
"Emphasize on this page"), its Caption placeholder and its empty-list line,
the Analyze path tooltip, and the delete-page confirmation. PR #328 (not merged) adds the compact layout (below 1,024 px the
library and the properties panel are drawers over the canvas;
`src/ui/compact-layout.ts`) and brings the user guide, the README image and
these documents up to date. Only this note, the "Recently completed" entries
for PRs #326 and #327, the paragraph dated 2026-11-19 under "Active
implementation program", the `docs/proposals/0005`-`0013` entry and the "Key
files" rows for the editor chrome were written for it; nothing else in this
file was re-checked._

_2026-11-19 (the end of the day; `main` at `d224979`, and the integration
branch `wip/int2` at `61e4d7e` for the code): the rest of proposal 0013's P3
and the guardrails of P4 are built on `wip/int2` for PR #328 (not merged), and
are not yet pushed: the pull request's own head is still `01c21db`. So the statements above that
say what is "not done" (the `.tbtn` buttons, the seven font-size rules, the
missing top-bar budget, the missing "what moved" note, "frame" in the shell's
labels) describe `main` and are out of date for the branch. None of this is in
`main`, and nothing of PR #328 is released. On the branch: no `.tbtn` is left
and `src/styles/toolbar.css` is deleted; `NOT_YET` is gone, so no stylesheet
sets text under 12 px; accent text uses `--accent-fg`, which the editor works
out from a document's brand accent so it reads (`readableAccentText` in
`src/ui/contrast.ts`); present mode has a dark scope, so its bar reads in the
light theme; motion takes the duration tokens; the shell says "page" where a
person reads it; a Problems jump opens the section of the field at fault, or
shows the Page or Document tab; opening a drawer closes the other on a phone
and where under 160 px of canvas would be left; the budgets
(`e2e/shell-budget.spec.ts`, `src/ui/shell-budget.test.ts`) count the top
bar's, the rail's and the pages bar's controls, walk the shell's text for
anything under 12 px, and check from 360 to 1,920 px that neither the
document nor the top bar, the status bar, the pages bar or the stage is wider
than its box and that no control outside the canvas runs past the window (the
body clips what overflows, so the document's width alone could not show a
bar that runs off); and the one-time "what moved" note (`src/ui/shell-note.ts`) is
shown to a browser that used the editor before, with **Help → What moved** to
show it again. Only this note, the "Recently completed" entry for PR #328, the
paragraph dated 2026-11-19 under "Active implementation program", and the "Key
files" rows for the editor chrome were written for it; nothing else in this
file was re-checked._

## What Topology Dojo is

A production-hosted, collaborative, AI-agent-assisted network-topology
authoring platform. A human authors multi-page flipbook diagrams in a
browser editor; an AI agent authors the same documents through an MCP server
(local stdio or remote Cloudflare, OAuth-gated) using the identical
catalog-driven API; the two collaborate in a shared workspace with
proposals, leases, checkpoints, and a revision timeline. An observe-only
learner adapts agent behavior to a human's confirmed authoring preferences
over time. See `ROADMAP.md` §"Current production baseline" for the full
picture with evidence citations.

## Current repository baseline

As of this review (`main` @ `e99b012`, PR #300 merged 2026-11-08):

- **All three migration-backed feature flags are live**: `WORKSPACE_ENABLED`,
  `PROFILES_ENABLED`, `ANALYTICS_ENABLED` are all `"true"` in the top-level
  (production) `wrangler.jsonc` and in `env.staging`. No Durable Object class
  is bootstrapped-but-inert right now.
- **Two non-migration flags are deliberately off in production**:
  `API_KEYS_ENABLED` (proposal 0005 — `"true"` on staging, `"false"` in
  production until UAT-MCP-04 passes) and `LIVE_DATA_ENABLED` (the seven
  EdgeConnect fabric tools — `"false"` in both environments; opt-in,
  independent of `ORCH_*` secret presence, issue #228). Neither has a
  binding or migration.
- **Migrations `v1`–`v5` are all applied** in production: `TopologyMcp`,
  `TopologyRegistry`, `TopologyDocument`, `AuthoringProfile`, `AnalyticsLog`.
- **Production origin**: `https://topology-dojo.harnessed.cloud` (moved from
  the `workers.dev` subdomain 2026-07-18; the GitHub OAuth App callback was
  repointed to match). Staging stays on its own `workers.dev` subdomain,
  fully isolated (`check-wrangler-env.mjs` enforces this in CI).
- **The current automated gate is 2918 Vitest cases in 196 files plus 120
  Chromium browser cases in 27 spec files** (`af6a9ca`, local run 2026-11-14;
  CI additionally runs the Python catalog reference tools, `catalog:check`,
  and a LibreOffice `.vsdx` render job — `ci.yml` jobs `check`, `e2e`,
  `visio`). Counts are evidence for this revision, not a durable product
  claim; use the living QA plan and the current CI run for a release
  decision.
- **The external monitoring gate needs current operator evidence**: this
  repository cannot read Cloudflare notification policy state. The repo-side
  half of `IMPLEMENTATION_PLAN.md` initiative
  O landed 2026-07-19: alert matrix + severity model (`docs/ALERTS.md`),
  Cloudflare human checklist (`docs/CLOUDFLARE_OPERATOR_RUNBOOK.md`),
  game-day framework + evidence template (`docs/GAME_DAY.md`), hourly (since
  proposal 0007; daily before) + on-demand production verification
  (`production-verify.yml`, deduplicated `production-smoke` issues, deployed
  SHA asserted against the GitHub Deployments record), a 15-check
  smoke (14 when it landed; `mcp-apikey-unauth` arrived with proposal 0005)
  with per-flag disabled-contract flags, staging flag-override deploy
  inputs, and a staging-only synthetic-fault route
  (`worker/staging-fault.ts`). Still human-only: the Cloudflare dashboard
  configuration (O1) and actually executing/recording the game day (O2).
  Until delivery evidence is attached, treat the Cloudflare layer as
  unverified; the GitHub synthetic layer remains repository-evidenced.
- Planning lives in `docs/`; do not copy static PR, issue, or branch counts
  into handoff notes because those become stale independently of the code.

## Recently completed

The August quality pass added text-box/shape sizing, compact and bounded MCP
discovery/reads, atomic `edit_topology`, non-zero-origin export correction,
honest autosave with a separate public-shared-copy slot, attachment-safe
layout, `inspect_render`, complete per-page undo, recoverable frame deletion,
shared cascade cleanup, all-element proposal previews, a Chromium browser
release gate with CI-rendered baselines, and overlay/format-painter/accessibility
polish. The user guide, QA plan, UAT plan, and traceability matrix document this
current surface.

Initiative A (agent activity + explainability) is implemented and shipped:
bounded MCP-session trails on existing `TopologyMcp` storage, a session index
on `AnalyticsLog` (v5), owner-gated `/api/admin/sessions`, an Agent Sessions
admin section, and a non-causal guidance-consulted timeline signal. Flag
choice: reuse already-on `ANALYTICS_ENABLED`. Merged as PR #243 (`5de7813`,
2026-08-19).

Shipped since the August baseline, outside the six-initiative plan (details
and evidence in `ROADMAP.md` §"Completed historical milestones"; PR numbers
from `git log --first-parent`):

- **Application rate limits** for MCP tools, share publish and large exports
  (PR #239, 2026-08-16), and the opt-in `LIVE_DATA_ENABLED` gate on the
  fabric tools (issue #228).
- **Competitive gap-closing batch** — inline label editing, quick-add,
  Share dialog with revoke (closes M20), hyperlinks, image nodes, status
  LEDs, Mermaid/CSV import, PDF export (`71b21e7`, 2026-08-17).
- **User-tied API keys** (proposal 0005, PR #247) and **importer sync
  ergonomics** (`element.upsert`, proposal 0006, PR #248), 2026-09-20.
- **Merge is the release** (proposal 0007, PR #273, 2026-10-10):
  `release.yml` + `deploy-worker.yml` + `scripts/migration-guard.mjs`
  replaced the manual `deploy-production.yml`.
- **Rendering/authoring quality**: flow paths follow link geometry (#257),
  light theme (#266, contrast fix #289), wire labels (#267), link anchor box
  (experimental, opt-in, #274), read-only draft tools served from a shared
  workspace's current revision (#279), attributed proposal conflicts (#270).
- **Wiring-sheet conventions** (proposal 0008, PR #282, 2026-10-15): link
  styles, tiers, port pills, bundles, port tables, sheet frame.
- **Phase 1 adoption** (PR #283, 2026-10-23): `export_topology` (PNG / PDF /
  draw.io / Visio / PowerPoint / Mermaid — `src/export/`), `view_topology`
  and the MCP Apps inline view, `server.json`.
- **Hardware catalog Phases 1–5** (PRs #285–#288, #290, 2026-10-24/25):
  `catalog/` data + `src/catalog/`, bind/validate, hardware MCP tools,
  wire-sheet rendering, native Visio masters. Phase 6 (feed importers) is
  not started; the real-Visio check is still pending
  (`futures/hw-catalog.md`).
- **Cinematic landing page** (PR #292, `worker/landing.ts`, 2026-11-03).
- **SD-WAN generator** (proposal 0010; PRs #293, #295, #296, #298,
  2026-11-08): `generate_sdwan_topology`, the editor wizard
  (`src/ui/sdwan-wizard.ts`), place tiles and page links, cloud hubs / SSE
  on-ramp, Natural Earth map backdrops (#298, #299); icon tiers 1–2
  (proposal 0011, #294–#296).
- **November 2026 review** (PRs #311–#319, 2026-11-14): markup-injection
  and data-integrity fixes (#311); rendering and export fixes (#312); canvas
  and app-shell defects (#313, #314); the link anchor box on by default,
  the clean render profile and parametric templates (#315); path analysis
  with its editor action, and the scenario-story library (#316); agent
  tools that refuse wrong calls (#317); standard canvas interactions
  (#318); QA and UAT plans brought up to date (#319). #312 and #313 reached
  `main` inside #314's merge.
- **UI overhaul foundations** (proposal 0013, P0 except the command registry;
  PR #326, merged 2026-11-19 as `e9d0d7f`; its Release run, 44491161125,
  completed with success at 09:12 UTC the same day). Merged: the editor stylesheet moved
  from `index.html` to `src/styles/` (`index.css` imports the files in
  cascade order); a token layer (`tokens.css`) for both themes and a flat
  skin with no backdrop blur; the toolbar (replaced by the top bar in PR #327),
  properties panel and status bar docked; neutral scrollbars shown on hover or keyboard focus; `color-scheme`
  and `theme-color` following the theme; the "Panel blur (glass)" display
  setting removed; one SVG icon set (Lucide, generated into an inline sprite
  by `scripts/build-icons.ts`) in place of symbol characters; ink on the brand
  accent chosen for contrast (`src/ui/contrast.ts`). Guards added:
  `src/styles/styles.test.ts` (colours only in `tokens.css` among the stylesheets in `src/styles/`, layer and radius
  scales, no blur, WCAG contrast computed from the tokens, a ratchet on text
  under 12 px), `src/ui/icons.test.ts`, `src/ui/contrast.test.ts` and
  `e2e/icons.spec.ts`. The three canvas screenshot baselines were regenerated
  in that PR; CI's e2e job passed on the pull request's last commit, `8881941`,
  before it merged. Also on `main` at `e9d0d7f`, and used by nothing until
  PR #327: `controls.css`, Inter, `menu.ts` and `menu.css`,
  `command-palette.ts` and `command-palette.css`, `inspector-tabs.ts`, with
  the browser specs `e2e/menu-component.spec.ts` and
  `e2e/command-palette-component.spec.ts`.
  The command registry and P1 to P3, in part, followed in PR #327 (next entry).
- **UI overhaul: command registry, shell, properties panel** (proposal 0013,
  the rest of P0, P1, P2 and part of P3; PR #327, merged 2026-11-19 as
  `d224979`). Merged: `src/ui/commands.ts`, the command table with every key
  binding as data, bound once in `src/main.ts`; the top bar, left rail, docked
  library, pages bar, zoom control, status bar and selection bar
  (`src/styles/shell.css`, the shell template in `src/main.ts`,
  `src/ui/menus.ts`, `src/ui/selection-bar-place.ts`); the command palette on
  Ctrl/Cmd+K (`src/ui/palette-sources.ts`); the properties panel's tabs,
  sections, header, colour popover and Link attachment line
  (`src/ui/inspector/`, `src/styles/inspector.css`); the shared controls on
  the wizards, the workspace, preferences and admin panels and the node
  designer; "page" for "frame" in the menus, the pages bar and the command
  titles (some labels still said "frame" in `main`; proposal 0013's section "What P1
  to P4 changed from this text" lists them, and PR #328 changes them).
  Guards added: `src/ui/menus.test.ts`, `src/ui/palette-sources.test.ts`,
  `src/ui/selection-bar-place.test.ts`, `src/ui/inspector-tabs.test.ts`,
  `src/ui/inspector/sections.test.ts`, `src/ui/inspector/field-groups.test.ts`,
  `src/ui/inspector/link-attachment.test.ts`, `src/ui/commands.test.ts`, and
  the browser specs `e2e/shell-menus.spec.ts`, `e2e/selection-bar.spec.ts`,
  `e2e/shell-inspector-layout.spec.ts`, `e2e/shell-inspector-tabs.spec.ts`,
  `e2e/command-keys.spec.ts`, `e2e/command-surfaces.spec.ts`; the three canvas
  screenshot baselines were regenerated for the narrower canvas column
  (704 x 608). Departures from the proposal's text are in its section "What P1
  to P4 changed from this text". Not done: see the dated note near the top of
  this file. PR #328 (not merged): the compact layout (below 1,024 px the
  panels are drawers), the user guide, the README image and these documents.
- **UI overhaul: finish the skin, guardrails and the "what moved" note**
  (proposal 0013, the rest of P3 and P4; for PR #328, **not merged**, so not in
  `main` and not released; built on the integration branch `wip/int2` and not yet pushed: the pull request's own head is still `01c21db`). On the branch: the Share dialog, the presentation
  controls, the shortcut sheet's close button and the path bar, the last
  surfaces on `.tbtn`, are on the shared controls, and so are the library's
  tiles, the canvas overlays, Display settings, the Problems dock and the
  annotation editors (restyled from their own rules); `toolbar.css` is
  deleted;
  `--accent-fg` for accent text, computed for a brand accent; a dark scope for
  present mode (`.dark-scope`); duration tokens (`--dur-slow`, `--dur-flash`)
  and a test that no transition or animation has a literal time;
  "page" for "frame" in the shell's labels; small fixes (Zoom in and Zoom out
  tooltips name their keys, the properties toggle has `aria-expanded`, a
  Problems jump opens the field at fault, Display settings fits a 450 px
  window, drawers close each other when they crowd the canvas, phone number
  fields keep every digit, a node's link-attachment override fits 1,440 x 900,
  the selection bar keeps clear of the quick-connect arrows). Guards:
  `e2e/shell-budget.spec.ts`, `src/ui/shell-budget.test.ts`,
  `e2e/shell-note.spec.ts`, `src/ui/shell-note.test.ts`, the contrast cases in
  `src/ui/contrast.test.ts`, the duration and 12 px tests in
  `src/styles/styles.test.ts`. The user guide, the README image, the QA plan,
  the traceability matrix, the capability matrix and the registers were
  updated for it.

## Active implementation program

Six initiatives, detailed in `IMPLEMENTATION_PLAN.md`:

| #   | Initiative                                  | Status                                                    | Blocking dependency                                                      |
| --- | ------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| N   | Living product/quality documentation        | Baseline refreshed 2026-08-09; maintain with each change  | None                                                                     |
| O   | Cloudflare alerting + production game day   | Repo-side done 2026-07-19; O1/O2 human halves outstanding | None — human can start immediately                                       |
| A   | Agent activity + explainability             | Implemented A1–A6; shipped (PR #243, live `5de7813`)      | None — reuses `ANALYTICS_ENABLED`; no new DO/migration                   |
| B   | Guided topology briefs + semantic templates | Done as re-scoped 2026-11-14 (parametric templates)       | None                                                                     |
| E   | EdgeConnect live-import hardening + UI      | E2 done 2026-11-14 (tests); E1, E3–E7 not started         | None — soft dependency on N landing                                      |
| T   | Time-aware flow/failure storytelling        | T1–T3 done 2026-11-14 (library); T4 held, T5–T7 not begun | T4 held: MCP tool-list budget; the live-data tools are off in production |

Status verified 2026-11-13 at `e99b012`: none of B's, E's or T's planned
modules or tools exist (`src/briefs/`, `src/stories/`, `create_from_brief`,
`compile_flow_story`, `fixtures/edgeconnect/`). **B's premise has moved**:
the SD-WAN generator (proposal 0010) already ships one intent-to-document
compiler with an MCP tool and a GUI wizard (`src/connect/generate.ts`,
`generate_sdwan_topology`, `src/ui/sdwan-wizard.ts`) — re-scope B against it
before starting B1. Work since August has been driven by proposals
0005–0011 and `futures/hw-catalog.md` rather than this table; proposal 0009
(status: Proposed) would re-cut _Now/Next_ if accepted.

Since that check (2026-11-14): initiative B was re-scoped against the
generator and shipped as parametric starter templates
(`src/api/templates.ts`, `params` on `create_from_template`, the parameter
dialog in `src/ui/template-wizard.ts`; see `ROADMAP.md`, Now item 4). Packet
E2 is done as tests, and `src/stories/` now holds T1–T3 — the scenario contract, the story compiler
and the failure-moment annotations — as a library with no caller yet.
`compile_flow_story` (T4) is deliberately not built: the MCP tool list has a
hard size budget and the live-data tools are off in production. Before
starting T4, note that a story needs no provider (its scenario carries the
base fabric), so the gate the packet assumed does not follow.

2026-11-19: proposal 0013 (the UI overhaul of the editor chrome, accepted
this date) is likewise driven from its own file, not from this table. Its P0
(foundations) is merged: PR #326 as `e9d0d7f` and PR #327, with the command
registry, as `d224979`. P1 (shell) and P2 (properties panel) are merged in
PR #327, and so is part of P3 (the skin sweep: the wizards, the workspace,
preferences and admin panels and the node designer are on the shared
controls). PR #328 (not merged) holds the rest of P3 (the Share dialog, the
presentation controls, the shortcut sheet, the path bar and the other
surfaces on the shared controls, no `.tbtn`, no text under 12 px, accent
text, motion) and P4 (the control and text-size budgets, the sideways-scroll
test and the one-time "what moved" note), the compact layout (drawers below
1,024 px) and the documentation. Until #328 merges, `main` has the old
skin on those surfaces and none of P4. The proposal's status header and its
section "What P1 to P4 changed from this text" are the record. Those phase
labels are the proposal's own and are unrelated to proposal 0003's packets
P1–P5.

Before starting a July implementation packet, revalidate its premise against
`ROADMAP.md`, `CAPABILITY_MATRIX.md`, and current code. O1/O2 remain explicitly
human/operator work unless dated evidence says otherwise.

## Important architectural rules

Read these before touching code — violating any of them has caused a
production incident or a launch-blocking finding in this repo's history:

- **Every workspace write goes through one path.** Human GUI edits, agent
  proposals, agent leased commits, restore, and fork all flow through
  `TopologyDocument`'s single commit pipeline (`worker/document.ts`). Never
  add a second write path for convenience or performance.
- **Pages are independent, full-frame documents — no cross-page
  inheritance, ever.** This is a locked architecture decision
  (`docs/decisions/0001-flipbook-vs-beats.md`, `DESIGN.md` #1). If a feature
  seems to need one page to reference/inherit from another, that's a design
  smell — see how the scenario-story compiler (`src/stories/compile.ts`,
  initiative T) keeps to it: its _input_ is a base plus changes, but every
  page is compiled from scratch from its own fabric state, and pages have
  only element ids and node positions in common.
- **Agents never write silently.** Every agent mutation to a shared
  workspace is either a reviewable proposal or a time-bounded,
  browser-granted, page-scoped lease commit — no "just write it" path exists
  by construction (`worker/document.ts` `commit()` requires either
  `source: 'proposal'` acceptance or an active lease for
  `source: 'agent-lease'`). Keep it that way.
- **Never treat a transient provider-fetch failure as deletion evidence.**
  The flow compiler's `upsertBySource` model updates/creates from what a
  provider _returns_; an empty or failed fetch must never cascade-delete
  previously-compiled elements. This is enforced by tests (packet E2),
  precisely because it's an easy mistake to make when "simplifying" sync
  logic: `src/connect/compile.test.ts` ("no delete on an empty, partial or
  failed fetch") converges every combination of empty collections, and every
  mid-read failure, onto a compiled document and finds every element still
  there; the `build_flow_topology` case in `src/mcp/tools.test.ts` proves a
  later fetch cannot reach an earlier build. The same suite pins what
  re-reading into a compiled document still gets wrong (not deletions:
  positions re-seeded, a restored tunnel left dimmed, a flow path or site
  zone shrunk by a partial read) — read it before building an in-place
  importer.
- **No raw prompt/conversation logging, anywhere.** The authoring-profile
  learner and the planned agent-explainability work both operate on
  structured, deterministic feature extraction from document _operations_ —
  never on raw LLM prompts, completions, or transcripts.
- **One catalog is the source of truth.** Anything a human can set through
  the inspector, an agent can set identically through the same
  catalog-driven contract (`src/api/catalog.ts`) — no UI-only persisted
  authoring fields and no agent-only persisted authoring fields. Local view
  state and owner-authority actions are intentionally surface-specific. See
  `DESIGN.md` #2/#3.

## Deployment rules

- **Merge is the release** (proposal 0007, `docs/proposals/0007-merge-is-the-release.md`).
  Production deploys exclusively through `release.yml`: every non-docs push
  to `main` runs CI on the merge SHA, rehearses it on staging, and deploys
  it to production — unattended for a routine release. A release that would
  apply a new Durable Object migration is **held** (red run, PR comment)
  until a human dispatches `release.yml` with the typed `apply_migration_tag`;
  a candidate whose migrations array is not a strict extension of
  production's is refused outright (`scripts/migration-guard.mjs`). The
  `guard` job enforces `main` for every event and honours an open
  `release-freeze` issue. There is no other path; `npm run deploy` was
  deleted (finding L1), `deploy-production.yml` was deleted 2026-10-10, and
  Workers Builds' Git integration is disconnected (operator O9) specifically
  because it once bypassed the gate.
- **Staging is isolated and safe to dispatch freely**
  (`deploy-staging.yml`, optional `ref` input — any ref, for UAT) — separate
  KV namespaces, DO namespaces, GitHub OAuth App, and origin from
  production. It is also rehearsed automatically by every release, so a
  manual dispatch queues behind (never cancels) a release in flight; check
  `GET <staging>/healthz` before trusting a UAT result.
  `scripts/check-wrangler-env.mjs` (run in CI and locally via
  `npm run check:wrangler`) enforces the isolation invariants and fails loudly
  on drift. Both paths deploy through the one shared `deploy-worker.yml`.
- **Recovery is explicit and never unattended.** Forward recovery is a
  `release.yml` dispatch with `recovery_sha`; a stateless rollback is
  `rollback_to_version` + `recovery_sha` (refused across a migration
  boundary). Never roll back across a migration boundary — redeploy with the
  offending flag turned off instead. See `docs/ROLLBACK.md`.

## ⚠️ Durable Object migration warning

**None of the six active initiatives in `IMPLEMENTATION_PLAN.md` are
designed to require a new migration.** If you're implementing a packet from
that plan and find yourself needing one anyway, **stop and get explicit
human sign-off before proceeding** — feature migrations `v3`–`v5` established
the full bootstrap-then-activate cycle (ship the new DO class inert behind a
flag in one deploy, activate it in a separate deploy after verification).
Migrations `v1` and `v2` predate that pattern. Skipping the established cycle is
the single highest-risk
mistake a new agent could make here. See `docs/DEPLOYMENT_RUNBOOK.md`'s
per-migration gate sections (`v3`, `v4`, `v5`) for the pattern to follow if
one genuinely becomes necessary.

## Test commands

```bash
npm run typecheck   # tsc --noEmit (app) + tsc -p worker/tsconfig.json --noEmit (worker)
npm run lint         # eslint . && prettier --check .
npm test             # Vitest unit + Miniflare integration suites
npm run build        # tsc --noEmit && vite build
npm run test:e2e     # Chromium functional + Linux-baseline visual release gate
npm run check:wrangler   # node scripts/check-wrangler-env.mjs — staging isolation + migration parity
npm run catalog:check    # hardware-catalog bundle + generated types are current (CI runs this)
```

Run the complete gate before opening a PR. Miniflare tests require permission
to bind a localhost listener; a restricted sandbox may report `listen EPERM`,
which is an environment failure rather than a product test result. Visual
baselines are CI-rendered for Linux; a macOS run can execute the functional
cases but cannot compare the five visual cases (`e2e/visual.spec.ts`) unless
reviewed Darwin baselines are deliberately added. See `launch-readiness/QA_TEST_PLAN.md`.

## Key files

| Area                                            | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document model + persistence                    | `src/pages/model.ts`, `src/pages/persist.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Headless authoring API                          | `src/api/{builder,edit,validate,layout,autolayout,catalog,tidy}.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| MCP tools (both transports)                     | `src/mcp/tools.ts` (source of truth), `src/mcp/{export-tools,hardware-tools}.ts`, `src/mcp/register.ts`, `src/mcp/server.ts` (stdio), `worker/mcp.ts` (remote)                                                                                                                                                                                                                                                                                                                                                  |
| Connector/flow-compiler platform                | `src/connect/{types,mock,edgeconnect,compile}.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| SD-WAN generator + wizard                       | `src/connect/generate.ts`, `src/ui/sdwan-wizard.ts`, `src/render/backdrops.ts` (proposal 0010)                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Scenario stories (library only)                 | `src/stories/{types,compile,frame,annotate}.ts` (initiative T, packets T1–T3)                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Export / import formats                         | `src/export/` (scene, PNG, PDF, draw.io, Visio, PowerPoint, Mermaid, cable schedule), `src/import/`, `worker/raster.ts`; contract in `docs/EXPORTS.md`                                                                                                                                                                                                                                                                                                                                                          |
| Hardware catalog + wire sheets                  | `catalog/` (data, schema, Python reference tools), `src/catalog/`, `src/api/hardware.ts`, `src/render/wiresheet.ts`, `worker/catalog.ts`, `scripts/catalog-*.ts`                                                                                                                                                                                                                                                                                                                                                |
| API keys (proposal 0005)                        | `worker/api-keys.ts`, `worker/api-keys-page.ts`, `src/server/api-key.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Shared workspace coordinator                    | `worker/document.ts` (revisions/proposals/leases/checkpoints/presence), `worker/registry.ts`, `worker/workspaces.ts`                                                                                                                                                                                                                                                                                                                                                                                            |
| Workspace client                                | `src/workspace/{model,client,offline,operations}.ts`, `src/ui/workspace-panel.ts`                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Adaptive authoring profiles                     | `src/profile/{features,learner,refinement,guidance}.ts`, `worker/profile.ts`, `worker/profile-api.ts`, `src/ui/profile-panel.ts`                                                                                                                                                                                                                                                                                                                                                                                |
| Admin/analytics dashboard                       | `worker/analytics.ts`, `worker/admin-api.ts`, `src/admin/`, `src/ui/admin-dashboard.ts`, `src/agent-activity/`                                                                                                                                                                                                                                                                                                                                                                                                  |
| Editor chrome styles                            | `src/styles/index.css` (imports the other files in cascade order), `src/styles/tokens.css` (semantic tokens, both themes), `src/styles/controls.css` (the shared control classes), `src/styles/shell.css`, `src/styles/inspector.css`, `src/styles/styles.test.ts` (guards, among them no text under 12 px and no literal duration); proposal 0013                                                                                                                                                              |
| Editor chrome icons                             | `scripts/build-icons.ts` (manifest + generator, `npm run build:icons`), `src/ui/icons.generated.ts` (generated from `lucide-static`), `src/ui/icons.ts`, `src/styles/icons.css`                                                                                                                                                                                                                                                                                                                                 |
| Ink on the brand accent                         | `src/ui/contrast.ts` (`readableInkOn` for the ink on an accent fill; on PR #328, not merged, also `readableAccentText` and `mixHex` for accent text), called by `setChromeAccent` in `src/main.ts`                                                                                                                                                                                                                                                                                                              |
| Menus and command palette                       | `src/ui/menu.ts` + `src/styles/menu.css` (the menu component), `src/ui/menus.ts` (the File, Edit, View, Arrange, Help, folded, Export, Tidy, account and context menus, as data), `src/ui/former-toolbar.ts` (the old toolbar's controls, for the tests that check none was lost), `src/ui/command-palette.ts` + `src/styles/command-palette.css`, `src/ui/palette-sources.ts` (what the palette lists); specs `e2e/shell-menus.spec.ts`, `e2e/menu-component.spec.ts`, `e2e/command-palette-component.spec.ts` |
| Command registry (PR #327, merged as `d224979`) | `src/ui/commands.ts` (the command table, `matchKey`, `createCommandRegistry`, `HELP_GESTURES`; pure, no DOM), `src/ui/commands.test.ts`, `src/ui/canvas-keys.test.ts` (tests `matchKey`), `e2e/command-keys.spec.ts`, `e2e/command-surfaces.spec.ts`; bound once in `src/main.ts`; proposal 0013 P0                                                                                                                                                                                                             |
| Shell (PR #327, merged as `d224979`)            | The shell template and its wiring in `src/main.ts` (top bar, left rail, docked library, canvas column, pages bar, zoom control, status bar), `src/styles/shell.css`, `src/ui/selection-bar-place.ts` (where the selection bar goes), `src/ui/fit-insets.ts` (fit view clears what floats over the canvas); specs `e2e/shell-layout.spec.ts`, `e2e/selection-bar.spec.ts`, `e2e/shell-frames.spec.ts`; proposal 0013 P1                                                                                          |
| Properties panel (PR #327, merged as `d224979`) | `src/ui/inspector/` (`tabs.ts`, `sections.ts`, `field-groups.ts`, `selection-header.ts`, `color-control.ts`, `page-tab.ts`, `document-tab.ts`, `link-attachment.ts`, `focus-keep.ts`, `panel-width.ts`), `src/ui/inspector-tabs.ts` (the tab rules), `src/styles/inspector.css`; specs `e2e/shell-inspector.spec.ts`, `e2e/shell-inspector-tabs.spec.ts`, `e2e/shell-inspector-layout.spec.ts`; proposal 0013 P2                                                                                                |
| Guardrails and the note (PR #328, not merged)   | `e2e/shell-budget.spec.ts` and `src/ui/shell-budget.test.ts` (the control budgets, the text-size walk, the sideways-scroll test), `src/ui/shell-note.ts` + `src/ui/shell-note.test.ts` + `e2e/shell-note.spec.ts` (the one-time "what moved" note; `help.whatMoved` in `src/ui/commands.ts`), `src/ui/problems-dock.ts` (`problemField`, where a problem is fixed); proposal 0013 P3 and P4                                                                                                                     |
| Compact layout (PR #328, not merged)            | `src/ui/compact-layout.ts` (the one breakpoint: at 1,023 px and below, that is below 1,024 px, the library and the properties panel are drawers), `src/ui/compact-layout.test.ts`; the drawer rules in `src/styles/shell.css` and `src/styles/inspector.css`; the compact cases of `e2e/shell-layout.spec.ts`                                                                                                                                                                                                   |
| Auth + landing page + showcase                  | `worker/auth.ts`, `worker/landing.ts`, `public/landing/`, `public/showcase/*.webp`                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Deployment config                               | `wrangler.jsonc`, `.github/workflows/{release,deploy-worker,deploy-staging,ci,production-verify,nightly-staging-smoke}.yml`, `scripts/{check-wrangler-env,migration-guard}.mjs`                                                                                                                                                                                                                                                                                                                                 |
| Flags                                           | `worker/env.ts` (`workspaceEnabled`, `profilesEnabled`, `analyticsEnabled`, `liveDataEnabled`, `isAdmin`), `worker/api-keys.ts` (`apiKeysEnabled`)                                                                                                                                                                                                                                                                                                                                                              |

## Known risks (from the launch-readiness findings register)

The 2026-07-04 findings register is preserved as an audit record; its original
top-line counts are not a current open-defect summary. Read appended closure
notes and `CAPABILITY_MATRIX.md`. Former findings H1 and **M20** are fixed
(M20 closed 2026-08-17 — publisher can revoke via the Share dialog,
`unpublish_topology`, or signed-in `DELETE /api/topology/:id`; snapshots use
`max-age=60` without `immutable`).

Full register: `docs/launch-readiness/FINDINGS_REGISTER.md`.

As of 2026-11-15 the register also lists sixteen observations the November
review left open, and 22 of the July findings still carry no status in any
document. The pre-audit note
([`sitrep/2026-11-15-pre-audit-handoff.md`](sitrep/2026-11-15-pre-audit-handoff.md),
section 6) records four problems confirmed on that date and not fixed: a
custom node spec can inject markup (the remainder of H8), a failed write to
the hosted agent store is reported as success (H6), documents carry no
schema version, and the dependency advisories are not triaged.

2026-11-16: the first of those is fixed by `fbcb0d8` (PR #324). Custom node
specs are rebuilt from an allowlist on every way into a document
(`sanitizeCustomNode`, `src/nodes/sanitize.ts`), and the pre-audit note's
probe no longer reaches the SVG (re-run this date). H6 is unchanged:
`persistAfter` in `worker/mcp.ts` still logs a failed store write and
returns success. The schema version and the advisory triage were not
re-checked.

## Human-only operational tasks

Things no agent in this repo can complete alone:

1. **Decide a production release** — **merging a PR into `main` is the
   human release decision** (proposal 0007): `release.yml` deploys it
   unattended. An agent never merges to `main`, and never dispatches
   `release.yml` (recovery, rollback, or a migration's `apply_migration_tag`
   ack), except on an explicit chat instruction quoted in the session. This
   is a procedural rule, not a technical one: the agent's GitHub identity is
   the owner's, so no GitHub setting can tell them apart (the `production`
   environment's required-reviewer click was removed 2026-10-09 for exactly
   that reason). Branch protection with no bypass — PR required, `CI /
check` + `CI / e2e` required — is the only gate that binds both equally.
2. **Configure Cloudflare alerting** (`IMPLEMENTATION_PLAN.md` packet O1) —
   a Cloudflare dashboard action; the exact steps + evidence requirements
   are `docs/CLOUDFLARE_OPERATOR_RUNBOOK.md` (CF-1..CF-6 checklist).
3. **Run the game day** (packet O2) — `docs/GAME_DAY.md`, a human operator
   observing/confirming each step of a live drill; production steps are each
   a PR the owner merges. Verify the staging SHA at the start
   of every drill; the 2026-07-19 observation recorded in the historical
   findings is not evidence of the current deployment.
4. **Provision the staging-only `DIAGNOSTICS_TOKEN` secret** (for game-day
   scenarios S-2..S-4): `npx wrangler secret put DIAGNOSTICS_TOKEN --env
staging` with a generated ≥16-char value kept only in the operator's
   password manager. Never set any `DIAGNOSTICS_*` value for production —
   CI (`check:wrangler`) rejects the var half outright.
5. **Optionally qualify EdgeConnect** (packet E5) — provision staging-only
   `ORCH_BASE_URL`/`ORCH_API_KEY` and execute the conditional QA/UAT track only
   when live-fabric support is being activated. This is a deliberate separate
   decision, never bundled into a normal feature deploy.

## Documentation map and history

- `docs/archive/IMPLEMENTATION_PLAN_2026-07-12.md` — the previous
  implementation plan (proposals 0002 follow-ons, 0003, 0004), fully
  executed. Carries a banner; do not treat as current.
- `docs/launch-readiness/FINDINGS_REGISTER.md` — preserved historical finding
  bodies plus the current status overlay described under "Known risks."
- `docs/launch-readiness/{QA_TEST_PLAN,UAT_PLAN,TRACEABILITY_MATRIX}.md` — the
  active living quality plans and capability-to-evidence index. Earlier
  pre-launch versions remain available in Git history, not as current files.
- `docs/USER_GUIDE.md` — the current task-based guide for people, agents,
  workspace owners, administrators, and operators.
- `docs/proposals/000{1,2,3,4}-*.md` — the original design proposals for
  live-flow-visualization, the shared workspace, adaptive authoring
  profiles, and the deployment pipeline. All four are implemented; 0001's
  status header already said so, 0003/0004's were corrected as part of this
  reset (see `DISCREPANCY_REGISTER.md`).
- `docs/proposals/0005`–`0013` — API keys (implemented, production flag
  off), importer sync (implemented), merge-is-the-release (implemented),
  wiring-diagram conventions (implemented except harness routing), the
  vendor-neutral diagramming-tool direction (**Proposed**, not accepted),
  the SD-WAN generator (slices 1–4 implemented), the icon gap review
  (tiers 1–2 shipped), SD-WAN vendor research (research only), and the UI
  overhaul of the editor chrome (accepted 2026-11-19; P0, P1 and P2 are merged, with part of P3: #326 as `e9d0d7f` and #327 as `d224979`; the rest of P3, P4, the compact layout and these documents are PR #328, not merged). Each
  file's status header is authoritative.
- `docs/EXPORTS.md` — the export/import fidelity contract.
- `docs/futures/hw-catalog.md` — hardware-catalog phase status;
  `docs/sitrep/` holds its dated progress notes (historical).

## Working conventions (unchanged, proven across ~20 packets)

- Packet = branch = PR; one active writer per branch; small enough to be one
  reviewable PR (see `IMPLEMENTATION_PLAN.md`'s packet specs for the target
  size).
- Independently verify the risky properties and run the full gate before
  committing — don't trust a sub-agent's self-report on correctness.
- Base every pull request on `main`. A pull request based on another
  pull request's branch merges into that branch, not into `main`, unless
  the base branch is deleted first; two of the November PRs were stranded
  that way and had to be carried by a third (2026-11-14).
- Staging deploys are safe to dispatch on request. Merging to `main` is the
  production release (since 2026-10-10) and any `release.yml` dispatch is a
  recovery or migration action: an agent does either only on an explicit
  human instruction quoted in the session, no exceptions (there is no second
  approval click since 2026-10-09).

## Operator checklist — proposal 0007 cut-over

Owner actions that complete "merge is the release" (details and rationale
in `proposals/0007-merge-is-the-release.md` §"GitHub settings checklist"):

_Status as of 2026-11-13: unverified. These are GitHub/Cloudflare settings
the repository cannot read; `release.yml` has been the only deploy path for
every merge since PR #273, but no dated owner evidence for the items below
is recorded here, so the boxes stay unchecked until the owner confirms._

- [ ] Branch protection on `main`: PR required; required checks `CI / check`
      and `CI / e2e`; no bypass, administrators included.
- [ ] `production` environment: deployment branches `main` only, no
      reviewers (both already true); `staging` environment: no reviewers.
- [ ] Scope the `staging` environment's `CLOUDFLARE_API_TOKEN` to the
      `topology-dojo-staging` script (it can otherwise address production).
- [ ] Repository "Allow auto-merge" off (verified off 2026-10-10).
- [ ] Actions workflow permissions read-only; "Require approval for all
      external contributors".
- [ ] Create the `release-freeze` label.
- [ ] Watch the first unattended release end to end, then confirm the next
      hourly `Production Verify` reports "deployed SHA matches the record".
