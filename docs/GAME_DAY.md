# Game Day — Controlled Operational Drill

_Initiative O, packet O2 (supersedes and expands `ROLLBACK.md` §"Staging game
day", which now points here). A repeatable, staging-first drill that
exercises detection, alerting, forward-disable/forward-enable recovery, and
the deployment approval gate — producing a durable evidence record
([`GAME_DAY_EVIDENCE_TEMPLATE.md`](GAME_DAY_EVIDENCE_TEMPLATE.md)) each
time it runs._

**Execution status:** the framework below is ready to run, but **no game day
has been executed yet**. Nothing in this file is a record of a completed
drill; completed drills live as dated evidence records.

## Non-negotiable rules

1. **Production fault injection never happens — not manually, not
   automatically.** The synthetic fault route is triple-gated to staging
   (`worker/staging-fault.ts`; CI rejects `DIAGNOSTICS_*` in production
   config; tests prove production rejection). Phase 3 uses only
   non-destructive reads and feature-flag forward deployments.
2. **Every production step requires the protected `production` GitHub
   Environment approval** — the owner clicks approve per deploy, exactly as
   for a release. The game day changes nothing about the deploy path.
3. **Forward-only recovery.** No step ever rolls production or staging back
   across a Durable Object migration boundary (`ROLLBACK.md` first
   principle). All recovery in this drill is a forward deploy with a flag
   value changed.
4. **Destructive-looking staging steps** (deliberate failures, flag
   disables) are pre-listed in the evidence record and checked off by the
   human operator as performed; anything not pre-listed is out of scope for
   the drill.
5. **Stop conditions** (any of these aborts the drill, restores staging,
   and files findings): a production stop condition from
   `DEPLOYMENT_RUNBOOK.md` §"Stop conditions" trips for real during the
   drill; a drill action affects production unexpectedly; the operator
   loses confidence in what state an environment is in; a paused
   account-wide alert policy would stay paused past the drill window
   (see `CLOUDFLARE_OPERATOR_RUNBOOK.md` §"Avoiding staging-noise").
6. **No secrets in evidence.** The evidence record carries run links, SHAs,
   timestamps, statuses — never tokens, cookies, or the
   `DIAGNOSTICS_TOKEN` value.

## Roles

- **Operator** — a human with GitHub dispatch + production-approval rights
  and Cloudflare dashboard access. Executes every step.
- **Observer** (optional, may be the same person on a solo team wearing two
  hats deliberately) — keeps the evidence record current in real time
  rather than reconstructing it afterwards.

Agents may prepare PRs (e.g. the production flag-change PRs in Phase 3) but
never dispatch production deploys or approve environments.

## Phase 1 — Preparation (no changes made)

Record each item in the evidence record before any exercise:

| #    | Check                                                                                                                                                                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | Current production SHA: `GET https://topology-dojo.harnessed.cloud/healthz` → `sha`, and confirm it matches the latest `Deploy Production` run's recorded SHA.                                                                                                      |
| 1.2  | Current staging SHA: same via the staging origin. **Known 2026-07-19 state: staging serves `da8f704…`, behind `main` — the first drill action (S-0) is a routine staging deploy of current `main`.**                                                                |
| 1.3  | No deployment in flight: both deploy workflows idle; no open `production-smoke`/`nightly-smoke` issues (or accept + note them).                                                                                                                                     |
| 1.4  | Operator permissions: can dispatch `deploy-staging`, `production-verify`; is a required reviewer of the `production` environment.                                                                                                                                   |
| 1.5  | Notification paths: GitHub notification email deliverable; Cloudflare destination state per `CLOUDFLARE_OPERATOR_RUNBOOK.md` CF-2 (it is valid to run Phase 2 before any Cloudflare policies exist — record "L1-only" so timing results are interpreted correctly). |
| 1.6  | Feature flags: read `wrangler.jsonc` top-level + `env.staging`; record all six values.                                                                                                                                                                              |
| 1.7  | Recovery assumptions: staging owns no production data (isolated KV/DO namespaces — `check:wrangler` green proves config isolation); disposable staging drafts/workspaces may be created and abandoned.                                                              |
| 1.8  | No pending Durable Object migration: the diff between staging SHA, production SHA, and `main` adds no migration tag beyond `v5`. If it does, **stop** — run the release first, game day after.                                                                      |
| 1.9  | `DIAGNOSTICS_TOKEN` set for staging (CF-4 precondition) if S-2/S-3/S-4 are in scope this run.                                                                                                                                                                       |
| 1.10 | Open the evidence record (copy the template; assign the drill id `GD-<date>-<n>`); pre-list every staging-degrading step; establish the stop conditions above; note drill start time.                                                                               |

## Phase 2 — Staging exercises

Every step targets `topology-dojo-staging` only. Restore staging (S-12)
before ending the session, even on abort.

| #    | Scenario                         | Action                                                                                                                                                                        | Expected result                                                                                                                                                                           |
| ---- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-0  | Baseline                         | Dispatch `deploy-staging` (ref `main`, all overrides `config`); then run `node scripts/smoke.mjs <staging> --sha <main-sha>`.                                                 | Green deploy; 14/14 smoke (no skips once staging is current).                                                                                                                             |
| S-1  | Health/readiness failure signals | With the staging token: `mode=error` fault (`curl -H "x-diagnostics-token: …" "<staging>/__staging/fault?mode=error"`), repeated ~10× over a minute.                          | Each call returns the labelled synthetic 500; staging error-rate metrics (CF-1) show the burst; production metrics show nothing.                                                          |
| S-2  | Controlled Worker exception      | Same with `mode=exception`, ~10×.                                                                                                                                             | Runtime 500s; staging **uncaught exception** count rises (this is the signal `mode=error` alone cannot produce).                                                                          |
| S-3  | Alert-delivery verification      | If Cloudflare policies exist (CF-3): keep the S-2 burst inside the policy's window; await notification.                                                                       | Notification arrives at the CF-2 destination; record time-to-notify. If no policy exists yet: record "L3 not configured — L1 only", which is itself a finding.                            |
| S-4  | Latency signal                   | `mode=slow&ms=4000`, ~10×.                                                                                                                                                    | Staging duration p99 visibly shifts in CF-1 metrics; no alert expected (latency is informational per `ALERTS.md`).                                                                        |
| S-5  | Authentication failure handling  | Sign in to staging in a private window, then: `/callback?state=web.bogus&code=x` → expect `400`; sign-out; confirm `/api/me` 401 and editor navigation redirects to `/login`. | Bad state handled with a controlled 400 (no 5xx); session lifecycle correct. Server-side OAuth failure logs visible in the CF-1 saved query.                                              |
| S-6  | Workspace feature disabled       | Dispatch `deploy-staging` with `workspace_enabled=false` (a **forward** deploy).                                                                                              | Workflow's own smoke passes asserting the 503 `workspace_disabled` contract; browser workspace UI degrades as documented in the forward-recovery table below; MCP workspace tools absent. |
| S-7  | Profiles feature disabled        | Dispatch with `profiles_enabled=false` (workspace back at `config`).                                                                                                          | Smoke asserts 503 `profiles_disabled`; app + workspace flows unaffected; preferences panel shows the disabled state.                                                                      |
| S-8  | Analytics feature disabled       | Dispatch with `analytics_enabled=false`.                                                                                                                                      | Smoke asserts 503 `admin_disabled`; sign-in works but is not recorded (verify roster does not grow); `/api/me` reports `admin:false`.                                                     |
| S-9  | Smoke failure → issue creation   | Leave one disable in place; manually dispatch `Nightly Staging Smoke` (workflow_dispatch).                                                                                    | The run fails on the flag-contract check and files (or comments on) the `nightly-smoke` issue — one issue, not many.                                                                      |
| S-10 | Deduplication                    | Dispatch `Nightly Staging Smoke` again in the failed state.                                                                                                                   | No second issue; a new comment on the same issue.                                                                                                                                         |
| S-11 | SHA-mismatch detection           | Run `node scripts/smoke.mjs <staging> --sha <wrong-sha>` locally.                                                                                                             | The healthz check fails loudly on the mismatch (this is the mechanism `production-verify`'s `expected_sha` uses).                                                                         |
| S-12 | Recovery + issue closure         | Dispatch `deploy-staging` (all overrides `config`); then dispatch `Nightly Staging Smoke`.                                                                                    | Green deploy + green smoke; the workflow comments on and **closes** the `nightly-smoke` issue. Staging fully restored (record final staging SHA).                                         |

## Phase 3 — Production-safe exercises

Non-destructive reads, plus feature-flag **forward deployments** only. Every
deploy here is a real protected production deploy: PR review + `production`
environment approval by the owner. Schedule these in a low-usage window;
each disable is user-visible while active (single-owner deployment, so the
"users" affected are the owner's own sessions/agents).

**Approval documentation:** the environment-approval click on each deploy
run **is** the explicit owner approval; the evidence record links each run.

| #    | Scenario                              | Action                                                                                                                                                                                                                                        | Expected result                                                                                                                                                       |
| ---- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-1  | Verify production health + readiness  | Dispatch `Production Verify` with `expected_sha=<current prod SHA>`; owner additionally opens `/readyz` in a signed-in browser session.                                                                                                       | 14/14 green incl. SHA assertion; `/readyz` 200 with all bindings ok.                                                                                                  |
| P-2  | Login + showcase + share surfaces     | Covered by P-1's checks (`login`, `showcase`, `viewer-shell`, `share-404`, `oauth-metadata`); owner spot-opens `/login` in a private window.                                                                                                  | All green; login page renders with the filmstrip.                                                                                                                     |
| P-3  | Approval-gate confirmation (negative) | A second GitHub identity (or the drill record if none exists) confirms a `deploy-production` dispatch **waits** for environment approval and can be **rejected**.                                                                             | The rejected run deploys nothing; the gate demonstrably blocks. (If no second identity is available, approve-then-observe the wait state and record that limitation.) |
| P-4  | Disable shared workspace (forward)    | PR editing top-level `wrangler.jsonc`: `WORKSPACE_ENABLED` → `"false"`; merge; dispatch `deploy-production` with `expect_workspace_disabled=true`; owner approves.                                                                            | Deploy green with the workflow smoke asserting the 503 contract; degraded behavior per the forward-recovery table; `v3` untouched.                                    |
| P-5  | Confirm degraded behavior + detection | `node scripts/smoke.mjs <prod> --expect-workspace-disabled`; also run a plain `Production Verify` dispatch and observe it **fail** the workspace contract check.                                                                              | Both behave as designed — the plain verify failing proves flag-state drift is detectable; it files the `production-smoke` issue (leave it open for P-6 to close).     |
| P-6  | Restore shared workspace (forward)    | Revert PR (`"true"`); merge; dispatch + approve; then dispatch `Production Verify` (plain).                                                                                                                                                   | Green; the `production-smoke` issue closes automatically. Record disable→restore wall-clock as the measured forward-recovery time.                                    |
| P-7  | Disable profiles (forward)            | Same PR flow: remove `PROFILES_ENABLED` (or set `"false"`); deploy + approve; verify with `--expect-profiles-disabled`.                                                                                                                       | 503 `profiles_disabled` on the profile API; authoring/workspace unaffected; learner stops observing (by design, no data loss — candidates simply stop accruing).      |
| P-8  | Restore profiles (forward)            | Revert; deploy + approve; plain verify.                                                                                                                                                                                                       | Green; preferences panel live again.                                                                                                                                  |
| P-9  | Disable analytics (forward)           | Same flow: remove `ANALYTICS_ENABLED`; verify with `--expect-analytics-disabled`.                                                                                                                                                             | 503 `admin_disabled`; logins work but are not recorded (gap in roster during the window is expected and permanent — no backfill).                                     |
| P-10 | Restore analytics (forward)           | Revert; deploy + approve; plain verify; owner signs in once and confirms the roster records it.                                                                                                                                               | Green; recording resumed.                                                                                                                                             |
| P-11 | Alert + recovery notifications        | For each Cloudflare policy configured in CF-3: confirm whether the P-4..P-10 window fired anything (it should **not** — flag disables are clean 503s, not errors) and that the GitHub issue open/close in P-5/P-6 notified the owner's email. | No false-positive Cloudflare alerts from clean disables; GitHub notifications received; record both.                                                                  |
| P-12 | Close out                             | Final `Production Verify` with `expected_sha`; confirm flags match `wrangler.jsonc`; no open `production-smoke` issues.                                                                                                                       | Production exactly at its pre-drill configuration and SHA lineage (the SHA advances past the drill PRs — record old + new).                                           |

## Phase 4 — Findings and follow-up

Complete in the evidence record, same day where possible:

1. Actual alert timings (time-to-detect, time-to-notify per scenario) vs
   the `ALERTS.md` expectations; note every false positive and every missed
   alert explicitly.
2. Recovery timings (measured forward disable→restore wall-clock per flag).
3. Runbook steps that were unclear/wrong → file a docs PR per item.
4. Deployment friction observed (queue time, approval latency, wrangler
   quirks).
5. Open a GitHub issue per follow-up action (label `game-day`), or a
   findings-register entry where it reveals a durable risk.
6. Update `[P]` thresholds in `ALERTS.md` per its tuning discipline,
   citing scenario measurements.
7. Mark the evidence record complete with pass/fail per scenario and
   operator sign-off; store it with the operator record and update
   `IMPLEMENTATION_PLAN.md` packet O2's status.

## Forward-recovery reference (per feature flag)

The tested, supported way to take any of the three live features out of (and
back into) production service. All three: deploy path =
`deploy-production.yml` from `main` with owner approval; Durable Object
implications = **none removed ever** — bindings, classes, and migrations
`v1`–`v5` stay declared in every state; stored data is preserved untouched
while the flag is off. Never recover any of these by rolling back across a
migration (`ROLLBACK.md`).

| Feature                     | Flag / current prod state      | Disable value                                           | User-visible behavior when disabled                                                                                                                                                                                          | Verification (disabled)                                                         | Re-enable value                | Verification (recovered)                                                                      |
| --------------------------- | ------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------- |
| Shared workspace            | `WORKSPACE_ENABLED` = `"true"` | `"false"` (only this literal disables — fail-open flag) | `/api/workspaces*` → 503 `{"error":"workspace_disabled"}` before any DO/KV read; the 8 workspace MCP tools unregistered; browser workspace panel degrades; solo editor, private MCP drafts, shares, login all unaffected     | `smoke.mjs --expect-workspace-disabled` green; `healthz.workspaceEnabled:false` | `"true"` (or remove the entry) | Plain smoke green; a workspace opens and its pre-disable revision/pages intact                |
| Adaptive authoring profiles | `PROFILES_ENABLED` = `"true"`  | Remove the entry (or `"false"`) — fail-closed flag      | `/api/profile*` → 503 `{"error":"profiles_disabled"}`; learner stops observing (no new candidates; existing preference data retained in the per-owner DO); the 3 guidance MCP tools unregistered; everything else unaffected | `--expect-profiles-disabled` green                                              | `"true"`                       | Plain smoke green; preferences panel lists the retained candidates; new outcomes accrue again |
| Owner analytics             | `ANALYTICS_ENABLED` = `"true"` | Remove the entry (or `"false"`) — fail-closed flag      | `/api/admin*` → 503 `{"error":"admin_disabled"}`; logins stop being recorded (**permanent gap — no backfill**); `/api/me` reports `admin:false`; sign-in itself unaffected (recording is post-response best-effort)          | `--expect-analytics-disabled` green                                             | `"true"`                       | Plain smoke green; owner's next login appears in the roster                                   |

**Other production surfaces reviewed for inclusion:** the MCP endpoint,
share API, auth flow, and static SPA have **no** feature flags — their only
forward-disable is a forward code deploy, and their recovery procedures are
the generic ones in `ROLLBACK.md`. The EdgeConnect connector
(`ORCH_BASE_URL`/`ORCH_API_KEY`) is not provisioned in production (secrets
absent ⇒ tools not registered), so it has no active state to drill;
revisit this table if packet E5 ever provisions it.
