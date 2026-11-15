# Topology Dojo — Production Readiness Review (Findings Register)

_Adversarial agentic review, 2026-07-04. 51 findings confirmed by independent verification agents (2 candidate findings refuted and dropped)._

**Original confirmed set:** 4 critical · 9 high · 29 medium · 9 low.

This is an immutable record of the 2026-07-04 review, not a live defect
dashboard. Closure notes do not rewrite the original problem statements. The
2026-07-19 reconciliation closed C1–C4, H7, M14, M18, M19, and L1. A second
code audit on 2026-08-09 verified the additional status changes below; use the
living QA/UAT plans and capability matrix for release decisions.

| Finding(s) | Status at 2026-08-09        | Evidence                                                                                                                                                                          |
| ---------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1, M5     | Closed                      | Attachment-safe layout and overlap-safe balance: `aa4e88c`, `7e3f8ed`; API regression suites                                                                                      |
| H2         | Closed                      | Shared links use an isolated autosave slot with keep/back behavior: `21eb53f`, `659cc6e`; Playwright share test                                                                   |
| H4, H9     | Closed                      | Autosave reports success/failure and offers JSON recovery: `21eb53f`, `659cc6e`; persistence tests                                                                                |
| M6, M9     | Closed                      | Dependent flow paths, hops, link ids, and markers are cleaned during removal/import self-heal: `5dcee18`; cascade tests                                                           |
| M7, M28    | Closed                      | Complete per-page snapshots/history and recoverable frame deletion: `5dcee18`; unit + Playwright frame tests                                                                      |
| M10        | Closed                      | Export backdrop honors non-zero viewBox origins: `090ae86`; unit + Playwright export test                                                                                         |
| M24        | Closed as originally stated | Editor interaction/gesture regression suites now cover the formerly untested core paths                                                                                           |
| M25        | Substantially addressed     | Playwright covers editor, autosave, share-copy, file-driven fixtures, history, overlay, export, and responsive glue; real Worker/OAuth paths remain separate integration/UAT work |
| M26        | Closed                      | Three CI-rendered Chromium visual baselines plus failure artifacts: `bd1f0aa`, `0d98fe3`                                                                                          |
| M29        | Closed                      | Shared overlay focus trap/restore and shortcut suppression: `7c596b7`; unit + Playwright coverage                                                                                 |
| L2         | Partially addressed         | CI declares `permissions: contents: read`; tag pinning and dependency-update/audit automation remain open                                                                         |
| L4         | Closed                      | Strict browser-response CSP and security headers are enforced by the Worker and covered by tests                                                                                  |
| L8         | Closed                      | Format painter is surfaced outside the context menu and is keyboard reachable: `7c596b7`                                                                                          |
| L9         | Substantially addressed     | Accessible names, visible focus behavior, overlay focus management, and reduced-motion handling are implemented; full assistive-technology UAT remains required                   |

See [`../DISCREPANCY_REGISTER.md`](../DISCREPANCY_REGISTER.md) for the
documentation reconciliation history.

## Current audit observations (not part of the original 51)

| ID                    | Status | Observation                                                                                                                                                                      | Required disposition                                                                                                                       |
| --------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| QA-2026-08-09-ZONE-01 | Open   | The generic zone-member picker can surface anchors, but the document contract and renderer treat zone membership as node-only. Selecting an anchor creates a validation problem. | Restrict the picker to nodes and add a mounted-browser regression, or record an explicit release waiver. QA case EDT-02 owns verification. |

The User Guide tells users not to select anchors as zone members until this is
resolved. This observation is a current QA finding and does not alter the
historical July finding count above.

### November 2026 review: observations left open

A second review ran on 2026-11-14 against `501e7a4`: four browser QA passes,
an MCP acceptance pass, a code review, and a comparison with other diagram
tools. What it found and fixed is recorded as test cases in the
[QA test plan](./QA_TEST_PLAN.md) §7.9–§7.14, with the evidence for each.

The rows below are what it found and did **not** fix. Each was reproduced at
`501e7a4`. None was re-tested after the fixes, so a row may have been
improved in passing; none was targeted.

| ID                    | Status | Observation                                                                                                                                                                                               | Suggested disposition                                                                            |
| --------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| QA-2026-11-14-UI-01   | Open   | The toolbar is wider than the window below about 1,850 px: at 1,440 px its content was 1,846 px in 1,406 px of room, so the right-hand controls are reached by scrolling the bar sideways.                | Group the export, template and arrange actions into menus, or an overflow menu.                  |
| QA-2026-11-14-UI-02   | Open   | Document- and page-level edits are outside undo: title, page name, legend, sheet, layers, brand palette, custom node types, stencil delete, and adding, duplicating or reordering frames.                 | Decide which belong in history; frame operations are the ones users expect to undo.              |
| QA-2026-11-14-UI-03   | Open   | Reference fields take internal ids typed by hand: an element's layer, a marker's node and flow path, a zone's parent zone, a callout's target.                                                            | Draw them as pickers listing the page's elements by label.                                       |
| QA-2026-11-14-UI-04   | Open   | With several nodes selected, Properties offers Format and (for two nodes) Path, but no shared fields: colour, layer and status cannot be set on a multi-selection there.                                  | Show the fields the selection has in common.                                                     |
| QA-2026-11-14-A11Y-01 | Open   | Canvas elements cannot be reached or selected from the keyboard, links cannot be created without a pointer, and the context menu has no keyboard trigger (Shift+F10 or the Menu key).                     | A keyboard path to select and act on elements; owned by the accessibility cases in QA plan §8.2. |
| QA-2026-11-14-A11Y-02 | Open   | Toggle buttons (tool, grid, snap, calm, badges) expose no pressed state and panel toggles no expanded state; several text and icon colours measured below 4.5:1 (muted text 4.32:1, placeholders 2.97:1). | Add `aria-pressed` / `aria-expanded`; adjust the muted and placeholder tokens.                   |
| QA-2026-11-14-CAN-01  | Open   | Flow paths and policy markers cannot be selected on the canvas, only from the Properties list. Dragging a zone does not move its members.                                                                 | Hit-test flows and markers; treat a zone drag as a move of its members.                          |
| QA-2026-11-14-CAN-02  | Open   | A 2,000-node document took 7.6 s to add one node. The cause was not profiled.                                                                                                                             | Profile first (QA plan §8.3), then decide.                                                       |
| QA-2026-11-14-DOC-01  | Open   | Changing the sheet size overwrites every frame's canvas size, with nothing to put the old sizes back.                                                                                                     | Apply to the current frame, or make it one undoable step.                                        |
| QA-2026-11-14-DOC-02  | Open   | Present mode does not fill the screen.                                                                                                                                                                    | Size the stage to the viewport.                                                                  |
| QA-2026-11-14-DOC-03  | Open   | The SD-WAN wizard's Cancel confirmation discards the choices made, and its preview counts the first page only.                                                                                            | Keep the choices on a declined cancel; count every page.                                         |
| QA-2026-11-14-MCP-01  | Open   | Server-side PNG and PDF draw emoji marker icons as empty boxes (the embedded font has no emoji). Arrows and the deny, redirect and NAT icons were fixed.                                                  | Draw marker icons as paths rather than text.                                                     |
| QA-2026-11-14-MCP-02  | Open   | `export_topology` PNG has no size check before rendering; there is no element-level read, so an agent fetches a whole page to inspect one element; a compiled flow cannot be refreshed in place.          | Separate follow-ups; none blocks authoring.                                                      |
| QA-2026-11-14-MCP-03  | Open   | `analyze_path` is refused on a shared workspace even with `show: none`, because admission is by tool name and the tool can write.                                                                         | Admit by arguments, or split the read from the write.                                            |
| QA-2026-11-14-RND-01  | Open   | `inspect_render` measures an overlay-cloud hub as 40×40 where it is drawn about 124×68, so overlaps with the cloud go unreported.                                                                         | Give the type a hit box that matches its art.                                                    |
| QA-2026-11-14-WHL-01  | Open   | The mouse-or-trackpad guess behind the wheel's Auto setting was not run on physical devices.                                                                                                              | QA case EDT-39: a real trackpad and a real mouse on macOS and Windows.                           |

### Security audit 2026-11-15: findings

A read-only security audit ran on 2026-11-15 against `916fb14` (`main`;
production serves `78ca2dc`, which differs only in `docs/`). It is the
independent audit asked for in the pre-audit handoff note of 2026-11-15
(not in the repository at this commit; "handoff" below refers to it).
Nothing was fixed, no product file was changed, and nothing was run against
production, an Orchestrator or any external host. Line numbers refer to
`916fb14`.

How each row is known:

- **Confirmed (lead)**: reproduced by the lead auditor with a throw-away
  probe, or read in code by the lead where the path is unambiguous.
- **Confirmed (pass)**: reproduced by one of five delegated audit passes
  (workspace and share authorisation; markup sinks; import and export; agent
  tools; dependencies and CI) with a probe that was then deleted. The lead
  did not re-run it.
- **Inferred**: reasoned from code, not exercised.

Probes ran in Node, Miniflare and Chromium. None ran in the real Workers
runtime, in a real MCP host, or in draw.io, Office or a Mermaid renderer, so
platform limits and the behaviour of consuming applications are inferred
throughout. The probe scripts were not kept in the repository; each
reproduction below is complete enough to rebuild.

#### Summary

| ID          | Sev    | Layer               | Finding                                                                                              | Known            |
| ----------- | ------ | ------------------- | ---------------------------------------------------------------------------------------------------- | ---------------- |
| SEC-1115-01 | High   | Auth                | Any registered MCP client can obtain a grant for a user with one click; no consent step              | Confirmed (lead) |
| SEC-1115-02 | High   | Parse gate, render  | Custom node spec fields inject markup; script runs in SVG and flipbook exports (extends handoff 6.1) | Confirmed (pass) |
| SEC-1115-03 | High   | Render              | A custom type named after a built-in changes how later, unrelated documents render                   | Confirmed (lead) |
| SEC-1115-04 | Medium | Persistence         | Legacy drafts are keyed by GitHub login and copied to whoever holds that login now                   | Confirmed (pass) |
| SEC-1115-05 | Medium | Agent tools         | The MCP Apps viewer's SVG cleaner can be bypassed to run script on click                             | Confirmed (pass) |
| SEC-1115-06 | Medium | Agent tools (stdio) | `export_topology outputPath` overwrites any file under the export root, with shell-active content    | Confirmed (pass) |
| SEC-1115-07 | Medium | Persistence         | One oversize document stops later documents being stored; no size or count caps (extends H6)         | Confirmed (pass) |
| SEC-1115-08 | Medium | Sharing             | Browser share publish has no quota and no size cap (M12 half fixed)                                  | Confirmed (pass) |
| SEC-1115-09 | Medium | Workspace           | Per-user workspace storage is unbounded and there is no delete route                                 | Confirmed (pass) |
| SEC-1115-10 | Medium | Export              | Raster, PDF and embedded-image exports can exceed the memory budget                                  | Confirmed (pass) |
| SEC-1115-11 | Medium | Import              | Hostile files hang or exhaust the importer (regex backtracking, unbounded inflate)                   | Confirmed (lead) |
| SEC-1115-12 | Medium | CI/CD               | The migration gate reads `wrangler.jsonc` only; wrangler prefers other config files                  | Confirmed (pass) |
| SEC-1115-13 | Medium | CI/CD               | `main` reports as unprotected                                                                        | Inferred         |
| SEC-1115-14 | Medium | CI/CD               | Staging deploys run an arbitrary ref's code beside the Cloudflare token                              | Inferred         |
| SEC-1115-15 | Medium | App shell           | Returning to the app after viewing a share link aborts start-up                                      | Confirmed (pass) |
| SEC-1115-16 | Medium | Dependencies        | Unbounded array validation in the MCP SDK and zod; the fix needs a major `agents` upgrade            | Inferred         |
| SEC-1115-17 | Low    | Auth                | Cookie-authenticated mutations rely on `SameSite=Lax` alone                                          | Confirmed (pass) |
| SEC-1115-18 | Low    | Auth                | Session and cookie handling: no revocation, attribute injection (L6), 500 on a malformed cookie      | Confirmed (lead) |
| SEC-1115-19 | Low    | Agent tools         | `extra` overrides typed fields and skips write checks (M11 still present)                            | Confirmed (pass) |
| SEC-1115-20 | Low    | Agent tools         | The MCP session object is named from a client header and not bound to the user                       | Inferred         |
| SEC-1115-21 | Low    | Agent tools         | Layout tools have no element cap                                                                     | Confirmed (pass) |
| SEC-1115-22 | Low    | Agent tools         | An `edit_topology` operation can carry its own `topologyId`                                          | Confirmed (pass) |
| SEC-1115-23 | Low    | Sharing             | The public snapshot rate limiter is bypassable and writes to KV per request                          | Confirmed (pass) |
| SEC-1115-24 | Low    | Headers             | CSP has no `form-action`; no HSTS; provider responses carry no security headers                      | Confirmed (pass) |
| SEC-1115-25 | Low    | Export              | draw.io and Mermaid writers: malformed XML, style-key injection, unescaped tooltip and labels        | Confirmed (pass) |
| SEC-1115-26 | Low    | Import              | MCP legacy-studio import stores a document without `parseDoc` (M13 residual)                         | Confirmed (pass) |
| SEC-1115-27 | Low    | Live data           | EdgeConnect client: no timeout, redirects followed, `https` not enforced, `..` in `applianceId`      | Inferred         |
| SEC-1115-28 | Low    | Workspace           | A large checkpoint restore cannot complete; raw storage errors are returned to clients               | Confirmed (pass) |
| SEC-1115-29 | Low    | CI/CD               | Actions pinned by tag (L2), no dependency automation, `.gitignore` misses local secret files         | Confirmed (pass) |
| SEC-1115-30 | Low    | Persistence         | Concurrent agent sessions are last-writer-wins on whole documents                                    | Confirmed (pass) |
| SEC-1115-31 | Info   | Various             | Smaller observations                                                                                 | Mixed            |

#### High

**SEC-1115-01. Any registered MCP client can obtain a grant for a user with one click.**

