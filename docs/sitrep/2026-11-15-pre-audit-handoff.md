# Pre-audit handoff — 2026-11-15

_Written for the independent audit that comes before any change to the core
layers. It records the state of the repository and of production at the
hand-over, what the November 2026 review changed and how deeply each part was
reviewed, what is known to be open, and where deeper problems are most
likely. [`../HANDOFF.md`](../HANDOFF.md) remains the standing entry point;
this note is a dated snapshot and will go stale._

Every statement below is marked by how it is known. **Confirmed** means
reproduced or read in code on the date given. **Observed** means reported by
a test pass during the review and not re-checked since. **Inferred** means
reasoned from code or titles without a check.

## 1. What the audit is for

The owner wants to know there are no deeper problems before core or
underlying changes are made. Two rules follow.

- **The audit is read-only.** Probes, scripts and throw-away tests are fine.
  No change to the layers in the table below, and no fix for anything in
  this note, until the audit has reported and the owner has decided.
- **Nothing here touches live network gear.** `LIVE_DATA_ENABLED` is off in
  both environments. Do not point the EdgeConnect client at a real
  Orchestrator without the owner's explicit go.

"Core" means the layers every feature stands on:

| Layer                             | Where                                                                                                                        | Why it is core                                                                            |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Document model and the parse gate | `src/pages/model.ts`, `src/pages/persist.ts` (`parseDoc`), `src/pages/typed-fields.ts`                                       | Every document from every source passes through `parseDoc`, in the browser and the Worker |
| Render engine and its mirrors     | `public/vendor/topology-ds.js`, `src/vendor/topology-ds.ts`, `src/render/`, `src/nodes/render.ts`                            | One render path for canvas, exports and agents; output is pinned by SHA tests             |
| Editor state machine              | `src/editor/editor.ts`                                                                                                       | Selection, gestures, per-page history, and the operations a gesture publishes             |
| Workspace commit pipeline         | `worker/document.ts`, `src/workspace/operations.ts`                                                                          | The single write path for shared workspaces                                               |
| Persistence                       | `src/mcp/persist-store.ts`, `worker/mcp.ts`, `worker/registry.ts`, autosave in `src/main.ts`, `src/pages/autosave-ledger.ts` | Durability of drafts, of the hosted agent store, and of the browser copy                  |
| Agent tool surface                | `src/mcp/tools.ts`, `src/mcp/register.ts`, `src/mcp/args.ts`, `src/mcp/write-checks.ts`                                      | The contract with every agent, held to a hard size budget                                 |
| Auth, sessions, sharing           | `worker/auth.ts`, `worker/default-handler.ts`, `worker/api-keys.ts`, `worker/share.ts`                                       | The trust boundary. Not touched by the November work and not reviewed since August        |

## 2. State at hand-over

| Fact                      | Value                                                                                                                                                                                                  | How it is known                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `main`                    | `916fb14`, the merge of #319                                                                                                                                                                           | Confirmed, `git fetch` 2026-11-15                                                      |
| Production serves         | `78ca2dc`, the merge of #318                                                                                                                                                                           | Confirmed: `GET /healthz` at 2026-11-15T00:31Z returned `ok: true` and that SHA        |
| Why the two differ        | #319 changed only `docs/`. `release.yml` ignores pushes that touch nothing but `docs/**` and `**.md`                                                                                                   | Confirmed, read in `release.yml`                                                       |
| Test gate at that code    | 196 Vitest files / 2,918 tests; 120 Chromium cases in 27 spec files; CI jobs `check`, `e2e`, `visio`                                                                                                   | Confirmed: local run at `af6a9ca` (the same tree) and the Release run for `78ca2dc`    |
| Production flags          | `WORKSPACE_ENABLED`, `PROFILES_ENABLED`, `ANALYTICS_ENABLED` are `"true"`; `LIVE_DATA_ENABLED` and `API_KEYS_ENABLED` are `"false"`                                                                    | Read in `wrangler.jsonc` on `main`. Only the workspace flag is confirmed by `/healthz` |
| Content-Security-Policy   | `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'` | Confirmed: response header of `GET /` on 2026-11-15                                    |
| Agent tool list           | stdio lists 35 tools in 44,088 bytes (limits 35 and 44,200). Hosted lists 64 in 67,614 bytes (limits 64 and 67,800). Ten more are operations only; 74 defined                                          | Confirmed: measured on `main` the way `src/mcp/token-budget.test.ts` measures          |
| Durable Object migrations | `v1`–`v5` applied; none added by the November work                                                                                                                                                     | Read in `wrangler.jsonc`; `worker/` changed by seven lines in the whole range          |

