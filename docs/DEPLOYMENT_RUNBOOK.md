# Deployment Runbook

This runbook defines the supported deployment process for Topology Dojo. It is
the operational companion to
[`proposals/0004-isolated-staging-and-deployment-pipeline.md`](proposals/0004-isolated-staging-and-deployment-pipeline.md).

## Invariants

1. Staging and production never share OAuth clients, KV namespaces, Durable
   Object namespaces, secrets, or Worker names.
2. A Durable Object migration is applied only by `wrangler deploy` against the
   intended environment.
3. `wrangler versions upload` is not a preview mechanism for this Worker.
4. Production deployment starts only after required CI and explicit approval.
5. Migration entries are append-only. Never delete, rename, reorder, or reuse a
   tag after deployment.
6. The deployed commit SHA and smoke result are recorded for every environment.
7. A failed smoke test leaves the deployment failed even if Cloudflare accepted
   the bundle.

## Environment inventory

Populate this table in the private operator record. Do not commit secret values.

| Item                   | Staging                     | Production                              |
| ---------------------- | --------------------------- | --------------------------------------- |
| Worker name            | `topology-dojo-staging`     | `topology-dojo`                         |
| Public origin          | `<staging-origin>`          | `https://topology-dojo.harnessed.cloud` |
| GitHub OAuth App       | `<staging-app>`             | `<production-app>`                      |
| OAuth callback         | `<staging-origin>/callback` | `<production-origin>/callback`          |
| `OAUTH_KV` id          | `<staging-id>`              | Managed in `wrangler.jsonc`             |
| `TOPOLOGY_KV` id       | `<staging-id>`              | Managed in `wrangler.jsonc`             |
| `SESSION_HMAC_SECRET`  | optional (`<set / unset>`)  | optional (`<set / unset>`)              |
| GitHub Environment     | `staging`                   | `production`                            |
| Cloudflare token owner | `<owner>`                   | `<owner>`                               |
| Last deployment SHA    | `<sha>`                     | `<sha>`                                 |
| Applied migration tag  | `<tag>`                     | `<tag>`                                 |

The staging KV ids must differ from production. The staging GitHub OAuth App
must not accept the production callback URL, and vice versa.

## Error 10211: preview upload contains a migration

### Symptom

```text
Version upload failed. You attempted to upload a version of a Worker that
includes a Durable Object migration, but migrations must be fully applied via
a non-versioned deployment. [code: 10211]
```

### Meaning

Cloudflare Workers Builds used its non-production default command,
`wrangler versions upload`, while the branch contained a migration not yet
applied to that Worker script.

### Response

1. Stop retrying the preview job; retries do not change migration state.
2. Confirm the migration tag and class name in `wrangler.jsonc`.
3. Do not remove the migration or point the command at production deploy.
4. Disable non-production branch builds on the production Worker if still
   enabled.
5. Deploy the candidate to the isolated staging Worker using
   `npx wrangler deploy --env staging`.
6. Record the failed preview as an infrastructure limitation, not an
   application test failure.

If there is no isolated staging environment, stop. Applying the migration to
production merely to obtain a preview is not an approved workaround.

## One-time staging bootstrap

### Prerequisites

- A dedicated staging GitHub OAuth App exists.
- Staging `OAUTH_KV` and `TOPOLOGY_KV` namespaces exist.
- `env.staging` declares every required variable, KV binding, Durable Object
  binding, and migration.
- The staging Worker name resolves to a separate script.
- `GITHUB_CLIENT_SECRET` is stored for the staging environment.
- `SESSION_HMAC_SECRET` is optional. When unset, browser sessions are signed
  with `GITHUB_CLIENT_SECRET`. Set it independently
  (`npx wrangler secret put SESSION_HMAC_SECRET --env staging`, and the same
  without `--env` for production) so OAuth client-secret rotation does not
  invalidate sessions. Not required yet — existing deployments keep working.
- A scoped Cloudflare deployment token and account id are stored in the GitHub
  `staging` Environment.
- Cloudflare production non-production branch builds are disabled.

### Local preflight

Run from a clean checkout of the exact candidate SHA:

```bash
npm ci
npm run check:wrangler
npm run typecheck
npm test
npm run lint
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
npx wrangler deploy --env staging --dry-run
```

The dry run validates bundling but does not prove remote bindings or apply a
migration.