- **Layer / location:** Auth. `worker/default-handler.ts:481-497` (`handleAuthorize`), `:500-558` (`handleCallback`), `worker/index.ts:55-61`.
- **Problem:** `/register` accepts anonymous dynamic client registration with any `redirect_uri`. `/authorize` sends the browser straight to GitHub with no consent screen of its own. `/callback` takes `state` as `atob` + `JSON.parse` with nothing binding it to the browser that started the flow, and calls `completeAuthorization` for whatever client the state names. An attacker registers a client that redirects to their own host and sends a signed-in user the `/authorize` link; the authorization code is delivered to the attacker, who redeems it for an access token and a 30-day refresh token carrying the victim's `props`. This is the confused-deputy case the MCP authorization specification requires per-client consent for.
- **Known:** Confirmed (lead) in Miniflare with the real `OAuthProvider` and `defaultHandler`; only the two GitHub calls were stubbed. Register → `/authorize` (302 to GitHub, no cookie set) → `/callback?code=…&state=<state>` (302 to the attacker's URI with `code`) → `/token` (200, access and refresh token) → `/mcp` saw the victim's `props`. A state forged without calling `/authorize`, with `codeChallengeMethod: "plain"`, was accepted too. Not tested: whether GitHub skips its own prompt for a user who has already authorised the app (believed so for OAuth Apps; if it prompts, the prompt names the legitimate app).
- **Impact:** the victim's hosted agent identity: drafts, workspaces through agent tools, share publish and revoke, profile reads; the connected fabric if `LIVE_DATA_ENABLED` is ever turned on. There is no grant list or revoke surface, so a victim cannot undo it.
- **Fix:** show a consent page naming the client and its redirect host before going to GitHub, and remember approval per user and client; bind the upstream `state` to the browser (random value in an `HttpOnly` cookie, or a signed state checked on return) and keep the auth request server-side in KV under that key; consider `allowPlainPKCE: false`; add a list-and-revoke page for grants (`listUserGrants` / `revokeGrant`).
- **Fix touches:** `worker/default-handler.ts`, `worker/index.ts`, a new page beside `worker/api-keys-page.ts`, `src/testing/default-handler.test.ts`, the smoke script's OAuth checks, `src/mcp/README.md`. Existing grants issued before the fix stay valid unless revoked.

**SEC-1115-02. Custom node spec fields inject markup; script runs in exports.** Extends handoff 6.1 and July H8.

- **Layer / location:** Parse gate and render. Gap: `src/pages/persist.ts:177-191` (`sanitizeCustomNode`). Sinks: `src/nodes/render.ts:49` (`strokeW`, every shape), `src/nodes/data.ts:244,253,265` and `shapeGeom` (`size` for circle, any unknown `shape`, triangle, diamond, cross, arrow; `radius` for square, rectangle, chassis), `src/nodes/designer.ts:139-141,153,164` (`size`, `strokeW`, `radius`, `ledCount`, `portCount` into `innerHTML` when "Edit type" is opened), loops at `src/nodes/render.ts:75-97,117-131` (`ledCount`, `portCount` unbounded).
- **Known:** Confirmed (pass). Matrix of every field × 13 shapes × string and array payloads through `parseDoc` and the real engine; then Chromium against a build served with the production CSP header.
- **In the app, under the production CSP:** inline handlers and `<script>` were blocked. Not blocked: `<foreignObject><meta http-equiv="refresh" content="0;url=…">` navigated the tab to another origin on opening `/v/<id>` with no click; `<style>` restyled the whole app (a full-page fake "session expired" overlay); `<form action="http://other-origin">` submitted off-origin; `<img src="/logout">` signed the viewer out. `ledCount: 3e7` froze the tab for about 11 s.
- **In exports:** the toolbar SVG download and the flipbook HTML export of such a document, opened from `file://`, ran the injected `<script>`.
- **Not injectable:** `shape`, `patternType`, `ledPos`, `portPos`, `icon`, `badgeText`, booleans, the four colours, `typeName`.
- **Reproduce:** the handoff's 6.1 test with `strokeW: '1"/><script>alert(1)</script><g x="'`.
- **Fix:** rebuild the spec from an allowlist in `sanitizeCustomNode`: finite numbers clamped to the designer's ranges, enums from their lists, real booleans, bounded `badgeText`, unknown keys dropped. Also coerce with `Number()` at the sinks and escape in `designer.ts`.
- **Fix touches:** the designer save path (`src/main.ts:4189`), `src/api/builder.ts:204`, the `define_node_type` tool, and `src/server/untrusted.test.ts`, which needs a `customNodes` axis. Stored documents with out-of-range specs will be normalised on load. Do it before or with SEC-1115-15.

**SEC-1115-03. A custom type named after a built-in changes how later, unrelated documents render.**

- **Layer / location:** Render. `src/render/core.ts:125-136,155`; `src/main.ts:174,1034,4192`; registry at `public/vendor/topology-ds.js:1230`. Name check missing in `src/pages/persist.ts` (`safeType` accepts `router`) and `src/api/validate.ts:62-66`; only the designer UI refuses built-in names (`src/ui/custom-type-name.ts`).
- **Problem:** rendering a document registers its custom types in the engine's static `NODE_TYPES` and nothing removes or restores them. A document may name a custom type `router`.
- **Known:** Confirmed (lead) in the Node render path: render a benign document with one router; render a second document with `customNodes: [{ …defaultSpec(), typeName: 'router', strokeW: <payload> }]` and no router node; render the first again. Its output now contains the payload. Confirmed (pass) in Chromium: open a share link whose document declares such types, click "back to my document", and the user's own untouched document draws attacker markup and its SVG export runs script from `file://`, until reload. Inferred: the Worker uses the same core (`worker/render.ts:23`), so within one isolate one user's render would change other users' `render_svg`, export and `view_topology` output until the isolate recycles. Not exercised in workerd.
- **Impact:** with SEC-1115-02 unfixed, markup in other users' server-side renders. With it fixed, an attacker can still replace how built-in types are drawn for everyone sharing the process.
- **Fix:** refuse custom names that collide with built-in and stock types in `parseDoc` and `validateDocument`; scope registration to one render (snapshot and restore, or a per-call type map); unregister the previous document's types in `loadDoc`.
- **Fix touches:** `src/render/core.ts`, `src/render/hit-boxes.ts` (same global shape), `src/main.ts` `loadDoc`, SHA-pinned render tests if registration order changes output, and any stored document that already shadows a built-in.

#### Medium

**SEC-1115-04. Legacy drafts are keyed by GitHub login.**

- **Layer / location:** Persistence. `src/mcp/registry-address.ts:73-110`; `worker/workspaces.ts:174-183,460-462,494-507`; `worker/admin-api.ts:107-111`.
- **Problem:** every sign-in and every agent session copies `tdoc:` drafts from the registry named `user:<login>` into the caller's uid registry. The legacy registry has no owner stamp and is kept indefinitely. Logins are reusable on GitHub.
- **Known:** Confirmed (pass) in Miniflare: a session for uid 999 with login `alice` listed and read a draft seeded under `user:alice` by uid 1. The copy code was read by the lead. Whether such drafts exist in production is unknown.
- **Fix:** stamp the legacy registry with the first uid that pulls it and refuse others; or run a one-off migration from the analytics roster, then delete the legacy keys and the code.
- **Fix touches:** `worker/registry.ts` (new RPC), `registry-address.ts`, `workspaces.ts`, `worker/mcp.ts`, the migration and registry-address tests.

**SEC-1115-05. The MCP Apps viewer's SVG cleaner can be bypassed.**

- **Layer / location:** Agent tools. `src/mcp/viewer-html.ts:133-149`.
- **Problem:** the cleaner removes `script`, `foreignObject`, `on*` attributes and hrefs beginning `javascript:`. It keeps `<a href="java&#9;script:…">`, `<a><set attributeName="href" to="javascript:…"/>`, `<a><animate attributeName="href" values="javascript:…"/>` and `<style>`.
- **Known:** Confirmed (pass): the function, extracted verbatim, ran script on click in Chromium for all three. It needs a markup injection to reach it (SEC-1115-02 or -03). Inferred: script in the viewer can send `tools/call` to the host. Host behaviour was not tested and decides the severity.
- **Fix:** an element and attribute allowlist (`src/catalog/sanitize-svg.ts` is suitable), or draw the SVG through `<img>`.
- **Fix touches:** the viewer's click and zoom behaviour if it moves to `<img>`.

**SEC-1115-06. stdio `export_topology outputPath` overwrites any file under the export root.**

- **Layer / location:** Agent tools (stdio). `src/server/export-file.ts:25-47`; `src/mcp/server.ts:46-52`; `src/mcp/export-tools.ts:198-206`; `src/export/mermaid.ts:53-60`.
- **Problem:** confinement to the working directory works (`../`, absolute paths and a linked parent are refused). Inside it there is no extension check and no overwrite protection, dot-paths are allowed, parent directories are created, and a symlink as the final component is followed. Mermaid output keeps `$()` and backticks from labels.
- **Known:** Confirmed (pass), twice independently, using only agent tools: a Mermaid export over an executable `build.sh` and over `.husky/pre-commit`; running either executed the label's payload. Writes to `.git/hooks/pre-commit` and `.bashrc` succeeded; a final-component symlink was followed out of the root. The guard code was read by the lead.
- **Prerequisite:** an agent steered by hostile content (an imported file is enough; see SEC-1115-31) on a developer machine, and the host approving the call.
- **Fix:** require the extension to match the format; refuse dot-segments; open with `wx` or require an explicit overwrite flag; `lstat` the target; default the root to a dedicated exports directory.
- **Fix touches:** `export-tools.ts` error text only (no schema bytes), the stdio README, `export-file` tests.

**SEC-1115-07. One oversize document stops later documents being stored.** Extends handoff 6.2 and July H6.

- **Layer / location:** Persistence. `src/mcp/persist-store.ts:94-98`; `worker/mcp.ts:227-237`; `worker/registry.ts:66-68`; `src/pages/persist.ts:306`.
- **Problem:** the persist loop stops at the first `put` that throws, and `persistAfter` swallows the error. Every document after it in the same session is never stored while each call returns success. There is no size cap per document and no cap on documents or bytes per user; `extra`, `update_element.set` and `define_node_type.spec` accept unbounded strings.
- **Known:** Confirmed (pass) against a fake store with a 2 MiB value limit: twelve `edit_topology` calls grew a document to 2.5 MB, the write threw, and a document created afterwards was not stored. Inferred: the 2 MiB figure for the real store, and that a user with tens of MiB of drafts would fail rehydrate and see an empty store.
- **Fix:** a byte cap per document with the error returned to the caller; a per-user quota in `TopologyRegistry.put`; one `try` per document; persist failure surfaced in the tool result (owner decision in handoff section 8).
- **Fix touches:** the tool contract for every mutating tool (result text, not schema bytes), QA case MCP-07.

**SEC-1115-08. Browser share publish has no quota and no size cap.** July M12 is half fixed.

- **Layer / location:** Sharing. `worker/default-handler.ts:452-472`; `worker/share.ts:34,110-128`; `src/share/snapshot.ts:50-60`.
- **Known:** Confirmed (pass) in Miniflare: 55 consecutive `POST /api/share` returned 201 and a 9.9 MB snapshot was stored and served publicly. The agent tool is metered (`worker/mcp.ts:251-257`); the browser route is not. After 50 shares the oldest leave the owner's list but stay public, so they cannot be found to revoke.
- **Fix:** move the quota and a byte cap into `publishSnapshot`; refuse at the list cap or delete the evicted snapshot.
- **Fix touches:** `share.ts`, error mapping (429, 413), the Share dialog, `share-api.test.ts`.

**SEC-1115-09. Per-user workspace storage is unbounded and there is no delete route.**

- **Layer / location:** Workspace. `worker/workspace-api.ts:26-36,61-64`; `worker/workspaces.ts:185-196`; `worker/document.ts:434-466,1374-1387`; `worker/registry.ts` (`markWorkspace`).
- **Known:** Confirmed (pass): 150 creates in a loop and one 18 MB, 12-page create all returned 201. The request body is read unbounded; only a per-page 1.8 MiB check exists. Sign-in is open to any GitHub account. Users cannot remove a workspace.
- **Fix:** a per-owner workspace cap and creation quota in the registry object; page-count and total-byte caps; a body cap; a DELETE route.
- **Fix touches:** `registry.ts`, `document.ts`, `workspace-api.ts`, the workspace panel.

**SEC-1115-10. Raster, PDF and embedded-image exports can exceed the memory budget.**

- **Layer / location:** Export. `src/export/raster.ts:118-135,174-184`; `src/export/print.ts:150-183`; `src/export/pdf.ts`; `src/mcp/export-tools.ts:93-99,370-374`; `src/api/layout.ts:287-305`; `src/api/text.ts:80`.
- **Problem:** the scale is floored at 0.25, so a large page `viewBox` exceeds `maxPixels`; `viewBox` has no upper bound; the 8 MiB output check runs after rendering; PDF export holds every page's bitmap; an embedded image is decoded at full size with no dimension or length limit.
- **Known:** Confirmed (pass) in Node: `viewBox: 0 0 60000 60000` gave a 225-megapixel render at 1.8 GiB resident; a six-page 600 dpi PDF reached 670 MiB; a 42 KB data URI decoding to 16000×16000 drove a 2100×1400 export to 1.36 GiB. Inferred: the effect in a 128 MB Worker isolate.
- **Fix:** drop the floor and refuse when the budget cannot be met; cap `viewBox`; release PDF bitmaps page by page; read image header dimensions and reject oversized ones; cap `imageHref` length.
- **Fix touches:** `exportPng`, `exportPdf`, PowerPoint image mode, `parseViewBox`; closes QA-2026-11-14-MCP-02's size-check part.

**SEC-1115-11. Hostile files hang or exhaust the importer.**

- **Layer / location:** Import. `src/import/drawio.ts:67-75` (`detectDrawio`), `:114-127` (inflate), `:136` (`htmlToText`); `src/import/mermaid.ts:116-117,214-217`. Callers: `src/import/open.ts:60`, `src/mcp/tools.ts:857`.
- **Known:** Confirmed (lead) for `detectDrawio`: `'<!---->'.repeat(n) + '<x'` took 106 ms at n=24 and 401 ms at n=26 (184 bytes), about four times per two comments; the 2,048-character window allows n≈290. It runs on any non-JSON file opened in the app and on `import_topology`. Confirmed (pass): a 349 KB compressed draw.io diagram inflated to 256 MiB before the size check rejected it; the Mermaid edge and subgraph regexes are cubic (a 1,600-space line took 493 ms); `htmlToText` is quadratic.
- **Fix:** scan the prolog linearly; use streaming inflate with an output ceiling; cap line and label length before the regexes.
- **Fix touches:** importer tests only.

**SEC-1115-12. The migration gate reads `wrangler.jsonc` only.**

- **Layer / location:** CI/CD. `.github/workflows/release.yml:310-342`; `.github/workflows/deploy-worker.yml:98-141`; `scripts/migration-guard.mjs`; `scripts/check-wrangler-env.mjs`.
- **Problem:** both guards read the literal file. wrangler resolves `wrangler.json` before `wrangler.jsonc`, and a `.wrangler/deploy/config.json` redirect before either. A commit adding one is classified routine while the deploy applies different migrations, bindings or vars, with no `apply_migration_tag`. The guard scripts also run from the candidate commit.
- **Known:** Confirmed (pass) in wrangler's source (`node_modules/wrangler/wrangler-dist/cli.js:2958`); not run end to end.
- **Fix:** pass `--config wrangler.jsonc` to `wrangler deploy` and `wrangler rollback`; fail CI when the other files exist; run the guard scripts from `main` with the candidate's config as data.
- **Fix touches:** both workflows and the tests for both scripts.

**SEC-1115-13. `main` reports as unprotected.**

- **Layer / location:** CI/CD. `.github/workflows/ci.yml:6` claims branch protection; `docs/DEPLOYMENT_RUNBOOK.md` invariant 4 depends on it.
- **Known:** Inferred. The branches API returns `protected: false` for `main`. Rulesets and environment settings could not be read, so a ruleset may still apply. If it is accurate, a direct push to `main` is an unattended production release with no review. There is no `CODEOWNERS`.
- **Fix:** confirm in repository settings; require pull requests and the CI checks; add `CODEOWNERS` for `.github/`, `scripts/` and `wrangler.jsonc`.

**SEC-1115-14. Staging deploys run an arbitrary ref's code beside the Cloudflare token.**

- **Layer / location:** CI/CD. `.github/workflows/deploy-staging.yml:21-29,104-114`; `.github/workflows/deploy-worker.yml:89-141`.
- **Known:** Inferred. The chosen ref controls the build, the env check and the wrangler config in the job that holds `CLOUDFLARE_API_TOKEN`. If staging and production share one Cloudflare account, a ref could name the production Worker. The token's scope is not readable from the repository.
- **Fix:** a separate account or token for staging, or restrict the staging environment to protected branches; assert the Worker name in the workflow, not in ref-controlled code.

**SEC-1115-15. Returning to the app after viewing a share link aborts start-up.**

- **Layer / location:** App shell. `src/main.ts:1200-1201` reaches `invalidatePreview()` before `const previewCache` at `src/main.ts:4209` is initialised.
- **Known:** Confirmed (pass) in Chromium: after opening any share link, including a benign one, every load of `/` throws a `ReferenceError`; the palette, inspector and filmstrip are empty until "back to my document" and a reload. Cause read from source.
- **Order matters:** this failure is the only thing stopping a hostile shared copy being drawn again on every visit to `/`. Fix SEC-1115-02 first or together.
- **Fix:** hoist `previewCache` or defer the resume.

**SEC-1115-16. Unbounded array validation in the MCP SDK and zod.** Triage for handoff 6.4.

- **Layer / location:** Dependencies. `@modelcontextprotocol/sdk` 1.29.0 (GHSA-46jr-4wx8-v453), `zod` 4.4.3 (GHSA-mrhx-c7xc-m3w5). Unbounded arrays at `src/mcp/tools.ts:1693,1742,2929`, `src/mcp/path-tools.ts:123`. The transport's 4 MiB check trusts `Content-Length` (`node_modules/agents/dist/mcp/index.js:88`).
- **Known:** Inferred from code; not exercised. Of the 26 production advisories this is the only one with a reachable path. The rest are in packages that are in no shipped bundle (express, proxy-addr, body-parser, qs, hono, ip-address and others), or are shipped but not reached with attacker input: `dompurify` is loaded only by `jsPDF.html()`, which is never called (`src/editor/export.ts:212-238`); `fast-uri` and `nanoid` receive no attacker input; the SDK's task, OAuth-client and bearer-middleware advisories concern code paths the Worker does not use. Dev-only advisories (two more critical: `vitest`, `tinypool`) need attacker-controlled options and do not touch build or deploy integrity.
- **Fix:** add `.max()` to the four arrays now; set `maxToolInputElements` once on SDK 1.32. `agents@0.14.5` pins the SDK at exactly 1.29.0, so that needs `agents` 0.33.0, a semver-major upgrade (owner decision in handoff section 8). Enforce a streamed body cap ahead of `mcp.fetch` in `worker/index.ts:47-54`.
- **Correction to the handoff's framing:** there is no npm-published package (`"private": true`; `server.json` lists the remote only). The stdio server runs from a clone.

#### Low

**SEC-1115-17. Cookie-authenticated mutations rely on `SameSite=Lax` alone.** `worker/auth.ts:80-85`; `worker/workspace-api.ts:26-36,47-53,202-207`; `worker/default-handler.ts:432-475`; `worker/profile-api.ts`. No route checks `Origin` or the content type, cookies have no `__Host-` prefix, and the WebSocket upgrade has no origin check. Confirmed (pass): with `Origin: https://evil.harnessed.cloud` and `content-type: text/plain`, workspace create, share publish and a workspace operation all succeeded. Sibling hosts under `harnessed.cloud` are therefore inside the trust boundary. Fix: one check in `route()` for non-GET requests and upgrades; `__Host-` cookies. Touches worker tests that post without an `Origin`.

**SEC-1115-18. Session and cookie handling.** Confirmed (lead). (a) Sessions are stateless seven-day cookies; `/logout` clears the cookie but the token stays valid, and nothing can revoke one (`src/server/session.ts`, `worker/auth.ts:203-211`). (b) July L6 is open: `go` is written into the state cookie unencoded, so `/auth/github?go=/a;Domain=evil.example;SameSite=None` adds attributes (`worker/auth.ts:110`); the value is a nonce the attacker does not know, so impact is small. (c) `Cookie: x=%` makes `/api/me` return 500, because `parseCookies` calls `decodeURIComponent` unguarded (`src/server/session.ts`). (d) `/logout` is a state-changing GET (`worker/default-handler.ts:582`). (e) The session key falls back to `GITHUB_CLIENT_SECRET` when `SESSION_HMAC_SECRET` is unset; which applies in production is not readable from the repository. Fix: encode `go`; guard the decode; POST logout; a session epoch per user if revocation is wanted.

**SEC-1115-19. `extra` overrides typed fields.** July M11 is still present. `src/mcp/tools.ts:1467,1663`; `src/mcp/write-checks.ts:115-128`. Confirmed (pass): `extra: {id, type, x, y}` created a duplicate id, an unknown type and non-numeric coordinates. The server renderer escaped all of it. Fix: strip those keys from `extra` or spread it first. No schema bytes.

**SEC-1115-20. The MCP session object is not bound to the user.** `node_modules/agents/dist/mcp/index.js:99,165` names the object `streamable-http:<mcp-session-id header>` (read by the lead); `worker/mcp.ts` never compares the caller with the stored `props`. Inferred: a second authenticated user who learns a live 256-bit session id would run tools as the first user, and a scoped API key would inherit an unscoped session's tool set. No leak of the id was found. Fix: refuse in `TopologyMcp` when the stored user id differs from the incoming one.

**SEC-1115-21. Layout tools have no element cap.** `src/api/tidy.ts:153`. Confirmed (pass): 2,000 nodes on one point made `tidy_topology` take 123 s and force layout 134 s, synchronously. Fix: cap nodes and links per page in the add and edit paths. Related to QA-2026-11-14-CAN-02.

**SEC-1115-22. An `edit_topology` operation can carry its own `topologyId`.** `src/mcp/tools.ts:2566-2573`; `worker/mcp.ts:265` checks only the outer id. Confirmed (pass): an operation wrote to a second document and kept the write when the batch on the first rolled back. No durable bypass of the workspace pipeline was found. Fix: one line, put `topologyId: tid` after the spread.

**SEC-1115-23. The public snapshot rate limiter.** `worker/default-handler.ts:314-352,362`; `src/mcp/rate-limit.ts:245-262`. Confirmed (pass): rotating addresses within one IPv6 /64 never reached the limit; each fresh address causes a KV write; the counter falls back to a client-supplied `X-Forwarded-For`; an id of 600 characters returns 500. Share ids are 48 random bits, so enumeration stays impractical. Fix: key on the /64, drop the fallback, validate the id as 12 hex characters before KV.

**SEC-1115-24. Response headers.** `worker/default-handler.ts:270-296`. The CSP has no `form-action` (used in SEC-1115-02); there is no HSTS or `Permissions-Policy`; `/mcp`, `/token` and `/register` responses come from the provider and carry none of the headers. Confirmed (pass) by reading.

**SEC-1115-25. draw.io and Mermaid writers.** `src/export/drawio.ts:39-47,120-124,176-205`; `src/export/mermaid.ts:53-60,197`. Confirmed (pass): `meta` keys such as `dojoType` or `xmlns` and characters such as U+FFFE or a control character in an id produce XML that `xmllint` rejects; an `imageHref` of `data:image/png;base64,AAAA;link=…;shape=…` adds style keys to the cell; the tooltip is not HTML-escaped; Mermaid labels keep `<…>` and `%%{init}%%`. What draw.io and Mermaid do with these is inferred. Visio, PowerPoint, the cable schedule and the flipbook shell were sound.

**SEC-1115-26. MCP legacy-studio import skips `parseDoc`.** July M13 residual. `src/mcp/tools.ts:907-913`. Confirmed (pass): hostile colours and a control character were stored verbatim; the engine escaped them at render. Also `gated()` in `src/import/open.ts:26-33` returns the unvalidated document if `parseDoc` returns null (not reachable today). Fix: route through `store.import`; fail closed.

**SEC-1115-27. EdgeConnect client.** Code review only; `LIVE_DATA_ENABLED` is off and no Orchestrator was contacted. `src/connect/edgeconnect.ts:46-47,197-203`. The client issues six GET paths and no writes; the base URL and key come from the environment only and the key appears in no output or error. Gaps before any live use: no request timeout; redirects are followed, so `X-AUTH-TOKEN` could be sent to another origin; `https` is not enforced on `ORCH_BASE_URL`; `applianceId: ".."` normalises to a different path; flow fan-out has no concurrency cap; `LIVE_DATA_GITHUB_IDS` unset means every signed-in user (documented). Fix: `redirect: 'error'`, `AbortSignal.timeout`, validate `applianceId`, require `https`.

**SEC-1115-28. Checkpoint restore and error text.** `worker/document.ts:1035-1050`; `worker/workspace-api.ts:210-214`; `worker/profile-api.ts:129-133`; `worker/admin-api.ts:158-161`. Confirmed (pass): restoring a checkpoint whose difference exceeds the store's value limit returns 400 with the raw `SQLITE_TOOBIG` text; the transaction rolls back, so nothing is corrupted, but the checkpoint cannot be restored. Storage and runtime messages are returned to clients generally.

**SEC-1115-29. CI hygiene.** July L2 is open: all six workflows pin first-party actions by tag, two of them in the job that holds the Cloudflare token. There is no Dependabot, Renovate or `npm audit` step. `.gitignore` has no `.dev.vars`, `.env` or `.wrangler/` entry (nothing of the kind is committed). Confirmed (pass).

**SEC-1115-30. Concurrent agent sessions.** `src/mcp/persist-store.ts`; `src/mcp/store.ts:14-17`. Confirmed (pass): two sessions editing one draft are last-writer-wins on the whole document, and a delete in one followed by an edit in the other brings the document back. Inferred: ids of the form `t<ms><counter>` can collide across isolates. By design today; a version stamp in the registry `put` would close it.

**SEC-1115-31. Smaller observations (Info).**

- Tool results echo document strings unmarked, and `view_topology` places the title and layer names inside a server-written sentence (`src/mcp/export-tools.ts:475-479`). This is the entry point for SEC-1115-06.
- `logoUrl` has no scheme check (`public/vendor/topology-ds.js:3324`) and `https` images are allowed by design, so an exported SVG can carry a remote image.
- `A["#9999999;"]` in Mermaid throws a `RangeError` out of `classifyOpenedFile`, which is documented never to throw (`src/import/mermaid.ts:83-89`).
- A change of more than 250 operations is committed as independent, individually validated revisions; a closed tab leaves a valid but partial revision (handoff lead 7: validation holds, atomicity does not).
- `src/render-svg/render.ts` interpolates ids and colours unescaped but has no importer.
- `reference/legacy-studio.zip` carries an unrelated repository with a third-party tenant slug and a placeholder bearer; no real credential was found.
- The production build is rebuilt per environment, not promoted, and dependency install scripts run in the job that holds the Cloudflare token.

#### Status of earlier findings touched by this audit

| Earlier finding                     | Status at `916fb14`                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| H6 (failed store write)             | Open, and wider than recorded: SEC-1115-07                                               |
| H8 / handoff 6.1 (custom node spec) | Open, complete field list and impact in SEC-1115-02                                      |
| M11 (`extra` overrides)             | Open: SEC-1115-19                                                                        |
| M12 (share writes)                  | Agent tool metered; browser route unmetered; no size cap: SEC-1115-08                    |
| M13 (imports bypass validation)     | Fixed for draw.io, Mermaid, CSV and the browser; open for MCP legacy import: SEC-1115-26 |
| M16 / M21 (`worker/` untested)      | Addressed: Miniflare suites under `src/testing/` drive the real Worker handlers          |
| M17 (inspector type unescaped)      | Not reproduced: the inspector builders escape document strings                           |
| L2 (actions by tag)                 | Open: SEC-1115-29                                                                        |
| L5 (open client registration)       | Open, and exploitable: SEC-1115-01                                                       |
| L6 (cookie attribute injection)     | Open: SEC-1115-18                                                                        |
| Handoff 6.4 (dependency advisories) | Triaged: SEC-1115-16                                                                     |
| Handoff lead 13 (failed rehydrate)  | Sound: a session that starts empty cannot delete or overwrite stored documents           |

M1, M2, M3, M4, M8, M22, M23, M27, L3 and L7 were not checked.

#### Checked and found sound

- **Sessions and API keys:** HMAC-SHA256 session cookies; `safePath` on the post-login redirect; the browser login's state nonce. API keys: 256-bit secrets stored hashed, constant-time comparison, a strict per-owner cap, revoke that never confirms another owner's key id, fail-closed on the flag, scopes applied at tool registration.
- **Workspace isolation:** the object name is `document:<session uid>:<id>` and every call re-checks the owner (`worker/document.ts:182-184`). The uid comes from the signed cookie or the grant, never from input. Workspaces are single-owner: there are no collaborator, viewer or invite roles, so handoff lead 4 reduces to what the owner's own agent can commit, and that is held by leases checked in the object. Agents cannot grant leases, accept proposals or restore.
- **`parseDoc` at the storage boundary:** initialise, every commit, load, checkpoint load and restore, legacy migration, fork and share publish. No path stores a workspace document without it.
- **Admin and diagnostics:** fail-closed on the flag, the session and the numeric id. Analytics stores identity, timestamps and tool names only. Staging fault injection is inert without the staging variable and a token.
- **Agent tools:** per-user keying from the grant only; no tool argument selects another user's registry, profile, workspace or share. Admission by name holds for all ten operations-only tools. Unknown arguments are refused. No prototype pollution through arguments, ids, CSV headers or attribute names. Generator and template counts are clamped.
- **Markup:** the engine entry (`_safeCfg`) and every TypeScript overlay (sheet, title block, caption, legend, port pills, port table, problem badges) escape document strings. Element links are `http(s)` only. The inspector, share dialog, workspace, profile and admin panels escape what they show. The share view writes to its own autosave slot and does not touch the viewer's draft (CODE-10).
- **Exports and imports:** Visio and PowerPoint XML were well-formed under hostile input; zip entry names never come from document values; external relationships are `http(s)` hyperlinks only; the cable schedule guards formula cells; the rasterizer fetches nothing; the XML importer rejects DTDs and caps size and depth.
- **CI:** no `pull_request_target` or similar triggers; inputs reach shells through `env:` and are validated; releases are restricted to `main`; no secret in the tree or the visible history; no source maps or secret names in the browser bundle.

#### Not covered

- The real Workers runtime: value-size, CPU and memory limits, and whether one isolate serves several users' renders (decides SEC-1115-03's reach).
- A real MCP host's sandbox for the viewer (decides SEC-1115-05's severity).
- GitHub's prompt behaviour for an already-authorised user (SEC-1115-01), branch rulesets, environment policies, the Cloudflare token's scope, and whether `SESSION_HMAC_SECRET` is set.
- Git history beyond the 227 commits in the audit's shallow clone.
- Firefox and Safari; touch.
- The editor state machine (`src/editor/editor.ts`), the fabric compiler and `worker/profile.ts` beyond its ownership checks, as security surfaces. Handoff leads 5, 6, 8, 9 and 10 are correctness and performance questions and were not audited.
- draw.io, Office and Mermaid behaviour on the files in SEC-1115-25.

