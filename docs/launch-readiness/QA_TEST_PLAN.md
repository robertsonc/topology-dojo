# Topology Dojo — Living QA Test Plan

- **Version:** 2.0
- **Effective date:** 2026-08-09
- **Status:** Active living plan
- **System under test:** Topology Dojo web editor, headless authoring API, local and remote MCP services, shared-workspace services, and the Cloudflare Worker deployment

This plan replaces the 2026-07-04 pre-launch snapshot. It describes the
current product and release pipeline. A result is not considered verified just
because a case appears in this plan: §4 records the automated evidence verified
on 2026-08-09, while cases marked **Required** still need execution against the
named environment and source SHA.

Authoritative companion documents:

- [Capability Matrix](../CAPABILITY_MATRIX.md) — shipped, flagged, partial, and deferred capabilities
- [User Guide](../USER_GUIDE.md) — user-visible behavior and operating instructions
- [UAT Plan](UAT_PLAN.md) — persona-based business acceptance
- [Traceability Matrix](TRACEABILITY_MATRIX.md) — capability/requirement → risk → test → evidence mapping
- [Deployment Runbook](../DEPLOYMENT_RUNBOOK.md), [Rollback](../ROLLBACK.md), and [Game Day](../GAME_DAY.md) — release and recovery controls
- [Findings Register](FINDINGS_REGISTER.md) — historical defects and remaining known risks; verify status against current code before treating an entry as open or closed

---

## 1. Quality objectives and scope

Topology Dojo's core contract is that people and agents author the same
document model through the same capability vocabulary and render path. QA must
therefore prove all of the following:

1. A user can create, edit, persist, import, export, share, and recover a
   topology without silent loss or corruption.
2. Browser, headless API, local MCP, and remote MCP behavior remain materially
   equivalent wherever the product claims parity.
3. Authentication, owner isolation, admin authorization, public-share
   carve-outs, and feature gates fail closed.
4. Shared-workspace revisions, proposals, leases, checkpoints, presence, and
   offline recovery preserve one canonical document under retries and
   concurrency.
5. Cloudflare staging and production use isolated resources, append-only
   migrations, an identifiable source SHA, and forward-only recovery.
6. User-visible behavior is documented and can be completed from the User
   Guide by a representative user during UAT.

### 1.1 In-scope surfaces

| Surface                         | Current scope                                                                                                                                                                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Editor                          | Selection, drag, marquee, pan/zoom, grid/snap, guides, links and waypoints, anchors, undo/redo, arrange/tidy, layers, legend, palette, minimap, find, select-by, context menus, format copy/paste, captions, problem badges, and responsive controls |
| Pages and persistence           | Independent flipbook frames, duplicate/reorder/delete/recover, playback timing, local and shared autosave slots, JSON open/save, legacy import, and corrupt-storage recovery                                                                         |
| Node and render system          | Built-in and custom node types, Node Designer, catalog parity, SVG/PNG/flipbook output, browser/Node/Worker render parity, themes, calm/reduced-motion, labels, routing, and visual regression                                                       |
| Headless API and MCP            | Authoring, validation, layout, tidy/balance, inspection, templates, layers, metadata, imports, render/export, optional provider tools, and structured errors over stdio and remote Streamable HTTP                                                   |
| Public and authenticated Worker | Login/logout/callback, session identity, OAuth metadata/token/register routes, `/mcp`, static app, showcase assets, `/api/topology/:id`, public `/v/:id`, `/healthz`, and `/readyz`                                                                  |
| Shared workspace                | Per-owner registry, lazy legacy handoff, revisions, semantic operations, proposals and selective acceptance, page-scoped leases, conflict detection, checkpoints/restore/fork, WebSocket push/presence, and IndexedDB recovery                       |
| Adaptive authoring              | Observe-only learning, candidate dedupe/refinement, owner confirmation/rejection/pause/resume/forget, bounded guidance, and read-only MCP guidance tools                                                                                             |
| Owner administration            | Login roster, admin identity gate, per-user workspace metadata, disabled/unauthenticated/non-admin behavior, and privacy boundary (no diagram content)                                                                                               |
| Delivery and operations         | CI, Playwright, Wrangler isolation checks, separate staging/production deployment workflows, feature-flag overrides in staging, migrations v1–v5, external smoke, production verification, alert response, and staging game-day recovery             |

### 1.2 Conditional and excluded scope

- The real EdgeConnect provider is shipped, but deployed secret state is not
  visible in the repository. Mock/injected-provider behavior remains in normal
  CI; a real-fabric acceptance track and deployed-tool inventory are mandatory
  before any environment claims supported `ORCH_BASE_URL`/`ORCH_API_KEY`
  activation.
- `src/core` is the retired beat model. Its existing tests remain regression
  evidence for retained code, but it is not a supported runtime surface.
- Full touch editing is not presently a support claim. Public shared views must
  remain readable on tablet/mobile viewports.
- Cloudflare dashboard policy creation and notification delivery are external
  operator actions. Repository tests can verify the routes and synthetic fault,
  but operational readiness requires recorded dashboard and game-day evidence.
- Share links are public snapshots with a 30-day KV lifetime and currently have
  no revoke/unpublish workflow. Tests must verify and documentation must state
  this behavior until a revocation feature ships.

---

## 2. Risk priorities

