# Handoff — session 2 (R-train, S-train, flat viewer, P-train start)

**Date:** 2026-07-15
**Supersedes** the July-12 session-1 handoff (its shipped list now lives in
[`ROADMAP.md`](ROADMAP.md) "Shipped"). This is the current pick-up doc.

**Scope of this session:** executed the R-train (workspace review/history),
the S-train resilience packets, a flat-viewer rendering change, and started the
P-train (adaptive authoring profiles, proposal 0003). Also did a full
git/branch cleanup.

## Current state

- **`main`** contains everything below except P2: the R-train (R2/R3/R4), the
  flat viewer, S1/S2/S3, P1, and the docs truth-up. Typecheck/lint/build green;
  the DO/Miniflare + `session.ts` webcrypto test suites only run in **CI**
  (this sandbox lacks `workerd`/`File`/`crypto`) — they are green on CI.
- **Open PRs:**
  - **#176 (draft) — Packet P2** `AuthoringProfile` DO + observe-only learner.
    **Migration-bearing (`v4`); operator-gated deploy required** (see below).
  - **#174 — roadmap** "resize link labels (`labelScale`)" item (docs-only).
- **Git is clean:** local = `main` + the two open-PR branches; ~113 merged
  remote branches pruned (whole project history). Only `main` + active PR
  branches remain on `origin`.

## What shipped this session (all merged to `main`)

| PR        | Packet | Delivered                                                                                                     |
| --------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| #159      | O7     | Activation observation window (2h active / 72h soak) + error-rate stop thresholds in `DEPLOYMENT_RUNBOOK.md`  |
| #160      | —      | Slim hover-reveal scrollbars on editor chrome                                                                 |
| #161      | D6     | Docs truth-up + evidence-backed findings closure (H7/M14/M15/L1)                                              |
| #162      | —      | Move-Map UI: fix collapsed-palette black icons, dock minimap into left rail, pin Problems to the right rail   |
| #163      | R2     | Selective proposal acceptance (coherent subset → one revision; residual stays reviewable)                     |
| #164/#167 | R3     | Named checkpoints, restore (forward-only), fork; `create_checkpoint`/`list_checkpoints` MCP tools             |
| #165/#171 | R4     | Revision timeline in the Agent Workspace panel                                                                |
| #166      | —      | **Flat viewer** — glow is an emphasis-only channel (`flattenViewer` render seam); live canvas + exports match |
| #168      | —      | Docs truth-up (roadmap Shipped) + adjustable-viewer roadmap item                                              |
| #169      | S1     | WebSocket push + presence (DO hibernation API; compact notices; polling stays the baseline)                   |
| #171      | S2     | Gesture-native operations with a referee fallback (retire the snapshot-diff adapter as the primary path)      |
| #173      | S3     | IndexedDB offline cache + crash recovery (queue-through-cache, idempotent replay, `fake-indexeddb` dev dep)   |
| #175      | P1     | Deterministic feature extraction (`src/profile/features.ts` → `SemanticFeatures`)                             |

**S4 (finer element-set leases) was deliberately skipped** — per-page agent
leases are fine for now; revisit only on measured lease contention.

## Open: Packet P2 (#176) — operator-gated deploy

P2 is the first **migration-bearing (`v4`)** packet and rides the 0004 pipeline.
It is **observe-only** (zero change to agent output) and gated by
`PROFILES_ENABLED`, which is **unset in production (⇒ off)** and `"true"` in
`env.staging`. Deploy is bootstrap-then-activate (`DEPLOYMENT_RUNBOOK.md`):

1. **Staging deploy** (`deploy-staging.yml`) — applies `v1`–`v4`; staging
   observes. Run smoke + the **forward-recovery drill**.
2. **Production `v4` bootstrap (flag-off)** — deploy the bundle (exports
   `AuthoringProfile`, binds `AUTHORING_PROFILE`, includes `v4`) with **no
   top-level `PROFILES_ENABLED`**; verify `v4` applied + binding exists; create
   no profile data.
3. **Activation** — a tiny PR adding top-level `"PROFILES_ENABLED": "true"`,
   deploy with approval. Recover a bad activation by forward-deploying flag-off
   — **never roll back across `v4`**.

Verified pre-merge: `wrangler deploy --env staging --dry-run` binds the DO;
`check-wrangler-env` passes (migrations deeply identical across blocks);
harness DO tests (dedupe, burst coalescing, over-cap eviction, cross-owner
isolation, observe-only) run in CI.