## CRITICAL (4)

### C1. Malformed page viewBox turns every node coordinate into NaN in tidy/layout/balance — persisted data destruction

- **Area:** Headless API | **Location:** `src/api/layout.ts:229` | **Type:** data-corruption
- **Problem:** parseViewBox uses `?? ` against Number() results, but NaN is not nullish, so a malformed viewBox yields NaN width/height. tidyPage's clampNode then computes a NaN fallback center and assigns it to every node; Math.round(NaN) is NaN. Reproduced: create page with viewBox '0 0 800px 600px' (accepted verbatim by the MCP tools set_page_properties/add_page, which take z.string() with no format check, and by parseDoc on import), add two nodes, call tidy_topology → all node x/y become NaN. The mutation is in place and persistAfter writes it to Durable Object storage, so the user's hand-placed coordinates are irrecoverably destroyed. Neither validateDocument nor analyzeLayout ever inspects viewBox, and NaN coordinates pass validation (see separate finding), so nothing flags the corruption. A '0 0 0 0' viewBox similarly piles all nodes at (0,0).
- **Fix:** Make parseViewBox reject non-finite/non-positive width/height (fall back to defaults per component: `Number.isFinite(p[2]) && p[2] > 0 ? p[2] : 1050`). Additionally validate the viewBox format in set_page_properties/add_page (regex or 4-finite-numbers parse) and flag malformed viewBox in validateDocument.
- **Status (2026-07-19): Closed.** Fixed in commit `a958bce` (2026-07-04).
  `parseViewBox` (`src/api/layout.ts:227-245`) now guards every component
  with `Number.isFinite`/positivity checks and falls back to safe defaults;
  `isValidViewBox` backs a hard validation error in `validateDocument`
  (`src/api/validate.ts:95-99`). This closure was verified directly in code
  during the 2026-07-19 documentation audit; the fix predates the audit by
  two weeks but was never annotated here.