Review the effective configuration before continuing:

- Worker name ends in `-staging`.
- Both KV namespace ids are staging ids.
- Every Durable Object binding declared at the top level is present in
  `env.staging` too (`check-wrangler-env.mjs` enforces this).
- Migrations contain unique, ordered tags identical to the top-level list
  (`v1`… through the current highest tag).
- `PUBLIC_BASE_URL` and `GITHUB_CLIENT_ID` are staging values.
- No binding uses production `script_name`.

### First full staging deploy

Dispatch [`deploy-staging.yml`](../.github/workflows/deploy-staging.yml)
(`workflow_dispatch`, optional `ref` input — defaults to the ref the run was
dispatched on). It re-runs the `ci.yml` `check` job against the resolved
commit, then deploys. The underlying command is:

```bash
npx wrangler deploy --env staging
```

This first full deployment creates/applies the staging Durable Object
namespaces. Save the deployment id, source SHA, actor, timestamp, and highest
applied migration tag.

### Bootstrap smoke

Run the smoke checklist below. Do not proceed to production planning until all
required checks pass.

## Routine staging deployment

1. Dispatch `deploy-staging.yml` with the candidate `ref` (branch, tag, or
   SHA).
2. Confirm no other UAT candidate currently owns staging.
3. Require a green CI check for that SHA (the workflow re-runs `ci.yml`
   itself before deploying).
4. Deploy with the `staging` GitHub Environment and the
   `topology-dojo-staging` concurrency group (a newer dispatch cancels a
   queued/running older one).
5. Record the active SHA in the workflow run summary.
6. Run automated HTTP smoke tests.
7. Run browser/MCP/workspace smoke when the change touches auth, Worker routes,
   bindings, storage, or workspace behavior.
8. Notify UAT participants that staging now represents the new SHA.

Staging is a mutable release-candidate environment. Test reports are invalid if
their recorded SHA does not match the current deployment.

## Production deployment without a new migration

1. Confirm the exact SHA passed CI and staging smoke.
2. Review the diff from the currently deployed production SHA.
3. Confirm no new migration tag appears.
4. Dispatch [`deploy-production.yml`](../.github/workflows/deploy-production.yml)
   from `main` (its `guard` job rejects any other ref unless an explicit
   `recovery_sha` is supplied) and obtain the required `production`
   environment approval.
5. The workflow re-runs `ci.yml`, then deploys with
   `wrangler deploy --env=""` (the explicit empty-string environment is
   required once `env.staging` exists — a bare `wrangler deploy` only warns
   and refuses to guess).
6. Run production-safe smoke checks.
7. Observe error rate and auth failures for the agreed window.
8. Record the result and update the deployment inventory.

If smoke or monitoring fails, follow [`ROLLBACK.md`](ROLLBACK.md).

## Production deployment with a new migration

> **Current migration state (revalidated 2026-08-09):** `v1`–`v5` are applied
> and their three product flags are enabled in the repository's production
> configuration. The `v3`–`v5` sections below are completed rollout examples,
> retained because they show the required three-gate pattern. For a new tag,
> copy the pattern with the new class/binding/flag; do not repeat a completed
> bootstrap or treat these examples as pending work.

### Gate A — staging proof

- The migration has been applied by a full staging deploy.
- Staging has exercised creation and use of the new namespace/class.
- Old and new code/storage contracts are compatible where they overlap.
- A forward-recovery build is ready or reproducible.
- The rollback boundary and stop conditions have been reviewed.

### Gate B — namespace bootstrap

The completed `v3` rollout deployed workspace entry points disabled:

```text
WORKSPACE_ENABLED=false
```

Dispatch `deploy-production.yml` with its `expect_workspace_disabled` input
set to `true` so the workflow's smoke step asserts the 503
`workspace_disabled` contract instead of the normal 401.

The bundle must still export `TopologyDocument`, bind `TOPOLOGY_DOCUMENT`, and
include `v3`. After deployment:

- confirm the normal application and legacy MCP paths still work;
- confirm Cloudflare reports a healthy active deployment;
- confirm the new binding exists;
- do not create or lazy-migrate production workspaces yet.

### Gate C — feature activation