Release behaviour worth knowing (confirmed on 2026-11-14, when seven PRs were
merged within two minutes): the production concurrency group does not cancel
a run in progress, and it keeps one pending run. So the first merge was
released, the middle ones were cancelled as superseded, and the last
code-changing merge was released. Nothing was lost, because each release
deploys the whole tree.

## 3. What changed since `501e7a4`

`501e7a4` is the merge of #310, the last release before the review. The range
to `main` is 87 commits, 183 files, +30,542 / −1,963 lines.

| PR   | Content                                                                                                             | Core layers touched                                                                                             | Written by                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| #311 | Markup injection, wrong-element rename, undo across documents, stale-tab overwrite                                  | Parse gate (typed fields), engine entry (`_safeCfg`), editor (`renameElement`, `resetHistory`), autosave ledger | Lead session                                                                           |
| #312 | Export fonts, link label chips, ID card centring, layout locks, Mermaid / draw.io round trip, captions, raster text | Engine (label frame, ID card), render mirrors, layout, import and export                                        | Lead session                                                                           |
| #313 | Canvas editor defects                                                                                               | Editor state machine: one selection model, gesture lifecycle, history, clipboard, locks                         | 22 commits by a delegated sub-agent, 3 by the lead session                             |
| #314 | App-shell defects. Also carried #312 and #313 into `main` (see section 9)                                           | None: `src/main.ts`, `index.html`, `src/ui/`, `src/nodes/designer.ts`                                           | 19 commits by a delegated sub-agent, 2 by the lead session                             |
| #315 | Link anchor box by default, clean render profile, parametric templates                                              | Authoring API (`DEFAULT_LINK_ATTACH`), render core (`profile`), `worker/workspaces.ts` (new-page default)       | Lead session, except the four template commits (delegated)                             |
| #316 | Path analysis and its editor action; scenario stories T1–T3; E2 tests                                               | Agent tool list (`analyze_path` in, `set_document_title` to operations only), editor (emphasis preview)         | Path core and stories delegated; tool registration and the editor action by the lead   |
| #317 | Agent tools refuse wrong calls                                                                                      | Agent tool surface: argument admission, write checks, page resolution                                           | Lead session                                                                           |
| #318 | Standard canvas interactions                                                                                        | Editor: zoom meaning, wheel handling, paste, insert node on link                                                | Editor commands begun by a delegated sub-agent and finished by the lead; the rest lead |
| #319 | QA and UAT plans, open findings                                                                                     | None (docs)                                                                                                     | §7.9–§7.13 of the QA plan and the UAT plan drafted by a delegated sub-agent            |

Where the lines went (changed lines, product code / tests):

| Area            | Product | Tests |
| --------------- | ------- | ----- |
| `src/editor`    | 3,810   | 4,911 |
| `src/main.ts`   | 1,822   | —     |
| `src/ui`        | 1,706   | 1,804 |
| `src/api`       | 1,664   | 2,405 |
| `src/stories`   | 1,418   | 1,659 |
| `src/mcp`       | 1,016   | 1,635 |
| `src/render`    | 489     | 479   |
| `src/pages`     | 420     | 398   |
| `public/vendor` | 155     | —     |
| `worker`        | 7       | —     |
| `e2e`           | —       | 3,032 |

**How deeply the delegated work was reviewed.** Less than its size deserves.
For #313 and #314 the lead session ran the full gate, resolved the merge
conflicts, read the commit messages, and scanned the new HTML-building lines
for unescaped values. It did not read the 41 commits line by line. The
stories library and the parametric templates were accepted on the gate and
their own guardrail tests. Several sub-agents stopped mid-task on a usage
limit; their uncommitted work was finished by the lead session.

## 4. Behaviour that changed for stored documents and existing clients

All of this is live in production.

- **Documents are repaired on load.** `parseDoc` drops members that are not
  objects, turns ids into strings, and drops or normalises fields whose type
  does not match the catalog. Fields the catalog does not list are kept.