### C2. Stored XSS: node/link `type` rendered unescaped into the inspector

- **Area:** Editor & Client | **Location:** `src/main.ts:1010` | **Type:** security
- **Problem:** typeRow() interpolates the selected element's `type` string into inspector HTML with no escaping (every other interpolation site uses esc(), this one does not). `node.type` is attacker-controlled: parseDoc() blind-casts page.nodes (src/pages/persist.ts:95 `nodes: Array.isArray(p.nodes) ? (p.nodes as Page['nodes']) : []`) so a crafted document loaded via a /v/<id> share link (published by anyone through the MCP share_topology tool), an opened JSON file, or a poisoned localStorage doc carries an arbitrary `type`. When the user clicks that node, renderInspector() does `inspector.innerHTML = html` with typeRow(node.type, ...) inside, and a payload such as type = '"><img src=x onerror=alert(document.cookie)>' executes in the OAuth-gated app origin (session cookies, /api/\* access). Same hole for link.type at line 1356.
- **Fix:** Escape `t` with esc() in both the value attribute and option text (and audit annoFieldControl enum options similarly). Better: have parseDoc validate node/link `type` against an id-safe pattern (e.g. /^[\w:-]+$/) so hostile strings never enter the model.
- **Status (2026-07-19): Closed.** Fixed in commit `a958bce` (2026-07-04).
  `typeRow()` (`src/main.ts`) now escapes with `esc()`; `parseDoc`
  additionally sanitizes element `type`/custom-node `typeName` on the way in
  (`src/pages/persist.ts`, `safeType`). A strict Content-Security-Policy
  (`script-src 'self'`, no inline handlers) was added to every browser-facing
  worker response as defense in depth. Verified directly in code during the
  2026-07-19 documentation audit.

### C3. persistStore deletes every stored topology after any rehydrate failure — total session data loss

- **Area:** MCP Server | **Location:** `src/mcp/persist-store.ts:47` | **Type:** data-loss
- **Problem:** persistStore treats the in-memory registry as the source of truth and deletes any DO-storage key whose id is not currently in memory. In worker/mcp.ts, rehydrate() catches ALL errors and 'starts empty' (lines 82-89), and rehydrateStore silently skips any doc for which parseDoc returns null. So: DO hibernates -> cold start -> storage.list() has a transient error OR one stored doc fails/throws in parseDoc -> registry is empty -> the agent's next successful mutating call (e.g. create_topology, which an agent will naturally issue when it finds its topology 'unknown') runs persistStore, which permanently DELETES every tdoc: key. A single corrupted document (see the update_element finding — trivially producible via tool input) aborts the whole rehydrate loop because parseDoc's zone self-heal throws, converting one bad doc into loss of ALL of the session's topologies. There is no distinction between 'doc was removed by delete_topology' and 'doc failed to load'.
- **Fix:** Track deletions explicitly (delete the key inside store.remove / a tombstone set) instead of mirroring by set-difference; never delete keys that failed to load. If rehydrate fails, either fail tool registration or mark the store degraded and skip the delete pass in persistStore. In rehydrateStore, wrap parseDoc per-document so one corrupt doc cannot abort loading the rest, and keep (not skip) unparseable payloads under their key.
- **Status (2026-07-19): Closed.** Fixed in commit `a958bce` (2026-07-04).
  `src/mcp/persist-store.ts` no longer mirrors deletions by set-difference —
  verified directly in code during the 2026-07-19 documentation audit.

### C4. Stored XSS in shared topologies via unvalidated element color fields

- **Area:** Injection & Rendering | **Location:** `src/pages/persist.ts:95` | **Type:** xss
- **Problem:** Any authenticated GitHub user can publish a topology through the share_topology MCP tool; the snapshot is stored verbatim in KV and served publicly at /v/<id> (worker/default-handler.ts serveSnapshot, no auth). When a victim opens /v/<id>, main.ts fetches the JSON and runs it through parseDoc, which passes node/link/zone/marker/layer arrays straight through with `p.nodes as Page['nodes']` — it validates ids and enums but NEVER validates the `color` fields. Those colors are interpolated raw (no \_esc) into SVG attribute values by the vendored engine, then injected into the live DOM via `svg.innerHTML` in renderPageInto. A node color of `#000"/><image href=x onerror=alert(document.domain)/><rect fill="` breaks out of the `stroke="..."`/`fill="..."` attribute and injects an <image onerror> that executes on render (innerHTML-inserted SVG event handlers fire even though <script> would not). There is NO Content-Security-Policy header anywhere in the worker, so nothing blocks it. Result: attacker-published document → victim opens shared link → JS runs on the app origin, able to read the victim's saved documents in localStorage and act inside their authenticated editor session.
- **Fix:** Validate every color-typed field on import (reuse the existing hexColor() gate in persist.ts that already guards the palette) and drop/normalize anything that isn't a strict `#rgb`/`#rrggbb` (or a small allowlist of named tokens). Defense in depth: escape color values at the render sinks and add a strict CSP (script-src 'self'; no inline handlers) on all worker responses.
- **Status (2026-07-19): Closed.** Fixed in commit `a958bce` (2026-07-04).
  `parseDoc` (`src/pages/persist.ts`) now sanitizes every color-typed field
  via `safeColor`/`scrubColors`/`sanitizeElements` (strict hex/rgb(a)/hsl(a)/
  keyword, drop-or-fallback otherwise); the same commit added a strict CSP to
  every browser-facing worker response. Verified directly in code during the
  2026-07-19 documentation audit.

## HIGH (9)

### H1. layout_topology strands anchors and manual link waypoints — links route across the canvas to stale positions

- **Area:** Headless API | **Location:** `src/api/autolayout.ts:350` | **Type:** correctness
- **Problem:** tidy.ts's carryAttachments exists precisely because (its own comment) 'a pass that shifts nodes leaves ports detached and routes bending back through stale waypoints — stray lines across the canvas'. But layoutPage never carries attachments for the algorithm's wholesale node movement: it only calls tidyPage as a finisher, whose carryAttachments uses positions captured after the algorithm already ran, so it compensates only for the small tidy delta. Reproduced: page with node a(100,600), anchor 'port1'(108,592) used as a link endpoint, and a link with manual waypoint (500,620); after layoutPage(hierarchical/LR) the nodes move to (479,350)/(571,350) while the anchor stays at (108,592) and the waypoint at (500,620) — the anchor-endpointed link now spans the page detached from any node. Any MCP agent following the documented flow (add elements → layout_topology) on a page with anchors or waypoints produces a visually broken diagram.
- **Fix:** Capture orig node positions at the top of layoutPage and call carryAttachments(page, orig) after the algorithm (before/instead of relying on tidyPage's internal call), mirroring what tidyPage/balancePage already do.

### H2. Opening a share link silently destroys the user's locally autosaved document

- **Area:** Editor & Client | **Location:** `src/main.ts:311` | **Type:** data-loss
- **Problem:** Visiting /v/<id> fetches the shared snapshot and calls loadDoc(parsed), which ends in markDirty(); 400ms later saveLocal(doc) overwrites the single localStorage slot ('topology-dojo:doc') that held the user's own work. There is no confirmation, no backup slot, and history.replaceState drops the /v/ path so the overwrite is permanent. Scenario: a user with hours of un-downloaded work clicks a colleague's share link (e.g. from Slack) in the same browser — their document is irreversibly replaced by the shared one. The fetch is also unawaited relative to boot: the app becomes interactive on the localStorage doc first, then loadDoc clobbers whatever the user started editing mid-flight.
- **Fix:** Before adopting a shared doc, either prompt when the local doc is non-trivial, or preserve the existing doc under a backup key / multi-document store. At minimum, do not autosave a share-link doc over the local one until the user makes an edit after an explicit 'keep this' choice.

### H3. loadDoc drops layers/legend/stencils from the incoming document and leaks the previous document's values

- **Area:** Editor & Client | **Location:** `src/main.ts:289` | **Type:** state-management
- **Problem:** loadDoc() assigns only title, pages, customNodes and palette; doc.layers, doc.legend, and doc.stencils are neither copied from `next` nor cleared. Two concrete failures: (1) Open a saved JSON (or a /v/ share link) that contains layers/legend/stencils — they are silently discarded even though parseDoc parsed them, so a document with a legend or layer visibility settings loads without them; the debounced autosave then persists the truncated doc, making the loss permanent. (2) Click 'new' after working in a doc with stencils/layers — the old stencils and layers survive into the supposedly blank document and get merged into it on the next save (cross-document contamination). The only assignments to doc.layers/legend/stencils elsewhere are UI mutations (lines 1254, 1318, 1904), never a load path.
- **Fix:** In loadDoc, assign (or delete) every TopologyDocument field: doc.layers = next.layers; doc.legend = next.legend; doc.stencils = next.stencils — then rebuild the palette and re-render. Add a round-trip test: loadDoc(parseDoc(serializeDoc(d))) must equal d.

### H4. Autosave failure is swallowed and the UI still shows '✓ saved' (silent data loss on quota exceeded)

- **Area:** Editor & Client | **Location:** `src/pages/persist.ts:176` | **Type:** persistence
- **Problem:** saveLocal() catches QuotaExceededError (and any storage failure) and returns as if nothing happened; markDirty() in src/main.ts:212-219 then unconditionally sets savedEl.textContent = '✓ saved'. localStorage is the ONLY persistence in this app (no server save), so a document that grows past the ~5MB quota (many pages, large customNodes/stencils), or a browser in a storage-restricted mode, means every subsequent edit is lost on tab close while the user is actively told their work is saved. There is no retry, no warning, and no prompt to download.
- **Fix:** Make saveLocal return a boolean (or throw) and have markDirty display a persistent 'not saved — download your work' state on failure, ideally with a one-click JSON download. Consider IndexedDB for headroom.

### H5. update_element null-patch can delete required fields (zone.nodes), producing stored docs that crash parseDoc on rehydrate

- **Area:** MCP Server | **Location:** `src/api/edit.ts:100` | **Type:** input-validation
- **Problem:** updateElement's patch semantics delete any key set to null and accept arbitrary unknown values (the MCP tool's `set` is z.record(z.string(), z.unknown())). Calling update_element with { elementId: <zoneId>, set: { nodes: null } } (or nodes: "x") deletes/corrupts the zone's required nodes array. The mutation succeeds, persistAfter serializes it to DO storage, and on the next cold start parseDoc's zone self-heal loop (src/pages/persist.ts lines 111-116: `if (z.nodes.some(...))`) throws TypeError on the missing array — which, combined with the persistStore mirror-delete, wipes the whole session's storage. Even ignoring the wipe, a flowPath patched with { waypoints: null } makes remove_element (cascade) and render throw on that doc from then on. Bad tool input becomes permanent document/state corruption rather than a rejected call.
- **Fix:** Guard structurally required fields in updateElement (id is already protected; also protect nodes/waypoints/from/to/type/x/y from null-deletion or wrong types, per element kind). Defensively normalize zone.nodes (z.nodes ?? []) and other arrays in parseDoc so a malformed stored doc degrades instead of throwing.

