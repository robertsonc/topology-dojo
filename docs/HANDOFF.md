# Handoff

_The primary entry point for picking up work on this repo. Rewritten
2026-07-19 as part of a full documentation reset (see
[`ROADMAP.md`](ROADMAP.md), [`CAPABILITY_MATRIX.md`](CAPABILITY_MATRIX.md),
[`DISCREPANCY_REGISTER.md`](DISCREPANCY_REGISTER.md)). Earlier handoff notes
and the pre-reset implementation plan are preserved under
[`archive/`](archive/) — do not treat anything there as current status; each
carries a banner pointing back here._

## What Topology Dojo is

A production-hosted, collaborative, AI-agent-assisted network-topology
authoring platform. A human authors multi-page flipbook diagrams in a
browser editor; an AI agent authors the same documents through an MCP server
(local stdio or remote Cloudflare, OAuth-gated) using the identical
catalog-driven API; the two collaborate in a shared workspace with
proposals, leases, checkpoints, and a revision timeline. An observe-only
learner adapts agent behavior to a human's confirmed authoring preferences
over time. See `ROADMAP.md` §"Current production baseline" for the full
picture with evidence citations.

## Current production state

As of this reset (`main` @ `d169274`, PR #195 merged 2026-07-18):

- **All three major feature flags are live**: `WORKSPACE_ENABLED`,
  `PROFILES_ENABLED`, `ANALYTICS_ENABLED` are all `"true"` in the top-level
  (production) `wrangler.jsonc`. Nothing is bootstrapped-but-inert right now.
- **Migrations `v1`–`v5` are all applied** in production: `TopologyMcp`,
  `TopologyRegistry`, `TopologyDocument`, `AuthoringProfile`, `AnalyticsLog`.
- **Production origin**: `https://topology-dojo.harnessed.cloud` (moved from
  the `workers.dev` subdomain 2026-07-18; the GitHub OAuth App callback was
  repointed to match). Staging stays on its own `workers.dev` subdomain,
  fully isolated (`check-wrangler-env.mjs` enforces this in CI).
- **723 tests passing**, 63 test files (`npm test`).
- **The one confirmed operational gap**: Cloudflare error-rate alerting is
  not configured. Production runs without automated alerts by explicit,
  documented operator choice (nightly staging smoke + GitHub-native failure
  notifications are the current safety net). This is `IMPLEMENTATION_PLAN.md`
  initiative O, packets O1–O3, and it's ready to start any time — no code
  dependency blocks it.
- **Zero open PRs, zero open issues.** This repo does not use GitHub Issues
  as a planning tool — all planning lives in `docs/`. 174 PRs merged to date
  (#1–#195). 7 stale-but-fully-merged branches exist on origin (safe to
  delete, no unique commits) — deleting them is a human/operator task (this
  environment's git push has been observed to reject `--delete` pushes; if
  that's still true, it needs to be done from a different environment).

## Recently completed (this session)

In order: the adaptive-authoring-profiles packets P4/P5 (confirmation/
scoping/guidance MCP tools, then outcome refinement); a labelScale contract
field for link labels; the nightly staging smoke workflow; the owner-only
admin/analytics dashboard (migration `v5`, two-gate bootstrap-then-activate
rollout); the production domain cutover to `harnessed.cloud`; two security
fixes (finding M18, an open-redirect bypass in the post-login redirect
guard; finding M19, a login-page copy correction to match the actual
open-signup posture); a pre-login showcase filmstrip on the login page
(four topologies authored via MCP, animated WebP frames); and this
documentation reset.

## Active implementation program

Six initiatives, detailed in `IMPLEMENTATION_PLAN.md`:

| #   | Initiative                                  | Status                                 | Blocking dependency                                                      |
| --- | ------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------ |
| N   | Documentation reset                         | **In progress — packet N3 is this PR** | None                                                                     |
| O   | Cloudflare alerting + production game day   | Not started                            | None — can start immediately                                             |
| A   | Agent activity + explainability             | Not started                            | None — soft dependency on N landing                                      |
| B   | Guided topology briefs + semantic templates | Not started                            | None — soft dependency on N landing                                      |
| E   | EdgeConnect live-import hardening + UI      | Not started                            | None — soft dependency on N landing                                      |
| T   | Time-aware flow/failure storytelling        | Not started                            | Packet E2 specifically (shared-file hotspot on `src/connect/compile.ts`) |

**Immediate next packet after this PR merges: O1** (configure Cloudflare
alerting) or **A1/B1/T1** (pure-types packets, no dependencies, safe to start
in parallel) — see `IMPLEMENTATION_PLAN.md`'s dependency graph for the full
picture of what can run concurrently.

## Important architectural rules

Read these before touching code — violating any of them has caused a
production incident or a launch-blocking finding in this repo's history:

- **Every workspace write goes through one path.** Human GUI edits, agent
  proposals, agent leased commits, restore, and fork all flow through
  `TopologyDocument`'s single commit pipeline (`worker/document.ts`). Never
  add a second write path for convenience or performance.
- **Pages are independent, full-frame documents — no cross-page
  inheritance, ever.** This is a locked architecture decision
  (`docs/decisions/0001-flipbook-vs-beats.md`, `DESIGN.md` #1). If a feature
  seems to need one page to reference/inherit from another, that's a design
  smell — see how the time-aware-storytelling initiative (T) works around
  this by fully compiling each page independently.
- **Agents never write silently.** Every agent mutation to a shared
  workspace is either a reviewable proposal or a time-bounded,
  browser-granted, page-scoped lease commit — no "just write it" path exists
  by construction (`worker/document.ts` `commit()` requires either
  `source: 'proposal'` acceptance or an active lease for
  `source: 'agent-lease'`). Keep it that way.
- **Never treat a transient provider-fetch failure as deletion evidence.**
  The flow compiler's `upsertBySource` model updates/creates from what a
  provider _returns_; an empty or failed fetch must never cascade-delete
  previously-compiled elements. This is enforced by a specific test
  (`IMPLEMENTATION_PLAN.md` packet E2) precisely because it's an easy mistake
  to make when "simplifying" sync logic.
- **No raw prompt/conversation logging, anywhere.** The authoring-profile
  learner and the planned agent-explainability work both operate on
  structured, deterministic feature extraction from document _operations_ —
  never on raw LLM prompts, completions, or transcripts.
- **One catalog is the source of truth.** Anything a human can set through
  the inspector, an agent can set identically through the same
  catalog-driven contract (`src/api/catalog.ts`) — no UI-only fields, no
  agent-only fields. See `DESIGN.md` #2/#3.

## Deployment rules

- **Production deploys exclusively through `deploy-production.yml`** —
  restricted to `main`, requires a protected `production` GitHub Environment
  approval, re-runs the full CI check first. There is no other path;
  `npm run deploy` was deleted (finding L1). Workers Builds' Git integration
  is disconnected (operator O9) specifically because it once bypassed this
  gate.
- **Staging is isolated and safe to dispatch freely**
  (`deploy-staging.yml`, optional `ref` input) — separate KV namespaces, DO
  namespaces, GitHub OAuth App, and origin from production.
  `scripts/check-wrangler-env.mjs` (run in CI and locally via
  `npm run check:wrangler`) enforces the isolation invariants and fails loudly
  on drift.
- **Recovery is always forward-only.** Never roll back across a migration
  boundary — redeploy with the offending flag turned off instead. See
  `docs/ROLLBACK.md`.

## ⚠️ Durable Object migration warning

**None of the six active initiatives in `IMPLEMENTATION_PLAN.md` are
designed to require a new migration.** If you're implementing a packet from
that plan and find yourself needing one anyway, **stop and get explicit
human sign-off before proceeding** — this repo has never added a migration
without a full bootstrap-then-activate cycle (ship the new DO class inert
behind a flag in one deploy, activate it in a separate deploy after
verification), and skipping that discipline is the single highest-risk
mistake a new agent could make here. See `docs/DEPLOYMENT_RUNBOOK.md`'s
per-migration gate sections (`v3`, `v4`, `v5`) for the pattern to follow if
one genuinely becomes necessary.

## Test commands

```bash
npm run typecheck   # tsc --noEmit (app) + tsc -p worker/tsconfig.json --noEmit (worker)
npm run lint         # eslint . && prettier --check .
npm test             # vitest run — 723 tests, 63 files
npm run build        # tsc --noEmit && vite build
npm run check:wrangler   # node scripts/check-wrangler-env.mjs — staging isolation + migration parity
```

Run all five before opening any PR. Durable Object / Miniflare and
`session.ts` WebCrypto suites fail to **start** locally (no `workerd`/
`File`/`crypto` in this environment) — they run in CI. Keep new
DO-adjacent logic locally verifiable by splitting it into pure
helpers/fakes the way `src/admin/roster.ts`, `src/profile/learner.ts`, and
`src/workspace/operations.ts` already do — that pattern is why this repo's
test suite stays fast and mostly local-runnable despite the DO-heavy
architecture.

## Key files

| Area                             | Files                                                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Document model + persistence     | `src/pages/model.ts`, `src/pages/persist.ts`                                                                                            |
| Headless authoring API           | `src/api/{builder,edit,validate,layout,autolayout,catalog,tidy}.ts`                                                                     |
| MCP tools (both transports)      | `src/mcp/tools.ts` (source of truth), `src/mcp/register.ts`, `src/mcp/server.ts` (stdio), `worker/mcp.ts` (remote)                      |
| Connector/flow-compiler platform | `src/connect/{types,mock,edgeconnect,compile}.ts`                                                                                       |
| Shared workspace coordinator     | `worker/document.ts` (revisions/proposals/leases/checkpoints/presence), `worker/registry.ts`, `worker/workspaces.ts`                    |
| Workspace client                 | `src/workspace/{model,client,offline,operations}.ts`, `src/ui/workspace-panel.ts`                                                       |
| Adaptive authoring profiles      | `src/profile/{features,learner,refinement,guidance}.ts`, `worker/profile.ts`, `worker/profile-api.ts`, `src/ui/profile-panel.ts`        |
| Admin/analytics dashboard        | `worker/analytics.ts`, `worker/admin-api.ts`, `src/admin/`, `src/ui/admin-dashboard.ts`                                                 |
| Auth + login page + showcase     | `worker/auth.ts`, `public/showcase/*.webp`                                                                                              |
| Deployment config                | `wrangler.jsonc`, `.github/workflows/{deploy-staging,deploy-production,ci,nightly-staging-smoke}.yml`, `scripts/check-wrangler-env.mjs` |
| Flags                            | `worker/env.ts` (`workspaceEnabled`, `profilesEnabled`, `analyticsEnabled`, `isAdmin`)                                                  |

## Known risks (from the launch-readiness findings register)

51 findings from the 2026-07-04 adversarial review; 8 now closed (this
reset closed C1–C4 and H7, previously M14/M18/M19/L1 were closed). No
Critical findings remain open. Two open findings worth knowing about because
they're small and well-scoped if picked up:

- **H1** — `layout_topology` doesn't carry anchors/manual link waypoints
  through its own algorithmic node movement (`tidy_topology`/
  `balance_topology` are unaffected). Fix is small: capture `orig` positions
  in `layoutPage` and call `carryAttachments(page, orig)` after the
  algorithm runs (`src/api/autolayout.ts:344-362`).
- **M20** — published share links (`/v/:id`) have no revoke/unpublish path:
  public, unauthenticated, 30-day KV retention, 24h immutable cache. Fix
  needs an authenticated delete endpoint plus dropping the `immutable`
  cache directive.

Full register: `docs/launch-readiness/FINDINGS_REGISTER.md`.

## Human-only operational tasks

Things no agent in this repo can complete alone:

1. **Approve production deploys** — the protected `production` GitHub
   Environment gate requires a human click every time, by design.
2. **Configure Cloudflare error-rate alerting** (`IMPLEMENTATION_PLAN.md`
   packet O1) — a Cloudflare dashboard action.
3. **Run the staging forward-recovery game day** (packet O2) — needs a human
   operator observing/confirming each step of a live drill.
4. **Provision EdgeConnect credentials** (packet E5) — `wrangler secret put`
   for `ORCH_BASE_URL`/`ORCH_API_KEY`, staging only, a deliberate separate
   decision never bundled into a feature deploy.
5. **Delete the 7 stale merged branches** — this environment's git push has
   been observed to reject `--delete` pushes to origin; do it from GitHub's
   UI or a different environment if that's still the case.

## Where historical plans are stored

- `docs/archive/IMPLEMENTATION_PLAN_2026-07-12.md` — the previous
  implementation plan (proposals 0002 follow-ons, 0003, 0004), fully
  executed. Carries a banner; do not treat as current.
- `docs/launch-readiness/{FINDINGS_REGISTER,QA_TEST_PLAN,UAT_PLAN}.md` — the
  2026-07-04 pre-launch review and launch-readiness plans. The findings
  register is still live/maintained (see "Known risks" above); the QA/UAT
  plans are frozen historical snapshots of a launch window that has since
  passed.
- `docs/proposals/000{1,2,3,4}-*.md` — the original design proposals for
  live-flow-visualization, the shared workspace, adaptive authoring
  profiles, and the deployment pipeline. All four are implemented; 0001's
  status header already said so, 0003/0004's were corrected as part of this
  reset (see `DISCREPANCY_REGISTER.md`).

## Working conventions (unchanged, proven across ~20 packets)

- Packet = branch = PR; one active writer per branch; small enough to be one
  reviewable PR (see `IMPLEMENTATION_PLAN.md`'s packet specs for the target
  size).
- Independently verify the risky properties and run the full gate before
  committing — don't trust a sub-agent's self-report on correctness.
- Staging deploys are safe to dispatch on request; production requires the
  protected environment approval every time, no exceptions.
