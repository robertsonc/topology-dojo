# Handoff

_The primary entry point for picking up work on this repo. Rewritten
2026-07-19 and revalidated 2026-08-09 against `main` at `4add174` (see
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

## Current repository baseline

As of this review (`main` @ `4add174`, PR #219 merged 2026-08-09):

- **All three major feature flags are live**: `WORKSPACE_ENABLED`,
  `PROFILES_ENABLED`, `ANALYTICS_ENABLED` are all `"true"` in the top-level
  (production) `wrangler.jsonc`. Nothing is bootstrapped-but-inert right now.
- **Migrations `v1`–`v5` are all applied** in production: `TopologyMcp`,
  `TopologyRegistry`, `TopologyDocument`, `AuthoringProfile`, `AnalyticsLog`.
- **Production origin**: `https://topology-dojo.harnessed.cloud` (moved from
  the `workers.dev` subdomain 2026-07-18; the GitHub OAuth App callback was
  repointed to match). Staging stays on its own `workers.dev` subdomain,
  fully isolated (`check-wrangler-env.mjs` enforces this in CI).
- **The current automated gate is 849 Vitest cases in 71 files plus 11
  Chromium browser cases.** Counts are evidence for this revision, not a
  durable product claim; use the living QA plan and the current CI run for a
  release decision.
- **The external monitoring gate needs current operator evidence**: this
  repository cannot read Cloudflare notification policy state. The repo-side
  half of `IMPLEMENTATION_PLAN.md` initiative
  O landed 2026-07-19: alert matrix + severity model (`docs/ALERTS.md`),
  Cloudflare human checklist (`docs/CLOUDFLARE_OPERATOR_RUNBOOK.md`),
  game-day framework + evidence template (`docs/GAME_DAY.md`), daily +
  on-demand production verification (`production-verify.yml`, deduplicated
  `production-smoke` issues, `expected_sha` mismatch detection), a 14-check
  smoke with per-flag disabled-contract flags, staging flag-override deploy
  inputs, and a staging-only synthetic-fault route
  (`worker/staging-fault.ts`). Still human-only: the Cloudflare dashboard
  configuration (O1) and actually executing/recording the game day (O2).
  Until delivery evidence is attached, treat the Cloudflare layer as
  unverified; the GitHub synthetic layer remains repository-evidenced.
- Planning lives in `docs/`; do not copy static PR, issue, or branch counts
  into handoff notes because those become stale independently of the code.

## Recently completed

The August quality pass added text-box/shape sizing, compact and bounded MCP
discovery/reads, atomic `edit_topology`, non-zero-origin export correction,
honest autosave with a separate public-shared-copy slot, attachment-safe
layout, `inspect_render`, complete per-page undo, recoverable frame deletion,
shared cascade cleanup, all-element proposal previews, a Chromium browser
release gate with CI-rendered baselines, and overlay/format-painter/accessibility
polish. The user guide, QA plan, UAT plan, and traceability matrix document this
current surface.

## Active implementation program

Six initiatives, detailed in `IMPLEMENTATION_PLAN.md`:

| #   | Initiative                                  | Status                                                    | Blocking dependency                                                      |
| --- | ------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| N   | Living product/quality documentation        | Baseline refreshed 2026-08-09; maintain with each change  | None                                                                     |
| O   | Cloudflare alerting + production game day   | Repo-side done 2026-07-19; O1/O2 human halves outstanding | None — human can start immediately                                       |
| A   | Agent activity + explainability             | Not started                                               | None — soft dependency on N landing                                      |
| B   | Guided topology briefs + semantic templates | Not started                                               | None — soft dependency on N landing                                      |
| E   | EdgeConnect live-import hardening + UI      | Not started                                               | None — soft dependency on N landing                                      |
| T   | Time-aware flow/failure storytelling        | Not started                                               | Packet E2 specifically (shared-file hotspot on `src/connect/compile.ts`) |

Before starting a July implementation packet, revalidate its premise against
`ROADMAP.md`, `CAPABILITY_MATRIX.md`, and current code. O1/O2 remain explicitly
human/operator work unless dated evidence says otherwise.

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
  catalog-driven contract (`src/api/catalog.ts`) — no UI-only persisted
  authoring fields and no agent-only persisted authoring fields. Local view
  state and owner-authority actions are intentionally surface-specific. See
  `DESIGN.md` #2/#3.

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
human sign-off before proceeding** — feature migrations `v3`–`v5` established
the full bootstrap-then-activate cycle (ship the new DO class inert behind a
flag in one deploy, activate it in a separate deploy after verification).
Migrations `v1` and `v2` predate that pattern. Skipping the established cycle is
the single highest-risk
mistake a new agent could make here. See `docs/DEPLOYMENT_RUNBOOK.md`'s
per-migration gate sections (`v3`, `v4`, `v5`) for the pattern to follow if
one genuinely becomes necessary.

## Test commands

```bash
npm run typecheck   # tsc --noEmit (app) + tsc -p worker/tsconfig.json --noEmit (worker)
npm run lint         # eslint . && prettier --check .
npm test             # Vitest unit + Miniflare integration suites
npm run build        # tsc --noEmit && vite build
npm run test:e2e     # Chromium functional + Linux-baseline visual release gate
npm run check:wrangler   # node scripts/check-wrangler-env.mjs — staging isolation + migration parity
```

Run the complete gate before opening a PR. Miniflare tests require permission
to bind a localhost listener; a restricted sandbox may report `listen EPERM`,
which is an environment failure rather than a product test result. Visual
baselines are CI-rendered for Linux; a macOS run can execute the functional
cases but cannot compare the three visual cases unless reviewed Darwin
baselines are deliberately added. See `launch-readiness/QA_TEST_PLAN.md`.

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

The 2026-07-04 findings register is preserved as an audit record; its original
top-line counts are not a current open-defect summary. Read appended closure
notes and `CAPABILITY_MATRIX.md`. Former finding H1 is fixed. One user-impacting
open constraint remains especially important:

- **M20** — published share links (`/v/:id`) have no revoke/unpublish path:
  public, unauthenticated, 30-day KV retention, 24h immutable cache. Fix
  needs an authenticated delete endpoint plus dropping the `immutable`
  cache directive.

Full register: `docs/launch-readiness/FINDINGS_REGISTER.md`.

## Human-only operational tasks

Things no agent in this repo can complete alone:

1. **Approve production deploys** — the protected `production` GitHub
   Environment gate requires a human click every time, by design.
2. **Configure Cloudflare alerting** (`IMPLEMENTATION_PLAN.md` packet O1) —
   a Cloudflare dashboard action; the exact steps + evidence requirements
   are `docs/CLOUDFLARE_OPERATOR_RUNBOOK.md` (CF-1..CF-6 checklist).
3. **Run the game day** (packet O2) — `docs/GAME_DAY.md`, a human operator
   observing/confirming each step of a live drill; production steps each
   require the environment-approval click. Verify the staging SHA at the start
   of every drill; the 2026-07-19 observation recorded in the historical
   findings is not evidence of the current deployment.
4. **Provision the staging-only `DIAGNOSTICS_TOKEN` secret** (for game-day
   scenarios S-2..S-4): `npx wrangler secret put DIAGNOSTICS_TOKEN --env
staging` with a generated ≥16-char value kept only in the operator's
   password manager. Never set any `DIAGNOSTICS_*` value for production —
   CI (`check:wrangler`) rejects the var half outright.
5. **Optionally qualify EdgeConnect** (packet E5) — provision staging-only
   `ORCH_BASE_URL`/`ORCH_API_KEY` and execute the conditional QA/UAT track only
   when live-fabric support is being activated. This is a deliberate separate
   decision, never bundled into a normal feature deploy.

## Documentation map and history

- `docs/archive/IMPLEMENTATION_PLAN_2026-07-12.md` — the previous
  implementation plan (proposals 0002 follow-ons, 0003, 0004), fully
  executed. Carries a banner; do not treat as current.
- `docs/launch-readiness/FINDINGS_REGISTER.md` — preserved historical finding
  bodies plus the current status overlay described under "Known risks."
- `docs/launch-readiness/{QA_TEST_PLAN,UAT_PLAN,TRACEABILITY_MATRIX}.md` — the
  active living quality plans and capability-to-evidence index. Earlier
  pre-launch versions remain available in Git history, not as current files.
- `docs/USER_GUIDE.md` — the current task-based guide for people, agents,
  workspace owners, administrators, and operators.
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
