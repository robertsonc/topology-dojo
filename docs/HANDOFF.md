# Handoff — session 2 close (2026-07-15, end of day)

The current pick-up doc. Session 2 ran 2026-07-13 → 07-15 and shipped the
R-train, the S-train (minus S4), the flat viewer, and proposal 0003 packets
P1–P3 — including the **first `v4` migration deploy through the 0004 pipeline**
with a successful forward-recovery drill.

## Where things stand (everything merged; no open PRs)

- **`main` is the complete state**: R2/R3/R4, flat viewer, S1/S2/S3, P1
  (feature extraction), P2 (`AuthoringProfile` DO + observe-only learner,
  migration `v4`), P3 (Authoring Preferences panel + `/api/profile*` routes),
  the session handoff + runbook v4 gates, and all docs truth-ups.
- **Staging** (`topology-dojo-staging`): running with **`v4` applied** and
  **`PROFILES_ENABLED="true"`** — the observe-only learner is live and
  accumulating candidates from the owner's MCP correction loops. Last verified
  deploy + smoke: 7/7 green (see Gate A evidence below). NOTE: `main` has moved
  past the last staging deploy (P3 merged after) — **dispatch
  `deploy-staging.yml` from `main`** to get the prefs panel onto staging and
  see the learner's candidates.
- **Production**: the first gated Actions deploy (O10) ran 2026-07-17 — run
  29593411599 applied `v1`–`v4` together from `main`@f4b8921 with the
  `workspace_disabled` bootstrap smoke green — followed by a combined
  activation deploy (`WORKSPACE_ENABLED:"true"` + `PROFILES_ENABLED:"true"`,
  operator decision to activate both at once after P4 staging UAT). Recovery
  for either feature is forward-only flag-off. O9 was completed later the
  same day after the still-connected Workers Builds integration push-deployed
  `main` past the approval gate twice (un-attested `sha: null` deploys of the
  P4-activation and P5 merges); the gated pipeline is now the only deploy
  path. O12 (alerting) remains open — the activation soak runs without
  alerts by explicit operator choice.