| Priority | Risk                                              | Required assurance                                                                                                                                                                                                     |
| -------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Silent data loss or false-success persistence     | Browser storage failure is visible; last edits flush; imports do not replace a good document on failure; workspace commits are atomic/idempotent; remote MCP persistence failure cannot be reported as durable success |
| P0       | Authentication or tenant-isolation failure        | Browser and MCP OAuth flows, session cookies, admin identity, owner-scoped registry/document/profile data, and unauthenticated public exceptions are tested positively and negatively                                  |
| P0       | Canonical-workspace corruption                    | Revisions are monotonic; retries are idempotent; proposals do not mutate before acceptance; leases constrain writes; conflicts never choose a silent winner; checkpoint restore is forward-only                        |
| P0       | Unsafe deployment or migration                    | Staging resources never point to production; all five DO bindings and both KV namespaces are present; migrations are append-only and identical across environments; deployed SHA and effective flags are recorded      |
| P1       | Human/agent or renderer drift                     | Catalog, document round trip, operations, and browser/Node/Worker output stay equivalent; remote tool inventory matches its enabled flags/provider                                                                     |
| P1       | Share/export/import integrity                     | Public-view gating, KV snapshot fidelity and expiry, legacy import, malformed input handling, offline flipbook, SVG/PNG framing, and custom-node round trips                                                           |
| P1       | Profiles/admin feature-gate or privacy regression | Enabled/disabled behavior, owner-only mutation, read-only agent guidance, admin-only metadata, and cross-owner isolation                                                                                               |
| P1       | Browser or accessibility regression               | Keyboard operation, focus/dialog behavior, readable names, reduced motion, responsive layouts, and supported-browser rendering                                                                                         |
| P2       | Performance, availability, and degraded-state UX  | Large documents, load/concurrency, WebSocket reconnect, storage unavailable, Worker redeploy, fault handling, and actionable errors                                                                                    |
| P3       | Cosmetic polish                                   | Copy, spacing, animation smoothness, and non-blocking visual differences outside approved tolerance                                                                                                                    |

Known risks or evidence gaps that must appear in release triage until resolved
or explicitly waived include public share-link revocation, end-to-end durable
persistence failure injection, the unverified real EdgeConnect integration,
Cloudflare alerting, and completion of the full production game day. Former
finding H1 (layout attachment carrying) is fixed and remains in regression
coverage rather than the open-risk list.

---

## 3. Environments and support assumptions

| Environment                   | Purpose                                               | What it proves                                                                                                                                            | What it does not prove                                                                                                 |
| ----------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Local Node/Vite               | Fast unit development; `npm run dev`; local stdio MCP | Pure API/model logic, editor state helpers, Node rendering, local browser flows, optional mock provider                                                   | Cloudflare routing, real OAuth, KV/DO wiring, remote MCP, or environment isolation                                     |
| Vitest + Miniflare            | Worker-level integration inside the unit suite        | Real `default-handler`, KV/DO behavior, workspace/profile/admin APIs, feature gates, health/readiness contracts, smoke functions                          | The production `OAuthProvider` wrapper and full `TopologyMcp` transport are intentionally bypassed by current fixtures |
| CI (`ubuntu-latest`, Node 22) | Required PR/deploy gate                               | Clean install, Wrangler config check, app+Worker typecheck, 849 Vitest cases, lint/format, production app build, and Chromium Playwright suite            | Firefox/Safari/Edge, live GitHub OAuth, deployed Cloudflare bindings, or manual UAT                                    |
| Local Playwright              | Functional debugging                                  | Eight non-screenshot Chromium journeys on the current macOS audit machine                                                                                 | The three committed visual baselines are Linux-only; absence of Darwin baselines is not a pixel mismatch               |
| Isolated staging Worker       | Release-candidate integration and UAT                 | Real Worker bundle, staging OAuth App, separate KV/DO resources, remote MCP, all enabled product flags, migrations, authenticated workflows, fault drills | Production routing/account settings unless separately verified                                                         |
| Production                    | Read-only/expendable post-deploy verification         | Public liveness, deployed SHA, auth/public boundaries, and a minimal disposable golden journey                                                            | Destructive, load, synthetic-fault, or bulk-data testing                                                               |

### 3.1 Browser and viewport policy

- **Automated release gate:** Playwright Chromium / Desktop Chrome on Linux.
- **Target compatibility certification:** current Chrome, Edge, Firefox, and
  Safari on macOS. Each cycle records its declared support matrix. Any omitted
  target requires product-owner approval and the same narrowed support claim in
  the User Guide and release notes. Non-Chromium results are manual until
  corresponding Playwright projects or equivalent device testing are in CI.
- **Editor viewports:** 1920×1080, 1440×900, and 1280×720.
- **Responsive smoke:** 480×800 for core-control reachability.
- **Public-view readability:** 768×1024 tablet plus a current phone viewport.
- A release must not claim a browser or mobile editing experience that was not
  executed and recorded for that release.

---

## 4. Verified automated baseline (2026-08-09)

The following results were verified against the current checkout during this
audit. They are a point-in-time baseline, not permanent release evidence.

| Gate                                 | Verified result                                                                      | Evidence boundary                                                                                                                                                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                             | Install completed with warnings                                                      | Local audit used Node 23.7.0/npm 10.9.2 while CI targets Node 22. npm's install summary reported 17 advisories (2 low, 3 moderate, 12 high); no dependency was changed and no advisory-level triage was performed. SEC-07 remains Required.                                  |
| `npm run typecheck`                  | Pass                                                                                 | Root TypeScript program plus `worker/tsconfig.json`                                                                                                                                                                                                                          |
| `npm test`                           | **71 files / 849 tests passed**                                                      | Vitest 3, `src/**/*.test.ts`, Node environment; Worker tests use esbuild + Miniflare                                                                                                                                                                                         |
| `npm run lint`                       | Pass                                                                                 | ESLint and Prettier check                                                                                                                                                                                                                                                    |
| `npm run build`                      | Pass                                                                                 | Root `tsc --noEmit` plus Vite production app build; Worker typecheck is provided by `npm run typecheck`, not by this command alone                                                                                                                                           |
| `npm run test:e2e`                   | 11 Chromium cases discovered                                                         | On macOS, **8 functional cases passed** and **3 visual cases were baseline-unavailable** because the repository contains Linux (`chromium-linux`) snapshots but no Darwin snapshots. This is not evidence of a pixel mismatch. CI is the canonical Linux visual environment. |
| Wrangler isolation                   | Real config passes within the 849-test suite; CI also invokes the standalone checker | Current checker needs the strengthening listed in §11.2 before it fully protects all five DO bindings and append-only history                                                                                                                                                |
| Deployed staging/production smoke    | **Not executed as part of this local audit**                                         | A current remote run with URL, SHA, flags, migration tags, and JSON output is still required for release evidence                                                                                                                                                            |
| UAT and non-functional certification | **Not executed as part of this audit**                                               | Execute the current UAT plan and §8 suites on the release candidate                                                                                                                                                                                                          |