## Operator checklist (IMPLEMENTATION_PLAN.md §4.7) + additions

| Item    | Status                                                                                                                     |
| ------- | -------------------------------------------------------------------------------------------------------------------------- |
| O1–O8   | ✅ done (staging isolated + live, CI-gated pipeline proven, O7 thresholds set)                                             |
| O9      | ⏳ Disconnect Workers Builds entirely once the production Actions path is proven                                           |
| O10/O11 | ⏳ Production `v3` bootstrap (`WORKSPACE_ENABLED:"false"`) → smoke → activation flip — protected human gates               |
| O12     | ⏳ Cloudflare error-rate alerting + failed-workflow notifications + nightly staging smoke                                  |
| **P2**  | ⏳ **New:** `v4` staging deploy + forward-recovery drill; production `v4` flag-off bootstrap; then `PROFILES_ENABLED` flip |

Also outstanding (0004 acceptance criteria): manual staging **UAT** (browser
OAuth, MCP session, workspace propose/accept/lease flows) and the
**forward-recovery exercise** in staging.

Staging resources (unchanged): `topology-dojo-staging`, KV
`9919607c2b7941e7b258d2427da28fe4` / `9aaf419994d74908b095989110375571`, staging
OAuth client `Ov23liEpiupkYUA9L4vu`, `WORKSPACE_ENABLED="true"`,
`PROFILES_ENABLED="true"`. Production is still on the Workers Builds path from
`main` (O9 pending); its `PROFILES_ENABLED` is unset (learner off).

## Next repo work, in order (per the plan)

1. **Merge P2 (#176)** after review + the operator staging deploy/drill.
2. **P3 (0003-A)** — Authoring Preferences panel (observe-only): owner-facing
   list of candidates/evidence with pause/forget; new `src/ui/profile-panel.ts`
   - a small owner-authed read/manage route. Low risk.
3. **P4 (0003-B)** — confirmation/scoping + `get_authoring_guidance` (+
   `list_/explain_authoring_preference`) MCP tools under hard token budgets;
   agents disclose applied rules. Browser-owner-only confirmation (no MCP
   confirm path). Medium risk; budgets are tests (≤5 rules, ≤400/800 tokens).
4. **P5 (0003-C)** — outcome refinement (overrides/contradictions/decay).
5. Deferred/open decisions: `IMPLEMENTATION_PLAN.md` §10–§11.

## Working conventions established this session

- **Packet = branch = PR.** For substantial packets, the session model does
  discovery, hands implementation to a focused sub-agent with a precise brief,
  then **independently reviews the risky properties + runs the gate** before
  committing. Migration/coordinator-concurrency packets get extra-careful
  review (transaction ordering, hibernation-safety, non-blocking gating).
- **Stacked branches** when packets serialize on `worker/document.ts`
  (R2→R3→R4, S1→S2, P1→P2). After the user merges a stack, sync `main`, delete
  merged locals, re-base the next packet on the fresh `main`. The stacked-merge
  pattern lands child PRs into their parent branch first, then a follow-up PR
  brings the branch to `main`.
- **DO/Miniflare + `session.ts` suites fail to _start_ locally** (`File`/
  `crypto`/`workerd` absent) — expected; they run in CI. Every packet's
  correctness is otherwise made **locally verifiable** (pure referees, fake
  IndexedDB, injected factories, dry-runs).
- **Migrations** deploy via the gated Actions workflows, bootstrap-then-
  activate, forward-recovery only across a migration boundary. Cloudflare
  Workers Builds previews are the deprecated path (error 10211 on migrations)
  and are **not** a gate — the GitHub Actions `check` is.

## Key pointers for pickup

- Coordinator: `worker/document.ts` (`TopologyDocument` DO — revisions,
  proposals, leases, checkpoints, WS presence, P2 learner hook). One DO per
  owner+topology.
- Profiles (0003): `src/profile/features.ts` (P1, pure), `src/profile/{model,
learner}.ts` + `worker/profile.ts` (P2), gated by `profilesEnabled()` in
  `worker/env.ts`.
- Workspace panel: `src/ui/workspace-panel.ts` (proposals, checkpoints,
  timeline, presence, offline indicator) — pure render fns are characterization-
  tested.
- Editor: `src/editor/editor.ts` (gesture funnel → `takePendingOperations()`;
  referee `chooseCommitOperations` in the panel). Client-only.
- Rendering: `src/vendor/topology-ds.ts` `flattenViewer` (flat viewer seam),
  `src/render/core.ts` (headless), `src/editor/export.ts` (exports).