### H6. Silent persistence failure for large documents: persistAfter swallows storage.put errors, so 'successful' topologies vanish on hibernation

- **Area:** MCP Server | **Location:** `worker/mcp.ts:101` | **Type:** data-loss
- **Problem:** persistStore writes each document as ONE storage value (storage.put(DOC_PREFIX+id, serializeDoc(doc))). Durable Object KV values are hard-capped (2 MB for SQLite-backed classes, which wrangler.jsonc configures via new_sqlite_classes), and serializeDoc pretty-prints with 2-space indentation, inflating size substantially. There is no size limit on import_topology (json: z.union([z.string(), z.record(...)]) — unbounded), on node meta maps, labels, or custom node specs, so a document can exceed the cap easily (a compiled fabric with per-flow hop data, or any import of a few MB). When put throws, persistAfter catches and only logs — the tool call returns success, the agent keeps editing, and after the DO hibernates the topology is gone or stale ('unknown topology'). This is silent, size-triggered data loss. Aggravating: persistStore rewrites EVERY document on EVERY mutating call (sequential awaited puts), so one oversized doc also fails persistence attempts triggered by edits to other docs after the delete pass has already run.
- **Fix:** Surface persistence failure to the caller (return isError so the agent knows the write is not durable), enforce a documented max document size at import/mutation time, serialize compactly (no pretty-print), and persist only the mutated document (chunk or move to R2/KV if docs can legitimately exceed the DO value cap).

### H7. Production deploy is not gated on CI: Workers Builds auto-deploys every push to main regardless of test results