- **`labelOffset` changed meaning** on tunnel, wireguard, packet, wifi, poe
  and optical links: it was an offset in the link's own rotated frame and is
  now page space, as on every other link type. Labels dragged on those link
  types before 2026-11-14 are drawn somewhere else now. No migration exists
  (see 6.3).
- **ID cards are drawn centred** on their position; they were drawn from the
  top-left corner. Existing ID cards moved by half their size.
- Replacing a document (new, open, template, generator) clears undo history.
- An idle browser tab no longer rewrites the autosave. A tab that sees a
  newer save from another tab shows a chip and does not overwrite it.
- New pages start with `linkAttach: {distribute: true}`. Stored pages are
  untouched.
- Agent tools: an unknown argument is refused, or moved into `extra` when it
  is a field of the element being added. Invalid writes are refused at the
  call. `update_element`, `remove_element` and `set_node_metadata` default
  to the page that has the element. `tidy`, `balance` and `layout` take
  `pageIndex`. `validate_topology` stops at 60 findings. `list_templates`
  returns `{templates, generators}`. `render_svg` is static unless
  `profile: "full"`. `set_document_title` is an `edit_topology` operation.
- Single-overlay generated fabrics have unlabelled tunnels.
- The zoom percentage means size on screen (100% is one page unit per
  pixel). A trackpad's two-finger slide pans; a pinch or Ctrl/Cmd+wheel
  zooms. A paste whose original position is out of view lands mid-view.
- An empty number field means "not set", not zero. A custom node type cannot
  take a built-in type's name. The Problems dock no longer opens by itself.

## 5. What was verified, and what was not

Verified:

| Claim                                                                                    | Evidence                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Each PR branch passed the full gate before it was pushed                                 | Local runs, CI on each PR head, and the Release CI on merge commits `b7234f2` and `78ca2dc`                                                                                           |
| Each merge produced the tree that was tested                                             | Tree equality checked with `git merge-tree` before the merges and against `main` after #314, #316, #318 and #319                                                                      |
| Element fields, ids, colours, numbers, `viewBox`, layers and legend cannot inject markup | Taint matrix in `src/server/untrusted.test.ts`; browser spec `e2e/untrusted-document.spec.ts` (opened file, share link, CSV import). **Custom node specs are not in either: see 6.1** |
| `parseDoc` leaves product-made documents unchanged                                       | `src/pages/parse-hardening.test.ts`: the sample, every template, generated fabrics, the browser-test fixtures                                                                         |
| Editor commands publish operations that reproduce the change                             | Referee-equality checks in `src/editor/*.test.ts`                                                                                                                                     |
| Path analysis returns the right routes                                                   | Comparison with an exhaustive search on random pages, `src/api/path.test.ts`                                                                                                          |
| Parametric templates are clean at every parameter value                                  | 144 documents through `validateDocument`, `analyzeLayout` and `inspectPage`, `src/api/templates.test.ts`                                                                              |
| Production took the releases                                                             | Release runs for #311, #314 and #318 green including the production smoke test; `/healthz`                                                                                            |

Not verified:

| Area                                                  | What is missing                                                                                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Wheel and trackpad                                    | The mouse-or-trackpad guess was never run on a physical device. QA case EDT-39                                                           |
| Browsers                                              | CI runs Chromium only. Firefox and Safari are untested. Visual baselines exist for Linux only                                            |
| Delegated code                                        | See section 3: gate, not line-by-line                                                                                                    |
| QA plan §7.9–§7.13 and the UAT plan                   | Citations checked by script (139 cited test files exist, quoted test names are present). The sentences were not re-read against the code |
| The 16 open findings                                  | Reproduced at `501e7a4`. Not re-tested after the fixes                                                                                   |
| Live fabric                                           | The EdgeConnect client has never run against a real or recorded Orchestrator payload                                                     |
| Performance                                           | One measurement, no profile                                                                                                              |
| Accessibility                                         | No assistive-technology pass. Contrast was measured, not fixed                                                                           |
| Touch                                                 | Not re-tested after the canvas hit-testing changes in #313                                                                               |
| Worker: auth, OAuth, API keys, share, admin, registry | Not reviewed at all in this work                                                                                                         |
| Export writers                                        | draw.io, Visio, PowerPoint, Mermaid, PDF and the cable schedule were not part of the injection audit                                     |
| Workspace, profile and admin panels                   | Never exercised with hostile strings                                                                                                     |
| Cloudflare alerting, branch protection, secrets       | Not readable from the repository                                                                                                         |
| Visio                                                 | The native masters have never been opened in real Visio                                                                                  |