- **Production domain + analytics (2026-07-18)**: the production origin moved
  from the `workers.dev` subdomain to **`topology-dojo.harnessed.cloud`** (custom
  domain in the Cloudflare dashboard; the production GitHub OAuth App callback
  was repointed to match). `PUBLIC_BASE_URL` and the production deploy/smoke
  references were truth-upped (PR #190). The **admin/analytics dashboard (`v5`)**
  then rolled out straight to production (staging UAT skipped by operator
  choice — the bootstrap is inert and `v5` mirrors the staging-proven `v4`):
  Gate B run 29622343320 applied `v5` **inert** + cut the domain over (verified:
  `/healthz` served the new sha, `/api/admin` returned the inert
  `admin_disabled` 503); Gate C run 29622993652 flipped
  `ANALYTICS_ENABLED:"true"` (PR #191), verified live by `/api/admin` switching
  from 503 to a 401 auth challenge and owner UAT of the dashboard. Recovery is
  forward-only flag-off; never roll back across `v5`.
- **Git**: clean. All session branches merged + pruned (local and remote);
  ~113 historical merged remotes also deleted. One unrelated branch
  `claude/hideable-frames-panel-ohlc73` appeared on origin from another
  session.

## Gate A — v4 staging proof (DONE, 2026-07-15)

| Step                                    | Evidence                                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `v4` applied to staging (P2 build)      | [run 29386077720](https://github.com/robertsonc/topology-dojo/actions/runs/29386077720) — CI (incl. workerd DO suites) + deploy green      |
| External smoke, learner observing       | 7/7 incl. sha assertion                                                                                                                    |
| Forward-recovery drill: flag-off deploy | [run 29386230142](https://github.com/robertsonc/topology-dojo/actions/runs/29386230142) — smoke 7/7, learner disabled cleanly forward-only |
| Re-enable                               | [run 29386327844](https://github.com/robertsonc/topology-dojo/actions/runs/29386327844) — smoke 7/7                                        |

This satisfies the runbook's v4 Gate A **and** constitutes a real
forward-recovery exercise performed in staging (a 0004 acceptance criterion).
Owner UAT of MCP workspace flows (propose/accept/lease) was confirmed done by
the operator. Full evidence also posted on PR #176.

Merge-history footnote: P2's content reached `main` via **#178** (the drill
branch was stacked on P2, and its auto-created PR was merged), which also
briefly pinned staging's flag off; **#179** restored `PROFILES_ENABLED="true"`.
GitHub therefore shows #176 as merged without its own merge commit.

## What shipped in session 2 (chronological, all on `main`)

| PR        | What                                                                     |
| --------- | ------------------------------------------------------------------------ |
| #159      | O7 activation observation window + stop thresholds (runbook)             |
| #160      | Slim hover-reveal scrollbars                                             |
| #161      | D6 docs truth-up + findings closure (H7/M14/M15/L1)                      |
| #162      | Collapsed-palette icon fix; minimap docked left; Problems pinned right   |
| #163      | **R2** selective proposal acceptance                                     |
| #164/#167 | **R3** checkpoints, forward-only restore, fork (+ 2 MCP tools)           |
| #165/#171 | **R4** revision timeline                                                 |
| #166      | **Flat viewer** (glow = emphasis-only channel; exports match)            |
| #168      | Roadmap truth-up + adjustable-viewer item                                |
| #169      | **S1** WebSocket push + presence (hibernation-friendly)                  |
| #171      | **S2** gesture-native operations + referee fallback                      |
| #173      | **S3** IndexedDB offline cache + crash recovery                          |
| #174      | Roadmap: resize link labels (`labelScale`)                               |
| #175      | **P1** deterministic feature extraction (`SemanticFeatures`)             |
| #176/#178 | **P2** `AuthoringProfile` DO + observe-only learner (**migration `v4`**) |
| #177      | Session handoff + runbook v4 gates                                       |
| #179      | Restore staging `PROFILES_ENABLED="true"`                                |
| #180      | **P3** Authoring Preferences panel (prefs button, pause/forget)          |

**S4 (finer element-set leases) deliberately skipped** — per-page leases are
fine; revisit only on measured contention.

## Operator checklist

| Item                              | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1–O8                             | ✅ (staging isolated + live; CI-gated pipeline proven; O7 thresholds set)                                                                                                                                                                                                                                                                                                                                                                                                                      |
| v4 Gate A (staging + drill)       | ✅ **done this session** (evidence above)                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Staging UAT (MCP workspace flows) | ✅ confirmed by operator                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| O9                                | ✅ 2026-07-17: Workers Builds Git integration disconnected (its push-triggered `wrangler deploy` had bypassed the gate twice); verified by the next `main` merge deploying nothing un-gated                                                                                                                                                                                                                                                                                                    |
| O10                               | ✅ 2026-07-17: first gated production deploy (run 29593411599) applied `v1`–`v4`; `workspace_disabled` bootstrap smoke green                                                                                                                                                                                                                                                                                                                                                                   |
| O11                               | ✅ 2026-07-17: `WORKSPACE_ENABLED:"true"` activation (combined deploy with profiles); T0 smoke on deploy, owner runs T1/T2                                                                                                                                                                                                                                                                                                                                                                     |
| O12                               | ◑ Partial. **Nightly staging smoke** ✅ (`nightly-staging-smoke.yml`, 08:00 UTC, files/closes a `nightly-smoke` issue via GitHub-native notification — no secrets). **Failed-deploy notifications**: GitHub's built-in Actions failure emails (per-user Settings → Notifications; no repo change). **Cloudflare error-rate alerting** ⏳ still open — dashboard-only, thresholds in `DEPLOYMENT_RUNBOOK.md` §"Rate-based stops"; this is the one gating the activation soak (owner working it) |
| Profiles activation (prod)        | ✅ 2026-07-17: top-level `"PROFILES_ENABLED": "true"` shipped in the combined activation deploy after P4 staging UAT                                                                                                                                                                                                                                                                                                                                                                           |
| Analytics dashboard (`v5`)        | ✅ 2026-07-18: shipped + live in production. Gate B (run 29622343320) applied `v5` inert + the `harnessed.cloud` cutover; Gate C (run 29622993652, PR #191) flipped `ANALYTICS_ENABLED:"true"`. Verified live (`/api/admin` 503→401) + owner UAT. Staging also runs the flag on. See runbook §"Migration `v5`".                                                                                                                                                                                |

## Next repo work, in order

1. ~~**Deploy staging from `main`**~~ — DONE 2026-07-17 (run 29589426103,
   `main`@35ae08d, green): the P3 prefs panel is live on staging. Owner
   sanity when convenient: sign in → prefs button → candidates listed.
2. ~~**P4 (0003-B)**~~ — DONE (this branch/PR): confirmation & scoping in the
   panel (browser-owner only — no MCP confirm path, by construction; the
   cookie-authed `/api/profile/*` confirm/reject routes are the only
   promotion path) + `get_authoring_guidance` / `list_authoring_preferences`
   / `explain_authoring_preference` read-only MCP tools under **hard token
   budgets as tests** (≤5 rules, ≤400 default / 800 absolute, `notModified`
   on unchanged revisions, ids + omission count on overflow — see
   `src/profile/guidance.test.ts`). Compiled-guidance cache keyed
   `(profileRevision, guidanceRevision, workspace, archetype, budget)` in
   `worker/profile.ts`; versioned `src/profile/guidance-packs.ts`
   (`GUIDANCE_REVISION` must bump with any pack edit). After merge: dispatch
   `deploy-staging.yml` from `main` so the confirm flow + guidance tools go
   live on staging.
3. ~~**P5 (0003-C)**~~ — DONE (this branch/PR): outcome refinement.
   A correction that REVERSES a stored rule's trait direction (same
   archetype, re-adds excluded / removes required traits) is a
   contradiction: it recalibrates confidence (`calibratedConfidence` —
   confirmation base × supporting share), records a bounded per-workspace
   **exception** (guidance stops serving the rule in that workspace only —
   the rule itself is never mutated), and at 2 contradictions flags
   `needsReview` for the panel's re-confirm/rescope/reject prompt. Stale
   rules (45 days unobserved) decay toward review as a render-time panel
   note. All pure logic in `src/profile/refinement.ts` with deterministic
   tests (`refinement.test.ts`) including **0003 acceptance criteria 3 and 4
   as named tests**; DO-level end-to-end in
   `src/workspace/authoring-profile.test.ts`. Contradictions are the one
   learning path that bumps `profileRevision` (exceptions change serving).
   After merge: dispatch `deploy-staging.yml`, UAT, then the normal gated
   production deploy.
4. Then: 0003-D (governed product guidance) is out of scope per the plan;
   remaining roadmap candidates in `ROADMAP.md` §Next.
5. ~~**Owner analytics / admin dashboard (MVP)**~~ — DONE + live in prod
   2026-07-18 (PRs #190/#191; Gate B run 29622343320, Gate C run 29622993652).
   A new `AnalyticsLog` SQLite DO (migration `v5`, single `idFromName('global')`
   instance) records a login roster + bounded recent-login log best-effort off
   `completeWebLogin` (`ctx.waitUntil`, gated by `analyticsEnabled()`). Owner-only
   `/api/admin/summary` + `/api/admin/users/:uid/workspaces` (fail-closed:
   `analyticsEnabled` else 503; `uid === ADMIN_GITHUB_ID` else 403) serve the
   roster and per-user workspace **metadata** (names/counts), the latter read
   live via `WorkspaceService.list()` — never diagram contents. Browser panel
   `src/ui/admin-dashboard.ts` (mirrors `profile-panel.ts`), revealed by the new
   `admin` field on `/api/me`. Shipped inert: prod has no top-level
   `ANALYTICS_ENABLED` (so `v5` bootstraps off), staging opts in; `ADMIN_GITHUB_ID`
   (owner id `17257145`) is set top-level from the start (harmless while off).
   Pure logic + render + a Miniflare admin-api harness all covered. Rollout:
   merge → `deploy-staging.yml` (live for UAT) → gated prod bootstrap (`v5`
   inert) → tiny activation PR (`ANALYTICS_ENABLED:"true"`). Runbook §"Migration
   `v5`" has the three gates. **Deferred follow-ups** (explicit MVP non-goals):
   session duration / "last active" (activity heartbeats) and agents / MCP-session
   detail (instrument `TopologyMcp.init()`).

## Working conventions (unchanged from session 2)

- Packet = branch = PR; session model does discovery → sub-agent implements
  from a precise brief → session model **independently verifies the risky
  properties + runs the gate** before committing.
- DO/Miniflare + `session.ts` webcrypto suites fail to _start_ locally (no
  `workerd`/`File`/`crypto`) — they run in CI; keep packet correctness locally
  verifiable via pure helpers/fakes.
- Staging deploys are safe to dispatch on request (`deploy-staging.yml`,
  optional `ref`); production requires the protected environment approval.
  Migration recovery is forward-only.

## Key pointers

- Coordinator: `worker/document.ts` (revisions, proposals, leases, checkpoints,
  WS presence, P2 learner window/emission).
- Profiles: `src/profile/{features,model,learner,client}.ts`,
  `worker/profile.ts` (DO), `worker/profile-api.ts` (routes),
  `src/ui/profile-panel.ts` (panel); all gated by `profilesEnabled()`
  (opt-in, unlike `workspaceEnabled`).
- Workspace panel: `src/ui/workspace-panel.ts`; editor gesture funnel:
  `src/editor/editor.ts` + referee in the panel; render seam:
  `flattenViewer` in `src/vendor/topology-ds.ts`.
