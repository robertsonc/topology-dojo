# Production Alert Matrix and Severity Model

_Initiative O (see [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md)),
written 2026-07-19. Companion documents:
[`CLOUDFLARE_OPERATOR_RUNBOOK.md`](CLOUDFLARE_OPERATOR_RUNBOOK.md) (the exact
human dashboard steps), [`GAME_DAY.md`](GAME_DAY.md) (how these alerts get
exercised), [`DEPLOYMENT_RUNBOOK.md`](DEPLOYMENT_RUNBOOK.md) (deploy gates and
the approved activation thresholds this matrix inherits), and
[`ROLLBACK.md`](ROLLBACK.md) (recovery)._

## Current operations baseline (assessed 2026-07-19)

Verified directly against the repository and both live origins:

- **Sole production deploy path**: `deploy-production.yml` — `main`-only
  guard, protected `production` GitHub Environment approval, re-runs full CI,
  deploys with `wrangler deploy --env=""`, then runs the credential-free
  smoke with `--sha` assertion. Workers Builds Git integration disconnected
  (operator O9). Staging deploys via `deploy-staging.yml` only.
- **Feature flags live in production**: `WORKSPACE_ENABLED`,
  `PROFILES_ENABLED`, `ANALYTICS_ENABLED` all `"true"` (top-level
  `wrangler.jsonc`); migrations `v1`–`v5` applied. Recovery for all three is
  forward-only (`ROLLBACK.md`).
- **Health surfaces**: `GET /healthz` (unauthenticated liveness + deployed
  SHA + workspace flag), `GET /readyz` (owner-authenticated per-binding
  readiness: KV, registry DO, document DO). Both covered by Miniflare tests.
- **Synthetic checks**: `scripts/smoke.mjs` (14 credential-free checks) runs
  on every staging/production deploy, nightly against staging
  (`nightly-staging-smoke.yml`, GitHub-issue dedup + recovery close), and —
  new in this initiative — daily plus on-demand against production
  (`production-verify.yml`, same issue pattern, optional expected-SHA
  assertion).
- **Live spot check (2026-07-19)**: production 14/14 pass, serving SHA
  `d169274…` (main tip is one docs-only merge ahead — expected). Staging
  12/14 pass, 2 skip, serving SHA `da8f704…` — **staging is stale**: it
  predates the admin dashboard and showcase code. Recorded as a game-day
  Phase 1 precondition (deploy current `main` to staging first).
- **The confirmed gap this document closes the spec half of**: no
  Cloudflare-side alert policies exist. Automated detection today is
  entirely GitHub-synthetic. Cloudflare-side configuration is human-only
  work, specified in `CLOUDFLARE_OPERATOR_RUNBOOK.md`.

## Detection layers

