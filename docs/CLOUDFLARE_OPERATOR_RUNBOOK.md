# Cloudflare Operator Runbook (human-only steps)

_Initiative O, packet O1. Every step in this file requires a human with
Cloudflare dashboard access — **no agent or workflow in this repository can
perform or verify them**, and none of them may be marked complete without
the evidence noted in each step. Companion: [`ALERTS.md`](ALERTS.md) (what to
configure and why), [`GAME_DAY.md`](GAME_DAY.md) (how to exercise what you
configured)._

## Ground rules

- **Environment scoping is by Worker script**: production is the Worker
  named `topology-dojo`; staging is `topology-dojo-staging`. Every metric
  view, log query, and notification policy must be checked against the
  script name before trusting or saving it. A policy that covers "all
  Workers" will page you for deliberate staging game-day faults — scope
  production policies to the production Worker wherever the dialog allows,
  and where it does not (account-wide alert types), record that limitation
  next to the policy in the evidence record.
- **Accounts/roles**: you need a Cloudflare account member with permission
  to view Workers analytics and manage account Notifications
  (Administrator, or a role including "Notifications Edit" + Workers read).
  The repo cannot verify your role; the validation for each step is that
  the described UI action succeeds.
- **Evidence**: for each completed step, capture (a) a screenshot of the
  final state, (b) the policy/destination name and (if shown) id, (c) the
  date. Store them in the private operator record (per
  `DEPLOYMENT_RUNBOOK.md` §"Environment inventory" — **never** commit
  screenshots or ids that embed tokens). Then update the checklist at the
  bottom of this file via PR.
- **Honesty rule**: Cloudflare's notification catalog and observability
  features vary by plan and change over time. Where a step below says
  "record what the catalog offers", the truthful outcome may be "the
  desired alert type does not exist on this plan" — that is a valid,
  recordable result and feeds the L3 gap list in `ALERTS.md`. Do not force
  a checkmark by configuring something that does not actually watch
  production.

## CF-1 — Locate Worker metrics, exceptions, and latency (read-only)

| Field                | Value                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Where                | Dashboard → **Workers & Pages** → select **`topology-dojo`** (production) → **Metrics** tab. Repeat for **`topology-dojo-staging`** so you can tell the two apart on sight.                                  |
| What you should find | Requests, error counts/rates (including uncaught exceptions), CPU time and duration percentiles (median/p99), per time range. Durable Object metrics appear per namespace under the Durable Objects section. |
| Environment          | Both — but bookmark the two script pages separately.                                                                                                                                                         |
| Validation           | The production page shows the request pattern you expect (low, single-owner volume) and the deployed version matches the latest `deploy-production` run.                                                     |
| Evidence             | Screenshot of the production Metrics tab showing the script name + date range.                                                                                                                               |

For log-level investigation: Dashboard → **Workers & Pages** →
**Observability** (Workers Logs / Query Builder). This repo already ships
`"observability": { "enabled": true }` in `wrangler.jsonc`, so invocation
logs are retained (7 days) without further config. Useful saved queries to
create while you are there (staging first to practice, then production):

1. 5xx by path: filter `status >= 500`, group by path.
2. Uncaught exceptions: filter on the error/exception field
   (`$workers.event.error` exists on invocation logs).
3. OAuth server failures: free-text `web login:` (the `worker/auth.ts`
   error-log prefix), excluding user-declined flows.
4. Login-analytics write failures: free-text
   `login analytics record failed`.

Evidence: the saved queries' names, listed in the operator record.

## CF-2 — Create the notification destination

| Field       | Value                                                                                                                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where       | Dashboard → **Notifications** → **Destinations**.                                                                                                                                                    |
| Action      | Confirm the owner's email is a verified notification destination. Optionally add a webhook destination (e.g. to a personal alert relay) via **Webhooks → Create** — the dialog sends a test on save. |
| Environment | Account-level (shared by any policy you create later).                                                                                                                                               |
| Validation  | For webhooks, the built-in "Save and Test" must succeed. For email, complete CF-4's end-to-end test before trusting it.                                                                              |
| Evidence    | Screenshot of the Destinations page; destination names in the operator record. **Never** put webhook secrets/URLs in the repo.                                                                       |

## CF-3 — Survey the notification catalog and create what exists

| Field       | Value                                                                                                                                                                                                                                                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where       | Dashboard → **Notifications** → **All Notifications** → **Add**.                                                                                                                                                                                                                                                                             |
| Action      | Walk the product list and record, verbatim, which alert types this account/plan offers for: **Workers** (any script-error/usage types), **Billing/Usage** (usage-based billing thresholds), **Health Checks** (only exists if the plan includes standalone Health Checks), and zone-level **HTTP/origin** alert types for `harnessed.cloud`. |
| Environment | Production focus; scope to the production Worker/zone wherever the type allows scoping.                                                                                                                                                                                                                                                      |
| Validation  | The recorded list is the outcome — including absences.                                                                                                                                                                                                                                                                                       |
| Evidence    | The verbatim list (with plan name) in the operator record + pasted into the O1 completion PR that updates `ALERTS.md`'s L3 rows.                                                                                                                                                                                                             |

Then create, from whatever the catalog actually offers, policies matching
`ALERTS.md`'s `human`-managed rows — nearest available semantics, thresholds
from the matrix (`[A]` values exactly; `[P]` values as starting points).
Name policies `topology-dojo-prod-<alert-name>` so the mapping back to the
matrix is 1:1. If a desired row has no supported alert type, write "no
supported type on <plan> as of <date>" next to that row's L3 status —
`ALERTS.md` already treats the GitHub synthetic layer (L1) as the guaranteed
baseline, and its "Monitoring gaps" table is where the durable record of the
limitation lives.