### 4.1 Vitest distribution

| Area                               |  Files |   Tests |
| ---------------------------------- | -----: | ------: |
| Admin                              |      1 |       7 |
| Headless API                       |     10 |      97 |
| Connect/provider                   |      2 |      16 |
| Retired core                       |      1 |       7 |
| Editor                             |      9 |     106 |
| Import                             |      2 |      48 |
| MCP                                |      2 |      45 |
| Nodes                              |      3 |      13 |
| Pages/persistence                  |      3 |      31 |
| Authoring profile                  |      4 |      85 |
| Render                             |      6 |      46 |
| Server                             |      2 |      25 |
| Worker integration (`src/testing`) |     14 |     117 |
| UI render/state helpers            |      3 |     117 |
| Vendored palette seam              |      1 |       7 |
| Workspace                          |      8 |      82 |
| **Total**                          | **71** | **849** |

Test count is not code coverage. No statement/branch coverage provider or
threshold is currently configured, and the UI suites primarily characterize
HTML/state helpers in a Node environment rather than driving the mounted panels
through a real DOM.

### 4.2 Playwright inventory

| Area              |  Cases | Current coverage                                                                |
| ----------------- | -----: | ------------------------------------------------------------------------------- |
| Editor basics     |      2 | Add/delete/undo/redo; autosave/reload                                           |
| Export            |      1 | Non-zero-origin SVG viewBox framing                                             |
| Frame history     |      2 | Per-frame undo survives switching; deleted-frame recovery                       |
| Overlay/share     |      2 | Shortcuts inert under help dialog; shared copy does not overwrite local work    |
| Visual/responsive |      4 | Three Linux screenshot baselines; one 480×800 control-reachability check        |
| **Total**         | **11** | Chromium only; Vite dev server with Worker network behavior mocked where needed |

---

## 5. Exact automated release gates and commands

From a clean checkout with Node 22:

```bash
npm ci
npm run check:wrangler
npm run typecheck
npm test
npm run lint
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

CI enforces those checks in two jobs: the fast `check` job and the separate
browser job. Staging and production deployment workflows resolve one immutable
SHA and call the same reusable CI workflow before building and deploying that
SHA.

External smoke syntax:

```bash
npm run smoke -- https://topology-dojo-staging.robertson-corey.workers.dev --sha <commit-sha> --wait-live 180 --json
npm run smoke -- https://topology-dojo.harnessed.cloud --sha <commit-sha> --wait-live 180 --json
```

Staging game-day deployments add the matching `--expect-workspace-disabled`,
`--expect-profiles-disabled`, and/or `--expect-analytics-disabled` flags. A
normal current deployment expects all three surfaces enabled.

No direct laptop command is release evidence. The GitHub Actions staging and
production workflows are the authoritative deployment paths; a local
`deploy:staging` run can overwrite the shared UAT target and must not be used
during a controlled test cycle.

---

## 6. Test levels

| Level                | Required coverage                                                                                                                | Frequency                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Static/config        | App+Worker strict TypeScript, lint, format, Wrangler environment invariants, Worker dry-run bundle                               | Every PR and deployment SHA                                           |
| Unit/property        | Model, parser, validation, layout, operations, profile learning/refinement, catalog, safe paths, and error boundaries            | Every PR                                                              |
| Component            | Editor state machine; mounted workspace/profile/admin panels; persistence and offline adapters; render fixtures                  | Every PR; browser-backed for interaction-heavy components             |
| Worker integration   | Real handler + KV/DO APIs, feature gates, tenant isolation, readiness, migrations, and failure injection under workerd/Miniflare | Every PR affecting `worker/`, `src/workspace`, `src/profile`, or auth |
| Browser E2E          | Critical editor/page/import/export/share/panel flows and visual baselines                                                        | Every PR for Chromium; scheduled compatibility matrix                 |
| Deployed integration | Full OAuth wrapper, remote MCP, real KV/DO bindings, authenticated readiness, public share, effective flags, and source SHA      | Every staging release candidate; minimal safe production smoke        |
| Non-functional       | Security, accessibility, compatibility, performance/load, resilience, and game day                                               | Scheduled and before material production releases                     |
| UAT                  | Persona workflows and User Guide validation                                                                                      | Each material feature release or support-contract change              |

---

## 7. Functional suites

Status legend:

- **Automated** — represented in the current Vitest or Playwright baseline.
- **Partial** — a lower-level or mocked test exists, but the production-shaped
  journey still needs coverage.
- **Required** — must be executed/implemented; no current automated evidence is
  sufficient.

### 7.1 Authentication, public routing, and sessions

| ID      | Scenario and expected result                                                                                                                      | Status/environment                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| AUTH-01 | Unauthenticated document navigation redirects to `/login`; `/login` and showcase images remain reachable                                          | Automated in Worker integration; Required on staging                             |
| AUTH-02 | `/auth/github` creates a nonce-bound state cookie with Secure, HttpOnly, SameSite, bounded lifetime, and safe same-origin `go`                    | Automated negative/start-flow coverage                                           |
| AUTH-03 | A real GitHub callback establishes the correct session and returns to the original same-origin deep link                                          | Required on staging                                                              |
| AUTH-04 | Missing, mismatched, replayed, malformed, and expired callback state grants no session                                                            | Partial; expand and run staging negative set                                     |
| AUTH-05 | `/api/me` returns the authenticated identity and correct `admin` flag; no session returns 401                                                     | Automated                                                                        |
| AUTH-06 | Logout clears the session; cached/back navigation cannot use authenticated APIs                                                                   | Partial; browser staging verification required                                   |
| AUTH-07 | OAuth metadata, dynamic client registration, authorization, token issuance/refresh/revocation, and invalid bearer behavior conform for remote MCP | Required against the real Worker wrapper                                         |
| AUTH-08 | `/mcp` is never reachable without a valid token; public `/v/:id` remains intentionally unauthenticated                                            | Automated negative smoke; Required positive staging flow                         |
| AUTH-09 | Owner A cannot read owner B's registry, workspace, profile, admin detail, or MCP drafts                                                           | Automated in several lower layers; Required end-to-end with two staging accounts |
| AUTH-10 | CSP/security headers cover app, login, share, API, and error responses without breaking required assets                                           | Partial; deployed header sweep required                                          |

### 7.2 Editor, pages, and recent browser regressions

| ID     | Scenario and expected result                                                                                                                                                                          | Status/environment                                                                                                                                                                        |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EDT-01 | Add, select, marquee, drag, delete, clone, align, distribute, and select-by preserve intended IDs/geometry and undo as one semantic action                                                            | Automated core/gesture coverage; browser smoke partial                                                                                                                                    |
| EDT-02 | Create and edit straight/orthogonal/curved links, waypoints, anchors, zones, flow paths, and policy markers; zones accept node members only while flows/links accept anchors; references remain valid | Automated lower-level; Required rich browser journey. The current generic zone picker can surface an invalid anchor and must be fixed or explicitly dispositioned before this case passes |
| EDT-03 | Undo/redo restores byte-equivalent state, clears redo after a new edit, and does not record no-op interactions                                                                                        | Automated                                                                                                                                                                                 |
| EDT-04 | **#204:** switching frames preserves each frame's undo history                                                                                                                                        | Automated Playwright, passed locally                                                                                                                                                      |
| EDT-05 | **#204:** deleting a frame offers recovery and restores the complete frame                                                                                                                            | Automated Playwright, passed locally                                                                                                                                                      |
| EDT-06 | **#209:** Delete and single-key canvas shortcuts remain inert while help, Node Designer, or another modal owns focus; Escape/focus restoration work                                                   | Help overlay automated; Node Designer/other dialogs Required                                                                                                                              |
| EDT-07 | Tidy and every arrange algorithm stay deterministic where promised, in bounds, and free of newly dangling anchors/waypoints                                                                           | Attachment carrying and balance overlap are automated regressions; full algorithm/browser sweep Required                                                                                  |
| EDT-08 | Inspector fields match the catalog, validate values, and round-trip layers, palette, legend, captions, metadata, opacity, flow controls, and label scale                                              | Automated lower-level; Required browser catalog-parity sweep                                                                                                                              |
| EDT-09 | Find, minimap, grid/snap, guides, theme, calm/reduced-motion, context menu, format copy/paste, and problem badges are keyboard- and pointer-operable                                                  | Partial; manual/a11y sweep required                                                                                                                                                       |
| EDT-10 | Node Designer creates/edits a declarative custom type that survives pages, JSON, MCP discovery, and all render paths                                                                                  | Partial; cross-surface E2E required                                                                                                                                                       |
| EDT-11 | Legacy importer preserves supported topology semantics and reports unsupported data without corrupting the current document                                                                           | Automated with 43 legacy cases; browser open flow Required                                                                                                                                |
| EDT-12 | Narrow viewport keeps core controls reachable and public viewer remains readable on tablet/phone                                                                                                      | 480×800 control smoke automated; viewer matrix Required                                                                                                                                   |

### 7.3 Persistence, import, export, and visual output

| ID      | Scenario and expected result                                                                                                                  | Status/environment                                                               |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| DATA-01 | **#203:** successful localStorage write displays “saved”; quota/policy failure displays “not saved” and offers JSON download                  | Automated unit plus successful browser path; failure UI browser test Required    |
| DATA-02 | The final debounced edit is persisted on unload/reload; storage-disabled/private-mode behavior is usable and honest                           | Partial; Safari/private-mode Required                                            |
| DATA-03 | **#202:** opening `/v/:id` uses a separate shared autosave slot and never overwrites local work; keep/back are explicit                       | Automated Playwright with mocked API, passed locally; real Worker share Required |
| DATA-04 | Truncated, malformed, oversized, prototype-shaped, and semantically invalid JSON fails safely while the current document remains intact       | Strong parser coverage; browser and payload-limit tests Required                 |
| DATA-05 | JSON export/import retains every page, custom type, layer, legend, palette, stencil, annotation, timing, source reference, and metadata field | Automated lower-level; superset golden document Required                         |
| DATA-06 | **#206:** SVG/PNG backdrop and crop use the actual non-zero viewBox origin                                                                    | Automated Playwright functional case, passed locally                             |
| DATA-07 | Flipbook HTML is self-contained, offline, correctly timed, escaped against document-content injection, and respects reduced motion            | Partial; offline browser/security execution Required                             |
| DATA-08 | Browser, Node, and Worker render the golden corpus materially identically                                                                     | Node/browser partial; Worker parity Required                                     |
| DATA-09 | **#216:** representative sample, spine-leaf, and EdgeHA images stay within 2% pixel-diff tolerance in canonical Linux Chromium                | Automated in CI configuration; current macOS baselines unavailable               |

### 7.4 Headless API, MCP, and provider behavior

| ID     | Scenario and expected result                                                                                                                                         | Status/environment                                                   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| MCP-01 | Capability and tool inventory matches catalog, flags, provider presence, and documentation; no hidden mutation tools exist                                           | Automated lower-level                                                |
| MCP-02 | Golden loop: discover → create → author → validate → tidy/balance → inspect → render succeeds and produces a clean topology                                          | Automated tool behavior; Required over remote staging transport      |
| MCP-03 | Invalid type, enum, ID, page, operation, size, and schema inputs return structured actionable errors and leave the session usable                                    | Automated lower-level; remote protocol errors Required               |
| MCP-04 | Templates instantiate, validate, and render cleanly; page targeting and metadata/layer/legend/palette operations round-trip                                          | Automated                                                            |
| MCP-05 | Local stdio omits remote-only share; remote exposes share and only exposes workspace/profile/provider tools when their services are enabled                          | Automated gate helpers; real tool-list staging verification Required |
| MCP-06 | Same owner sees durable drafts across transport/DO restarts; a different owner sees none                                                                             | Persist-store unit coverage; real `TopologyMcp` hibernation Required |
| MCP-07 | Every mutating legacy tool persists; every genuinely read-only/workspace tool avoids stale legacy write-back; persistence failure is not reported as durable success | Partial and high risk; full Worker integration Required              |
| MCP-08 | Real `share_topology` writes `doc:<random-id>` with 30-day TTL, correct payload/size handling, and normalized absolute URL                                           | Tool dependency is stubbed today; real Worker/KV test Required       |
| MCP-09 | Browser, Node, and Worker `render_svg` agree for built-ins, custom types, layers, palette, emphasis, and reduced motion                                              | Partial; worker-render golden suite Required                         |
| MCP-10 | Mock provider query/compile/upsert paths are deterministic and credential-free                                                                                       | Automated                                                            |
| MCP-11 | Before live provider activation, recorded and then sandbox Orchestrator payloads pass normalization, pagination/error, idempotency, secret-redaction, and load tests | Required conditional gate                                            |

### 7.5 Shared workspace and offline collaboration

| ID    | Scenario and expected result                                                                                                       | Status/environment                                           |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| WS-01 | Owner handoff lazily migrates a legacy draft exactly once; agent reads never trigger migration; stale legacy mutations are refused | Automated                                                    |
| WS-02 | Manifest, bounded changes, paginated element hydration, and revision timeline return no unintended full-document data              | Automated lower-level; HTTP route matrix Partial             |
| WS-03 | Proposal creation does not change canonical state; full/selective accept creates one coherent revision; reject preserves state     | Automated DO/UI helpers; browser staging journey Required    |
| WS-04 | Disjoint edits rebase; same-field and delete/edit conflicts reject explicitly with no silent winner                                | Automated operations/DO; concurrent staging journey Required |
| WS-05 | Agent direct writes require a current browser-granted page lease; wrong-page, expired, revoked, or self-granted attempts fail      | Automated lower-level; staging two-client journey Required   |
| WS-06 | Repeated `operationId` is idempotent across timeout/retry; revisions never duplicate or regress                                    | Automated DO                                                 |
| WS-07 | Checkpoint create/list/cap, forward-only restore, fork isolation, and selective proposal dependencies behave as documented         | Automated DO/UI helpers; browser interaction Required        |
| WS-08 | Presence/push tracks two sockets, reconnects, and never persists stale presence                                                    | Automated DO socket; deployed WebSocket journey Required     |
| WS-09 | IndexedDB offline cache recovers pending/canonical state after refresh/crash; unavailable/corrupt storage degrades safely          | Automated adapter; real browser offline/reconnect Required   |
| WS-10 | Aggregate documents above 2 MiB work through page keys; oversize page/metadata/batch fails before revision advance                 | Automated DO; staging limit check Required                   |

### 7.6 Adaptive profiles and administration

| ID       | Scenario and expected result                                                                                                                | Status/environment                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| PROF-01  | Observe-only outcomes dedupe, strengthen, cap, isolate owners, and never change coordinator responses                                       | Automated                                                            |
| PROF-02  | Candidate confirmation is human-only and scope-aware; reject tombstones; pause/resume/forget and re-review follow the documented lifecycle  | Automated lower-level/UI HTML; mounted browser flow Required         |
| PROF-03  | Bounded guidance serves only confirmed applicable rules, respects revisions/token limits/exceptions, and profile MCP tools remain read-only | Automated                                                            |
| PROF-04  | `PROFILES_ENABLED` off produces the stable 503/no-tool/no-write posture; on activates API, panel, learner, and guidance                     | Automated gates; forward-disable staging drill Required              |
| ADMIN-01 | `ANALYTICS_ENABLED` off returns stable 503 and records nothing; on records bounded login metadata                                           | Automated lower-level; staging drill Required                        |
| ADMIN-02 | Unauthenticated is 401, signed-in non-admin is 403, configured numeric-ID admin sees the chip/roster/workspace metadata                     | Automated API/HTML helpers; mounted browser roles Required           |
| ADMIN-03 | Admin responses and UI never include topology contents or another unintended identity field; hostile names/titles are escaped               | Automated rendering/API partial; privacy payload inspection Required |

### 7.7 Cloudflare delivery and operations

| ID     | Scenario and expected result                                                                                                                         | Status/environment                                                                                                                                                                                           |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OPS-01 | Clean CI installs and all gates operate on the exact resolved deploy SHA                                                                             | Automated workflow configuration; record run URL                                                                                                                                                             |
| OPS-02 | Staging Worker name, base URL, GitHub client, both KV IDs, all DO namespaces, and secrets are isolated from production                               | Partial automated checker plus deployment evidence                                                                                                                                                           |
| OPS-03 | v1–v5 migration history is present, ordered, append-only, and identical in staging/production; every bound class is exported                         | Equality partially automated; append-only/export guard Required                                                                                                                                              |
| OPS-04 | `/healthz` reports live status, exact SHA, and effective feature posture; `/readyz` probes every enabled dependency under an owner session           | Current health coverage verifies status/SHA and the workspace flag only; readiness probes KV/registry/document only. Both posture and dependency coverage are Partial; deployed authenticated check Required |
| OPS-05 | All 14 unauthenticated smoke checks pass with zero skips for a current release                                                                       | Suite automated; current CLI permits skips, so release review must reject them manually until strict mode exists                                                                                             |
| OPS-06 | Browser OAuth, remote MCP, shared workspace, profiles, and admin positive journeys pass after staging deploy                                         | Required manual/automated staging pack                                                                                                                                                                       |
| OPS-07 | Workspace/profile/admin forward-disable and re-enable preserve data and unaffected routes; staging synthetic fault never activates without its token | Gate/fault unit coverage; recorded game day Required                                                                                                                                                         |
| OPS-08 | Production deploy waits for approval, cannot bypass `main` except explicit recovery SHA, and is followed by SHA-bound smoke                          | Workflow configuration; record deployment evidence                                                                                                                                                           |
| OPS-09 | Cloudflare error-rate policies notify the expected channel and recovery closes/updates the incident record                                           | Required external operator evidence                                                                                                                                                                          |

---

### 7.8 Competitive gap-closing batch (2026-08-17)

Features shipped by the UI gap-closing initiative (see the roadmap's
"Competitive gap-closing batch" milestone and the matching capability-matrix
rows). Automated evidence ran green locally against the feature branch.

| ID     | Scenario and expected result                                                                                                                                                | Status/environment                                                                                                                                          |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GAP-01 | Double-click renames a node/link/zone in place (Enter commits one undo step + one semantic op; Escape cancels); double-click empty canvas quick-adds                        | Automated: `src/editor/inline-edit.test.ts` (8) + e2e `gap-features.spec.ts`                                                                                |
| GAP-02 | Chevron click creates a connected same-type node (one undo step, one gesture batch); drag-to-empty opens the connect picker; occupied spots are skipped                     | Automated: `src/editor/quick-connect.test.ts` (8) + e2e                                                                                                     |
| GAP-03 | Share dialog publishes/lists/revokes; revocation is ownership-enforced; snapshot caching drops `immutable` (M20)                                                            | Automated: `src/testing/share-api.test.ts` (10, incl. Miniflare through the real handler); UI mocked-API journey verified; Required: hosted staging journey |
| GAP-04 | `href`/`tooltip` render as clickable `<a>`/`<title>` in exports and viewer; only http(s) is emitted; `javascript:` is a validation error                                    | Automated: `src/render/href-tooltip.test.ts` (7) + `src/api/href-tooltip.test.ts` (5)                                                                       |
| GAP-05 | Image nodes render https/data:image sources clipped + placeholdered otherwise; ≤256KB inline cap enforced; palette upload downscales                                        | Automated: `src/render/image-node.test.ts` (8); upload journey verified via scripted browser                                                                |
| GAP-06 | PDF (single/multi-frame), clipboard PNG, selection-only exports, and the flipbook toolbar action produce correct artifacts                                                  | Automated: `src/editor/export.test.ts` crop math + e2e PDF download; clipboard/selection verified via scripted browser                                      |
| GAP-07 | Mermaid flowcharts and CSV import through the open dialog and `import_topology` with warnings for unsupported syntax                                                        | Automated: `src/import/mermaid.test.ts` (9), `src/import/csv.test.ts` (9), 4 MCP-level cases, e2e open-flow                                                 |
| GAP-08 | Page `lineJumps` renders arc/gap hops (later-drawn line links hop earlier ones, exactly one of a pair), persists, validates                                                 | Automated: `src/render/line-jumps.test.ts` (5) + e2e persistence                                                                                            |
| GAP-09 | Present mode plays frames full-screen on the shared timing model; ←/→/Space/Escape behave                                                                                   | Verified via scripted browser; Required: manual staging pass                                                                                                |
| GAP-10 | Node `status` renders LEDs in both render paths and joins the legend; Ctrl+F matches metadata with a shown reason                                                           | Automated: `src/render/status.test.ts` (6); find journey verified via scripted browser                                                                      |
| GAP-12 | Callouts render wrapped text + a leader line to KNOWN targets only; dangling targets warn; deleting the target clears the pointer; annotation nodes are never 'unconnected' | Automated: `src/render/callout.test.ts` (8)                                                                                                                 |
| GAP-13 | draw.io export emits parseable mxGraph XML (one diagram per frame, centres preserved, waypoints/zones/styles mapped, XML-escaped)                                           | Automated: `src/editor/drawio.test.ts` (6) + DOMParser check via scripted browser                                                                           |
| GAP-14 | Mini style bar recolors all selected nodes / retypes a link / toggles emphasis, re-anchors on view changes, hides during gestures and on empty selection                    | Verified via scripted browser; Required: manual staging pass                                                                                                |
| GAP-11 | Pinch zoom/two-finger pan work without regressing single-finger editing                                                                                                     | Verified via CDP-synthesized touch gestures; Required: real-device spot check                                                                               |

## 8. Non-functional suites

All values below are release requirements unless a product owner records a
time-bounded waiver. No threshold should be reported as passed without a result
artifact.

### 8.1 Security and privacy

| ID     | Test                                                                                                                 | Required result                                                                                                          |
| ------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| SEC-01 | XSS payload corpus in labels, names, metadata, types, colors, custom specs, imports, shared views, SVG, and flipbook | No executable markup; output remains valid; CSP blocks a missed inline vector                                            |
| SEC-02 | Open-redirect/state/cookie fuzz for browser and MCP OAuth                                                            | Same-origin return only; no state replay; no header/cookie injection                                                     |
| SEC-03 | Owner/admin authorization matrix on every API verb/path                                                              | 401/403/404 behavior is consistent and leaks no existence/content                                                        |
| SEC-04 | CSRF posture for logout and every state-changing browser API                                                         | Documented and accepted controls; no cross-origin mutation                                                               |
| SEC-05 | Payload, operation, page, proposal, checkpoint, share, and client-registration abuse                                 | Enforced size/count/rate limits with actionable 4xx/429; no uncontrolled KV/DO growth                                    |
| SEC-06 | Secrets/logging inspection                                                                                           | No OAuth, Orchestrator, diagnostics, session, document, or raw prompt secret in code, artifacts, summaries, or logs      |
| SEC-07 | Dependency and workflow supply chain                                                                                 | High/critical production dependency findings triaged; Actions pinned/approved; least-privilege token permissions         |
| SEC-08 | Public caching and share lifecycle                                                                                   | Public nature, 24-hour cache behavior, 30-day expiry, and lack/presence of revocation match documentation and acceptance |

### 8.2 Accessibility

Target: WCAG 2.2 AA for login, editor controls, shared viewer, workspace,
preferences, and admin panels.

| ID      | Test                                                                                                 | Required result                                                                                                         |
| ------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| A11Y-01 | Automated axe scan of login, editor, shared view, open dialogs, workspace, profile, and admin states | Zero serious/critical violations; accepted exceptions linked to issues                                                  |
| A11Y-02 | Keyboard-only journey                                                                                | Visible focus, logical order, named controls, operable menus/dialogs/panels, Escape close, and focus restoration        |
| A11Y-03 | Screen-reader semantics                                                                              | Correct headings/landmarks/status announcements/dialog names; canvas alternatives and error messages are understandable |
| A11Y-04 | 200% zoom, high contrast, reduced motion, light/dark                                                 | No blocked operation, clipped critical content, or unwanted motion                                                      |

No accessibility automation is currently configured; these cases are
**Required**, not part of the 2026-08-09 pass count.

### 8.3 Performance and scale

Canonical large document: 20 pages, one 200-node/300-link page, 10 zones, 20
flow paths, five custom types, representative labels/layers. Commit the
generator and seed to make results reproducible.

| ID      | Test                                                 | Threshold                                                                      |
| ------- | ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| PERF-01 | Import/open large document on agreed mid-tier laptop | Interactive within 3 s; no long task above 1 s                                 |
| PERF-02 | Single drag and 200-element marquee/group drag       | 30 fps target; no interaction stall above 250 ms                               |
| PERF-03 | 100 edit undo/redo sequence                          | Each step under 100 ms; bounded memory after GC                                |
| PERF-04 | Tidy/layout/balance and render                       | Local render under 2 s; deployed render under 5 s; no Worker CPU termination   |
| PERF-05 | 25 concurrent MCP sessions running the golden loop   | 100% success; p95 non-render tool under 2 s, render under 5 s; isolation holds |
| PERF-06 | 100 concurrent readers of one public share           | 100% expected response; no DO dependency; error rate within release threshold  |
| PERF-07 | Two-hour editor/workspace endurance with reconnects  | No state loss, unbounded heap growth, stale presence, or revision drift        |

No committed large-document generator or load runner currently implements this
suite; all PERF cases remain **Required**.

### 8.4 Compatibility and resilience

| ID      | Test                                                               | Required result                                                                                                     |
| ------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| COMP-01 | Chrome/Edge/Firefox/Safari matrix and declared viewports           | Critical workflows pass or limitation is removed from support claim                                                 |
| COMP-02 | Linux vs. macOS visual execution                                   | Canonical Linux baselines pass; local functional suite remains separable from platform-specific snapshots           |
| RES-01  | localStorage/IndexedDB unavailable, full, corrupt, and interrupted | Visible degraded state; export/recovery path; no false “saved” state                                                |
| RES-02  | KV/DO write failure at each commit/publish stage                   | No partial revision or false durable success; idempotent retry                                                      |
| RES-03  | Worker restart/redeploy and MCP/WebSocket reconnect                | Owner data and canonical revision survive; presence reconstructs cleanly                                            |
| RES-04  | Feature disable/re-enable and migration-bearing deploy             | Forward recovery works without cross-version rollback or data deletion                                              |
| RES-05  | Staging slow/error/exception synthetic faults                      | Alerts, triage, stop conditions, and evidence capture work; route stays inert in production/uncredentialed requests |

---

## 9. Test data and accounts

### 9.1 Repository fixtures

- Use `e2e/fixtures/` for browser import/share/visual cases.
- Use `fixtures/legacy/` and `fixtures/EdgeHA_*.json` for importer and regression
  coverage.
- Add versioned fixtures for the rich parity document, malformed/security
  corpus, maximum-size boundaries, and deterministic large-document generator.
- Every fixture must state provenance, expected schema/version, intended test
  IDs, and whether it is safe to publish in CI artifacts.

### 9.2 Staging identities

Maintain disposable identities for:

- owner A;
- owner B for isolation/concurrency;
- the configured admin owner;
- a non-admin signed-in user;
- a fresh remote MCP client registration.

Record identity IDs, not secrets, in evidence. Never use personal/customer
topologies as test data. Delete disposable workspaces, grants, snapshots, and
profile/admin records where the product supports deletion; otherwise use a
clearly prefixed run ID and document retention.

Orchestrator credentials belong only in environment secrets. Use recorded,
redacted payloads before a real sandbox and verify that no credential appears
in tool arguments, logs, screenshots, or artifacts.

---

## 10. Entry, exit, and release decision gates

### 10.1 Test-cycle entry

- The candidate is one immutable commit SHA with a recorded change/risk scope.
- `npm ci`, Wrangler isolation, app+Worker typecheck, all Vitest tests, lint,
  build, and both Linux CI jobs are green on that SHA. The Chromium job must
  pass all 11 current cases, including the three canonical visual comparisons;
  the local macOS 8/11 partial run is diagnostic evidence only unless an
  explicit exception is approved.
- The staging deployment was performed by the authorized workflow, reports the
  same SHA, and lists effective flags and migration tags.
- Staging OAuth, KV, DO, diagnostics secret, accounts, and fixtures are ready
  and isolated; no production IDs appear in staging configuration.
- Required feature documentation and User Guide changes are reviewable before
  UAT begins.
- Known defects and findings affected by the change are triaged, with owners
  and retest IDs.

### 10.2 Pull-request exit

- Both reusable CI jobs pass with no focused, skipped, or unexpectedly pending
  test.
- New/changed behavior has an automated regression at the lowest useful level
  plus browser/Worker coverage when the integration boundary changed.
- Traceability rows and user-facing documentation are updated.
- No new Sev-1/Sev-2 defect is open; security/privacy changes have an explicit
  reviewer.

### 10.3 Release-candidate exit

- 100% of P0 cases and 100% of changed P1 cases pass on the exact staging SHA.
- All 14 external smoke checks pass with **zero failures and zero skips**.
- Real browser OAuth, remote MCP golden loop, owner isolation, public share,
  workspace proposal/lease/reconnect, profiles, admin, and authenticated
  readiness pass on staging.
- Required browser/accessibility/security/performance/resilience suites pass or
  have an approved, dated waiver that narrows the support claim.
- Zero open Sev-1 or Sev-2 defects. Sev-3 exceptions have a workaround, owner,
  target date, and product-owner approval.
- Every in-scope capability has a current traceability row and evidence link;
  the User Guide was validated during UAT.
- UAT meets its acceptance thresholds and the named business owner signs off.
- Migration, forward-recovery, alerting, and post-deploy procedures have current
  evidence when the release touches those areas.

The 2026-08-09 repository audit verifies the local automated baseline only. It
does **not** by itself satisfy the release-candidate exit gate.

### 10.4 Production exit

- Protected environment approval names the approved SHA.
- SHA-bound production smoke passes without a skip.
- A non-mutating login/public-view check and disposable remote MCP read/create/
  validate/render check pass, then test data is retired per policy.
- Monitoring remains normal through the observation window; any stop condition
  triggers the documented forward-recovery path.

---

## 11. Defects, reporting, and quality improvements

### 11.1 Severity and handling

| Severity | Definition                                                                                                                  | Response and gate                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Sev-1    | Data loss/corruption, auth or owner-isolation bypass, executable injection, production outage, migration/resource crossover | Immediate triage; blocks merge/promotion; regression test required             |
| Sev-2    | Critical workflow unusable without a reasonable workaround; remote MCP/share/workspace/render parity broken                 | Triage within one business day; blocks release unless fixed and reverified     |
| Sev-3    | Material degradation with a documented workaround; performance/accessibility/support target missed                          | Fix or product-owner waiver with date; targeted regression required when fixed |
| Sev-4    | Cosmetic, copy, or minor documentation issue with no workflow impact                                                        | Backlog; does not independently block release                                  |

Every defect records environment, SHA, feature flags, migration tags, test ID,
steps/data, expected/actual, logs/network evidence, screenshot/trace, severity,
owner, and regression-test location. A failed result is never converted to
“pass” by changing the expected result without product and QA review.

### 11.2 Required automation improvements

Prioritized gaps from the current audit:

1. Add Vitest V8 coverage reporting and archive it. Establish a measured
   baseline first, then enforce global and critical-module line/branch
   thresholds; do not use the 849 test count as a proxy.
2. Strengthen `check-wrangler-env.mjs`: compare the complete DO binding set
   (currently five, including `AUTHORING_PROFILE` and `ANALYTICS`), both KV
   bindings, names/classes/IDs, and an immutable v1–v5 migration prefix. Add
   mutations for each new binding and for identical-but-destructively-edited
   migration arrays.
3. Add CI Wrangler dry-run bundles for top-level production and staging so the
   actual Worker entry/config compiles before deployment.
4. Add production-shaped Worker integration for `worker/index.ts` and
   `TopologyMcp`: full OAuth wrapper, remote MCP initialize/tool list/call,
   owner rehydration, persistence classification/failure, real KV publish/TTL,
   and Worker renderer parity.
5. Make current-environment smoke strict: a skipped implemented route must fail
   deployment and scheduled verification. Retain an explicit legacy mode only
   when intentionally checking an old deployment.
6. Expand authenticated readiness to every enabled dependency, including
   profile/admin stores and OAuth/MCP health, and run it automatically in
   staging with a safe test identity.
7. Add mounted browser E2E for workspace, profile, admin, Node Designer,
   malformed import, storage failure, and positive deployed share/OAuth flows.
8. Split functional and visual Playwright commands; keep canonical visual runs
   in a pinned Linux environment, and add Firefox/WebKit projects where they
   represent the declared support matrix.
9. Add axe-based accessibility checks, the deterministic performance/load
   harness, dependency/security scanning, and retained successful-run evidence.

### 11.3 Evidence package

For every release candidate, retain:

- CI and deploy workflow URLs and immutable SHA;
- Vitest count/coverage, lint/type/build results, Playwright report and traces;
- Wrangler isolation/dry-run output, effective Worker name/resources, flags,
  migration tags, and deployed-SHA response;
- smoke JSON with all 14 named results and no skips;
- authenticated staging checklist, MCP transcript stripped of secrets,
  workspace revision IDs, and disposable share URL/expiry evidence;
- browser/accessibility/security/performance/resilience results;
- defect/waiver list, traceability matrix snapshot, UAT report, User Guide
  validation, approver, and date.

---

## 12. Traceability and maintenance

The [Traceability Matrix](TRACEABILITY_MATRIX.md) is the release index. Each row
must include:

`Capability/requirement → risk priority → code owner/surface → automated test → manual/UAT scenario → environment → last SHA/result/evidence → User Guide section → open defect/waiver`.

At minimum, maintain rows for editor/pages, persistence/import/export,
catalog/render parity, browser OAuth, remote MCP, public sharing, registry and
canonical workspace, offline/presence, profiles, admin, provider activation,
staging/production isolation, migrations, readiness/smoke, accessibility,
security, performance, and compatibility.

Update this plan and its traceability rows whenever any of the following
changes:

- document schema, parser, catalog, tool inventory, template, provider, or
  render engine;
- editor interaction, page lifecycle, persistence slot, export/import, or
  supported browser/viewport;
- auth/session/OAuth route, public/private boundary, role, owner key, API, or
  security header;
- workspace operation/revision/proposal/lease/checkpoint/offline/presence
  contract;
- profile learning/guidance/admin analytics behavior or feature-flag default;
- KV/DO binding, migration, compatibility date, secret, environment URL,
  deployment workflow, smoke/readiness check, alert, or recovery procedure;
- a Sev-1/Sev-2 incident, escaped defect, support-claim change, or UAT failure.

Change-specific minimum regressions:

- `public/vendor/`, `src/vendor/`, or render seam → golden visual corpus plus
  browser/Node/Worker parity.
- `worker/index.ts`, `worker/auth.ts`, or `worker/mcp.ts` → full staging OAuth +
  remote MCP + share/persistence pack.
- `wrangler.jsonc` or a DO export/migration → isolation, immutable migration
  prefix, both dry-run bundles, staging deploy, readiness, smoke, and forward
  recovery as applicable.
- document model/parser/import → valid, legacy, malformed, security, maximum
  size, and round-trip corpus.
- workspace/profile/admin UI → mounted interaction, keyboard/axe, API role
  matrix, reconnect, and feature-disabled states.
- provider activation → recorded payload contract, real sandbox, idempotency,
  credential redaction, performance, and documented disable/recovery path.

The QA owner reviews this plan at least once per material release and quarterly
while production is active. Stale historical facts belong in an archive or
dated evidence report, not in this living plan.