After bootstrap smoke and approval, the rollout enabled the workspace and
deployed forward.
Run the full shared-workspace smoke suite immediately, then hold the activation
in the observation window below. A failed activation — a red smoke or any
tripped stop threshold — is recovered by disabling the feature
(`WORKSPACE_ENABLED=false`) and deploying a compatible forward version; do not
roll back across `v3`. See "Activation observation window and thresholds".

### Completed example: migration `v4` — `AuthoringProfile`

The same three gates, with one simplification: `PROFILES_ENABLED` is **opt-in**
(unset ⇒ off — the opposite default from `WORKSPACE_ENABLED`), so the
production bootstrap needs **no config change at all**. Merging P2 and running
the normal protected production deploy _is_ the flag-off bootstrap.

1. **Gate A — staging proof.** Merge P2; dispatch `deploy-staging.yml`. This
   applies `v4` to the staging script (staging has `PROFILES_ENABLED="true"`,
   so its learner observes). Run smoke; exercise an accept → user-correction →
   `create_checkpoint` sequence and confirm a candidate appears (via the DO —
   or the P3 panel once it exists). Perform the forward-recovery drill for
   `v4`: redeploy staging with `PROFILES_ENABLED` removed/`"false"`, verify the
   app + workspace flows are unaffected, re-enable.
2. **Gate B — production bootstrap (inert).** Dispatch `deploy-production.yml`
   from `main` with approval. The bundle exports `AuthoringProfile`, binds
   `AUTHORING_PROFILE`, and applies `v4`; with no top-level `PROFILES_ENABLED`
   the learner is fully inert (zero storage writes, responses unchanged).
   Verify `v4` applied and the binding exists; run the normal smoke; create no
   profile data.
3. **Gate C — activation (later, when P3/P4 make profiles useful).** A tiny PR
   adding top-level `"PROFILES_ENABLED": "true"`; deploy with approval; watch
   the observation window. Recover by forward-deploying with the flag removed —
   never roll back across `v4`.

**Historical sequencing note:** the first gated production deploy carried the
then-pending migration tags together. The independent flags kept each surface
inert until its own activation. For any future multi-tag bootstrap, record every
tag and activate each feature separately.

### Completed example: migration `v5` — `AnalyticsLog`

