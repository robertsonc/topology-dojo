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
