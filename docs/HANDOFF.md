# Handoff

_The primary entry point for picking up work on this repo. Rewritten
2026-07-19; revalidated 2026-08-09 (`4add174`) and again 2026-11-13 against
`main` at `e99b012` (see
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

As of this review (`main` @ `e99b012`, PR #300 merged 2026-11-08):

- **All three migration-backed feature flags are live**: `WORKSPACE_ENABLED`,
  `PROFILES_ENABLED`, `ANALYTICS_ENABLED` are all `"true"` in the top-level
  (production) `wrangler.jsonc` and in `env.staging`. No Durable Object class
  is bootstrapped-but-inert right now.
- **Two non-migration flags are deliberately off in production**:
  `API_KEYS_ENABLED` (proposal 0005 — `"true"` on staging, `"false"` in
  production until UAT-MCP-04 passes) and `LIVE_DATA_ENABLED` (the seven
  EdgeConnect fabric tools — `"false"` in both environments; opt-in,
  independent of `ORCH_*` secret presence, issue #228). Neither has a
  binding or migration.
- **Migrations `v1`–`v5` are all applied** in production: `TopologyMcp`,
  `TopologyRegistry`, `TopologyDocument`, `AuthoringProfile`, `AnalyticsLog`.
- **Production origin**: `https://topology-dojo.harnessed.cloud` (moved from
  the `workers.dev` subdomain 2026-07-18; the GitHub OAuth App callback was
  repointed to match). Staging stays on its own `workers.dev` subdomain,
  fully isolated (`check-wrangler-env.mjs` enforces this in CI).
- **The current automated gate is 1768 Vitest cases in 146 files plus 32
  Chromium browser cases in 9 spec files** (`e99b012`, local run 2026-11-13;
  CI additionally runs the Python catalog reference tools, `catalog:check`,
  and a LibreOffice `.vsdx` render job — `ci.yml` jobs `check`, `e2e`,
  `visio`). Counts are evidence for this revision, not a durable product
  claim; use the living QA plan and the current CI run for a release
  decision.
- **The external monitoring gate needs current operator evidence**: this
  repository cannot read Cloudflare notification policy state. The repo-side
  half of `IMPLEMENTATION_PLAN.md` initiative
  O landed 2026-07-19: alert matrix + severity model (`docs/ALERTS.md`),
  Cloudflare human checklist (`docs/CLOUDFLARE_OPERATOR_RUNBOOK.md`),
  game-day framework + evidence template (`docs/GAME_DAY.md`), hourly (since
  proposal 0007; daily before) + on-demand production verification
  (`production-verify.yml`, deduplicated `production-smoke` issues, deployed
  SHA asserted against the GitHub Deployments record), a 15-check
  smoke (14 when it landed; `mcp-apikey-unauth` arrived with proposal 0005)
  with per-flag disabled-contract flags, staging flag-override deploy
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

Initiative A (agent activity + explainability) is implemented and shipped:
bounded MCP-session trails on existing `TopologyMcp` storage, a session index
on `AnalyticsLog` (v5), owner-gated `/api/admin/sessions`, an Agent Sessions
admin section, and a non-causal guidance-consulted timeline signal. Flag
choice: reuse already-on `ANALYTICS_ENABLED`. Merged as PR #243 (`5de7813`,
2026-08-19).

Shipped since the August baseline, outside the six-initiative plan (details
and evidence in `ROADMAP.md` §"Completed historical milestones"; PR numbers
from `git log --first-parent`):

- **Application rate limits** for MCP tools, share publish and large exports
  (PR #239, 2026-08-16), and the opt-in `LIVE_DATA_ENABLED` gate on the
  fabric tools (issue #228).
- **Competitive gap-closing batch** — inline label editing, quick-add,
  Share dialog with revoke (closes M20), hyperlinks, image nodes, status
  LEDs, Mermaid/CSV import, PDF export (`71b21e7`, 2026-08-17).
- **User-tied API keys** (proposal 0005, PR #247) and **importer sync
  ergonomics** (`element.upsert`, proposal 0006, PR #248), 2026-09-20.
- **Merge is the release** (proposal 0007, PR #273, 2026-10-10):
  `release.yml` + `deploy-worker.yml` + `scripts/migration-guard.mjs`
  replaced the manual `deploy-production.yml`.
- **Rendering/authoring quality**: flow paths follow link geometry (#257),
  light theme (#266, contrast fix #289), wire labels (#267), link anchor box
  (experimental, opt-in, #274), read-only draft tools served from a shared
  workspace's current revision (#279), attributed proposal conflicts (#270).
- **Wiring-sheet conventions** (proposal 0008, PR #282, 2026-10-15): link
  styles, tiers, port pills, bundles, port tables, sheet frame.
- **Phase 1 adoption** (PR #283, 2026-10-23): `export_topology` (PNG / PDF /
  draw.io / Visio / PowerPoint / Mermaid — `src/export/`), `view_topology`
  and the MCP Apps inline view, `server.json`.
- **Hardware catalog Phases 1–5** (PRs #285–#288, #290, 2026-10-24/25):
  `catalog/` data + `src/catalog/`, bind/validate, hardware MCP tools,
  wire-sheet rendering, native Visio masters. Phase 6 (feed importers) is
  not started; the real-Visio check is still pending
  (`futures/hw-catalog.md`).
- **Cinematic landing page** (PR #292, `worker/landing.ts`, 2026-11-03).
- **SD-WAN generator** (proposal 0010; PRs #293, #295, #296, #298,
  2026-11-08): `generate_sdwan_topology`, the editor wizard
  (`src/ui/sdwan-wizard.ts`), place tiles and page links, cloud hubs / SSE
  on-ramp, Natural Earth map backdrops (#298, #299); icon tiers 1–2
  (proposal 0011, #294–#296).

## Active implementation program

Six initiatives, detailed in `IMPLEMENTATION_PLAN.md`:

| #   | Initiative                                  | Status                                                    | Blocking dependency                                                      |
| --- | ------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| N   | Living product/quality documentation        | Baseline refreshed 2026-08-09; maintain with each change  | None                                                                     |
| O   | Cloudflare alerting + production game day   | Repo-side done 2026-07-19; O1/O2 human halves outstanding | None — human can start immediately                                       |
| A   | Agent activity + explainability             | Implemented A1–A6; shipped (PR #243, live `5de7813`)      | None — reuses `ANALYTICS_ENABLED`; no new DO/migration                   |
| B   | Guided topology briefs + semantic templates | Not started (see note)                                    | None — soft dependency on N landing                                      |
| E   | EdgeConnect live-import hardening + UI      | Not started                                               | None — soft dependency on N landing                                      |
| T   | Time-aware flow/failure storytelling        | Not started                                               | Packet E2 specifically (shared-file hotspot on `src/connect/compile.ts`) |

Status verified 2026-11-13 at `e99b012`: none of B's, E's or T's planned
modules or tools exist (`src/briefs/`, `src/stories/`, `create_from_brief`,
`compile_flow_story`, `fixtures/edgeconnect/`). **B's premise has moved**:
the SD-WAN generator (proposal 0010) already ships one intent-to-document
compiler with an MCP tool and a GUI wizard (`src/connect/generate.ts`,
`generate_sdwan_topology`, `src/ui/sdwan-wizard.ts`) — re-scope B against it
before starting B1. Work since August has been driven by proposals
0005–0011 and `futures/hw-catalog.md` rather than this table; proposal 0009
(status: Proposed) would re-cut _Now/Next_ if accepted.

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

- **Merge is the release** (proposal 0007, `docs/proposals/0007-merge-is-the-release.md`).
  Production deploys exclusively through `release.yml`: every non-docs push
  to `main` runs CI on the merge SHA, rehearses it on staging, and deploys
  it to production — unattended for a routine release. A release that would
  apply a new Durable Object migration is **held** (red run, PR comment)
  until a human dispatches `release.yml` with the typed `apply_migration_tag`;
  a candidate whose migrations array is not a strict extension of
  production's is refused outright (`scripts/migration-guard.mjs`). The
  `guard` job enforces `main` for every event and honours an open
  `release-freeze` issue. There is no other path; `npm run deploy` was
  deleted (finding L1), `deploy-production.yml` was deleted 2026-10-10, and
  Workers Builds' Git integration is disconnected (operator O9) specifically
  because it once bypassed the gate.
- **Staging is isolated and safe to dispatch freely**
  (`deploy-staging.yml`, optional `ref` input — any ref, for UAT) — separate
  KV namespaces, DO namespaces, GitHub OAuth App, and origin from
  production. It is also rehearsed automatically by every release, so a
  manual dispatch queues behind (never cancels) a release in flight; check
  `GET <staging>/healthz` before trusting a UAT result.
  `scripts/check-wrangler-env.mjs` (run in CI and locally via
  `npm run check:wrangler`) enforces the isolation invariants and fails loudly
  on drift. Both paths deploy through the one shared `deploy-worker.yml`.
- **Recovery is explicit and never unattended.** Forward recovery is a
  `release.yml` dispatch with `recovery_sha`; a stateless rollback is
  `rollback_to_version` + `recovery_sha` (refused across a migration
  boundary). Never roll back across a migration boundary — redeploy with the
  offending flag turned off instead. See `docs/ROLLBACK.md`.

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
npm run catalog:check    # hardware-catalog bundle + generated types are current (CI runs this)
```

Run the complete gate before opening a PR. Miniflare tests require permission
to bind a localhost listener; a restricted sandbox may report `listen EPERM`,
which is an environment failure rather than a product test result. Visual
baselines are CI-rendered for Linux; a macOS run can execute the functional
cases but cannot compare the five visual cases (`e2e/visual.spec.ts`) unless
reviewed Darwin baselines are deliberately added. See `launch-readiness/QA_TEST_PLAN.md`.

## Key files

| Area                             | Files                                                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document model + persistence     | `src/pages/model.ts`, `src/pages/persist.ts`                                                                                                                                    |
| Headless authoring API           | `src/api/{builder,edit,validate,layout,autolayout,catalog,tidy}.ts`                                                                                                             |
| MCP tools (both transports)      | `src/mcp/tools.ts` (source of truth), `src/mcp/{export-tools,hardware-tools}.ts`, `src/mcp/register.ts`, `src/mcp/server.ts` (stdio), `worker/mcp.ts` (remote)                  |
| Connector/flow-compiler platform | `src/connect/{types,mock,edgeconnect,compile}.ts`                                                                                                                               |
| SD-WAN generator + wizard        | `src/connect/generate.ts`, `src/ui/sdwan-wizard.ts`, `src/render/backdrops.ts` (proposal 0010)                                                                                  |
| Export / import formats          | `src/export/` (scene, PNG, PDF, draw.io, Visio, PowerPoint, Mermaid, cable schedule), `src/import/`, `worker/raster.ts`; contract in `docs/EXPORTS.md`                          |
| Hardware catalog + wire sheets   | `catalog/` (data, schema, Python reference tools), `src/catalog/`, `src/api/hardware.ts`, `src/render/wiresheet.ts`, `worker/catalog.ts`, `scripts/catalog-*.ts`                |
| API keys (proposal 0005)         | `worker/api-keys.ts`, `worker/api-keys-page.ts`, `src/server/api-key.ts`                                                                                                        |
| Shared workspace coordinator     | `worker/document.ts` (revisions/proposals/leases/checkpoints/presence), `worker/registry.ts`, `worker/workspaces.ts`                                                            |
| Workspace client                 | `src/workspace/{model,client,offline,operations}.ts`, `src/ui/workspace-panel.ts`                                                                                               |
| Adaptive authoring profiles      | `src/profile/{features,learner,refinement,guidance}.ts`, `worker/profile.ts`, `worker/profile-api.ts`, `src/ui/profile-panel.ts`                                                |
| Admin/analytics dashboard        | `worker/analytics.ts`, `worker/admin-api.ts`, `src/admin/`, `src/ui/admin-dashboard.ts`, `src/agent-activity/`                                                                  |
| Auth + landing page + showcase   | `worker/auth.ts`, `worker/landing.ts`, `public/landing/`, `public/showcase/*.webp`                                                                                              |
| Deployment config                | `wrangler.jsonc`, `.github/workflows/{release,deploy-worker,deploy-staging,ci,production-verify,nightly-staging-smoke}.yml`, `scripts/{check-wrangler-env,migration-guard}.mjs` |
| Flags                            | `worker/env.ts` (`workspaceEnabled`, `profilesEnabled`, `analyticsEnabled`, `liveDataEnabled`, `isAdmin`), `worker/api-keys.ts` (`apiKeysEnabled`)                              |

## Known risks (from the launch-readiness findings register)

The 2026-07-04 findings register is preserved as an audit record; its original
top-line counts are not a current open-defect summary. Read appended closure
notes and `CAPABILITY_MATRIX.md`. Former findings H1 and **M20** are fixed
(M20 closed 2026-08-17 — publisher can revoke via the Share dialog,
`unpublish_topology`, or signed-in `DELETE /api/topology/:id`; snapshots use
`max-age=60` without `immutable`).

Full register: `docs/launch-readiness/FINDINGS_REGISTER.md`.

## Human-only operational tasks

Things no agent in this repo can complete alone:

1. **Decide a production release** — **merging a PR into `main` is the
   human release decision** (proposal 0007): `release.yml` deploys it
   unattended. An agent never merges to `main`, and never dispatches
   `release.yml` (recovery, rollback, or a migration's `apply_migration_tag`
   ack), except on an explicit chat instruction quoted in the session. This
   is a procedural rule, not a technical one: the agent's GitHub identity is
   the owner's, so no GitHub setting can tell them apart (the `production`
   environment's required-reviewer click was removed 2026-10-09 for exactly
   that reason). Branch protection with no bypass — PR required, `CI /
check` + `CI / e2e` required — is the only gate that binds both equally.
2. **Configure Cloudflare alerting** (`IMPLEMENTATION_PLAN.md` packet O1) —
   a Cloudflare dashboard action; the exact steps + evidence requirements
   are `docs/CLOUDFLARE_OPERATOR_RUNBOOK.md` (CF-1..CF-6 checklist).
3. **Run the game day** (packet O2) — `docs/GAME_DAY.md`, a human operator
   observing/confirming each step of a live drill; production steps are each
   a PR the owner merges. Verify the staging SHA at the start
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
- `docs/proposals/0005`–`0012` — API keys (implemented, production flag
  off), importer sync (implemented), merge-is-the-release (implemented),
  wiring-diagram conventions (implemented except harness routing), the
  vendor-neutral diagramming-tool direction (**Proposed**, not accepted),
  the SD-WAN generator (slices 1–4 implemented), the icon gap review
  (tiers 1–2 shipped), and SD-WAN vendor research (research only). Each
  file's status header is authoritative.
- `docs/EXPORTS.md` — the export/import fidelity contract.
- `docs/futures/hw-catalog.md` — hardware-catalog phase status;
  `docs/sitrep/` holds its dated progress notes (historical).

## Working conventions (unchanged, proven across ~20 packets)

- Packet = branch = PR; one active writer per branch; small enough to be one
  reviewable PR (see `IMPLEMENTATION_PLAN.md`'s packet specs for the target
  size).
- Independently verify the risky properties and run the full gate before
  committing — don't trust a sub-agent's self-report on correctness.
- Staging deploys are safe to dispatch on request. Merging to `main` is the
  production release (since 2026-10-10) and any `release.yml` dispatch is a
  recovery or migration action: an agent does either only on an explicit
  human instruction quoted in the session, no exceptions (there is no second
  approval click since 2026-10-09).

## Operator checklist — proposal 0007 cut-over

Owner actions that complete "merge is the release" (details and rationale
in `proposals/0007-merge-is-the-release.md` §"GitHub settings checklist"):

_Status as of 2026-11-13: unverified. These are GitHub/Cloudflare settings
the repository cannot read; `release.yml` has been the only deploy path for
every merge since PR #273, but no dated owner evidence for the items below
is recorded here, so the boxes stay unchecked until the owner confirms._

- [ ] Branch protection on `main`: PR required; required checks `CI / check`
      and `CI / e2e`; no bypass, administrators included.
- [ ] `production` environment: deployment branches `main` only, no
      reviewers (both already true); `staging` environment: no reviewers.
- [ ] Scope the `staging` environment's `CLOUDFLARE_API_TOKEN` to the
      `topology-dojo-staging` script (it can otherwise address production).
- [ ] Repository "Allow auto-merge" off (verified off 2026-10-10).
- [ ] Actions workflow permissions read-only; "Require approval for all
      external contributors".
- [ ] Create the `release-freeze` label.
- [ ] Watch the first unattended release end to end, then confirm the next
      hourly `Production Verify` reports "deployed SHA matches the record".