**Known plan-dependent options, in preference order, if the basic catalog
has no Workers-error type:**

1. **Standalone Health Checks** (plan-gated): an HTTPS check against
   `https://topology-dojo.harnessed.cloud/healthz` expecting 200, with its
   status-change notification type. This is the closest Cloudflare-native
   equivalent of the repo's own daily verify, at minutes-level latency.
2. **Zone HTTP error-rate alert types** (plan-gated, Business+
   historically): scope to the `harnessed.cloud` zone; note they watch the
   zone, not the Worker script, so staging (workers.dev) never triggers
   them.
3. **OTLP export / Tail Worker → external monitor** (Workers Paid): export
   logs/traces to an external stack (Grafana/Honeycomb/etc.) and alert
   there. This is the "external monitoring later" path in `ALERTS.md` and a
   deliberate, separate decision — do not stand it up as a side effect of
   this checklist.

## CF-4 — Verify notification delivery end-to-end (staging fault, never production)

Only after the repo-side game-day prerequisites exist (this PR):

| Field        | Value                                                                                                                                                                                                                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Precondition | `DIAGNOSTICS_TOKEN` secret set for **staging only** (`npx wrangler secret put DIAGNOSTICS_TOKEN --env staging`, value ≥16 chars from a password generator, stored only in the operator's password manager) and a temporary staging-scoped copy of the alert policy (or acceptance that an account-wide policy will fire — note which). |
| Action       | Run `GAME_DAY.md` scenario S-3 (synthetic staging exception burst via `/__staging/fault`). Watch for the alert to arrive at the CF-2 destination.                                                                                                                                                                                      |
| Environment  | **Staging only.** Production fault injection is prohibited (see `GAME_DAY.md` §"Stop conditions").                                                                                                                                                                                                                                     |
| Validation   | The notification arrives; its timestamps line up with the fault window; time-to-notify is recorded.                                                                                                                                                                                                                                    |
| Evidence     | The received email/webhook payload (redact tokens), time-to-notify, in the game-day evidence record (`GAME_DAY_EVIDENCE_TEMPLATE.md`).                                                                                                                                                                                                 |

## CF-5 — Acknowledge, record, and verify recovery

Cloudflare Notifications has no acknowledge/resolve workflow — treat the
GitHub issue as the system of record:

1. On receiving any Cloudflare alert, find or open the matching GitHub
   issue (`production-smoke` label for production; `nightly-smoke` for
   staging) and comment that you have it — that comment is the
   acknowledgement timestamp used for the severity-model goals.
2. Diagnose via CF-1's views/queries; act per the matrix row's operator
   action.
3. Recovery: some alert types send an explicit "resolved" notification,
   others simply stop firing — verify recovery positively either way by
   dispatching `production-verify` (with `expected_sha` when relevant) and
   letting its green run close the issue.
4. Evidence: the issue thread carries detection → ack → recovery times; for
   game days, copy those into the evidence record.

## CF-6 — Binding-level triage pointers (when `/readyz` names a failing binding)

- `kv` → Dashboard → **Storage & Databases → KV** → namespace
  `TOPOLOGY_KV` (production id per `wrangler.jsonc`) → metrics/ops.
- `registry` / `document` → Workers & Pages → `topology-dojo` → Durable
  Objects → the `TopologyRegistry` / `TopologyDocument` namespace metrics,
  plus CF-1's log queries filtered to `/api/workspaces`.
- Cross-check [Cloudflare status](https://www.cloudflarestatus.com/) before
  assuming an application fault: a platform incident is recovered by
  waiting/confirming, not by deploying.

## Avoiding staging-noise in production alerting

- Game-day drills deliberately break **staging** (`GAME_DAY.md` Phase 2).
  Before a drill: confirm which of your policies are production-scoped
  (script-scoped policies: fine; account-wide policies: expect and ignore
  the staging-caused firing, or pause that policy for the drill window and
  — **stop-condition** — set a timer to unpause it at drill end; record
  the pause in the evidence record either way).
- The nightly staging smoke (08:00 UTC) will fail by design if a drill
  leaves staging in a degraded state overnight — end every drill by
  restoring staging (a normal `deploy-staging` dispatch, no overrides) so
  the nightly acts as the drill's independent "state restored" check
  rather than a false alarm.

## Operator checklist (update via PR as steps complete)

An unchecked row means only that the repository contains no dated completion
evidence. It is not proof that the external Cloudflare setting is currently
absent. Revalidate in the dashboard, capture evidence privately, and then
update this table.

| #    | Step                                                                               | Status | Evidence ref |
| ---- | ---------------------------------------------------------------------------------- | ------ | ------------ |
| CF-1 | Metrics/logs located; saved queries created (staging + prod)                       | ☐      |              |
| CF-2 | Notification destination(s) verified                                               | ☐      |              |
| CF-3 | Catalog surveyed verbatim; existing types configured; gaps recorded in `ALERTS.md` | ☐      |              |
| CF-4 | Delivery verified end-to-end via staging fault (never production)                  | ☐      |              |
| CF-5 | Ack/record/recovery flow exercised once                                            | ☐      |              |
| CF-6 | Binding triage pointers walked once (familiarization)                              | ☐      |              |
| —    | `DIAGNOSTICS_TOKEN` set for staging only (see CF-4 precondition)                   | ☐      |              |