- **Status (2026-07-19): Closed.** The CI-gated Actions deploy path exists —
  `deploy-production.yml` re-runs `ci.yml` (via `workflow_call` / `needs:
check`), requires the `production` GitHub environment approval, and is
  restricted to `main` with the CI `check` as a required status (Packet D5,
  PR #150; environments + branch protection, operator O5/O6). It was exercised
  end to end on staging by
  [Deploy Staging run #4](https://github.com/robertsonc/topology-dojo/actions/runs/29219841599)
  (SHA `104b4d5`). This finding's own stated closure bar — operator O9
  (disconnect Workers Builds) followed by O10 (first gated production
  deploy) — was met **2026-07-17** (see `docs/HANDOFF.md` operator
  checklist); the register was not updated to reflect that until this pass.
  The gated pipeline is now production's only deploy path; Workers Builds'
  Git integration is disconnected. A Node 22 pin across all workflows (PR
  #155) resolved the CI/deploy toolchain mismatch this finding also flagged.

- **Area:** CI/CD & Release | **Location:** `.github/workflows/ci.yml:8` | **Type:** deploy-pipeline-safety
- **Problem:** The GitHub Actions workflow only runs checks; deployment happens through the Cloudflare Workers Builds Git integration, which triggers on push to main and runs its own build/deploy command ('npx wrangler deploy' per the repo's own docs) in parallel with — and independent of — CI. A commit whose vitest suite or lint fails but which still compiles ships straight to production at 100% traffic (no gradual rollout is possible because the DO migration forbids 'versions upload'). Worse, the artifact that reaches production is not the one CI built: Workers Builds rebuilds under its own default Node version while CI tests on Node 20 (there is no engines field or .nvmrc pinning). Direct pushes to main are clearly anticipated (the workflow has a push: main trigger), so nothing in the repo assumes branch protection either.
- **Fix:** Pick one gated path: either move deploy into GitHub Actions (cloudflare/wrangler-action with a CLOUDFLARE_API_TOKEN secret, in a job with `needs: check`, on push to main only) and disconnect Workers Builds auto-deploy, or set the Workers Builds build command to `npm ci && npm run typecheck && npm test && npm run lint && npm run build` so a red suite fails the deploy. Also add an engines/.nvmrc pin (node 20) so CI and the deploy build use the same toolchain, and enable branch protection requiring the CI check.

### H8. Custom node spec fields inject arbitrary SVG markup (typeName breaks out of <defs>/url())

- **Area:** Injection & Rendering | **Location:** `src/nodes/render.ts:44` | **Type:** xss
- **Problem:** parseDoc accepts `d.customNodes` with zero field validation (`d.customNodes as CustomNodeSpec[]`). renderCustomNode then interpolates several spec fields raw into markup that is registered with the engine and rendered into the DOM on the shared-view path (registerCustomNodes runs for the loaded doc, and any node using the type renders it). `spec.typeName` is placed inside a `<defs>` id and then inside `fill="url(#${pid})"`; a typeName like `x"/><image href=x onerror=alert(1) y="` closes the fill attribute and injects an active element. colorStroke/colorFill/ledColor/badgeColor are likewise interpolated into `stroke=`/`fill=` with no escaping (only badgeText is passed through esc). Same stored-XSS reach as the color finding: attacker defines a malicious custom type via MCP define_node_type, adds a node of that type, publishes, victim views /v/<id>.
- **Fix:** Validate CustomNodeSpec on import: enforce a safe charset for typeName (e.g. `^[A-Za-z0-9_-]+$`), validate all color fields as hex, and constrain enums (shape/pattern/icon/ledPos/portPos). Escape any field that reaches markup.

### H9. Status bar shows '✓ saved' even when autosave silently failed (quota/private mode), and there is no unload flush

- **Area:** UI / UX / A11y | **Location:** `src/main.ts:215` | **Type:** error-feedback
- **Problem:** saveLocal() swallows all localStorage errors, but markDirty() unconditionally reports success after calling it. The document's only persistence is localStorage (there is no server save), so this is a false save indicator over real data loss. Failure scenario: user in Safari private browsing or with a quota-exceeded origin edits for an hour, watches '✓ saved' after every change, closes the tab -> everything is gone. Separately, the save is debounced 400ms and there is no beforeunload handler (grep finds none in src/), so closing the tab immediately after an edit drops the last change even when storage works.
- **Fix:** Make saveLocal return success/failure; on failure show a persistent 'not saved — download your work' warning instead of '✓ saved'. Add a beforeunload/pagehide handler that flushes the pending debounced save.

## MEDIUM (29)

### M1. parseDoc crashes with TypeError on plausible input and silently accepts null/garbage elements that break every later tool

- **Area:** Headless API | **Location:** `src/pages/persist.ts:112` | **Type:** validation-gap
- **Problem:** parseDoc's contract is 'a corrupt or hand-edited file must never crash — falls back to a valid shape or null', but element arrays are cast unchecked (`p.nodes as Page['nodes']`). Two reproduced failures: (1) a zone without a nodes array — {pages:[{zones:[{id:'z1'}]}]} — throws 'Cannot read properties of undefined (reading some)' in the self-heal loop, and a null entry in nodes throws 'Cannot read properties of null (reading id)', so import_topology surfaces a raw TypeError instead of 'invalid topology document JSON'; (2) a null entry in links passes parseDoc, the document is stored and persisted, and then validate_topology throws 'Cannot read properties of null (reading from)' — the tool advertised as the safety net crashes on the very document import accepted, and updateElement/removeElement/render crash the same way. The poisoned document is rehydrated from DO storage on every cold start.
- **Fix:** Normalize element arrays entry-by-entry in parseDoc: keep only object entries with a string id (defaulting zone.nodes to [], flowPath.waypoints to []), drop or reject the rest. At minimum wrap the self-heal loop defensively so parseDoc honors its return-null contract.

### M2. validateDocument accepts NaN/Infinity node coordinates — document validates clean but renders broken SVG

- **Area:** Headless API | **Location:** `src/api/validate.ts:121` | **Type:** validation-gap
- **Problem:** The only coordinate check is `typeof n.x !== 'number'`, and typeof NaN === 'number', so a node with x:NaN or y:Infinity produces zero errors (reproduced: 0 errors for x:NaN). analyzeLayout is also silent because every NaN comparison is false. Such values arrive via import_topology (parseDoc does not check element fields), via update_element set:{x:null} deleting x entirely, or via the viewBox corruption above. The 'valid' document then renders NaN into SVG coordinate attributes headlessly and in the GUI, and hit-testing/layout on it silently misbehaves — exactly the 'validates but crashes the renderer' class. Same gap for opacity (NaN passes the 0..1 range check) and anchor x/y, which are never type-checked at all.
- **Fix:** Use Number.isFinite(n.x) / Number.isFinite(n.y) (and the same for anchors, waypoint points, opacity, padding) so non-finite numerics are validation errors.

### M3. Convergent re-compile mints duplicate policy-marker ids when a flow's steering policy changes

- **Area:** Headless API | **Location:** `src/connect/compile.ts:322` | **Type:** id-collision
- **Problem:** compileFlow's policy marker uses source identity `policy|<policy.id>@<flowKey>` but explicit element id `elId('pm', flowKey)` — the id omits the policy. compileFabric is documented for in-place refresh ('Pass an existing compiled document to refresh it in place'); when the same flow is re-compiled after being steered into a different overlay, the source no longer matches, upsertBySource takes the create path, and addPolicyMarker appends a second marker with the identical id. Reproduced: two markers both id 'pm_A_f1', and validateDocument reports error 'duplicate policy marker id "pm_A_f1"' — the converged document violates the page-unique-id invariant that locate()/updateElement/removeElement rely on (they silently operate on the first match only). Relatedly, because compileFabric/compileFlow always pass `id:` in upsert props, converging onto an element that carries the same source but a different id (e.g. authored by hand or renamed) throws 'element id cannot be changed' (reproduced), aborting the refresh.
- **Fix:** Either include policy.id in the marker's element id, or (better) key the marker source by flowKey alone so a policy change updates the existing marker. In upsertBySource, ignore a props.id that differs from the matched element's id on the update path instead of throwing (or strip id before update in compile).

### M4. removeElement with an id that exists twice cascades-deletes links belonging to the surviving duplicate

- **Area:** Headless API | **Location:** `src/api/edit.ts:150` | **Type:** correctness
- **Problem:** None of the add\* builders (addNode/addLink/addZone/... and their MCP tools, which accept explicit nodeId/linkId/etc.) reject an id that already exists on the page — the uniqueness invariant edit.ts documents ('validate enforces this') is only checked by the optional validate_topology tool. locate() returns the first match, so with two nodes sharing id 'a': update_element patches only the first, and remove_element removes the first but its cascade prunes ALL links whose from/to === 'a', all markers with nodeId 'a', all zone memberships and flow-path waypoints 'a' — i.e. the edges of the still-present second node are silently destroyed along with the first node. An agent that reuses an id (a common LLM failure mode the API should be defensive about) gets no error at creation time and corrupted, partially-deleted topology later.
- **Fix:** Reject duplicate explicit ids at add time (throw 'id already exists on this page' in addNode/addLink/addAnchor/addZone/addFlowPath/addPolicyMarker), which makes the cascade's by-id pruning sound.

### M5. balancePage's greedy axis clustering collapses transitively-close columns into coincident nodes, after the last de-overlap pass

- **Area:** Headless API | **Location:** `src/api/tidy.ts:174` | **Type:** layout
- **Problem:** alignAxis merges a cluster as long as each consecutive sorted gap is <= tol (default 26px), so a chain of nodes each 26px apart on x — but far apart on y, hence untouched by tidy — all snap to one mean x. Two nodes that share a row then become exactly coincident. Reproduced: nodes a(200,100), b1(226,300), b2(252,500), c(278,100) → after balancePage all four at x=239, with a and c both at (239,100) — perfectly overlapping. balanceDocument/balance_topology runs tidyPage BEFORE balancePage and never re-separates after, and the tool is documented as the terminal 'run it last' pass, so the overlap ships in the final document (the returned 'after' warning count is the only hint).
- **Fix:** Bound cluster spread (merge only while value - clusterStart <= tol), or run a tidy de-overlap pass after balancePage in balanceDocument/balanceLayout.

### M6. removeElement cascade leaves dangling flow-path hop refs and hop linkIds

- **Area:** Headless API | **Location:** `src/api/edit.ts:160` | **Type:** correctness
- **Problem:** The cascade prunes a flow path's waypoints when their endpoint is removed, but never touches the path's hops array: a hop whose ref was the pruned waypoint remains, and removing a link leaves hops[].linkId pointing at the deleted link (hops are only cleaned for markers via flowPathId, not inside surviving paths). Reproduced: flowPath waypoints ['a','b','c'] with hops [{ref:'b',linkId:'lab'},{ref:'c'}]; removeElement('b') leaves waypoints ['a','c'] but hops still [{ref:'b',linkId:'lab'},...], and validate permanently reports 'hop ref "b" is not one of the waypoints' and 'hop linkId references missing link "lab"'. So the documented contract — cascade cleans dependents so validate stays quiet — is broken; an agent following remove_element → validate_topology gets warnings it cannot clear except by hand-editing hops, and renderers consuming per-hop data see stale tunnel/link attribution.
- **Fix:** In the node/anchor branch, filter f.hops to refs still present in f.waypoints; when removing a link (found.kind === 'link'), delete matching hops[].linkId across all flow paths.

### M7. Undo cannot revert emphasis changes: page snapshot omits emphasis/caption, corrupting history

- **Area:** Editor & Client | **Location:** `src/editor/editor.ts:2955` | **Type:** undo-redo
- **Problem:** serialize() (whose comment claims 'drops nothing') omits Page.emphasis, caption, duration and transition, and restore() never touches them. applyEmphasis() (line 1145) DOES call this.snapshot() before mutating page.emphasis, so: user clicks 'Emphasize on this frame' (or toggles an emphasis checkbox in the inspector), then presses Ctrl+Z — the undo entry pops but the emphasis/dimming stays exactly as it was; pressing undo again reverts the user's PREVIOUS edit instead. Every emphasis toggle pushes an un-revertable junk entry, so undo appears off-by-one/broken in any emphasis workflow, and redo can never restore a cleared emphasis either.
- **Fix:** Include emphasis (and caption/duration/transition if they are ever snapshotted) in serialize() and restore() — restore must also delete the fields when absent in the snapshot. Add a test: emphasize → undo → page.emphasis is back to its prior value.

### M8. parseDoc blind-casts nodes/links; a malformed entry throws, silently breaking Open (unhandled rejection) and discarding the saved doc at boot

- **Area:** Editor & Client | **Location:** `src/pages/persist.ts:95` | **Type:** persistence
- **Problem:** Despite the module's contract ('a corrupt or hand-edited file must never crash the editor'), nodes/links/anchors are cast without per-entry validation. A doc with `"nodes": [null]` or a non-object entry makes parseDoc itself throw at the zone self-heal loop (`pg.nodes.map((n) => n.id)` on null). Consequences: (1) In the file-open handler (src/main.ts:396, an async listener with no try/catch around `parseDoc(await file.text())`), the throw becomes an unhandled promise rejection — the user clicks Open, picks the file, and nothing happens, not even the 'not a valid document' alert. (2) At boot, loadLocal()'s catch returns null and the app silently swaps in sampleDocument(); the first edit then autosaves over the possibly hand-recoverable saved doc. Entries that don't throw (e.g. nodes missing numeric x/y or id) flow straight into the editor as NaN geometry.
- **Fix:** Filter each nodes/links/anchors entry to well-formed objects (string id, finite x/y for nodes, string from/to for links) the way stencils/layers already are, and wrap the fileInput handler body in try/catch so a parse failure always surfaces the existing alert.

### M9. Deleting a node leaves dangling flow-path waypoints and policy markers (error-level problems the UI created itself)

- **Area:** Editor & Client | **Location:** `src/editor/editor.ts:1094` | **Type:** state-management
- **Problem:** deleteSelected() cascades link removal and prunes zone membership, but never touches page.flowPaths[].waypoints or page.policyMarkers[].nodeId. Scenario: user adds a flow path through nodes A→B→C and a policy marker on B, then deletes B — validateDocument immediately reports `waypoint references missing` (warn) and `'nodeId' references missing` (ERROR, src/api/validate.ts:267-268), so the problems panel turns red from a normal delete, exports/MCP validate_topology flag the doc, and the only fix is hand-editing refs in the inspector. parseDoc's load-time self-heal (persist.ts:111-116) also only repairs zones, so these dangling refs persist across save/load forever.
- **Fix:** In the same cascade, filter each flowPath's waypoints to surviving node/anchor ids (dropping paths left with <2 waypoints) and remove policyMarkers whose nodeId was deleted; mirror the same rules in parseDoc's self-heal.

### M10. Export backdrop rect ignores the viewBox origin — broken SVG/PNG exports after 'fit to content'

- **Area:** Editor & Client | **Location:** `src/editor/export.ts:31` | **Type:** export-correctness
- **Problem:** pageToSVG() draws the dark background at x=0,y=0 sized vw×vh, but sets the wrapper's viewBox to page.viewBox — whose origin is routinely non-zero: fitPageToContent() produces `${Math.round(b.x - 48)} ${Math.round(b.y - 48)} …` and growPageToFit()/tidy can yield negative origins (editor.ts:307, 328-332). Scenario: user draws content around x≈500, clicks 'fit to content' (viewBox becomes e.g. '82 40 900 620'), exports PNG — the backdrop rect covers only the region from page coords (0,0) to (900,620), so part of the exported image sits on a transparent/black background and the dark panel is offset from the art. Both the fSvg and fPng toolbar buttons hit this path.
- **Fix:** Parse the full viewBox (x, y, w, h) and emit the rect at the viewBox origin: `<rect x="${vx}" y="${vy}" …/>`. Add a test exporting a page with a non-zero-origin viewBox.

### M11. `extra` passthrough is spread after validated fields, letting tool input override id/type/x/y with arbitrary types and defeating the zod layer

- **Area:** MCP Server | **Location:** `src/mcp/tools.ts:393` | **Type:** input-validation
- **Problem:** register.ts's stated contract is that 'type coercion like Number("abc") -> NaN can't slip through' because args are zod-validated. But add_node and add_link accept extra: z.record(z.string(), z.unknown()) and spread it LAST in the object passed to addNode/addLink, so it silently overrides every validated field: add_node with extra: { x: "NaN", type: 42, id: ["a"] } stores a node whose x is a string, whose type is a number, and whose id is an array. builder.addNode does no validation. The poisoned element then breaks downstream calls on that topology (render_svg/tidy/layout arithmetic on string coordinates; update_element/remove_element cannot address a non-string id because locate() compares e.id === id), and it persists to DO storage and into share snapshots consumed by the browser viewer. upsert_by_source's `set` (z.unknown values, cast unchecked into NodeInput) has the same hole. Errors are per-call so the session survives, but the document is durably corrupted with no in-band repair path except delete/reimport.
- **Fix:** Spread `extra` FIRST and the validated fields last, and strip reserved keys (id, type, x, y, from, to, layer) from extra/set/upsert props. Add minimal type guards in builder/edit for coordinates (finite numbers) and ids (strings).

### M12. share_topology: unbounded, unmetered KV writes with no snapshot size cap, exposed to any GitHub account

- **Area:** MCP Server | **Location:** `worker/mcp.ts:110` | **Type:** resource-exhaustion
- **Problem:** Every share_topology call mints a fresh random id and writes a new KV value with a 30-day TTL — there is no per-user/per-session rate limit, no quota, and no cap on serialized document size (KV rejects only at its own 25 MiB value limit). The OAuth gate in worker/default-handler.ts issues a grant to ANY GitHub account (handleCallback has no allowlist/org check), so anyone with a free GitHub login can drive an agent loop that writes arbitrarily many multi-megabyte public snapshots — KV storage cost, write-op cost, and a public unauthenticated hosting endpoint (/v/:id serves the JSON to anyone). A single misbehaving agent retry-loop also does this accidentally, since the tool description encourages re-running after edits ('a new link' every time).
- **Fix:** Enforce a max serialized snapshot size before the KV put, add a per-session/per-user publish rate limit (the DO is the natural place to count), key snapshots by user for quota/cleanup, and decide explicitly whether any-GitHub-account access is intended for launch.

### M13. import*topology/parseDoc blindly casts element arrays, so imports bypass the per-field validation the add*\* tools enforce

- **Area:** MCP Server | **Location:** `src/pages/persist.ts:95` | **Type:** correctness
- **Problem:** parseDoc validates page-level scalars carefully but casts every element collection with zero shape checking: `nodes: Array.isArray(p.nodes) ? (p.nodes as Page['nodes']) : []` (same for links, anchors, flowPaths, policyMarkers; customNodes at line 117 is also a blind cast). import_topology therefore accepts documents whose nodes lack ids or coordinates, whose links have non-string endpoints, or whose customNodes are arbitrary junk — the exact inputs the add_node/add_link zod shapes reject. The import 'succeeds' and returns an id, and the breakage surfaces later as errors from render_svg/validate_topology/update_element on that topology (e.g. a null entry in nodes makes locate() throw `e.id` on null), which reads to the agent as a broken server rather than a rejected import. This is a semantic divergence between the two ingestion paths of the same tool surface, and it is the path by which malformed structures reach DO storage and share snapshots.
- **Fix:** Validate or normalize each element on import: require an object with a string id (generate one otherwise), coerce/verify required per-kind fields (type/x/y, from/to, waypoints), and drop entries that cannot be normalized — mirroring the self-heal already done for zone membership. Alternatively run validateDocument at import time and reject on structural errors.

### M14. No staging or preview environment; any non-production deploy shares production KV (OAuth tokens, share snapshots) — and PR previews are known-broken anyway

- **Status (2026-07-13): Closed.** Delivered by Packet D1 (PR #149):
  `wrangler.jsonc` now declares an `env.staging` block with its own KV
  namespaces, Durable Object namespaces, GitHub OAuth App/secret, and
  `PUBLIC_BASE_URL`, and a `scripts/check-wrangler-env.mjs` CI guard asserts
  staging and production share no resource ids. The `topology-dojo-staging`
  Worker is deployed and healthy with migrations `v1`–`v3` applied — first
  fully-green gated deploy
  [Deploy Staging run #4](https://github.com/robertsonc/topology-dojo/actions/runs/29219841599)
  (SHA `104b4d5`, smoke 7/7 including sha verification). Non-production Workers
  Builds branch builds are disabled (operator O1), so no non-production deploy
  reads or writes production KV.

- **Area:** CI/CD & Release | **Location:** `wrangler.jsonc:42` | **Type:** environments
- **Problem:** wrangler.jsonc defines a single environment: no [env.staging]/[env.preview] blocks, no preview_id on the KV namespaces, hard-coded production namespace IDs, and one DO binding. Any deploy that isn't production — a Workers Builds PR preview or a developer testing 'wrangler deploy' — would read and write the production OAUTH_KV (live OAuth grants/tokens) and TOPOLOGY_KV (live share links). On top of that, the repo's own docs state that 'wrangler versions upload' — which is what Workers Builds uses for non-production-branch preview builds — fails with error 10211 because of the Durable Object migration, so PR preview deployments cannot work at all. Net effect for launch: there is nowhere to exercise the GitHub OAuth flow, the MCP endpoint, or the DO/KV wiring before it hits production users.
- **Fix:** Add an [env.staging] (or a second Worker) with its own KV namespaces, DO namespace, GitHub OAuth App (distinct callback URL), and PUBLIC_BASE_URL; deploy every merge there first and promote to production after a smoke test. Disable Workers Builds non-production-branch builds explicitly since they are known to fail, or scope them to the staging env.

### M15. No post-deploy smoke test, no alerting, and no rollback procedure — observability:true is the entire ops story

- **Status (2026-07-19): Substantially addressed; open pending two
  human-only actions.** Repo-side coverage is now complete: post-deploy
  smoke (`scripts/smoke.mjs`, every gated deploy, `--sha` assertion) has
  grown to 14 checks including per-flag disabled-contract assertions;
  `GET /healthz` + `GET /readyz` shipped in Packet D3 (PR #148); the nightly
  staging smoke ships with GitHub-issue dedup + recovery closure
  (`nightly-staging-smoke.yml`, PR #189); production is now verified daily
  and on demand with the same issue pattern and deployed-SHA-mismatch
  detection (`production-verify.yml`, initiative O); a full production alert
  matrix + severity model exists ([`../ALERTS.md`](../ALERTS.md)) with
  thresholds labeled approved vs provisional; rollback/forward-recovery
  procedures are migration-agnostic ([`../ROLLBACK.md`](../ROLLBACK.md))
  with per-flag disable/enable tables ([`../GAME_DAY.md`](../GAME_DAY.md));
  and a staging-only, triple-gated synthetic-fault mechanism exists for
  drills (`worker/staging-fault.ts` — CI-excluded from production config,
  production rejection proven by tests). Still **open**, both human-only:
  (1) Cloudflare-side notification policies
  ([`../CLOUDFLARE_OPERATOR_RUNBOOK.md`](../CLOUDFLARE_OPERATOR_RUNBOOK.md),
  packet O1 — note the notification catalog's Workers alert types could not
  be verified from documentation and must be surveyed in the dashboard);
  (2) executing and recording the game day
  ([`../GAME_DAY.md`](../GAME_DAY.md), packet O2). Close this finding only
  when both have dated evidence.

- **Area:** CI/CD & Release | **Location:** `wrangler.jsonc:47` | **Type:** release-verification
- **Problem:** Nothing verifies a deploy after it lands. The whole site — SPA, login gate, share API, and MCP — sits behind one OAuthProvider wrapper in worker/index.ts, so a single bad change (rotated GITHUB_CLIENT_SECRET not updated, KV binding renamed, broken migration) takes down everything at once, and the first signal would be a user report. There is no health endpoint, no post-deploy curl check, no alerting configured (observability only enables logs), and no docs mention rollback anywhere in README/docs/. Rollback is also nontrivial here: `wrangler rollback` cannot cross the Durable Object SQLite migration boundary declared in migrations, so the team needs a written procedure before launch, not during an incident.
- **Fix:** Add a post-deploy smoke step (curl GET /login expect 200, GET /.well-known/oauth-authorization-server expect 200, unauthenticated GET / expect 302 to /login, GET /api/topology/nonexistent expect 404) run from the deploy job or a scheduled workflow; configure a Cloudflare notification/alert on Worker error rate; write a ROLLBACK.md covering `wrangler rollback` and its DO-migration limits.

### M16. worker/ has zero test coverage and is excluded from the vitest include path; no e2e or integration tests in CI

- **Area:** CI/CD & Release | **Location:** `vite.config.ts:55` | **Type:** test-coverage
- **Problem:** Vitest only picks up src/\*_/_.test.ts, so the entire worker/ directory — the OAuth authorize/callback exchange, the web-login vs MCP-client state discrimination (isWebCallback), the document-navigation auth gate, and the public share-snapshot API in worker/default-handler.ts — is exercised by nothing except tsc. These are exactly the security-sensitive, regression-prone paths (the wrangler.jsonc comment even records a past 'sign-out does nothing' bug in this gating logic), and CI would go green on a change that breaks login for every user. @cloudflare/vitest-pool-workers exists precisely for testing Worker fetch handlers against the workerd runtime with mock KV/DO bindings.
- **Fix:** Add worker tests via @cloudflare/vitest-pool-workers (or at minimum unit tests of defaultHandler/auth.ts with stubbed env) covering the auth gate, /callback state branching, and /api/topology method/id handling; wire them into `npm test` so CI runs them, and add one wrangler-dev-based e2e that boots the Worker and hits /login and /api/topology/:id.

### M17. Inspector interpolates element type into innerHTML unescaped (XSS on node selection from a shared doc)

- **Area:** Injection & Rendering | **Location:** `src/main.ts:1015` | **Type:** xss
- **Problem:** parseDoc does not constrain node.type / link.type strings. renderInspector builds the inspector via `inspector.innerHTML = html`, and typeRow() interpolates the raw type string into both an <option> value and its text content without escaping. When a victim who has opened a shared /v/<id> document clicks a node whose type is `</option></select><img src=x onerror=alert(document.domain)>`, the payload is parsed as HTML and executes on the app origin. It is interaction-gated (requires selecting the crafted element) but needs no attacker interaction beyond publishing the document.
- **Fix:** Escape `t` in both the option value and text content (the file already has esc()), and validate node.type/link.type against the known catalog on import.

### M18. Open redirect in the sign-in flow via backslash bypass in safePath()

- **Area:** Worker & Auth Security | **Location:** `worker/auth.ts:39` | **Type:** open-redirect
- **Problem:** safePath() is the only guard on the post-login redirect target (the `go` param), and it only rejects values starting with `//`. A value like `/\evil.com` passes (starts with `/`, not `//`), is stored in the state cookie by startWebLogin, and is emitted verbatim as the Location header by completeWebLogin (`headers.append('location', safePath(go ?? '/'))`, line 147). Browsers normalize backslashes to slashes during URL parsing, so `Location: /\evil.com` resolves to `https://evil.com/`. Confirmed locally: `new URL('/\evil.com','https://topology-dojo.example.com').href` === `https://evil.com/`. An attacker sends a victim `https://topology-dojo.../login?go=/%5Cevil.com`; after a legitimate GitHub sign-in the victim is silently redirected off-site to a phishing/credential-harvesting page that looks like a continuation of the trusted flow.
- **Fix:** Reject any path containing a backslash and require it to start with a single '/'. Prefer resolving against the origin and confirming the result stays same-origin: `const u = new URL(p, origin); return u.origin === origin ? u.pathname + u.search : '/'`. Apply in both startWebLogin and completeWebLogin.
- **Status (2026-07-18): Closed.** `safePath` (`worker/auth.ts`) now resolves `?go=` against a fixed sentinel origin with WHATWG URL parsing and returns `/` for anything that doesn't stay same-origin — closing the backslash bypass along with the `//host`, absolute-URL, and control-char/whitespace variants in a single guard. It is applied at both the entry (`startWebLogin`) and emit (`completeWebLogin`) sites. Regression test: `src/testing/safe-path.test.ts`.

### M19. No account allowlist — any GitHub user worldwide is granted access despite "Authorized GitHub accounts only"

- **Area:** Worker & Auth Security | **Location:** `worker/default-handler.ts:126` | **Type:** authorization
- **Problem:** Both the web login (completeWebLogin) and the MCP OAuth grant (handleCallback) accept ANY GitHub identity — there is no allowlist of permitted user ids/logins anywhere in worker/ or src/server/ (grep for allowlist/authorized/allowed_users returns only the login-page marketing string). handleCallback issues an MCP grant for whoever authenticates (`props: { id: user.id, login: user.login, ... }`) and completeWebLogin signs a session for any GitHub user. Yet the login page asserts `Authorized GitHub accounts only.` (worker/auth.ts:207). Effect: every one of GitHub's ~100M accounts can pass the gate, open the editor, and drive the authenticated MCP server (creating Durable Objects and publishing world-readable KV snapshots on your account's dime). The stated access-control policy is not implemented.
- **Fix:** Add an explicit allowlist (env var of GitHub numeric ids or an org-membership check via the GitHub API) and enforce it in BOTH completeWebLogin and handleCallback before signing a session / calling completeAuthorization; return 403 otherwise. If open signup is actually intended, remove the false "Authorized accounts only" claim.
- **Status (2026-07-18): Closed (open signup confirmed intended).** Operator decision ahead of a public invite: any GitHub account may sign in, so the fix taken is the finding's second branch — the false "Authorized GitHub accounts only." claim on the login page was replaced with accurate wording ("Open to any GitHub account"). No allowlist is implemented, by design; sign-ins are recorded (metadata only) in the owner-analytics roster (migration `v5`), which is the visibility mechanism for who has access. Revisit an allowlist only if abuse or quota pressure appears.

### M20. Published share snapshots are unauthenticated, unrevocable, and hard-cached for 24h

- **Area:** Worker & Auth Security | **Location:** `worker/default-handler.ts:52` | **Type:** data-exposure
- **Problem:** serveSnapshot returns any `doc:<id>` from KV to anyone, with `Cache-Control: public, max-age=86400, immutable`. share_topology (worker/mcp.ts publish) writes the full topology document — internal network node metadata, addresses, zone/policy data — to this public URL keyed by a 12-hex-char id. There is no delete/unpublish endpoint and no auth on read, so once a link is created it cannot be revoked: even after the KV entry is (manually) removed, edge/browser caches serve it for up to 24h due to the immutable directive, and the KV entry itself persists for 30 days regardless. A user who shares by accident, or whose link leaks, has no way to take it down. The immutable+public cache directive on privacy-sensitive, user-generated content is the sharp edge.
- **Fix:** Provide an authenticated unpublish/delete endpoint that removes `doc:<id>`, drop `immutable` (use a short max-age or `private`/`no-store` so revocation is possible), and consider requiring the snapshot to encode ownership so only the publisher can delete. Document the 30-day PII retention.
- **Status (2026-08-17): Closed** (two parallel closures unified at merge). PR #240 landed ownership via snapshot KV **metadata** (`src/share/snapshot.ts`: `revokeShareSnapshot` distinguishes forbidden/not_found, `DELETE /api/topology/:id`, MCP `unpublish_topology`, `Cache-Control: public, max-age=60`, no `immutable`); the gap-closing branch layered a per-owner **listing index** (`worker/share.ts` `shares:<uid>`) powering the browser Share dialog (publish/list/copy/revoke), `POST/GET /api/share`, and MCP `list_shares`. At merge the metadata check stayed authoritative for every revoke path and the index remained listing-only, so a lost index row can never grant or deny revocation. Verified by a Miniflare suite through the real default handler (`src/testing/share-api.test.ts`: publish with metadata + index → list → public serve at max-age=60 without `immutable` → foreign-owner revoke rejected 403 → owner revoke → public 404 → index pruned). Snapshots published before owner metadata existed can be neither listed nor revoked and expire on their original 30-day TTL (documented in the user guide).

### M21. Entire worker/ directory (auth, OAuth callback routing, share API) has zero tests and is excluded by the vitest include glob

- **Area:** Test Coverage | **Location:** `worker/default-handler.ts:158` | **Type:** test-coverage
- **Problem:** No test imports anything from worker/ (grep over src/**/\*.test.ts finds nothing), and vite.config.ts sets include: ['src/**/\*.test.ts'], so even if a worker test were written it would not run. Untested security-relevant logic includes: the dual-purpose /callback dispatch (isWebCallback state-prefix check deciding whether a GitHub redirect issues a browser session cookie or an MCP grant), the web-login state-nonce validation in completeWebLogin (worker/auth.ts:94), the open-redirect guard safePath (worker/auth.ts:39-41), the document-navigation auth gate (isDocumentNavigation + the /v/ shared-view carve-out, default-handler.ts:178-185), and the token-exchange error paths. Only the HMAC cookie primitives in src/server/session.ts are unit tested — the code that decides WHO gets a cookie and WHERE requests are redirected is not. Concrete regression scenario: someone tweaks the WEB_STATE_PREFIX handling or the isSharedView condition; the editor is silently served unauthenticated (or MCP callbacks start minting browser sessions), CI stays green, and it ships.
- **Fix:** Add a worker test suite using @cloudflare/vitest-pool-workers (or at minimum plain vitest unit tests with mocked fetch/env for auth.ts and default-handler.ts, which are already dependency-injectable via Request/env). Priority cases: safePath rejects '//evil' and absolute URLs; /callback with web.-prefixed state never reaches handleCallback and vice versa; nonce mismatch returns 400; unauthenticated document navigation to '/' redirects to /login while '/v/abc' and sub-resource fetches do not; /api/topology/:id rejects non-GET. Widen the vitest include (or add a second project) so worker tests actually execute in CI.

### M22. MCP-over-worker Durable Object path untested: persistence gating (READONLY_TOOLS) and real KV publish never execute under test

- **Area:** Test Coverage | **Location:** `worker/mcp.ts:33` | **Type:** test-coverage
- **Problem:** TopologyMcp (worker/mcp.ts) is the production MCP server, and its three critical behaviors are untested: (1) persistAfter skips persistence for any tool name in the hardcoded READONLY_TOOLS string set — no test asserts this set stays a subset of actual tool names or that every mutating tool triggers a write, so if a tool is renamed (or a new tool's name is accidentally added to the set), mutations silently stop reaching DO storage and topologies vanish on hibernation — the exact data-loss failure the code comment calls the QA 'blocker' (mcp.ts:55-59); (2) publish() — the real shareId generation, KV put with TTL, and PUBLIC_BASE_URL link construction (mcp.ts:106-115) — is bypassed in tests: tools.test.ts:766 injects a stub publishTopology and asserts the stub's own return value, so the KV path has zero coverage; (3) the init/rehydrate ordering with McpAgent hibernation is only simulated via a Map-backed fake in persist-store.test.ts, never against the workerd DO runtime. persist-store.test.ts itself is a good unit test, but everything wiring it into production is uncovered.
- **Fix:** Add a cheap drift-guard unit test: assert every READONLY_TOOLS entry matches a name in createTools() output, and assert specific mutating tools (add_node, update_element, delete_topology, build_flow_topology) are NOT in the set. Add a vitest-pool-workers integration test that drives TopologyMcp end-to-end: create a topology, force a new DO instance, and assert the id still resolves; and one that calls share_topology against a real (miniflare) KV namespace and then GETs /api/topology/:id.

### M23. parseDoc accepts untrusted JSON but element arrays are cast wholesale with no per-element validation, and no test exercises malformed nodes/links

- **Area:** Test Coverage | **Location:** `src/pages/persist.ts:95` | **Type:** test-coverage
- **Problem:** parseDoc is the single validation gate for three untrusted-input paths: user file import (src/main.ts:400), fetched share snapshots from KV (src/main.ts:322), and the remote MCP import_topology tool available to any GitHub-authenticated user (src/mcp/store.ts:38). It carefully validates page-level scalars and palettes, then casts every element list unchecked — a node entry like {"id": 42, "x": "abc"} or a bare string inside the nodes array flows straight into the editor, the renderer, and DO persistence. persist.test.ts only tests missing arrays and page-level corruption ('fills in missing fields defensively'), never malformed element entries, so the gap between the module's stated contract ('a corrupt or hand-edited file must never crash the editor') and its behavior is invisible to CI. Failure scenario: a hand-edited or adversarial share JSON with a non-numeric node x produces NaN geometry — blank canvas or a hit-test/render exception after 'import succeeded', and via import_topology the poisoned doc is persisted to DO storage where it re-breaks every rehydrate.
- **Fix:** Add element-level normalization in parseDoc (drop entries without string id / finite x,y; coerce or drop bad link endpoints) and negative unit tests feeding malformed element entries through all three entry points: parseDoc directly, store.import(), and rehydrateStore with a corrupted stored value. A small property/fuzz test (random JSON mutations must yield null or a document that renderDocumentToSVG can render without throwing) would lock the contract.

### M24. editor.ts — 2,975 lines of interaction logic (undo/redo, drag, marquee, pan/zoom, snapping) with zero tests

- **Area:** Test Coverage | **Location:** `src/editor/editor.ts:97` | **Type:** test-coverage
- **Problem:** The Editor class is the core product surface and the largest file in src/, and it has no test file; only its leaf helpers (geometry.test.ts, clone.test.ts, caption.test.ts, legend.test.ts, stencil.test.ts) are covered. Untested logic includes the JSON-string-based undo/redo stacks with 100-entry cap and coalesced arrow-nudge entries (lines 967-1027, with subtle pop-if-unchanged bookkeeping at lines 259, 275, 290), the DragState multi-select move with snap deltas, marquee selection, waypoint drags, format-painter key lists, and pan/zoom viewBox math. Failure scenario: a refactor of snapshot() or the pop-on-no-change logic silently corrupts history — undo restores a stale page or drops a user's last edit — and nothing in CI notices because no test ever constructs an Editor. Much of this class is pure state-machine logic over Page objects and is unit-testable today without a browser (pointer handlers are thin wrappers over testable methods).
- **Fix:** Extract-and-test or jsdom-test the Editor: unit tests for undo/redo invariants (snapshot → mutate → undo restores byte-identical page; no-op interactions leave history depth unchanged; redo cleared on new edit), selection/marquee set math, and snap-delta computation. Add 2-3 Playwright smoke flows (drop node, drag, undo, reload-from-autosave) as the integration backstop.

### M25. main.ts app shell (share-view loading, file import, autosave boot, auth chip) untested and no e2e harness exists

- **Area:** Test Coverage | **Location:** `src/main.ts:315` | **Type:** test-coverage
- **Problem:** src/main.ts is 2,905 lines wiring every feature together and has no tests: the /v/:id share-view path (fetch /api/topology/:id, parseDoc, fallback when the snapshot 404s after the 30-day KV TTL — the only public-facing feature of the product), the file-import flow at line 400, localStorage autosave/restore boot ordering, and the /api/me login chip (line 2580) with its dev-mode 404 handling. CI (typecheck/vitest-node/lint/build) never loads the SPA in a browser, so a regression anywhere in this glue — e.g. share links rendering a blank editor because the fetch error branch regressed — ships with a green build. Likelihood is high because this file changes with nearly every feature.
- **Fix:** Add a minimal Playwright job to CI against `vite preview` (plus wrangler dev for the share API): (1) app boots and renders the sample document; (2) /v/:id with a seeded snapshot renders read-only; (3) /v/:id with an unknown id shows the fallback rather than a blank page; (4) JSON file import of a valid and an invalid file. Four tests would cover the product's whole public entry surface.

### M26. No rendering snapshot/visual regression coverage; vendored engine integration and the cache-bust plugin are untested

- **Area:** Test Coverage | **Location:** `vite.config.ts:24` | **Type:** test-coverage
- **Problem:** The headless render tests (src/server/render.test.ts, 25 cases) are good behavioral tests but assert substrings of the SVG string in Node — there is no pixel/DOM snapshot baseline, so visual regressions (z-order/layer stacking, marker glyph geometry, theme/palette remapping, CSS animation output) that keep the asserted substrings intact ship silently. The actual browser canvas additionally renders through the vendored engine loaded via raw `<script src="/vendor/…">` tags, whose freshness depends entirely on the vendorCacheBust regex in vite.config.ts — itself untested, so a regression in that regex (or a renamed vendor path) silently stops cache-busting and browsers keep a year-stale immutable engine while the hashed app bundle moves on: exactly the app/engine skew the plugin's own comment warns about, now unguarded.
- **Fix:** Two cheap additions: (1) a unit test for vendorCacheBust asserting every /vendor/ reference in the real index.html gets a ?v= hash appended (fails loudly if a vendor file goes missing or the regex rots); (2) SVG-string golden-file snapshots (vitest toMatchFileSnapshot) for 3-4 fixture documents in the existing Node render tests — full-output snapshots catch the geometry/stacking regressions the substring assertions miss, no browser needed. Playwright screenshot baselines can come later.

### M27. Vendored engine load failure leaves a silently dead app with no error message

- **Area:** UI / UX / A11y | **Location:** `src/main.ts:232` | **Type:** degraded-state
- **Problem:** The renderer is a classic deferred script (index.html: '/vendor/topology-ds.js') that sets window.TopologyDesigner; the typed facade throws if it is absent. main.ts constructs `new Editor(...)` at module top level with no try/catch; the Editor constructor calls renderArt() -> renderPageInto() -> engine(), which throws. The uncaught exception aborts the rest of the module, so everything wired after line 232 (all toolbar listeners, palette build, filmstrip, keyboard handlers) never runs. Failure scenario: a deploy where the 300KB+ vendor bundle 404s or a flaky network drops it -> user sees the toolbar chrome render, but the palette/filmstrip are empty, the canvas is blank, and every button is dead — with zero user-facing message (only a console error). Nothing detects the failure or offers a reload.
- **Fix:** Guard app boot: check `window.TopologyDesigner` before constructing the Editor (or wrap boot in try/catch) and render a visible error state in #app ('The diagram engine failed to load — reload to retry') instead of letting the module die silently.

### M28. Frame deletion is unrecoverable and confirm is skipped for annotation-only frames; switching frames wipes all undo history

- **Area:** UI / UX / A11y | **Location:** `src/main.ts:2145` | **Type:** destructive-action-safety
- **Problem:** deletePage() confirms only when the page has nodes or links; a frame containing only zones, flow paths, policy markers, anchors, or a caption is deleted with no confirmation. Undo cannot recover it because the undo stack lives in the Editor and is page-scoped: setPage() zeroes undoStack/redoStack. Failure scenario 1: user builds a frame of zones + flow-path annotations over an empty canvas, clicks the ✕ on the wrong frame -> gone instantly, no confirm, no undo. Failure scenario 2: user presses ArrowRight with nothing selected (which flips pages, main.ts:2715) mid-edit, flips back -> Ctrl+Z now does nothing; all history for the frame they were editing is silently destroyed.
- **Fix:** Treat any non-empty collection (zones/flowPaths/policyMarkers/anchors/caption) as content for the confirm; better, make page deletion undoable (document-level history or a toast with 'Undo'). Keep per-page history across setPage, or at minimum keyed by page id.

### M29. Global single-key shortcuts stay live behind the node-designer modal, which also has no Escape or focus trap

- **Area:** UI / UX / A11y | **Location:** `src/main.ts:2594` | **Type:** focus-management
- **Problem:** The window keydown handler only exempts INPUT/SELECT/TEXTAREA/contentEditable targets; it has no notion of an open modal. The node-designer (nd-modal) closes only via Cancel or backdrop click — no Escape handler, no focus trap, no focus move on open. Failure scenario: user opens 'design node', clicks a shape tile (a <button>, so the exemption doesn't apply), then presses Delete/Backspace intending to fix a name -> editor.deleteSelected() destroys the canvas selection hidden behind the modal; pressing 'v'/'l'/'t' silently switches tools or re-lays-out the diagram behind it. The help overlay has role=dialog but no aria-modal, no focus moved into it, and closing the find palette drops focus to <body>.
- **Fix:** Suppress global shortcuts while any modal/popover is open (a shared 'modalOpen' check or checking e.target.closest('.nd-modal,.help-backdrop,.find')). Add Escape-to-close and initial focus + focus trap (or use <dialog>) for the designer and help overlays; restore focus to the invoker on close.

## LOW (9)

### L1. Ungoverned second deploy path: `npm run deploy` ships the local working tree to production, bypassing CI and conflicting with Git-integration deploys

- **Status (2026-07-13): Closed.** The `npm run deploy` script was deleted in
  Packet D1 (PR #149). Deploys now run only through the gated GitHub Actions
  workflows (`deploy-staging.yml` / `deploy-production.yml`), each of which
  re-runs the CI `check` before deploying; there is no longer a laptop path
  that can push a local working tree to the production Worker.

- **Area:** CI/CD & Release | **Location:** `package.json:15` | **Type:** deploy-pipeline-safety
- **Problem:** The deploy script does a full production `wrangler deploy` from whatever is on the developer's disk — uncommitted or unpushed changes included — with no tests and no record in Git. It coexists with the Workers Builds auto-deploy, so the two paths silently clobber each other: a laptop deploy is reverted by the next push to main, or a laptop deploy of a stale branch overwrites what main deployed. src/mcp/README.md even instructs running `npm run deploy` as part of TOPOLOGY_KV setup, normalizing the bypass. Because wrangler deploy takes 100% traffic instantly, one accidental invocation from the wrong checkout replaces production.
- **Fix:** Remove the script or repoint it at the staging env (wrangler deploy --env staging); make Workers Builds (or a gated Actions job) the only path that can touch the production Worker, and scope developer API tokens so they cannot deploy the production script.

### L2. CI supply-chain hardening absent: tag-pinned actions, default GITHUB_TOKEN permissions, no dependency audit or update automation

- **Area:** CI/CD & Release | **Location:** `.github/workflows/ci.yml:12` | **Type:** supply-chain
- **Problem:** Actions are pinned to mutable major tags (actions/checkout@v4, actions/setup-node@v4) rather than commit SHAs, the workflow declares no `permissions:` block so the GITHUB_TOKEN gets the repo default (potentially write) while `npm ci` executes arbitrary dependency lifecycle scripts, and there is no `npm audit` step for the three production dependencies (which include the OAuth provider guarding live tokens) nor any Dependabot/Renovate config (.github/ contains only ci.yml). For a worker handling OAuth grants, a compromised action or dependency in this pipeline is a credential-adjacent risk.
- **Fix:** Add `permissions: { contents: read }` at workflow level, pin both actions to full commit SHAs, add a step `npm audit --omit=dev --audit-level=high`, and commit .github/dependabot.yml covering npm and github-actions ecosystems.

### L3. Entire Vite/Vitest config cast `as never`, disabling type checking of build and test configuration

- **Area:** CI/CD & Release | **Location:** `vite.config.ts:57` | **Type:** build-config
- **Problem:** defineConfig's argument is cast to never (to smuggle the vitest `test` key past Vite's types instead of importing defineConfig from 'vitest/config'). This turns off compile-time validation of every field: a typo in outDir, target, or the test include glob would be silently accepted. Since wrangler.jsonc hard-codes assets.directory: './dist', a mistyped outDir would produce a deploy that serves a stale or empty asset directory — and with no post-deploy smoke test (see separate finding) nothing would catch it before users do.
- **Fix:** Import defineConfig from 'vitest/config' (which types the test key over Vite's config) and delete the `as never` cast so the config is type-checked by the CI typecheck step.

### L4. No security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) on app, login, or share responses

- **Area:** Worker & Auth Security | **Location:** `public/_headers:10` | **Type:** security-headers
- **Problem:** public/\_headers only sets Cache-Control for /vendor/\*. Nothing sets a Content-Security-Policy, X-Frame-Options/frame-ancestors, X-Content-Type-Options, or Referrer-Policy for the SPA, the self-rendered login page (worker/auth.ts loginPage), or the public /v/<id> share view. Consequences on an OAuth-authenticated app: (1) the editor and login page can be framed by any origin -> clickjacking; (2) absence of CSP means any reflected/stored XSS (e.g. via topology node labels rendered into SVG on the public share view) executes with no mitigation; (3) no nosniff. For a production launch this is a baseline gap across every HTML response.
- **Fix:** Add a global \_headers block (and/or set headers in the Worker for dynamic responses) with a restrictive Content-Security-Policy, X-Frame-Options: DENY (or frame-ancestors 'none'), X-Content-Type-Options: nosniff, and Referrer-Policy: strict-origin-when-cross-origin. The login and share pages especially must be un-frameable.

### L5. Unauthenticated dynamic client registration and no rate limiting on any write path

- **Area:** Worker & Auth Security | **Location:** `worker/index.ts:40` | **Type:** rate-limiting
- **Problem:** clientRegistrationEndpoint '/register' is exposed with no authentication (standard for the provider, but note it) and there is no rate limiting anywhere in the Worker. An anonymous attacker can loop POST /register to fill OAUTH_KV with client records, and any signed-in GitHub user (see the no-allowlist finding) can loop share_topology to fill TOPOLOGY_KV with 30-day snapshots. There is no per-IP or per-user throttle, quota, or size cap on either write path, so both KV namespaces can be inflated at will — a cost/DoS and storage-abuse vector with no backpressure.
- **Fix:** Put Cloudflare Rate Limiting (or a DO/KV counter) in front of /register, /callback, /auth/github, and the share-publish tool; cap snapshots per user and per time window; and constrain snapshot payload size.

### L6. Cookie attribute injection via unencoded `go` in the OAuth state cookie

- **Area:** Worker & Auth Security | **Location:** `worker/auth.ts:73` | **Type:** cookie-handling
- **Problem:** startWebLogin builds the state cookie as `cookie(COOKIE_STATE, `${nonce}|${go}`, 600)` where `go` is an attacker-influenced path that is not URL-encoded before being placed into the Set-Cookie value. A `go` containing `;` lets the attacker inject additional cookie attributes into the tdg_oauth_state Set-Cookie header (e.g. `go=/x;Max-Age=99999999` or a `Domain=`/`Path=` override), and a `;` also silently truncates the stored return path when parseCookies later splits on `;`. Blast radius is limited to the short-lived state cookie, but it is unsanitized attacker input flowing into a response header.
- **Fix:** encodeURIComponent(go) before embedding it in the cookie value (and decode on read), or store only the nonce in the cookie and keep `go` in the GitHub state parameter.

### L7. share_topology and surface-inventory tests assert stubs/name lists rather than production behavior

- **Area:** Test Coverage | **Location:** `src/mcp/tools.test.ts:766` | **Type:** tautological-tests
- **Problem:** Two coverage soft spots inside the otherwise strong tools.test.ts: (1) the share_topology test injects a fake publishTopology and then asserts the fake's hardcoded return URL — it validates the plumbing between tool and dep (worthwhile) but reads as if publishing is covered when the production publisher (worker/mcp.ts publish → KV, TTL, PUBLIC_BASE_URL trailing-slash handling) never runs under test (see the separate DO finding); (2) 'exposes the full authoring + render + discovery surface' (line 22) and 'documents every tool in the MCP README' (line 62) assert a hardcoded name list and README string mentions — useful drift guards, but they contribute to a misleadingly high sense of MCP coverage since neither exercises behavior. Risk is indirect: a reviewer sees share/inventory tests passing and assumes the publish path is safe to refactor.
- **Fix:** Keep the wiring test but rename it to make the stub explicit ('passes the stored doc to the publish dep'), and cover the real publisher in the DO/KV integration suite: assert the KV key format (doc:<12-char id>), the 30-day expirationTtl, and that PUBLIC_BASE_URL with and without a trailing slash yields a well-formed /v/:id URL.

### L8. Format painter (Copy/Paste format) exists only in the right-click context menu — unreachable by keyboard or touch and undiscoverable

- **Area:** UI / UX / A11y | **Location:** `src/main.ts:2742` | **Type:** discoverability
- **Problem:** editor.copyFormat()/pasteFormat() are wired exclusively in ctxItemsFor(); they appear in no toolbar button, no inspector control, and no keyboard shortcut (they are absent from the SHORTCUTS help overlay). The context menu itself opens only from a contextmenu event on the canvas host, is never focused, and has no arrow-key navigation, so the whole feature is right-click-only. Failure scenario: touch/trackpad users without an easy right-click, and all keyboard-only users, can never use format painting; other users will not learn it exists since the '?' shortcut reference never mentions it.
- **Fix:** Add keyboard shortcuts (e.g. Ctrl+Alt+C/V) and list them in the help overlay, and/or surface copy/paste-format buttons in the inspector's Arrange row. Move focus into the context menu on open and support ArrowUp/Down/Enter.

### L9. Icon-only controls rely solely on title attributes and several interactive elements suppress the focus indicator

- **Area:** UI / UX / A11y | **Location:** `index.html:339` | **Type:** accessibility
- **Problem:** Most toolbar/canvas controls are icon glyphs (↶, ▦, ⌗, ◓, ⚙, ⤢, ✕) whose only accessible name is the title attribute — below 1480px the text labels are hidden entirely (`.tlabel { display: none }`), so screen-reader and touch users depend on titles that never show on touch. The brand-palette swatches explicitly set `outline: none` with no replacement focus style, and the find input sets `outline: none` (border-color change only), so keyboard focus position becomes invisible on those controls.
- **Fix:** Add aria-label (duplicating the title) to icon-only buttons, and add :focus-visible styles (e.g. 2px accent outline) wherever outline is removed, including the dp-swatch and find input.

## Refuted (investigated, not real)

- **Canvas selection and filmstrip are pointer-only: keyboard users cannot select elements, switch focus to frames, or rename them** — refuted: The cited lines are real (filmstrip frames are non-focusable divs, overlay SVG binds only pointer events), but the claimed failure scenario — keyboard users cannot select, move, rename, or switch frames — is false because the reviewer missed keyboard-accessible alternate
- **prefers-reduced-motion is only honored for flow particles; the ambient animated backdrop defaults on for everyone** — refuted: The ambient 'animated' default is gated behind a second reducedMotion check the reviewer missed. Calm defaults from prefers-reduced-motion (src/main.ts:2208-2213), the editor passes calm into every render (src/editor/editor.ts:576), renderPageSVG sets `topo.reducedMotion
