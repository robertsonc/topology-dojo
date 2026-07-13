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

| Item                   | Staging                     | Production                                          |
| ---------------------- | --------------------------- | --------------------------------------------------- |
| Worker name            | `topology-dojo-staging`     | `topology-dojo`                                     |
| Public origin          | `<staging-origin>`          | `https://topology-dojo.robertson-corey.workers.dev` |
| GitHub OAuth App       | `<staging-app>`             | `<production-app>`                                  |
| OAuth callback         | `<staging-origin>/callback` | `<production-origin>/callback`                      |
| `OAUTH_KV` id          | `<staging-id>`              | Managed in `wrangler.jsonc`                         |
| `TOPOLOGY_KV` id       | `<staging-id>`              | Managed in `wrangler.jsonc`                         |
| GitHub Environment     | `staging`                   | `production`                                        |
| Cloudflare token owner | `<owner>`                   | `<owner>`                                           |
| Last deployment SHA    | `<sha>`                     | `<sha>`                                             |
| Applied migration tag  | `<tag>`                     | `<tag>`                                             |

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
- A scoped Cloudflare deployment token and account id are stored in the GitHub
  `staging` Environment.
- Cloudflare production non-production branch builds are disabled.

### Local preflight

Run from a clean checkout of the exact candidate SHA:

```bash
npm ci
npm run typecheck
npm test
npm run lint
npm run build
npx wrangler deploy --env staging --dry-run
```

The dry run validates bundling but does not prove remote bindings or apply a
migration.

Review the effective configuration before continuing:

- Worker name ends in `-staging`.
- Both KV namespace ids are staging ids.
- All three Durable Object bindings are present.
- Migrations contain unique, ordered `v1`, `v2`, and `v3` tags.
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

### Gate A — staging proof

- The migration has been applied by a full staging deploy.
- Staging has exercised creation and use of the new namespace/class.
- Old and new code/storage contracts are compatible where they overlap.
- A forward-recovery build is ready or reproducible.
- The rollback boundary and stop conditions have been reviewed.

### Gate B — namespace bootstrap

For migration `v3`, deploy with workspace entry points disabled:

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

After bootstrap smoke and approval, enable the workspace and deploy forward.
Run the full shared-workspace smoke suite immediately. A failed activation is
recovered by disabling the feature and deploying a compatible forward version;
do not roll back across `v3`.

## Smoke checklist

### Automated HTTP smoke

| Request                                       | Expected                                                  |
| --------------------------------------------- | --------------------------------------------------------- |
| `GET /healthz`                                | `200 { ok: true, sha, workspaceEnabled }`, no secret data |
| `GET /login`                                  | `200`, login page                                         |
| `GET /` without session                       | Redirect to `/login`                                      |
| `GET /.well-known/oauth-authorization-server` | `200`, valid metadata                                     |
| `GET /api/topology/nonexistent`               | `404`, controlled JSON error                              |

`scripts/smoke.mjs` runs the `/healthz` check unauthenticated against any
environment; pass `--sha <deployed-sha>` to assert the deployed commit
matches. `GET /readyz` is a deeper, owner-authenticated readiness check (a
`TOPOLOGY_KV` round-trip, a `TOPOLOGY_REGISTRY` DO echo, and — when
`WORKSPACE_ENABLED` — a `TOPOLOGY_DOCUMENT` DO echo; `200` when every binding
is reachable, `503` naming the failing binding otherwise). It requires a
signed-in session, so it is a manual/UAT check, not part of the
unauthenticated-safe automated smoke subset above.

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
- Worker error rate exceeds the approved threshold;
- the deployed SHA cannot be proven from the workflow/deployment record.

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