## 6. Confirmed problems that are still open

### 6.1 A custom node spec can inject markup

Confirmed 2026-11-15 with a probe against `main`.

- `sanitizeCustomNode` in `src/pages/persist.ts` checks `typeName` and four
  colour fields and passes every other field of the spec through unchanged.
- `renderCustomNode` in `src/nodes/render.ts` writes `spec.strokeW` straight
  into `stroke-width="…"` and uses `spec.size` in geometry attributes.
- A document whose `customNodes[0].strokeW` (or `.size`) is the string
  `1"/><image href="x" onerror="…"/><g data-x="` survives `parseDoc`, and the
  payload appears as live markup in the output of `renderDocumentToSVG`.

To reproduce, as a throw-away test beside `src/server/render.ts`:

```ts
import { defaultSpec } from '../nodes/spec.js';
import { parseDoc } from '../pages/persist.js';
import { renderDocumentToSVG } from './render.js';

const payload = '1"/><image href="x" onerror="1"/><g data-x="';
const doc = parseDoc(
  JSON.stringify({
    title: 't',
    customNodes: [{ ...defaultSpec(), typeName: 'probe', strokeW: payload }],
    pages: [
      {
        id: 'p1',
        name: 'F',
        viewBox: '0 0 400 300',
        nodes: [{ id: 'n1', type: 'probe', x: 200, y: 150 }],
        links: [],
        anchors: [],
        zones: [],
        flowPaths: [],
        policyMarkers: [],
      },
    ],
  }),
)!;
// true: the payload is in the SVG as an element, not as text
renderDocumentToSVG(doc, 0).includes('<image href="x" onerror="1"/>');
```

Probed fields: `strokeW` and `size` reach markup. `radius`, `ledCount`,
`portCount`, `shape`, `patternType`, `ledPos`, `portPos`, `icon` and
`badgeText` all survive `parseDoc` with the wrong type but did not appear in
markup for a circle. Other shapes were not tried, so treat that list as a
lower bound.

Reach: every path that loads a document, including the public share view
`/v/<id>`, and the `define_node_type` operation, which the agent-tool pass saw
store unknown spec keys as given. Confirmed in the headless render only. The canvas registers
the same function, so the editor is expected to behave the same; that was
not run in a browser.

Effect in production: markup, not script. `script-src 'self'` blocks inline
handlers, and `img-src` / `connect-src 'self'` block a request to another
origin. What the policy leaves open is injected links and `<foreignObject>`
forms (there is no `form-action` directive). Outside the app there is no
policy at all: an SVG exported from such a document carries the payload.

This contradicts what #311 says. Its commit and description claim a
document can no longer inject markup. The taint matrix walks element fields
and never looked at custom node specs. It is the unfixed remainder of July
finding H8.

Suggested fix, not applied: type-check every `CustomNodeSpec` field in
`sanitizeCustomNode` (finite, clamped numbers; enums from their lists;
booleans; unknown keys dropped), keep escaping at the sinks, and add custom
node specs to the taint matrix.

### 6.2 A failed store write is reported as success (July finding H6)

Confirmed in code 2026-11-15. `persistAfter` in `worker/mcp.ts` catches an
error from `persistStore` and logs it, so the agent's call returns success
and the change exists only in memory for the rest of the session.
`persistStore` (`src/mcp/persist-store.ts`) now writes only documents that
changed, which was part of the July fix. No document size limit was found.
The registry's storage layer was not traced. It affects topologies in the
hosted agent's per-user store, not shared workspaces. The QA plan rates the
same behaviour "partial and high risk" (case MCP-07).

### 6.3 Documents carry no schema version

Confirmed 2026-11-15: `TopologyDocument` has no version field
(`catalogVersion` is for hardware bindings). #312 changed what two stored
values mean (section 4) and nothing could migrate or even detect the
affected documents. Nobody has counted them. Any further change to the
meaning of a stored field has the same problem.

### 6.4 Dependency advisories are not triaged