Identical shape to `v4`: `ANALYTICS_ENABLED` is **opt-in** (unset ⇒ off), so the
production bootstrap needs **no config change** — merging the admin dashboard PR
and running the normal protected production deploy _is_ the flag-off bootstrap.
`ADMIN_GITHUB_ID` (the owner's numeric GitHub id) is set at the top level from
the start; it is harmless while the surface is off (`isAdmin()` only matters once
`/api/admin` is reachable, which requires `ANALYTICS_ENABLED`), and the admin
gate fails **closed** if it is ever unset.

1. **Gate A — staging proof.** Merge the PR; dispatch `deploy-staging.yml`. This
   applies `v5` to the staging script (staging has `ANALYTICS_ENABLED="true"` +
   `ADMIN_GITHUB_ID`, so the dashboard is live for UAT). Run smoke; sign in as
   the admin → the Admin chip appears → the roster lists your own just-recorded
   login → click a user → their workspace names/counts (metadata only). Confirm
   a non-admin session (or an unauthenticated `/api/admin/summary`) gets
   `403`/`401` and never sees the chip. Perform the forward-recovery drill for
   `v5`: redeploy staging with `ANALYTICS_ENABLED` removed/`"false"`, verify the
   app + login flow are unaffected (logins simply stop being recorded, the
   `/api/admin` routes `503`), re-enable.
2. **Gate B — production bootstrap (inert).** Dispatch `deploy-production.yml`
   from `main` with approval. The bundle exports `AnalyticsLog`, binds
   `ANALYTICS`, and applies `v5`; with no top-level `ANALYTICS_ENABLED` the store
   is fully inert (zero login writes, `/api/admin` returns the stable
   `admin_disabled` 503, `/api/me` reports `admin: false`). Verify `v5` applied
   and the binding exists; run the normal smoke; create no analytics data.
3. **Gate C — activation (when the dashboard is wanted in prod).** A tiny PR
   adding top-level `"ANALYTICS_ENABLED": "true"`; deploy with approval. From
   then on logins are recorded and the owner's Admin chip is live. Recover by
   forward-deploying with the flag removed — never roll back across `v5`.
   Note: analytics only capture data **going forward**; there is no historical
   backfill of logins that happened before activation.

## Smoke checklist

### Automated HTTP smoke

`scripts/smoke.mjs` — credential-free, non-mutating, safe against any
environment at any time. The full check list (locked by
`src/testing/smoke-checks.test.ts`; update both together):

| Check               | Request                                       | Expected                                                                                              |
| ------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `healthz`           | `GET /healthz`                                | `200 { ok: true, sha, workspaceEnabled }`, no secret data; with `--sha`, the deployed-commit assert   |
| `readyz-unauth`     | `GET /readyz`                                 | `401` — the deep probe must never run unauthenticated                                                 |
| `app`               | `GET /` without session                       | Redirect to `/login`                                                                                  |
| `login`             | `GET /login`                                  | `200`, login page with the GitHub affordance                                                          |
| `me-unauth`         | `GET /api/me`                                 | `401`                                                                                                 |
| `oauth-metadata`    | `GET /.well-known/oauth-authorization-server` | `200`, valid metadata                                                                                 |
| `mcp-unauth`        | `POST /mcp` without credentials               | `401`                                                                                                 |
| `workspaces-unauth` | `GET /api/workspaces`                         | `401`; with `--expect-workspace-disabled`, exactly `503 {"error":"workspace_disabled"}`               |
| `profile-unauth`    | `GET /api/profile/preferences`                | `401`; with `--expect-profiles-disabled`, exactly `503 {"error":"profiles_disabled"}`                 |
| `admin-unauth`      | `GET /api/admin/summary`                      | `401`; with `--expect-analytics-disabled`, exactly `503 {"error":"admin_disabled"}`                   |
| `share-404`         | `GET /api/topology/nonexistent`               | `404`, controlled JSON error                                                                          |
| `viewer-shell`      | `GET /v/<nonexistent>` as navigation          | `200` app shell **without** sign-in (public share view stays ungated)                                 |
| `showcase`          | `GET /showcase/hub-spoke.webp`                | `200` image, ungated (login-page filmstrip asset)                                                     |
| `fault-inert`       | `GET /__staging/fault` (no token)             | Anything **except** a synthetic fault — proves the staging-only fault gate never fires uncredentialed |

`GET /readyz` with a signed-in session is the deeper readiness check (a
`TOPOLOGY_KV` round-trip, a `TOPOLOGY_REGISTRY` DO echo, and — when
`WORKSPACE_ENABLED` — a `TOPOLOGY_DOCUMENT` DO echo; `200` when every binding
is reachable, `503` naming the failing binding otherwise). It requires a
session cookie, so it stays a manual/UAT check; the unauthenticated smoke
covers only its auth gate (`readyz-unauth`).

Production can be verified on demand — and is verified daily on a schedule —
by [`production-verify.yml`](../.github/workflows/production-verify.yml)
(optional `expected_sha` input for deployed-SHA-mismatch detection; failures
file a deduplicated `production-smoke` issue that a later green run closes).
Staging drills can temporarily override feature flags per deploy through
`deploy-staging.yml`'s `workspace_enabled` / `profiles_enabled` /
`analytics_enabled` inputs (staging-only; production flag changes are always
a reviewed `wrangler.jsonc` commit) — see `GAME_DAY.md`.

### Browser OAuth smoke

- Open a clean/private browser profile.
- Sign in through the environment-specific GitHub OAuth App.
- Confirm the callback returns to the same environment.
- Confirm `/api/me` reports the expected identity.
- Sign out and confirm the session no longer grants editor access.

### Remote MCP smoke

- Connect a fresh MCP client to the environment `/mcp` URL.
- Complete dynamic client registration and GitHub authorization.
- List tools and call a read-only capability tool.
- Create a disposable private draft and verify it survives a new transport
  session.
- Delete/retire disposable data according to the test-data policy.

### Shared workspace smoke

- Create a disposable canonical workspace.
- Open it in the browser Agent Workspace.
- Submit an agent proposal and verify the canonical revision does not change.
- Accept one proposal and reject another.
- Grant a current-page lease, apply a scoped agent change, and revoke it.
- Verify an out-of-scope change is rejected.
- Refresh/reconnect and verify the canonical snapshot and revision.
- Lazy-migrate a disposable legacy draft and verify stale legacy mutation is
  refused.
- Confirm another GitHub user cannot access the owner workspace.

## Stop conditions

Stop promotion or activation when any of the following occurs:

- migration status is unknown or differs from the expected tag;
- a staging resource id matches production;
- OAuth redirects cross environments;
- any smoke test mutates production during staging validation;
- canonical workspace revisions regress or accepted data disappears;
- persistence failures are logged after a successful operation response;
- Worker error rate exceeds the approved threshold (see "Activation observation
  window and thresholds");
- the deployed SHA cannot be proven from the workflow/deployment record.

## Activation observation window and thresholds

The concrete go/no-go criteria for the workspace-activation flip (Gate C / plan
O11). These are the "approved threshold" the Stop conditions refer to. Tuned for
this deployment's reality — a single-owner, low-traffic Worker — so absolute
counts lead and percentage rates apply only once a window has enough samples to
be meaningful. These same numbers are the `[A]`-marked rows of the standing
production alert matrix ([`ALERTS.md`](ALERTS.md)); the human dashboard steps
to wire them into Cloudflare notifications are
[`CLOUDFLARE_OPERATOR_RUNBOOK.md`](CLOUDFLARE_OPERATOR_RUNBOOK.md) (packet O1
— **not yet configured** as of 2026-07-19; the GitHub synthetic layer in
`ALERTS.md` §"Detection layers" is the active safety net meanwhile).

Every trip recovers the same way: **forward-deploy `WORKSPACE_ENABLED=false`**
(never roll back across `v3`).

### Observation window

| Tier                 | Duration              | Activity                                                                                     | Exit                                                                                           |
| -------------------- | --------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| T0 — activation gate | Immediately post-flip | Run the full shared-workspace smoke suite.                                                   | 100% green, or **immediate** flag-off — no soak on a failed smoke.                             |
| T1 — active watch    | 2 hours, hands-on     | Owner actively watches Worker metrics, DO metrics, and logs; exercises real workspace flows. | No stop condition tripped → enter T2.                                                          |
| T2 — soak            | 72 hours, passive     | Alerting-only (O12 alerts must be live). Normal intermittent use permitted.                  | Clean soak → Phase 5 exit. Flag retirement (Phase 6) stays gated on a further routine release. |

### Hard stops — roll back on first occurrence (data integrity)

- canonical workspace revision regresses, or an accepted proposal does not
  advance the canonical revision;
- a persistence failure is logged after a success response was returned;
- a lease-scoped change applies out of scope, or an out-of-scope change is not
  rejected;
- the owner cannot complete GitHub sign-in to production at all.

### Rate-based stops — roll back on sustained breach

Evaluated over a 10-minute rolling window. The rate column applies only once the
window holds **≥20 requests**; below that, the absolute column governs.

| Signal                                                                                                      | Absolute trip (any volume) | Rate trip (≥20 req/window) |
| ----------------------------------------------------------------------------------------------------------- | -------------------------- | -------------------------- |
| Worker errors (5xx / unhandled exceptions)                                                                  | ≥ 5 in 10 min              | > 2% of requests           |
| Durable Object errors (`TopologyDocument` / registry storage exceptions, non-data-loss)                     | ≥ 3 in 10 min              | > 1% of DO ops             |
| OAuth server-side failures (callback 5xx, token-exchange error, KV failure; excludes user-declined consent) | ≥ 3 in 10 min              | > 5% of auth attempts      |

### Informational — not a stop by itself

- Proposal conflicts are expected under optimistic concurrency; elevated volume
  is worth noting but only becomes a stop when it coincides with a hard-stop
  data-integrity signal above.
- Request latency is not one of proposal 0004's named activation signals; watch
  it for context, but it does not by itself trip a rollback.

## Deployment record template

```markdown
### Topology Dojo deployment

- Environment:
- Source SHA:
- Pull request:
- Actor/approver:
- Workflow run:
- Cloudflare deployment/version id:
- Highest migration tag before/after:
- Feature flags:
- Automated smoke:
- Manual OAuth/MCP/workspace smoke:
- Observation window/result:
- Follow-up issues:
```

## Ownership

- Release owner: coordinates candidate SHA, approval, and smoke evidence.
- Cloudflare owner: manages tokens, Workers Builds state, bindings, and alerts.
- OAuth owner: manages environment-specific GitHub Apps and callback URLs.
- UAT owner: confirms the tested staging SHA and signs off on acceptance.
- Incident owner: invokes the rollback or forward-recovery runbook.