| Layer                                                   | What it is                                                                                                                                     | Managed by                                                  | State                                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| L1 — GitHub synthetic checks                            | Deploy-gate smoke, nightly staging smoke, daily + on-demand production verify; failures file deduplicated GitHub issues that close on recovery | **Code** (this repo's workflows)                            | Active (production-verify lands with this PR)                 |
| L2 — Cloudflare dashboards (metrics, logs)              | Workers per-script metrics; Workers Logs + Query Builder (7-day retention; `observability.enabled` is already `true` in `wrangler.jsonc`)      | Cloudflare platform; consulted by a human                   | Available now, investigation-only (no alerting by itself)     |
| L3 — Cloudflare notification policies / external alerts | Account **Notifications** policies routed to an email/webhook destination; optionally external monitoring via OTLP export or a Tail Worker     | **Human** (dashboard; see `CLOUDFLARE_OPERATOR_RUNBOOK.md`) | **Not configured** — the remaining human-only gap (packet O1) |

**Honesty note on L3:** Cloudflare's per-product notification catalog varies
by account and plan. What this repo's docs previously assumed ("Workers alert
types for error rate / CPU time") could **not** be verified against current
Cloudflare documentation. The operator runbook therefore (a) has the operator
record what the catalog actually offers on this account, and (b) treats the
L1 synthetic layer as the guaranteed baseline that does not depend on any
plan feature. Do not mark any L3 row "done" until a real notification has
been received and its evidence captured.

## Reading the matrix

- **Sev** — severity if the alert fires and is confirmed (see the severity
  model below).
- **Threshold** — `[A]` approved: inherited verbatim from
  `DEPLOYMENT_RUNBOOK.md` §"Activation observation window and thresholds"
  (the only operator-approved numbers this deployment has); `[P]`
  provisional: a conservative starting value — production traffic
  (single-owner, low-volume) is too small to derive a statistical baseline,
  so tune after 30 days of L2 data and after each game day, recording changes
  in this file's history.
- **Window / min** — evaluation window and minimum event count before the
  alert may fire. Rate expressions apply only at or above the minimum;
  below it the absolute count governs (this is the runbook's low-traffic
  rule).
- **Managed** — `code` (exists in this repo, versioned) vs `human`
  (Cloudflare dashboard or other manual configuration).
- **Destination** — where the signal lands. Defaults: `code`-managed alerts
  → a deduplicated GitHub issue (labels `nightly-smoke` /
  `production-smoke`) plus GitHub's native workflow-failure email to the
  owner; `human`-managed alerts → the Cloudflare notification email/webhook
  destination the operator configures (runbook step CF-2).
- **Recovery condition** — unless stated otherwise: the same signal clean
  for two consecutive evaluation windows (or the next green synthetic run,
  which auto-closes the GitHub issue).

### Worker health (production unless noted)

| Alert                    | Service / endpoint           | Signal & data source                                                                                        | Sev | Threshold                                            | Window / min     | Managed    | Immediate operator action (runbook §)                                                                                                     |
| ------------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------- | --- | ---------------------------------------------------- | ---------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `prod-worker-5xx`        | Worker `topology-dojo` (all) | 5xx responses / total — Workers metrics (L2/L3); corroborated by L1 smoke failures                          | 1–2 | `[A]` ≥5 in 10 min any volume; >2% at ≥20 req/window | 10 min / 20 req  | human      | Confirm via `production-verify` dispatch; classify release vs platform; recover per `ROLLBACK.md` decision flow (§"Classify the release") |
| `prod-worker-exceptions` | Worker `topology-dojo`       | Uncaught exceptions — Workers metrics "errors" / Workers Logs `$workers.event.error` (L2/L3)                | 1–2 | `[A]` ≥5 in 10 min (counted with 5xx)                | 10 min / any     | human      | Pull stack from Workers Logs; if introduced by the last deploy, forward-fix or flag-off (`ROLLBACK.md` §"Forward recovery")               |
| `prod-latency`           | Worker `topology-dojo`       | p99 wall time — Workers metrics (L2)                                                                        | 3   | `[P]` p99 >2 s sustained 15 min (interactive routes) | 15 min / 50 req  | human      | Context signal only per runbook (§"Informational") — investigate via Query Builder slowest-requests view; escalate only with errors       |
| `prod-traffic-spike`     | Worker `topology-dojo`       | Requests/min vs 7-day norm — Workers metrics (L2)                                                           | 3   | `[P]` >10× 7-day same-hour norm for 30 min           | 30 min / 500 req | human      | Check source distribution (abuse vs legitimate); review KV/DO usage + billing; consider Cloudflare WAF/rate-limiting rules if abusive     |
| `prod-traffic-zero`      | Worker `topology-dojo`       | Requests/min ≈ 0 vs norm — L1 daily verify catches the reachability case                                    | 2   | `[P]` 0 requests in 6 h **and** a failed L1 verify   | 6 h / n/a        | code+human | Distinguish "quiet day" (single-owner tool) from outage: dispatch `production-verify`; if it fails, treat as `prod-health-fail`           |
| `prod-health-fail`       | `GET /healthz`               | Non-200 / non-JSON / `ok!=true` — L1 (`production-verify.yml` healthz check)                                | 1   | Any failed run (daily + on-demand)                   | per run / 1      | code       | `DEPLOYMENT_RUNBOOK.md` §"Stop conditions"; if a deploy is in flight, halt promotion; else classify per `ROLLBACK.md` and recover forward |
| `prod-ready-fail`        | `GET /readyz` (owner-authed) | Any binding probe failing (`ok:false`, 503) — manual/UAT check in L1 docs; owner browser or curl w/ session | 2   | Any failing binding                                  | per check / 1    | code       | The failing binding is named in the response; KV vs DO triage per `CLOUDFLARE_OPERATOR_RUNBOOK.md` §CF-6; do not deploy while red         |
| `staging-smoke-fail`     | Staging origin               | Nightly smoke red — L1 (`nightly-staging-smoke.yml` issue)                                                  | 3   | Any failed nightly run                               | nightly / 1      | code       | Triage next working session; staging failures never page; fix forward and let the next green run close the issue                          |

### Durable Objects

Cloudflare exposes DO metrics per namespace (requests, errors, duration,
storage); the application additionally surfaces DO failures as API 5xx and
`/readyz` binding failures, which is what L1 can see from outside.

| Alert                        | Service / endpoint                               | Signal & data source                                                                                              | Sev | Threshold                                             | Window / min    | Managed | Immediate operator action                                                                                                                           |
| ---------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | --- | ----------------------------------------------------- | --------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prod-do-errors`             | All DO namespaces (prod script)                  | DO exception/error rate — Durable Objects metrics (L2/L3)                                                         | 2   | `[A]` ≥3 in 10 min any volume; >1% at ≥20 ops/window  | 10 min / 20 ops | human   | Identify class via metrics + Workers Logs; if workspace data integrity is implicated, treat as hard stop (`DEPLOYMENT_RUNBOOK.md` §"Hard stops")    |
| `prod-do-request-failures`   | `/api/workspaces/*` → `TopologyDocument`         | API 5xx on workspace routes — L2 logs (`status>=500 AND path startsWith /api/workspaces`)                         | 2   | `[A]` counts within `prod-do-errors` budget           | 10 min / 20     | human   | Workspace coordinator failure: forward-disable drill posture is the tested recovery (`GAME_DAY.md` scenario P-4; `ROLLBACK.md` §"Forward recovery") |
| `prod-do-latency`            | DO namespaces                                    | DO request duration p99 — DO metrics (L2)                                                                         | 3   | `[P]` p99 >1 s sustained 15 min                       | 15 min / 50 ops | human   | Investigate storage op volume; not a stop by itself (runbook §"Informational")                                                                      |
| `prod-do-restarts-alarms`    | DO namespaces                                    | Restart/alarm anomalies — **no first-class metric**; infer from Workers Logs (abrupt session drops, re-init logs) | 3   | `[P]` observational — see monitoring gaps             | n/a             | human   | Documented gap: note occurrences in the findings register; rely on error-rate alerts for user-visible impact                                        |
| `prod-workspace-coordinator` | Shared workspace feature                         | Multiple users' workspace ops failing / revision regression — L2 logs + user report                               | 1   | `[A]` any hard-stop signal (revision regression etc.) | per event / 1   | human   | **Hard stop**: `DEPLOYMENT_RUNBOOK.md` §"Hard stops" — forward-deploy `WORKSPACE_ENABLED=false`, never roll back across `v3`                        |
| `prod-profile-persistence`   | `AUTHORING_PROFILE` DO / `/api/profile/*`        | Profile API 5xx or learner write failures — L2 logs                                                               | 3   | `[P]` ≥3 in 60 min                                    | 60 min / 3      | human   | Observe-only surface: forward-disable `PROFILES_ENABLED` if sustained (`GAME_DAY.md` P-7); no data-integrity exposure for authoring docs            |
| `prod-analytics-persistence` | `ANALYTICS` DO / `/api/admin/*`, login recording | `login analytics record failed` in Workers Logs; admin API 5xx                                                    | 3   | `[P]` ≥3 in 60 min                                    | 60 min / 3      | human   | Best-effort surface (never blocks login by design — `worker/auth.ts`); forward-disable `ANALYTICS_ENABLED` if noisy (`GAME_DAY.md` P-9)             |

### Authentication and security

Normal user login failures (declined GitHub consent, abandoned flows) are
**not** incidents; every threshold here excludes user-declined consent per
the approved runbook definition, and anomaly thresholds are set well above
single-user noise.

| Alert                      | Service / endpoint                          | Signal & data source                                                                                        | Sev | Threshold                                          | Window / min | Managed | Immediate operator action                                                                                                                                      |
| -------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --- | -------------------------------------------------- | ------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prod-auth-server-fail`    | `/callback`, `/auth/github`, token exchange | Server-side OAuth failures (callback 5xx, token-exchange error, KV failure) — L2 logs (`web login:` errors) | 1–2 | `[A]` ≥3 in 10 min any volume; >5% at ≥20 attempts | 10 min / 20  | human   | If the owner cannot sign in at all → SEV-1 hard stop; check GitHub OAuth App status/secret rotation first (`ROLLBACK.md` §"Authentication or secret incident") |
| `prod-auth-anomaly`        | `/login`, `/auth/github`                    | Login-attempt volume anomaly — L2 logs; `ANALYTICS` roster (owner dashboard) for who succeeded              | 3   | `[P]` >100 attempts/h sustained 3 h                | 3 h / 100    | human   | Open-signup posture (finding M19): volume alone is quota/abuse watch, not a breach; consider WAF rules; review roster for unexpected accounts                  |
| `prod-unauthorized-access` | `/api/*` authed routes                      | Sustained 401/403 bursts against authed APIs — L2 logs (`status=401 OR 403 AND path startsWith /api/`)      | 3   | `[P]` >200/h from few sources sustained 1 h        | 1 h / 200    | human   | Probing/scripted abuse: WAF/rate-limit at the zone; verify no 401→200 transitions that would indicate a bypass (those are SEV-1)                               |
| `prod-session-invalid`     | `/api/me`, session cookie verification      | Repeated invalid-session verifications — L2 logs                                                            | 3   | `[P]` >100/h sustained 3 h                         | 3 h / 100    | human   | Expected after secret rotation (all sessions invalidate); otherwise investigate cookie tampering; rotate `GITHUB_CLIENT_SECRET` only with the incident runbook |
| `prod-admin-authz-fail`    | `/api/admin/*`                              | 403 `admin_forbidden` for a **signed-in** non-admin — L2 logs                                               | 3   | `[P]` ≥10 in 24 h                                  | 24 h / 10    | human   | Fail-closed gate is working; note who (roster) is probing the admin surface; no action unless paired with other anomalies                                      |
| `prod-rate-limit`          | Zone / WAF                                  | Rate-limit rule activations — zone security events (L2)                                                     | 3   | `[P]` n/a until a rule exists                      | n/a          | human   | **Not configured today** (no rate-limit rules exist). If/when the operator adds zone rules, wire their built-in event notifications and update this row        |

### Application APIs

| Alert                  | Service / endpoint            | Signal & data source                                                                                                         | Sev | Threshold                            | Window / min | Managed | Immediate operator action                                                                                     |
| ---------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------ | ------------ | ------- | ------------------------------------------------------------------------------------------------------------- |
| `prod-workspace-api`   | `/api/workspaces*`            | 5xx rate — L2 logs; L1 contract check (`workspaces-unauth`) proves the gate contract                                         | 2   | `[A]` within Worker/DO error budgets | 10 min / 20  | human   | See `prod-do-request-failures`; contract drift (wrong status shape) is caught by L1 on every run              |
| `prod-profile-api`     | `/api/profile/*`              | 5xx rate — L2 logs; L1 `profile-unauth` contract check                                                                       | 3   | `[P]` ≥3 in 60 min                   | 60 min / 3   | human   | See `prod-profile-persistence`                                                                                |
| `prod-analytics-api`   | `/api/admin/*`                | 5xx rate — L2 logs; L1 `admin-unauth` contract check                                                                         | 3   | `[P]` ≥3 in 60 min                   | 60 min / 3   | human   | See `prod-analytics-persistence`                                                                              |
| `prod-mcp-endpoint`    | `/mcp` (+ OAuth endpoints)    | 5xx / OAuth-provider errors — L2 logs; L1 `mcp-unauth` + `oauth-metadata` checks daily                                       | 2   | `[A]` within Worker error budget     | 10 min / 20  | human   | MCP agent sessions are per-DO: check `MCP_OBJECT` metrics; a metadata/401-contract regression fails L1 loudly |
| `prod-share-api`       | `/api/topology/:id`, `/v/:id` | 5xx on public share reads — L2 logs; L1 `share-404` + `viewer-shell` checks daily                                            | 2   | `[P]` ≥5 in 10 min                   | 10 min / 5   | human   | Public surface; check KV metrics (`TOPOLOGY_KV`) and cache behavior                                           |
| `prod-export-fail`     | MCP `export_flipbook` etc.    | **Not independently observable** server-side today (tool errors return in-band to agents)                                    | 3   | Gap — see monitoring gaps            | n/a          | n/a     | Rely on `prod-mcp-endpoint` + user reports; candidate future work: structured tool-error logging              |
| `prod-ws-upgrade-fail` | `/api/workspaces/:id/socket`  | WebSocket upgrade failures — partially observable in Workers metrics/logs; unauth probing impossible (auth precedes upgrade) | 3   | `[P]` ≥5 in 10 min (from logs)       | 10 min / 5   | human   | Client falls back to polling by design (426 path); investigate only when paired with DO errors                |

### Deployment and CI

| Alert                       | Service                          | Signal & data source                                                                               | Sev | Threshold      | Window / min | Managed | Immediate operator action                                                                                                                                                                               |
| --------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------- | --- | -------------- | ------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy-prod-fail`          | `deploy-production.yml`          | Workflow failure — GitHub Actions native failure email + run page                                  | 1–2 | Any failed run | per run / 1  | code    | The deploy is failed regardless of Cloudflare's accept (`ROLLBACK.md` §"Failed smoke after a successful deploy"); classify and recover before re-dispatch                                               |
| `deploy-staging-fail`       | `deploy-staging.yml`             | Workflow failure — GitHub native                                                                   | 3   | Any failed run | per run / 1  | code    | Fix forward; staging owns no user data                                                                                                                                                                  |
| `staging-smoke-fail`        | `nightly-staging-smoke.yml`      | Nightly smoke red — deduplicated `nightly-smoke` issue                                             | 3   | Any failed run | nightly / 1  | code    | See Worker-health table                                                                                                                                                                                 |
| `prod-smoke-fail`           | `production-verify.yml`          | Daily/dispatch verify red — deduplicated `production-smoke` issue                                  | 1–2 | Any failed run | daily / 1    | code    | Treat as `prod-health-fail` until diagnosed                                                                                                                                                             |
| `prod-sha-mismatch`         | `/healthz` vs deploy record      | `sha` ≠ last production deploy's recorded SHA — `production-verify.yml` with `expected_sha`        | 2   | Any mismatch   | per run / 1  | code    | Someone/something deployed outside the record or a deploy half-landed: freeze deploys, reconcile against the `deploy-production` run history, then redeploy the intended SHA via the protected workflow |
| `env-config-invalid`        | `scripts/check-wrangler-env.mjs` | Isolation/migration-parity/diagnostics-exclusion violation — CI + both deploy workflows (blocking) | 2   | Any violation  | per run / 1  | code    | The deploy is already blocked; fix `wrangler.jsonc` — never bypass the check                                                                                                                            |
| `migration-validation-fail` | Deploy workflows                 | Migration tags read/parity step failing, or wrangler migration error — deploy logs                 | 1   | Any occurrence | per run / 1  | code    | **Stop.** `DEPLOYMENT_RUNBOOK.md` §"Error 10211" and §"Stop conditions"; never edit applied migration history; escalate to owner before any further deploy                                              |

### Monitoring gaps (explicit)

Honest list of what has **no** reliable alert today, the closest available
signal, and the future option. These are accepted, documented gaps — not
silently missing coverage.

| Gap                                   | Closest signal today                                                     | Future option                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Real-time production paging (minutes) | Daily L1 verify + human-noticed breakage; L3 once configured             | External uptime monitor polling `/healthz` (e.g. via OTLP/Tail-Worker pipeline or a third-party checker)                  |
| DO restart/alarm anomalies            | Indirect: error spikes, session drops in logs                            | If Cloudflare exposes a first-class metric, add an L3 policy and update the DO table                                      |
| Export (`export_flipbook`) failures   | MCP endpoint errors + user reports                                       | Structured tool-error logging → Query Builder saved query → L3                                                            |
| WebSocket connect quality per client  | Server-side upgrade errors in logs; client polling fallback masks impact | Client-side beacon (out of scope for now)                                                                                 |
| Latency-based alerting                | L2 dashboards on demand                                                  | Decide after 30 days of baseline whether latency ever pages (today it is informational per the approved runbook)          |
| Authenticated-flow synthetic checks   | L1 is credential-free by design; authed flows are manual smoke           | A dedicated low-privilege probe identity — **only** with explicit owner decision; never embed real user credentials in CI |

## Severity model

Targets are **operational goals for a single-operator deployment, not
guarantees or SLAs**. "Owner" is the deployment owner (the only operator);
"escalation" therefore means escalating _tooling and focus_ (dropping other
work, opening an incident record), not paging additional humans who do not
exist. If the operator roster ever grows, revisit this section.

### SEV-1 — production down or integrity at risk

Production unavailable; authentication globally broken (owner cannot sign
in); shared workspaces inaccessible or canonical data integrity in doubt
(revision regression, persistence failure after success response); a deploy
that caused widespread failure.

- **Acknowledgement goal:** as soon as seen; the daily L1 verify bounds
  unnoticed downtime to ~24 h until L3/external monitoring exists (a known,
  accepted limit — see monitoring gaps).
- **Escalation:** drop everything; open an incident record
  (`ROLLBACK.md` template) immediately; freeze all deploys and promotions.
- **Communication:** note in the incident record and (if users are affected)
  the GitHub issue; there is no status page.
- **Recovery verification:** full `ROLLBACK.md` §"Recovery verification"
  list + a green `production-verify` dispatch with `expected_sha`.
- **Follow-up:** findings-register entry + prevention action within a week;
  update thresholds/runbooks with what was learned.

### SEV-2 — major feature degraded, workaround exists

A major feature (workspaces, MCP, shares, profiles) unavailable or erroring
for multiple operations; sustained elevated failure rates above approved
thresholds; DO errors affecting more than one user; production degradation
with a working workaround (including a deliberate flag-off state).

- **Acknowledgement goal:** same day.
- **Escalation:** incident record if user-visible beyond the owner;
  otherwise a `production-smoke`/tracking issue is sufficient.
- **Communication:** the tracking issue is the record.
- **Recovery verification:** the affected surface's smoke checks green +
  the specific feature exercised manually.
- **Follow-up:** tracking issue closed only with a cause note; register
  entry if it revealed a process gap.

### SEV-3 — partial, isolated, or non-production

Partial/isolated failures; staging failures of any kind; nightly smoke
failures; analytics/profile/export degradation (best-effort surfaces);
anomaly watches that need eyes but not action.

- **Acknowledgement goal:** next working session.
- **Escalation:** none — the deduplicated issue is the queue.
- **Communication:** issue comments.
- **Recovery verification:** next green scheduled run (auto-closes).
- **Follow-up:** only if recurring (3+ occurrences → register entry).

## Threshold tuning discipline

1. Every `[P]` value above is a starting point chosen to be quiet at current
   traffic, not a measured baseline. Do not present them as measured.
2. After 30 days of Workers metrics/logs in production, and after every game
   day, review each `[P]` against observed p95/p99 and event counts; change
   values in this file via PR so tuning is versioned.
3. A threshold change prompted by a false positive or a missed alert MUST
   cite the triggering run/incident in the PR description.
4. `[A]` values change only together with
   `DEPLOYMENT_RUNBOOK.md` §"Activation observation window and thresholds"
   — they are the same numbers by construction.