Confirmed 2026-11-15: `npm audit --omit=dev` reports 26 advisories in
production dependencies: 2 critical (`dompurify`, `proxy-addr`, both
transitive), 14 high (including the direct dependencies
`@modelcontextprotocol/sdk` and `agents`), 5 moderate, 5 low. With dev
dependencies the total is 41, 4 of them critical. Whether any vulnerable
code is in the Worker bundle or the browser bundle is unknown. QA case
SEC-07 requires that triage for a release.

### 6.5 Sixteen findings from the review

Listed with suggested dispositions in
[`../launch-readiness/FINDINGS_REGISTER.md`](../launch-readiness/FINDINGS_REGISTER.md),
"November 2026 review: observations left open". Observed, not re-tested.
Smaller ones that did not make the register are in Appendix A.

### 6.6 July findings with no recorded status

Twenty-two of the 51 July findings have no closure note in the register and
no status in any other document. The four high ones were checked on
2026-11-15: H3 and H5 are fixed in code, H8 is partly fixed (6.1), H6 is
open (6.2). The other 18 (14 medium, 4 low) were not checked. Appendix B
lists them.

## 7. Where deeper problems are most likely

These are leads, not findings. None has been checked unless it says so.

1. **Other markup sinks outside the element path.** Custom node specs were
   missed, so others may have been. Look at every place that builds SVG or
   HTML from document values without going through the engine's entry:
   `src/nodes/render.ts`, `src/editor/legend.ts`, the sheet frame and title
   block, captions, the wire-sheet legend, problem badges, and the template
   literals in `src/main.ts` and `src/ui/`.
2. **Export writers.** draw.io, Visio and PowerPoint are XML; Mermaid is
   text with its own quoting. None was tested with hostile labels or ids.
3. **Strings from other principals.** The workspace panel shows proposal
   names, actor names and revision labels that an agent or a collaborator
   wrote. `src/ui/workspace-panel.ts`, `profile-panel.ts` and
   `admin-dashboard.ts` were not exercised with hostile input.
4. **What a collaborator can commit.** `applyOperations` in
   `src/workspace/operations.ts` passes the result of every batch through
   `parseDoc`, and `worker/document.ts` does the same when a workspace is
   initialised and when a stored document or checkpoint is loaded (call
   sites read; the commit path itself was not traced). So the type gate
   applies there, and so do its gaps (6.1).
5. **The editor rewrite.** `src/editor/editor.ts` changed by about 3,000
   lines, most of them delegated. The riskiest parts are pointer capture
   and gesture abort, the history entries that record a canvas resize, the
   per-page history stacks, and the single selection store.
6. **Performance.** A 2,000-node document took 7.6 s to add one node
   (observed). Suspects, none measured: the whole-page JSON snapshot taken
   for every undo step, the full art re-render, document-wide validation and
   layout analysis on every change, the minimap and filmstrip, and
   whole-document serialisation for autosave. The code review also named
   `hoverNodeAt`, `measureLink` and `updateMiniBar` as quadratic per event.
