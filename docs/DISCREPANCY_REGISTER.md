# Documentation Discrepancy Register

_Compiled 2026-07-19 from a full repository audit (code + docs + git history + live GitHub state) ahead of the roadmap/handoff reset. Each row was independently verified against code, not just cross-referenced between docs. See `docs/CAPABILITY_MATRIX.md` for the underlying capability-by-capability evidence this register draws on. Revalidated 2026-08-09: this table remains the dated record of what the July reset found; the follow-up below records later resolutions._

Severity guide: **Critical** = a reader would materially misjudge production risk or duplicate finished work; **High** = a reader would make a wrong near-term decision; **Medium** = confusing but self-correcting once the reader checks code; **Low** = cosmetic/citation gaps.

| #   | Document                                                                     | Section                                                                     | Current claim                                                                                                                                                                                                                                 | Actual repository state                                                                                                                                                                                                                                                                                                                             | Required correction                                                                                                                                                                                                                                 | Severity                                  | Evidence                                                                                                          |
| --- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | `docs/launch-readiness/FINDINGS_REGISTER.md`                                 | C1–C4 (Critical)                                                            | No status annotation — reads as 4 open, unremediated CRITICAL vulnerabilities (NaN-viewBox corruption, inspector XSS, `persistStore` data loss, shared-snapshot color-field XSS)                                                              | All 4 fixed in commit `a958bce` (2026-07-04). Verified directly in code: `src/api/layout.ts:227-245` (`parseViewBox` finite guard, C1); `src/main.ts` `typeRow()` uses `esc()` (C2); `src/mcp/persist-store.ts` tombstone-based deletion, not set-difference (C3); `src/pages/persist.ts` `safeColor`/`scrubColors`/`sanitizeElements` (C4)         | Add a "Status (2026-07-19): Closed" note to each of C1–C4 citing `a958bce` and the current code location                                                                                                                                            | **Critical**                              | `git show a958bce`; `src/api/layout.ts:227-245`; `src/pages/persist.ts`                                           |
| 2   | `docs/launch-readiness/FINDINGS_REGISTER.md`                                 | Header (line 5)                                                             | Static "Confirmed: 4 critical · 9 high · 29 medium · 9 low" with no closed/open breakdown                                                                                                                                                     | 5 findings now closed (M14, M18, M19, L1, plus C1–C4 per row 1 above — 8 total), 1 partially closed (H7 per row 3)                                                                                                                                                                                                                                  | Replace the static line with a closed/open breakdown, refreshed at each closure                                                                                                                                                                     | **High**                                  | Direct count: `grep -c '^### [CHML][0-9]'` = 51; closure notes present for M14/M18/M19/L1 only prior to this pass |
| 3   | `docs/launch-readiness/FINDINGS_REGISTER.md`                                 | H7 status note                                                              | "Status (2026-07-13): ... stays open only because ... the residual cutover is operator O9 ... followed by O10" — presented as still open                                                                                                      | H7's own stated closure bar (O9 done AND O10 done) was met 2026-07-17 per `docs/HANDOFF.md`'s operator checklist, a full day before this register's own 2026-07-18 edit (on an unrelated finding, M19)                                                                                                                                              | Close H7, citing O9/O10 completion dates                                                                                                                                                                                                            | **High**                                  | `docs/HANDOFF.md` operator checklist: "O9 ✅ 2026-07-17", "O10 ✅ 2026-07-17"                                     |
| 4   | `docs/IMPLEMENTATION_PLAN.md`                                                | Entire document ("Current state (verified 2026-07-12)")                     | "Proposal 0004 is unimplemented"; "Proposal 0003 is unimplemented"; no `/healthz`, no `WORKSPACE_ENABLED`, `npm run deploy` still ships to prod; no legacy importer; no on-canvas layout badges; "Baseline: 262 tests green"                  | Every one of these is now false: 0004's pipeline is live and has deployed to production repeatedly; 0003 (profiles) is live in production (migration v4, `PROFILES_ENABLED:"true"`); `npm run deploy` was deleted (finding L1, closed); the legacy importer and on-canvas badges both ship (verified in code this audit); current test count is 723 | Archive the entire document with a historical-completion header (see `docs/archive/`); replace with a new active `docs/IMPLEMENTATION_PLAN.md`                                                                                                      | **Critical**                              | `docs/CAPABILITY_MATRIX.md` (every row above); `npm test` output (723 tests, this session)                        |
| 5   | `docs/proposals/0003-adaptive-agent-authoring-profiles.md`                   | Header, line 3                                                              | "**Status:** Candidate for a future phase"                                                                                                                                                                                                    | Packets P1–P5 (phases A, B, C of this proposal's own "Delivery phases") are fully implemented, tested (143+ passing tests), and live in production (`PROFILES_ENABLED:"true"` top-level)                                                                                                                                                            | Flip the status line to "Implemented (Phases A–C); Phase D deliberately out of scope — see `docs/ROADMAP.md`"                                                                                                                                       | **High**                                  | `docs/CAPABILITY_MATRIX.md` "Adaptive authoring" section; `wrangler.jsonc:35`                                     |
| 6   | `docs/proposals/0004-isolated-staging-and-deployment-pipeline.md`            | Header, line 3; acceptance-criteria checklist                               | "**Status:** Proposed implementation plan"; every `[ ]` acceptance-criteria box unchecked                                                                                                                                                     | The pipeline is built, has deployed to production repeatedly (v1–v5), and most checklist items are independently confirmed done elsewhere (staging isolation, CI-gated deploys, `v3` bootstrap, workspace flag flip)                                                                                                                                | Flip the status line to "Implemented"; check off the satisfied acceptance-criteria boxes; leave the staging game-day and Cloudflare-alerting boxes unchecked (still genuinely open)                                                                 | **High**                                  | `docs/CAPABILITY_MATRIX.md` "Operations" section; `docs/HANDOFF.md` operator checklist                            |
| 7   | `docs/ROADMAP.md`                                                            | "Next / candidate" → "Production workspace activation"                      | Lists 5 residual operator steps (game day, `v3` bootstrap w/ flag off, Workers Builds disconnect, alerting, flag flip) as still outstanding                                                                                                   | 3 of 5 are done (Workers Builds disconnected O9, `v3` bootstrap done O10, flag flipped O11 — all 2026-07-17, per the same document set's own HANDOFF.md). Only the formal staging game day and Cloudflare alerting remain open                                                                                                                      | Narrow the bullet to the two genuinely-open items, or remove it and fold into the alerting/game-day initiative in the new plan                                                                                                                      | **High**                                  | `docs/HANDOFF.md` operator checklist rows O9–O11                                                                  |
| 8   | `docs/ROADMAP.md`                                                            | "Next / candidate" → "Agentic implementation workflows"                     | Phrased as "Pilot on deployment safety and one editor quality-of-life feature" — prospective                                                                                                                                                  | The workflow has been used for ~20+ packets across multiple sessions (D1–D6, B1, R0–R4, S1–S3, I1–I2, P1–P5, plus this session's admin dashboard and filmstrip work) — the pilot concluded long ago                                                                                                                                                 | Remove from "Next/candidate" or reframe as an established working convention, not a pilot                                                                                                                                                           | **Medium**                                | `docs/HANDOFF.md` PR table; this session's own PR history (#190–#195)                                             |
| 9   | `docs/ROADMAP.md`                                                            | "Next / candidate" → "MCP auth hardening"                                   | "graduate the single shared secret to per-key KV ... or full OAuth" — describes current auth as a shared secret                                                                                                                               | Current MCP auth is already OAuth 2.1 with GitHub as the upstream identity provider, dynamic client registration, and per-user Durable Object isolation — there is no shared-secret mechanism anywhere in the code                                                                                                                                  | Rewrite or remove this bullet; it misdescribes the shipped auth model, not just its future                                                                                                                                                          | **Medium**                                | `worker/index.ts:49-56` (`OAuthProvider` wrapping the whole Worker)                                               |
| 10  | `docs/ARCHITECTURE.md`                                                       | "Known constraints" / follow-on work list (~line 240)                       | Lists "multi-human presence," "visual proposal diffs," and "IndexedDB offline recovery" as still-pending follow-on work                                                                                                                       | All three are shipped and live: presence (`worker/document.ts:216-347`, Packet S1), proposal diffs (`src/workspace/preview.ts`, Packet R1), offline cache (`src/workspace/offline.ts`, Packet S3)                                                                                                                                                   | Remove the three shipped items from the pending list; keep only genuinely-open items (organization ACLs, CRDT-style multi-master editing)                                                                                                           | **Medium**                                | `docs/CAPABILITY_MATRIX.md` "Shared workspace" section                                                            |
| 11  | `docs/ROLLBACK.md`                                                           | Throughout ("Classify the release," "Forward recovery," "Staging game day") | Every worked example and the entire game-day checklist names `v3`/`TopologyDocument` specifically; no mention of `v4` or `v5`                                                                                                                 | `DEPLOYMENT_RUNBOOK.md` has since documented full three-gate procedures for `v4` (`AuthoringProfile`) and `v5` (`AnalyticsLog`), including forward-recovery drills for each — but `ROLLBACK.md` was never updated to reference them                                                                                                                 | Add a short pointer note: the same forward-only principles generalize to any migration; see `DEPLOYMENT_RUNBOOK.md`'s per-migration gate sections for the current list (`v3`–`v5`)                                                                  | **High**                                  | `docs/DEPLOYMENT_RUNBOOK.md:210-274` (v4/v5 gate sections); `docs/ROLLBACK.md` has zero matches for "v4" or "v5"  |
| 12  | `worker/env.ts`                                                              | `profilesEnabled()` docstring (~line 96)                                    | "`env.staging` sets it `\"true\"` so staging observes; production stays unset until the operator activates"                                                                                                                                   | Production's top-level `vars` block sets `PROFILES_ENABLED:"true"` (`wrangler.jsonc:35`) — this has been true since the O11 activation deploy (2026-07-17). The comment describes the pre-activation bootstrap state as if it were still current                                                                                                    | Update the comment to describe the flag mechanism (opt-in, unset ⇒ off) without asserting production's current value, or note the value can drift and point to `wrangler.jsonc` as the source of truth                                              | **Low** (code comment, no runtime effect) | `wrangler.jsonc:35`; `worker/env.ts` comment text                                                                 |
| 13  | `docs/launch-readiness/QA_TEST_PLAN.md`, `docs/launch-readiness/UAT_PLAN.md` | Entire documents                                                            | Both frozen at 2026-07-04, targeting a "T+30 day launch" that predates the workspace, profiles, analytics, and deployment-pipeline work entirely. UAT_PLAN §6 still names `npx wrangler deploy` as the launch mechanism (removed, finding L1) | Production has been live and iterating for weeks; the launch window these plans describe has passed                                                                                                                                                                                                                                                 | Add a short historical banner atop each: "Pre-launch snapshot (2026-07-04), superseded by the live production system — see `docs/CAPABILITY_MATRIX.md` for current status." Do not rewrite the body (historical value as a launch-readiness record) | **Medium**                                | Both docs' own header dates; `docs/ROADMAP.md`'s shipped items directly contradicting named "out of scope" items  |
| 14  | `docs/HANDOFF.md`                                                            | Title (line 1)                                                              | "Handoff — session 2 close (2026-07-15, end of day)"                                                                                                                                                                                          | The body was actively edited across at least 3 additional calendar days (07-17, 07-18) covering two full production activation cycles (profiles v4, analytics v5), a domain migration, and two security fixes — none of which existed as of the titled date                                                                                         | Resolved by this reset: the new `docs/HANDOFF.md` carries a current, accurate date and framing rather than a stale single-session title                                                                                                             | **Medium**                                | `git log --follow docs/HANDOFF.md` shows commits through 2026-07-18                                               |
| 15  | `docs/proposals/0001-live-flow-visualization.md`                             | Header, line 3                                                              | "Status: Implemented — E1 (#65), E2 (#66), E3 (#67), E4 (#68), E5" — no PR number for E5                                                                                                                                                      | Minor citation gap, not a factual error                                                                                                                                                                                                                                                                                                             | Low-value fix; note only, not corrected in this pass (would require archaeology to find the right PR number with no functional benefit)                                                                                                             | **Low**                                   | `docs/proposals/0001-live-flow-visualization.md:3`                                                                |
| 16  | `docs/proposals/0002-shared-human-agent-workspace.md`                        | "Follow-on work" list                                                       | 9 items presented uniformly as pending                                                                                                                                                                                                        | 6 of 9 have shipped (proposal preview + selective acceptance, gesture-native ops, IndexedDB cache, checkpoints/restore/fork/timeline, WebSocket presence, adaptive profiles); only org ACLs, finer leases, and comments/mentions remain open                                                                                                        | Not corrected in this pass (proposal 0002 predates the current archival convention; its status line "Accepted for Phase 0" is technically still true — only the follow-on list is stale). Flagged here for a future doc pass                        | **Low**                                   | `docs/CAPABILITY_MATRIX.md` "Shared workspace" section                                                            |

## Follow-up — 2026-08-09

- Row 13 is superseded: `QA_TEST_PLAN.md` and `UAT_PLAN.md` are now living
  release-cycle plans, backed by `USER_GUIDE.md` and
  `TRACEABILITY_MATRIX.md`. The original pre-launch bodies remain recoverable
  from Git history.
- Rows 4, 10, and 14 were revalidated and their living documents now carry the
  August baseline. Static test/PR/issue counts were removed or made explicitly
  revision-scoped.
- Former finding H1, referenced by the July capability/roadmap baseline, is
  fixed by commits `aa4e88c` and `7e3f8ed`; algorithmic layout now carries
  anchors and manual waypoints by node id.
- This register is a documentation-audit record, not a live defect dashboard.
  Use appended status notes in `launch-readiness/FINDINGS_REGISTER.md`, the
  capability matrix, and the current QA/UAT evidence for release decisions.

## Not corrected in the July pass (explicitly deferred, with reasoning)

- **Rows 15–16**: citation/list staleness with no risk of misjudging current system state once a reader consults `docs/ROADMAP.md` or `docs/CAPABILITY_MATRIX.md`. Low value relative to the size of the change.
- **Full `docs/ROLLBACK.md` generalization to a migration-agnostic template**: row 11's pointer note is a safe, cheap mitigation; a full rewrite is a larger editorial project better scoped as its own small packet (see `docs/IMPLEMENTATION_PLAN.md` → N-series).

## Follow-up — 2026-10-09

- `deploy-production.yml` drifted from proposal 0004 decision 3 (its table
  says "Push/merge to `main` → required checks, protected production
  approval → Production"): the implementation is manual-dispatch plus a
  `production` environment required-reviewer click. With one owner that click
  only ever approved the dispatcher's own dispatch, and the agent's GitHub
  identity is the owner's, so it gated nothing while adding a desktop-only
  step (GitHub Mobile cannot approve it). The required reviewers were removed
  2026-10-09; the deployment-branch rule (`main` only) and the `guard` job
  remain the controls. Docs updated in the same change: `DEPLOYMENT_RUNBOOK`,
  `GAME_DAY`, `HANDOFF`, `AGENTIC_IMPLEMENTATION_WORKFLOW`, `ALERTS`,
  `CAPABILITY_MATRIX`, `ROADMAP`. A merge-is-release redesign (push to
  `main` → CI → staging rehearsal → migration guard → production) is under
  discussion and, if adopted, lands as a new proposal. Historical records
  (`IMPLEMENTATION_PLAN`, `PACKET_ISSUES`) keep their original "approve the
  production deploy" wording as the record of what was done.

## Follow-up — 2026-10-10

- **Closed: the 0004 decision-3 drift.** Proposal 0007
  (`proposals/0007-merge-is-the-release.md`) is adopted and implemented:
  `release.yml` runs on every non-docs push to `main` (CI on the merge SHA →
  staging rehearsal → Durable Object migration guard → production → record),
  which is what 0004's table always said ("Push/merge to `main` →
  Production") minus the approval click that gated nothing. The manual
  `deploy-production.yml` is deleted; `deploy-staging.yml` and `release.yml`
  share one deploy implementation (`deploy-worker.yml`). Docs updated in the
  same change: `DEPLOYMENT_RUNBOOK`, `ROLLBACK`, `GAME_DAY`, `HANDOFF`,
  `AGENTIC_IMPLEMENTATION_WORKFLOW`, `ALERTS`, `ROADMAP`, `wrangler.jsonc`
  header, `src/mcp/README.md`. Not updated (historical or outside this
  change's scope — still say "deploy-production"): `CAPABILITY_MATRIX.md`,
  `CLOUDFLARE_OPERATOR_RUNBOOK.md`, `ARCHITECTURE.md`,
  `launch-readiness/FINDINGS_REGISTER.md`, `archive/*`, and the completed
  `v3`–`v5` rollout examples in `DEPLOYMENT_RUNBOOK.md` (which carry a note).
  Proposal 0004's own text is left as the record of the original design;
  0007 states what supersedes it.

## Follow-up — 2026-11-13

Accuracy pass over the planning, architecture and operations docs against
`main` at `e99b012` (code, `wrangler.jsonc`, `.github/workflows/`, `scripts/`
and `git log`; the local clone is shallow, so history before 2026-08-16 was
not re-read). Counts quoted here are evidence for that revision only.

Found and corrected:

- **`HANDOFF.md` baseline was three months stale** (`4add174`, "849 Vitest
  cases in 71 files plus 11 Chromium cases", "three visual cases"). Now
  `e99b012`: 1768 Vitest cases in 146 files, 32 Playwright cases in 9 spec
  files, 5 visual cases; `catalog:check` and the CI `visio` job added to the
  gate description. The "Recently completed" and "Key files" sections had no
  entry for anything merged after PR #243 (exports, hardware catalog, SD-WAN
  generator, API keys, landing page); added.
- **Flag inventory.** `HANDOFF.md`, `ROADMAP.md`, `ALERTS.md`,
  `DEPLOYMENT_RUNBOOK.md` and `GAME_DAY.md` described three flags.
  `wrangler.jsonc` has five: `API_KEYS_ENABLED` (staging `"true"`,
  production `"false"`) and `LIVE_DATA_ENABLED` (`"false"` in both) were
  missing or only partly reflected. `GAME_DAY.md` step 1.6 said "record all
  six values".
- **Smoke check count.** "14-check smoke" in `HANDOFF.md`, `ROADMAP.md`,
  `ALERTS.md` and "14/14" in `GAME_DAY.md` S-0 / P-1: `scripts/smoke.mjs`
  runs 15 since proposal 0005 added `mcp-apikey-unauth`. The dated
  2026-07-19 spot-check figures in `ALERTS.md` are left as recorded.
- **Workspace tool count.** `GAME_DAY.md`'s forward-recovery table said "the
  8 workspace MCP tools"; `WORKSPACE_TOOL_NAMES` (`worker/workspace-tools.ts`)
  lists 11.
- **MCP tool inventory.** `ROADMAP.md` said "62 possible tool
  registrations"; `createTools` with every optional dependency supplied
  returns 72 at `e99b012` (43 with none).
- **Shipped items listed as pending.** `ROADMAP.md` _Next_: hardware catalog
  "Phases 1-3 merged, Phase 4 in review" (Phases 1–5 merged, PRs #285–#288,
  #290) and the light-theme contrast fix "in review" (merged, PR #289).
  `futures/hw-catalog.md` Phase 5 and `futures/light-theme-contrast.md`
  status lines said "in review". `IMPLEMENTATION_PLAN.md` and
  `PACKET_ISSUES.md` still read "implemented this PR … do not merge/deploy"
  for A1–A6 (merged as PR #243) and carried no done-marker for O3.
- **Closes the 2026-10-10 "not updated" list for two files.**
  `ARCHITECTURE.md` (production deploys via `deploy-production.yml` behind a
  protected environment approval) and `CLOUDFLARE_OPERATOR_RUNBOOK.md`
  ("latest `deploy-production` run", "daily verify") now describe
  `release.yml` and the hourly verify. `ROADMAP.md` "Deliberately excluded"
  still named the protected-environment approval; corrected.
- **`ARCHITECTURE.md` module map and engine claim.** The Layers block
  predated `src/export/`, `src/import/` (beyond legacy), `src/catalog/`,
  `src/profile/`, `src/share/`, `src/ui/`, `src/connect/generate.ts` and
  most of `src/render/`; extended. Locked decision 5 said "the engine is
  vendored unmodified" and Known constraints listed three sanctioned edits;
  `git log -- public/vendor/topology-ds.js` shows targeted engine edits in
  more than a dozen commits since August (flow paths following links, wire
  labels, link anchor box, tiers, rounded corners, light-theme knobs, map
  backdrops). Both statements now say so.
- **Proposal 0007 status line** said "pending the owner's GitHub settings
  changes … before the first unattended release"; the workflows merged as
  PR #273 and `release.yml` is the only production path in the repository.
  The settings checklist itself stays unchecked (see below).
- **Stale cross-reference.** `IMPLEMENTATION_PLAN.md` / `PACKET_ISSUES.md`
  O1 acceptance cites a `HANDOFF.md` "O12" checklist row that no longer
  exists; annotated to point at the `CLOUDFLARE_OPERATOR_RUNBOOK.md`
  checklist.

Revalidated, no change needed: Durable Object classes and migration tags
`v1`–`v5` (identical in both environments); `release.yml` triggers, jobs
and dispatch inputs; `deploy-staging.yml` inputs; `production-verify.yml`
hourly schedule; `nightly-staging-smoke.yml`; the smoke check table in
`DEPLOYMENT_RUNBOOK.md`; `ROLLBACK.md`'s freeze, rollback and
migration-class rules; every relative link in the files reviewed.

Initiative status confirmed, not changed: B, E and T are **not started**
(no `src/briefs/`, `src/stories/`, `create_from_brief`,
`compile_flow_story` or recorded EdgeConnect fixtures). Their packets now
carry a note that the SD-WAN generator (proposal 0010) overlaps B and that
the live-fabric tools also require `LIVE_DATA_ENABLED`.

Left as unverified (the repository cannot evidence these; not flipped):

- Cloudflare notification policies (O1, CF-1..CF-6) and whether a game day
  has been executed (O2).
- The proposal 0007 GitHub settings checklist in `HANDOFF.md` (branch
  protection, environment reviewers, token scoping, `release-freeze` label).
- Which SHA production and staging currently serve, and whether any
  `ORCH_*`, `DIAGNOSTICS_TOKEN` or `SESSION_HMAC_SECRET` secret is set.
- Verification of `.vsdx` / `.pptx` output in Microsoft Visio / PowerPoint,
  and publication of `server.json` to the MCP registry.

Not corrected in this pass (outside its file scope, flagged for the owning
docs): `CAPABILITY_MATRIX.md` still says "60 possible registrations"; the
`worker/env.ts` and `worker/workspace-tools.ts` comments still say "the
eight workspace MCP tools". Rows 15–16 above remain as deferred in July.

## Follow-up: 2026-11-16

Scheduled docs audit of `main` at `60e5812` against base `e99b012` (the
newest SHA in the capability matrix header). Each item says how it is known:
**Confirmed** (read in code or reproduced this run), **Observed** (reported by
a test run, not re-checked) or **Inferred**.

| #   | Document                                      | Section                             | Current claim                                                                      | Actual repository state                                                                                                                                                                                                                                                                                                                                                                          | Required correction                                                                                                                                              | Severity   | Evidence                                                                                                                                                                    |
| --- | --------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 17  | `docs/sitrep/2026-11-15-pre-audit-handoff.md` | §2 "Agent tool list"; §7 lead 11    | "stdio lists 35 tools in 44,088 bytes (limits 35 and 44,200)"                      | Confirmed: the stdio server (`src/mcp/server.ts`) passes `catalog: nodeCatalogLoader()`, so it also lists the five hardware tools: 40 tools, 49,257 bytes, measured the way `src/mcp/token-budget.test.ts` measures. That test's "local (stdio)" case passes only `renderDocument`, so the list a stdio agent actually loads has no budget. Suspected test gap, not a doc fix; code not changed. | Dated record, not edited. Owner decision: budget the deployed stdio configuration in `token-budget.test.ts`, or state that the stdio limit excludes the catalog. | **Medium** | `src/mcp/server.ts` (`registerTopologyTools` deps); `src/mcp/hardware-tools.ts` gate on `deps.catalog`; `src/mcp/token-budget.test.ts` (`STDIO`); throw-away probe this run |
| 18  | `docs/sitrep/2026-11-15-pre-audit-handoff.md` | §6.1, §8 first row, Appendix B (H8) | A custom node spec can inject markup; open                                         | Confirmed resolved by `fbcb0d8` (PR #324): `sanitizeCustomNode` (`src/nodes/sanitize.ts`) rebuilds every spec from an allowlist at `parseDoc`, `defineNodeType` and the Designer save. The sitrep's own probe, re-run this audit with the payload in `strokeW`, `size`, `radius`, `ledCount`, `portCount`, `badgeText`, `icon` and `shape` (circle shape only), no longer reaches the SVG.       | Dated record, not edited. `HANDOFF.md` "Known risks" now carries a dated note.                                                                                   | **High**   | `src/nodes/sanitize.ts` (`sanitizeCustomNode`); `src/pages/persist.ts` (`parseDoc`); `src/nodes/custom-node-spec.test.ts`; probe this run                                   |
| 19  | `docs/HANDOFF.md`                             | "Key files", Auth row               | `worker/auth.ts`, `worker/landing.ts`, `public/landing/`, `public/showcase/*.webp` | Confirmed: the MCP consent flow, provider options and connected-apps page added by PR #322 live in `worker/mcp-authorize.ts`, `worker/oauth-options.ts` and `worker/connections-page.ts`, which the row does not name.                                                                                                                                                                           | Add them to the row. Not edited this run: the row is not a dated passage.                                                                                        | **Low**    | `worker/default-handler.ts` (`route`: `/authorize`, `/callback`, `/connections`, `/api/connections`)                                                                        |
| 20  | `docs/CAPABILITY_MATRIX.md`                   | Operations, "Browser release gate"  | "nine Chromium spec files as of `e99b012`"                                         | Confirmed: `e2e/` holds 29 spec files at `60e5812`. The claim is scoped to `e99b012`, so it is dated rather than wrong.                                                                                                                                                                                                                                                                          | Refresh when the Operations section is next deep-audited.                                                                                                        | **Low**    | `ls e2e/*.spec.ts`                                                                                                                                                          |

Corrected in the living docs this run (Confirmed against code):

- `CAPABILITY_MATRIX.md` tool inventory said 73 definitions and 9
  operations-only; `createTools` with every dependency defines 74, lists 64
  hosted, and `OP_ONLY_TOOLS` has 10.
- The MCP consent page, browser-bound flow state, S256-only PKCE, the
  refusal of pre-consent grants, and `/connections` (PR #322) were described
  only in `src/mcp/README.md`. Added to `USER_GUIDE.md` (hosted MCP endpoint,
  authentication troubleshooting), `ARCHITECTURE.md` (identity, module map),
  `README.md` and the matrix.
- Custom node spec hardening and per-document type registration (PRs #323,
  #324) were in no living doc. Added to `USER_GUIDE.md` (Node Designer),
  `ARCHITECTURE.md` (untrusted documents, document model, module map) and the
  matrix.
- `validate_topology`'s 60-finding cap with `omitted` / `counts`
  (`MAX_VALIDATE_PROBLEMS`, `src/mcp/tools.ts`) was undocumented; added to
  `src/mcp/README.md`.
- Oversized workspace syncs split into several commits, and the **sync
  rejected** state after three refusals (`src/workspace/batch.ts`,
  `MAX_SYNC_REFUSALS` in `src/ui/workspace-panel.ts`), added to
  `USER_GUIDE.md`.
- Single-overlay fabrics draw unlabelled overlay tunnels
  (`src/connect/compile.ts`); added to the SD-WAN generator section of
  `USER_GUIDE.md`.
- Server-side PNG / PDF redraw the deny, redirect and NAT marker icons
  (`UNDRAWABLE`, `src/export/raster.ts`); other emoji marker icons still
  print as boxes. Added to `EXPORTS.md`.

Resolved since an earlier follow-up:

- 2026-11-13 "Not corrected": "`CAPABILITY_MATRIX.md` still says 60 possible
  registrations". Resolved by `13a1822` (73 definitions) and corrected to 74
  by this run.

Still open from earlier follow-ups, re-checked this run: the
`worker/env.ts` and `worker/workspace-tools.ts` comments (and the test helper
`src/testing/worker-fixtures.ts`) still say "the eight workspace MCP tools";
`WORKSPACE_TOOL_NAMES` has 11. Code comments, not edited.

## Follow-up: 2026-11-19

Documentation pass for PRs #326 and #327 (both merged 2026-11-19, as `e9d0d7f`
and `d224979`) and for PR #328. Checked against the tree
at `d224979` and, for the compact layout, at `d24f6a4`. Each item says how it
is known; **Confirmed** means read in the code, in `git log` or in the running
app this run.

| #   | Document                                                                                                                                                                                                            | Section                                                                          | Current claim                                                                                                                                                                                                                                                                                                                                      | Actual repository state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Required correction                                                                                                                                                                                                                                                                                                                                                                                                             | Severity   | Evidence                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 21  | `docs/proposals/0013-ui-overhaul.md`                                                                                                                                                                                | Status header                                                                    | "P1 (shell), P2 (properties panel), P3 (skin sweep) and P4 (guardrails) have not changed a surface"; PR #327 is a draft                                                                                                                                                                                                                            | Confirmed: `git log` has PR #327 merged as `d224979`; the tree has the top bar and menus (`src/ui/menus.ts`), the rail, pages bar and zoom control (`src/styles/shell.css`), the palette (`src/ui/palette-sources.ts`) and the tabbed panel (`src/ui/inspector/`).                                                                                                                                                                                                                                                                                                                                         | Header rewritten 2026-11-19 with a status line for each phase.                                                                                                                                                                                                                                                                                                                                                                  | **High**   | `git log --oneline e9d0d7f..d224979`; `ls src/ui/inspector`                                                                                                     |
| 22  | `docs/HANDOFF.md`, `docs/ROADMAP.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/launch-readiness/QA_TEST_PLAN.md` §7.15–§7.16, `TRACEABILITY_MATRIX.md` REQ-032, REQ-033, `docs/CAPABILITY_MATRIX.md` row for the chrome | Status passages for proposal 0013                                                | PR #327 is a draft and not merged; until it merges `main` has no command registry; no surface of P1–P4 has changed                                                                                                                                                                                                                                 | Confirmed: merged as `d224979` (a given fact of this pass, and `git log`). `src/ui/commands.ts` and the shell are on the tree.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Corrected 2026-11-19. HANDOFF keeps its older dated notes and marks them superseded in a new note; the roadmap, plan, QA plan, traceability and matrix passages were edited in place.                                                                                                                                                                                                                                           | **High**   | `git log --oneline d224979 -1`; `grep -rn "draft" docs/HANDOFF.md docs/ROADMAP.md`                                                                              |
| 23  | `docs/launch-readiness/QA_TEST_PLAN.md` EDT-40, EDT-43, EDT-44; `TRACEABILITY_MATRIX.md` REQ-032, REQ-033; `docs/CAPABILITY_MATRIX.md`                                                                              | Rows that name controls                                                          | "The toolbar … docked"; "the toolbar button" opens the shortcut sheet; the sheet is grouped "… View, Frames, Help"; the flipbook export is a `#fExport` option of the browser toolbar                                                                                                                                                              | Confirmed: the toolbar is gone (`src/main.ts` builds `#topbar`); the sheet is opened by the rail's `#tHelp` and its group is "Pages" (`e2e/command-surfaces.spec.ts`); `#fExport` does not exist and `file.export.flipbook` is a menu command; test counts in EDT-34, EDT-35 and EDT-43 were older than the specs.                                                                                                                                                                                                                                                                                         | Corrected 2026-11-19; the counts are `test(` declarations at `d24f6a4`. In `CAPABILITY_MATRIX.md` the rows for PDF, copy-as-image, draw.io, Visio, PowerPoint and Mermaid export and the Share dialog still cited `#fExport` or a `#fShare` toolbar button; they were corrected later the same day to name `#fExport` as the control before PR #327 and the Export button, **File → Export** and the top bar's `#fShare` since. | **Medium** | `grep -n fExport src/main.ts`; `grep -cE "^\s*test\(" e2e/*.spec.ts`                                                                                            |
| 24  | `docs/proposals/0013-ui-overhaul.md`                                                                                                                                                                                | Target layout; "Where every toolbar control goes"; Properties panel; "Done when" | The text as first written: Ctrl+K absorbs Find and quick-add; "page" everywhere; the anchor box and Distribute ends are visible on selecting a node with no clicks; Problems entries open the tab and field; preferences are linked from the agent panel; the problem-badge toggle is in the Problems header; on phones the rail is a bottom strip | Confirmed: none of these holds on the tree (Find and quick-add are unchanged; "frame" remains in the Find box, the presentation controls and the shortcut sheet's Presentation rows, the path bar and the path analysis messages, the Page tab's Story hint, Caption placeholder and empty-list line, the Analyze path tooltip and the delete-page confirmation; the node override's fields need the switch on; a jump shows the Selection tab only; the preferences are in the account menu only; badges are in View only; the rail stays a left column at 390 px). The proposal text is kept as written. | Recorded in the proposal's section "What P1 and P2 changed from this text". No code changed.                                                                                                                                                                                                                                                                                                                                    | **Medium** | The section's own evidence lines; `grep -rin frame src/main.ts src/ui`                                                                                          |
| 25  | `docs/proposals/0013-ui-overhaul.md` (P3) and `docs/futures/light-theme-contrast.md`                                                                                                                                | P3: "Light theme contrast pass (see …)"                                          | The linked document is the plan for the light-theme contrast pass of the chrome                                                                                                                                                                                                                                                                    | Confirmed: the document is about the rendered output (`render_svg`, exports; PR #289) and its outcome says nothing of the editor chrome. The chrome's contrast is guarded by token tests (`src/styles/styles.test.ts`, "token contrast"), not by a per-surface check.                                                                                                                                                                                                                                                                                                                                      | A dated note on the futures document says so; the proposal's P3 status line says what is and is not checked.                                                                                                                                                                                                                                                                                                                    | **Low**    | `docs/futures/light-theme-contrast.md` "Outcome"                                                                                                                |
| 26  | `docs/launch-readiness/FINDINGS_REGISTER.md`                                                                                                                                                                        | November 2026 review: QA-2026-11-14-UI-01, A11Y-01, A11Y-02                      | UI-01 open: the toolbar is wider than the window below about 1,850 px; A11Y-01 open: the context menu has no keyboard trigger; A11Y-02 open: toggles expose no pressed state                                                                                                                                                                       | Confirmed: the toolbar is replaced by a 44 px top bar that does not scroll sideways at 1,024 to 1,920 px (`e2e/shell-menus.spec.ts`; measured in the dev server 2026-11-19); Shift+F10 and the menu key open the context menu (`e2e/shell-menus.spec.ts`); the tool, grid, snap, Calm, library and minimap toggles expose `aria-pressed` and the pages toggle `aria-expanded` (measured). Still open: the properties toggle has neither; canvas elements still cannot be reached from the keyboard (not re-tested); placeholders of the title and palette fields were not measured.                        | Closure notes added to the findings register 2026-11-19: UI-01 closed; A11Y-01 and A11Y-02 part closed.                                                                                                                                                                                                                                                                                                                         | **Medium** | `e2e/shell-menus.spec.ts` ("the top bar never scrolls sideways at ${width}px, signed in"; "Shift+F10 and the menu key open the context menu from the keyboard") |
| 27  | `docs/EXPORTS.md`; `docs/launch-readiness/UAT_PLAN.md` UAT-PR-01 step 7                                                                                                                                             | Prose that names the old toolbar                                                 | "the editor toolbar (**svg**, **png**, and the **export…** menu)"; "the **sign in** chip in the toolbar"                                                                                                                                                                                                                                           | Confirmed: there is no toolbar; exports are in **File → Export** and the Export button, and the sign-in chip is in the top bar.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Not edited in this pass (outside the documents it covered). Open.                                                                                                                                                                                                                                                                                                                                                               | **Low**    | `grep -n toolbar docs/EXPORTS.md docs/launch-readiness/UAT_PLAN.md`                                                                                             |

Resolved since an earlier follow-up: none of the open items of 2026-11-16 was
touched by this pass. The "nine Chromium spec files as of `e99b012`" claim
(row 20) is still a dated claim; `e2e/` holds 37 spec files at `d24f6a4`.

Open in the product, found while writing these documents (code not changed; the
proposal's status lines carry the detail):

- Surfaces still in the old skin: the Share dialog, the presentation controls,
  the shortcut sheet's close button and the path bar use `.tbtn`; seven
  `font-size` rules under 12 px remain (`NOT_YET` in
  `src/styles/styles.test.ts`); several surfaces set `color: var(--accent)` as
  text instead of `--accent-fg` (`grep -rn "color: var(--accent)" src/styles`).
  Whether those fall under 4.5 : 1 was not measured.
- Guardrails not built: a cap on the top bar's controls, and the one-time "what
  moved" note. What exists is the 12 px ratchet and the properties panel's
  layout spec.
- A jump from a Problems entry shows the Selection tab but does not open the
  section or focus the field; the tabs' `reveal` function is not called by the
  shell.
- Two or more nodes have no shared fields in the panel (QA-2026-11-14-UI-04,
  re-checked: still open).
- A new page is still named "Frame N", and the Find box, the presentation
  controls and the shortcut sheet's Presentation rows, the path bar and the
  path analysis messages, the Page tab's Story hint (which names the
  context-menu item "Emphasize on this frame"; the item is "Emphasize on this
  page"), its Caption placeholder and empty-list line, the Analyze path
  tooltip and the delete-page confirmation say "frame".

## Follow-up: 2026-11-19, second pass (PR #328)

The documents were checked again against PR #328's branch at `61e4d7e` (the
code of the later slices for PR #328). "Closed" below means closed by PR #328's
code at that commit: before PR #328, `main` had what the first pass of
2026-11-19 recorded. Each item says how it is known.

Closed by PR #328:

- Row 27 (`docs/EXPORTS.md`, UAT-PR-01 step 7 naming the toolbar): both
  corrected in this pass; `grep -n -i toolbar docs/EXPORTS.md
docs/launch-readiness/UAT_PLAN.md` finds nothing in them.
- "Surfaces still in the old skin": `grep -rn tbtn src e2e` finds nothing,
  `src/styles/toolbar.css` is deleted, `NOT_YET` is gone from
  `src/styles/styles.test.ts`, and no stylesheet sets text or an icon in
  `color: var(--accent)` (what remains of `var(--accent)` is borders and
  `accent-color`). Confirmed by those commands this pass. Whether each surface
  reaches 4.5 : 1 was measured in a browser while it was converted; the token
  contrast is asserted, the surfaces' is not (see below).
- "Guardrails not built": the control budgets, the text-size walk and the
  sideways-scroll test are `e2e/shell-budget.spec.ts` and
  `src/ui/shell-budget.test.ts`; the "what moved" note is
  `src/ui/shell-note.ts`. Confirmed in the tree; an extra top-bar button and a
  rule setting text at 11 px each fail a unit test (tried this pass).
- "A jump from a Problems entry ... does not open the section or focus the
  field": `problemField` and `revealProblemField` do, and a page or document
  problem calls `InspectorTabs.reveal` (`e2e/problems-panel.spec.ts`, "a jump
  to a problem about a field opens its section and focuses it").
- Row 24, "page everywhere": the Find box, the presentation bar and the
  shortcut sheet's Presentation rows, the path bar and its messages, the Page
  tab's hints, the Analyze path tooltip and the delete-page confirmation say
  page (`grep -rn -i frame src/main.ts src/ui` finds code comments, command
  ids, CSS classes, a storage key and the default page name "Frame N").
- `docs/futures/light-theme-contrast.md` keeps its body about the rendered
  output; a dated update for the chrome was added at its end.
- A11Y-02's "panel toggles expose no expanded state": the properties toggle has
  `aria-controls` and `aria-expanded` (`e2e/shell-inspector-tabs.spec.ts`).
  The register row itself is not edited: its other parts (tool toggles'
  pressed state, the muted-text token) were not re-checked.
- The user guide said the shared-copy banner's buttons were "keep this copy",
  "back to my document" and "unpublish link", and the Share dialog's "copy"
  and "revoke"; the banner's text had been sentence case since `4fd8ed1`.
  Corrected to the labels in the tree.

Open, found in this pass and not fixed:

- No test asserts the contrast of the surfaces in the light theme or of the
  present bar; EDT-71 is manual.
- The disabled Selection tab is drawn at `opacity: 0.4`
  (`.tab[aria-disabled='true']` in `src/styles/controls.css`), which puts its
  text below 4.5 : 1. It is `aria-disabled`, and WCAG exempts a disabled
  control from the text contrast rule; the text-size walk does not check
  contrast, so nothing flags it.
- The Display settings popover keeps its two choices (Ambient backdrop and
  Wheel) as selects, not as `.seg`, because specs drive them with
  `selectOption`.
- The workspace-sync spec "a commit the server refuses stops retrying and
  shows the reason" took 19.6 s in this pass's CI-settings run (19.7 s in the
  earlier slice's), within 0.4 s of the 20 s limit the QA plan now sets
  (§10.2); the ten slowest tests are in the QA plan's §4.4.
- SVG animation drawn by `src/render-svg` and the editor's pulses is outside
  the stylesheets, so the new duration test does not cover it.
- Code comments in `src/main.ts` still say "frame" for what the shell calls a
  page (for example the Find section's header comment); not edited.
- Rows 21 to 26 above keep their first-pass text: they record what the
  documents said and what `main` had then.
