# Handoff — July 12 plan execution, session 1

**Date:** 2026-07-13
**Scope of this session:** authored the plan of record
([`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md)), then executed every
packet that was runnable without pending operator input, and stood up the
staging deployment pipeline end to end.

## What shipped (all merged to `main`)

| PR   | Packet | Delivered                                                                                                                      |
| ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| #143 | plan   | `docs/IMPLEMENTATION_PLAN.md` — the dependency-ordered packet plan for proposals 0002/0003/0004 + roadmap                      |
| #144 | W1     | Shared esbuild+Miniflare worker test harness; first worker route tests (auth, share API, workspace 401, cross-owner isolation) |
| #145 | B1     | Inline on-canvas layout warning badges (+ adversarial-review XSS fix: element ids escaped in overlay markup)                   |
| #146 | D4     | `scripts/smoke.mjs` external deployment smoke suite                                                                            |
| #147 | D2     | `WORKSPACE_ENABLED` feature flag: 503-gates `/api/workspaces*`, hides the 8 workspace MCP tools, panel disabled-state          |
| #148 | D3     | `GET /healthz` (unauthenticated liveness + sha) and `GET /readyz` (owner-authenticated per-binding readiness)                  |
| #149 | D1     | `env.staging` in `wrangler.jsonc` + `scripts/check-wrangler-env.mjs` CI guard; **`npm run deploy` deleted** (finding L1)       |
| #150 | D5     | `deploy-staging.yml` + `deploy-production.yml` gated workflows; `ci.yml` reusable via `workflow_call`                          |
| #151 | R0     | Agent Workspace panel extracted from `main.ts` (−609 lines) into `src/ui/workspace-panel.ts` with characterization tests       |
| #152 | I1     | `src/import/legacy.ts` — legacy Topology Studio converter, 6 real fixtures, all validating clean                               |
| #153 | R1     | Rendered before/after proposal preview with changed-element highlights                                                         |
| #154 | I2     | Legacy import wired into the GUI open flow + `import_topology` `format` parameter                                              |
| #155 | fix    | Node 22 in all workflows (wrangler requires ≥22 — found by live run #1)                                                        |
| #156 | fix    | Smoke `--wait-live`: first-deploy DNS-propagation window (found by live run #2)                                                |
| #157 | fix    | Sha-aware wait: redeploy version-propagation window (found by live run #3)                                                     |

Test suite: **262 → 424** (as of the #156 CI run), all green. Roadmap items
completed outright: inline layout badges, the legacy importer (both halves),
and the rendered-proposal-preview follow-on from proposal 0002.

## Deployment state (verified live)

- **Staging is live and healthy**: `topology-dojo-staging` exists with fully
  isolated resources (KV `9919607c2b7941e7b258d2427da28fe4` /
  `9aaf419994d74908b095989110375571`, own DO namespaces, staging OAuth client
  id `Ov23liEpiupkYUA9L4vu`, `WORKSPACE_ENABLED="true"`), migrations v1–v3
  applied.
- **O8 evidence — first fully-green gated deploy:**
  [Deploy Staging run #4](https://github.com/robertsonc/topology-dojo/actions/runs/29219841599)
  (SHA `104b4d5`, smoke 7/7 incl. sha verification). Runs #1–#3 each found one
  pipeline defect, fixed forward in #155/#156/#157.
- **Production untouched** all session: still on the Workers Builds path from
  `main`, single flat env, no `WORKSPACE_ENABLED` var set (unset ⇒ enabled —
  production workspace behavior is unchanged).

## Operator checklist status (IMPLEMENTATION_PLAN.md §4.7)

| Item    | Status                                                                                                                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| O1      | ✅ Workers Builds non-production branch builds disabled                                                                                                                                          |
| O2      | ✅ Staging KV namespaces created (ids above)                                                                                                                                                     |
| O3      | ✅ Staging GitHub OAuth App created (callback `https://topology-dojo-staging.robertson-corey.workers.dev/callback`)                                                                              |
| O4      | ✅ `GITHUB_CLIENT_SECRET` set on the `topology-dojo-staging` Worker; staging browser sign-in with GitHub credentials verified working                                                            |
| O5/O6   | ✅ GitHub environments `staging`/`production` with Cloudflare secrets; production required reviewers + `main` restriction; `check` required status                                               |
| O7      | ✅ Decided: manual-only staging dispatch; observation window (2h active / 72h soak) + error-rate stop thresholds set in `DEPLOYMENT_RUNBOOK.md` → "Activation observation window and thresholds" |
| O8      | ✅ First gated staging deploy green (run #4)                                                                                                                                                     |
| O9      | ⏳ Disconnect Workers Builds entirely once the production Actions path is also proven                                                                                                            |
| O10/O11 | ⏳ Production v3 bootstrap (`WORKSPACE_ENABLED:"false"` PR → protected deploy → smoke `--expect-workspace-disabled`) then activation flip — protected human gates                                |
| O12     | ⏳ Cloudflare error-rate alerting + failed-workflow notifications + nightly staging smoke                                                                                                        |

Also outstanding on the operator side: manual staging UAT (browser OAuth, MCP
session, workspace propose/accept/lease flows) and the **forward-recovery
exercise** in staging (deploy a flag-off build, verify, re-enable) —
`DEPLOYMENT_RUNBOOK.md` has the steps; both are 0004 acceptance criteria.

## Next repo work, in order (per the plan)

**Update (session 2, 2026-07-14):** items 1–2 below are ✅ shipped — D6 (PR
#161), and the full **R-train R2→R3→R4** merged to `main` (R2 #163; R3+R4 landed
via the stacked chain #164/#165 → #167). Also shipped this session: the O7
activation thresholds (#159), slim scrollbars (#160), the Move-Map UI fixes
(#162), and the **flat viewer** rendering change (#166). Next is the S-train.

1. ~~**D6 — docs truth-up + findings closure**~~ ✅ (PR #161).
2. ~~**R2 → R3 → R4**~~ ✅ selective acceptance → checkpoints/restore/fork →
   revision timeline, all merged.
3. **S1–S4** (resilience) — now unblocked (the `worker/document.ts` serialization
   with the R-train is cleared): IndexedDB offline cache, WebSocket
   push/presence, collaborator/org ACLs, finer element-set leases. Then
   **P1–P5** (proposal 0003) last — P2 is migration-bearing (`v4`) and rides the
   now-proven pipeline.
4. Deferred list and open decisions: see `IMPLEMENTATION_PLAN.md` §10–§11.

## Working conventions this session established

- One packet ≈ one branch (`claude/packet-*`) ≈ one draft PR; Sonnet
  implementer in an isolated worktree → adversarial review + independent
  gate run (typecheck/test/lint/build) by the session model → push → draft
  PR → human merge. Per `AGENTIC_IMPLEMENTATION_WORKFLOW.md`.
- Deploys only via the GitHub Actions workflows; staging dispatches are safe
  to run on request; production requires the protected environment approval.
- `npm run smoke -- <origin> --sha <sha> --wait-live 180` is the external
  verification for any deploy.