7. **Chunked workspace sync.** A change of more than 250 operations is
   committed as several revisions (#307). Whether each intermediate
   revision is valid on its own (a link before its node) is unverified.
8. **Autosave across tabs.** One `localStorage` slot is shared by all tabs,
   with a ledger to detect a newer foreign save. Look for lost-update
   windows around the 400 ms debounce and for quota handling with embedded
   images. Undo snapshots copy embedded image data (reported as plausible by
   the code review, not confirmed).
9. **Forward compatibility of the parse gate.** A known field with an
   unexpected type is dropped on load and the document is then saved. A
   newer writer and an older cached client could lose data silently, and
   with no version field (6.3) nothing detects it.
10. **Server-side raster.** The rasterizer embeds one Latin typeface with no
    fallback. Emoji marker icons are confirmed to render as empty boxes in
    server PNG and PDF. Non-Latin labels very likely do too (inferred).
11. **Tool-list budget.** Both lists are at their tool-count limit and
    within 200 bytes of their size limit. Any new agent tool needs another
    one folded away. T4 is held on this.
12. **Admission by tool name.** `worker/mcp.ts` refuses a tool on a shared
    workspace by its name, so `analyze_path` is refused even when it would
    only read. Check for other tools with a read mode and a write mode.
13. **Error swallowing around the hosted store.** Besides 6.2, a failed
    rehydrate starts the session with an empty store by design. Check what
    a session can then do to the stored copy.
14. **The Worker.** Auth, OAuth, API keys, sharing, the registry and the
    admin API were out of scope for the November work, and most of the July
    findings without a status are there (Appendix B).

## 8. Decisions that wait on the owner

Each of these shapes a core change, so they are better settled after the
audit than discovered during it.

| Decision                                              | Why it matters                                                                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Fix 6.1 now, or leave it for the audit                | It is a contained input check, but it is in the parse gate                                                                         |
| How a failed store write should surface (6.2)         | Error to the agent, retry, or a size limit at write time; each changes the tool contract                                           |
| Whether documents get a schema version (6.3)          | Needed before any further change to the meaning of a stored field. Also decides whether to migrate the two changes already shipped |
| Which document- and page-level edits join undo        | Touches the editor's history and the operations it publishes                                                                       |
| Whether zones are containers                          | Changes what moving, copying and deleting a zone mean in the model                                                                 |
| The tool-list budget: raise it, or keep folding tools | Blocks T4 and any other new agent tool                                                                                             |
| `analyze_path` on shared workspaces                   | Admit by arguments, or split the read from the write                                                                               |
| Proposal 0009 (vendor-neutral direction)              | If accepted it re-cuts the roadmap's Now and Next                                                                                  |
| A dependency upgrade plan (6.4)                       | The MCP SDK and `agents` are direct dependencies of the Worker                                                                     |

## 9. Working in this repository

The standing rules are in [`../HANDOFF.md`](../HANDOFF.md) ("Important
architectural rules", "Deployment rules", "Working conventions"). What this
review added:

- **Stacked pull requests strand work.** #312 and #313 were each based on
  the branch below. When the stack was merged from the bottom up, #312
  merged into #311's branch after that branch had already landed, and #313
  into #312's. Neither reached `main` until #314 was re-pointed at `main`
  and carried them. GitHub only re-points a pull request when its base
  branch is deleted. Base every pull request on `main`, or re-point before
  merging.
- **A docs-only merge does not deploy.** `/healthz` reports the commit that
  is serving; compare it with the last merge that touched code.
- **The full gate:** `npm run check:wrangler`, `typecheck`, `catalog:check`,
  `lint`, `build`, `npm test`, `npm run test:e2e`.
- **Browser tests in a sandbox.** If the Playwright build the repo pins is
  not installed, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an installed
  Chromium. `E2E_PORT` moves the dev server off 4173 so two runs can
  coexist.
- **Visual baselines** must be regenerated from an ordinary checkout on
  Linux. A git worktree with a linked `node_modules` cannot serve the font
  files, and the pictures come out in the wrong typeface. Look at each new
  baseline before committing it. A baseline that still passes can be stale:
  the comparison tolerates small differences.
- **Unit tests under load.** With several suites running at once the
  default 5 s test timeout fails at random; `npx vitest run --testTimeout
30000` does not.
- **The editor's unit harness uses a stub engine** (`installEditorGlobals`
  in `src/editor/test-harness.ts`). A test that compares rendered art
  proves almost nothing unless it installs the real engine;
  `src/editor/emphasis-preview.test.ts` shows how.
- **Delegated sub-agents can stop mid-task** and leave uncommitted work in
  their worktrees. Check the worktree, not the report.

For the audit's own output: one entry per finding with an id, a severity,
the layer, a location as `file:line` at a named commit, how to reproduce it
or the reasoning, whether it is confirmed or inferred, a suggested fix, and
what else the fix would touch. Add them to the findings register as a new
dated section. The register's July text is a frozen record; do not edit it.

## Appendix A — Review findings that were not fixed and are not in the register

Observed at `501e7a4` by the review's test passes; line numbers quoted from
those reports refer to that commit. None was re-tested after the fixes, and
an item marked "not re-tested" may have been improved in passing. The
reproduction scripts lived in the review session's scratch space and were
not kept.

**Canvas**

- Typing a letter with a node selected runs the single-key shortcut (T
  tidies) instead of editing the label. F2 and Enter now rename.
- Select-all omits anchors (not re-tested). Marquee selects nodes only, by
  centre point, never links. There is no mixed node-and-link selection, and
  links cannot be copied, cut or duplicated on their own.
- No Shift axis lock, Alt-drag copy, edge auto-pan or snap-bypass modifier.
- "Align left" and "Align right" align centres, not edges.
- Stacking keys and menu items act on one node only.
- Grid and snap settings are not remembered across a reload.
- The corner squares on a selected node look like resize handles and are
  not; dragging one deselects.
- In hand mode the status bar still says "tool select".
- Palette search: Enter does not add the top hit; Escape leaves focus in
  the field.
- A plain click on one of several selected nodes does not reduce the
  selection to it. Switching frames resets zoom and pan.
- The link tool ignores press-drag-release and leaves its source armed.
- A selected link's "+" handles float off the route on orthogonal and
  curved links (not re-tested).
- `cycleLinkType` and `cycleLinkStyle` in the editor have no caller.
- The mini style bar covers a selected link's end and port labels. A short
  link's centre label covers both nodes, with no Problems entry.
- The inline label editor always opens below the node and is single-line.
- Wireguard links ignore Color. The zone member picker accepts duplicates.
  "+ zone" with nothing selected adds an invisible zone. A new zone is not
  selected for naming. The anchor tool on a node hides the anchor beneath
  it.
- Measured: nudging with 600 nodes took about 385 ms per key, hover about
  27 ms per move.

**Documents, import and export**

- Open replaces the document with no confirmation (not re-tested; the
  import confirmation was fixed in #314).
- The export and template dropdowns fire on ArrowDown, so a keyboard user
  triggers an export by arrowing through the list (not re-tested).
- No file drop on the window; no paste of Mermaid or draw.io text.
- A duplicated frame is named "Frame N". Filenames drop non-ASCII
  characters. Both PowerPoint exports share a filename. The save chip is
  blank after load. The tab title never changes. Every unreadable file gives
  the same error. "Hold" accepts 1 ms. A non-calm SVG export shows delayed
  particles at (0,0). Mermaid import ignores direction when subgraphs are
  present. Page chips are not focusable.
- A shared copy: New, Open and Template may overwrite the user's own draft
  (code review CODE-10; not confirmed either way after #311).

**Properties, panels and accessibility**

- Custom node types cannot be deleted. Renaming one in the designer creates
  a copy. Escape in the designer discards edits without asking.
- Focus drops to the page body when Properties re-renders (not re-tested).
- "Auto-place labels" exists only in the context menu.
- 93 tab stops in the node library with no way past them. Forced-colours
  mode blanks the colour swatches. Hex inputs are named "auto". The id
  `label-placement-hint` is used twice.
- Contrast, measured: dark muted text 4.32:1, placeholders 2.97:1, light
  accent on white 3.0:1, active toolbar icons 2.30:1, warning amber 2.19:1.
- The Calm default is written to storage on first load, so an operating
  system reduced-motion preference turned on later is ignored.
- No first-run or empty-canvas guidance.
- At 200% browser zoom (720×450) the canvas is about 270×125 px; panels
  collapse by themselves only at 640 px and below.
- On a phone a selected node cannot be dragged by touch, and a long press
  opens no menu (not re-tested after #313).
- Find results have no listbox semantics. The panel resizer is mouse-only.

**Agent tools**

- PNG export checks its size after rendering: 24 devices gave 4.2 MB in
  36 s; 54 devices ran 91 s and then failed the 8 MiB limit. The SDK's
  default request timeout is 60 s. `src/mcp/export-tools.ts:93`.
- Wire sheets: `view: "wiresheet"` followed by `layout_topology` with
  `algorithm: "tiered"` stacks panels on each other; `mirror: true`
  misorders six access switches; `spacing: 220` overflows the sheet.
  `src/api/autolayout.ts:248-430`.
- `build_flow_topology` twice gives two documents; there is no refresh in
  place.
- `assign_interfaces` returns the full list for the dry run and again for
  the apply (not re-tested).
- `get_topology` has no element-level read, and its summary omits page ids.
- `export_flipbook` and `render_svg` have no `outputPath`. Mermaid text is
  duplicated in the structured result. `view_topology` sends the SVG even
  to a client without the inline view.
- `describe_capabilities`: 13.4 KB of node types repeating the same eight
  keys; filters barely shrink it; an unknown type gets no "unknown" note.
- `define_node_type` takes an open `spec` object and stores unknown keys
  (see 6.1).
- CSV import: a `[links]` row naming an undeclared node creates it and
  discards every declared position. `layout_topology hierarchical` on a
  Mermaid or CSV import moved nothing. `src/import/csv.ts:217`.
- Hardware: `bind_hardware` is not batchable; optics cannot be listed;
  `E_PORT_REUSED` names no links; the wire-sheet legend prints an internal
  panel id.
- Small: `share_topology` is named in four descriptions on a server that
  lacks it; eleven different names for an id parameter; three wordings for
  a page out of range; a `blocked` link ignores `label`; the default
  flow-path colour equals the link colour.

**Other code-review items not confirmed fixed**

- Stale problem badges after a page switch.
- Nudge, undo, nudge within 500 ms is not undoable.
- Reported as plausible only: macOS Ctrl+click toggles and then opens the
  menu; undo snapshots copy embedded image data; deleting a stencil has no
  confirmation and no undo.

**Fabric compiler, pinned as "known limits" tests, not fixed**
(`src/connect/compile.test.ts`)

- A flow read without its tunnel records loses its egress hop.
- A partial appliance list shrinks a site zone.
- Every re-read writes seed positions again.
- A restored tunnel keeps the dimmed opacity it had while down.

## Appendix B — July findings with no recorded status

Checked 2026-11-15:

| Id  | Finding                                                | Now                      |
| --- | ------------------------------------------------------ | ------------------------ |
| H3  | Opening a document dropped layers, legend and stencils | Fixed in code            |
| H5  | `update_element` could delete required fields          | Fixed in code            |
| H6  | A failed store write is reported as success            | Open (6.2)               |
| H8  | Custom node spec fields inject markup                  | Partly fixed; open (6.1) |

Not checked:

| Id  | Finding                                                                        |
| --- | ------------------------------------------------------------------------------ |
| M1  | `parseDoc` crashes on plausible input and accepts garbage elements             |
| M2  | `validateDocument` accepts NaN and Infinity coordinates                        |
| M3  | A convergent re-compile mints duplicate policy-marker ids                      |
| M4  | `removeElement` with a duplicated id deletes links of the surviving duplicate  |
| M8  | `parseDoc` blind-casts nodes and links; a malformed entry breaks Open          |
| M11 | `extra` passthrough lets tool input override `id`, `type`, `x`, `y`            |
| M12 | `share_topology`: unbounded, unmetered KV writes with no snapshot size cap     |
| M13 | Imports bypass the per-field validation the add tools enforce                  |
| M16 | `worker/` has no test coverage                                                 |
| M17 | The inspector writes an element's type into HTML unescaped                     |
| M21 | The `worker/` directory is excluded from the test run                          |
| M22 | The hosted agent's Durable Object path is untested                             |
| M23 | `parseDoc` casts element arrays with no per-element validation                 |
| M27 | A failed engine load leaves a dead app with no message                         |
| L3  | The Vite and Vitest config is cast `as never`                                  |
| L5  | Unauthenticated dynamic client registration; no rate limiting on write paths   |
| L6  | Cookie attribute injection through an unencoded `go` in the OAuth state cookie |
| L7  | Share and surface-inventory tests assert stubs, not production behaviour       |

Inferred from the titles and not verified: #311 probably covers M1, M2, M8,
M13, M17 and M23; the rate limits of PR #239 probably address part of M12
and L5; Miniflare suites added since July probably address M16 and M21.

## Appendix C — Pull requests and merge commits

| PR   | Merge commit on `main` | Released to production                     |
| ---- | ---------------------- | ------------------------------------------ |
| #311 | `af4e352`              | Yes; release finished 2026-11-14 15:58Z    |
| #312 | none of its own        | Carried by #314                            |
| #313 | none of its own        | Carried by #314                            |
| #314 | `b7234f2`              | Yes; deployed 2026-11-14 17:47Z            |
| #315 | `cdb059a`              | With #318 (its own release was superseded) |
| #316 | `607a895`              | With #318                                  |
| #317 | `04f0162`              | With #318                                  |
| #318 | `78ca2dc`              | Yes; deployed 2026-11-14 17:59Z            |
| #319 | `916fb14`              | Docs only; no release by design            |
