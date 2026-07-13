# Implementation Plan — July 12 proposals + roadmap

**Status:** Accepted plan of record
**Captured:** 2026-07-12
**Covers:** [Proposal 0002](proposals/0002-shared-human-agent-workspace.md)
follow-ons, [Proposal 0003](proposals/0003-adaptive-agent-authoring-profiles.md)
(phases A–C), [Proposal 0004](proposals/0004-isolated-staging-and-deployment-pipeline.md)
(all phases), and the [`ROADMAP.md`](ROADMAP.md) "Next / candidate" list.
**Executed as:** bounded implementation packets per
[`AGENTIC_IMPLEMENTATION_WORKFLOW.md`](AGENTIC_IMPLEMENTATION_WORKFLOW.md) —
one packet ≈ one reviewable PR, one active writer per branch, human
merge/release gates throughout.

## Current state (verified 2026-07-12)

- **Proposal 0002 Phase 0 is shipped** (PR #141): the `TopologyDocument`
  coordinator (`worker/document.ts` — revisions, proposals, current-page leases
  with 60–900 s TTL, history floor/compaction, actor attribution on every
  change), the full workspace REST surface (`worker/workspace-api.ts`), the
  eight remote MCP workspace tools, the Agent Workspace panel in `src/main.ts`,
  and the pure operation layer (`src/workspace/operations.ts`:
  `applyOperations`, `diffDocuments`, `operationTargets`,
  `summarizeOperations`).
- **Proposal 0004 is unimplemented**: `wrangler.jsonc` is a single flat
  environment with production KV ids; the only workflow is a checks-only
  `ci.yml`; there is no `/healthz`, no `WORKSPACE_ENABLED` flag in code (the
  runbooks reference it aspirationally), and `npm run deploy` still ships a
  local working tree straight to production. Launch-readiness findings **H7,
  M14, M15, L1** are open and are closed by this phase.
- **Proposal 0003 is unimplemented**; its stated prerequisite — actor-attributed
  operation batches and revisions — exists.
- **Roadmap gaps**: layout warnings appear in the problems panel
  (`renderProblems()` in `src/main.ts`) but not as on-canvas badges; GUI
  per-page SVG/PNG export ships while flipbook export and share links are
  MCP-only; there is no legacy Topology Studio importer; remote MCP auth is
  already OAuth 2.1 (per-key credentials remain a conditional item); `worker/`
  has zero test coverage (findings M16/M21/M22 — the vitest include is
  `src/**` only).
- Baseline: 262 tests green.

## 1. Ground rules

Every packet below is specified with **Outcome**, **Files**, **Approach**,
**Risk** (low / medium / high), **Validation**, and **Deployment impact**
(none / routine / binding-or-secret / migration-bearing). When picked up, a
packet is expanded into the full template from
`AGENTIC_IMPLEMENTATION_WORKFLOW.md` inside its PR.

Non-negotiable constraints carried through the whole plan:

- `DESIGN.md` #2/#3: no UI-only surfaces; the catalog parity test stays green;
  new document-affecting capabilities get API/MCP parity in the same packet.
- Locked decision 6: operations, not checkout. Nothing below introduces a
  second write path around the `TopologyDocument` coordinator.
- The vendored engine stays opaque; all rendering goes through
  `src/render/core.ts`.
- Baseline gates for every packet:
  `npm run typecheck && npm test && npm run lint && npm run build`.
- **Migration-bearing changes (anything adding a Durable Object class) are
  forbidden until the Phase 1 pipeline exists and has been exercised once.**
  This is the single most important sequencing rule in this plan.

### Shared-file hotspots (concurrency planning)

- `src/main.ts` — app shell, Agent Workspace panel, problems panel. Packets
  touching it serialize; Packet R0 (panel extraction) exists specifically to
  shrink this hotspot before the workspace-UI packets stack up.
- `worker/document.ts` — the `TopologyDocument` DO. Packets R2, R3, S1, S4,
  and P2 all touch it; they are strictly serialized in the order given.
- `worker/default-handler.ts` and `worker/env.ts` — Phase 1 owns these; later
  phases only extend.

## 2. Phase order and rationale

| Order | Phase                                           | Depends on            |
| ----- | ----------------------------------------------- | --------------------- |
| 1a    | W1 — worker test harness                        | —                     |
| 1     | D1–D6 — proposal 0004 deployment safety         | W1                    |
| 2     | B1 — inline layout badges (parallel pilot)      | — (file-disjoint)     |
| 3     | R0–R4 — workspace review polish                 | Phase 1 (DO releases) |
| 4     | S1–S4 — workspace resilience                    | Phase 3               |
| 5     | I1–I2 — legacy importer (parallel from Phase 3) | — (file-disjoint)     |
| 6     | P1–P5 — adaptive authoring profiles (0003 A–C)  | Phases 1 + 3          |

**Why this order:**

1. **Phase 1 (0004) is first and is the designated first pilot of the agentic
   workflow.** It closes H7 (uncontrolled production deploys), M14 (no
   staging), M15 (no smoke/rollback), L1 (laptop deploy path) — and it gates
   everything else: Phases 3–4 repeatedly modify the production
   `TopologyDocument` DO, and Phase 6 requires a brand-new DO class
   (migration `v4`). Shipping any of that without isolated staging, CI-gated
   deploys, and forward-recovery practice would recreate the situation 0004
   was written to end.
2. **Phase 1a (worker test harness) lands before/with the 0004 packets.** The
   `WORKSPACE_ENABLED` gate and `/healthz` need Worker-level tests to be
   trustworthy, and the harness pattern already exists in-repo
   (`src/workspace/document-do.test.ts` builds the DO with esbuild and runs it
   under Miniflare). Generalizing it is a small, high-leverage packet that also
   starts paying down M16/M21/M22.
3. **Phase 2 (inline layout badges) runs in parallel** as the second workflow
   pilot mandated by `AGENTIC_IMPLEMENTATION_WORKFLOW.md` ("one small
   diagram-editor quality-of-life feature"). It is file-disjoint from Phase 1
   (pure editor/GUI; no worker, no deploy surface).
4. **Phase 3 (review polish) before Phase 4 (resilience).** Preview, selective
   acceptance, and checkpoints make the existing suggest-review loop _good_;
   push/offline/gesture-native make it _robust_. Polish is also lower-risk
   (R1 is client-only) and produces the checkpoint primitive that 0003's
   "persistence test" guardrail depends on ("only corrections that survive a
   later checkpoint count").
5. **Phase 5 (importer) is order-independent** — a pure module plus two thin
   adapters, disjoint from everything except a small `main.ts` open-flow
   touch. Schedule it opportunistically from Phase 3 onward.
6. **Phase 6 (0003) is last.** Its practical dependencies are: (a) the
   deployment pipeline, because the profile store is a new DO class →
   migration `v4`; (b) checkpoints (Phase 3), for the persistence guardrail;
   (c) real accumulated workspace usage, so the learner has genuine correction
   data and thresholds can be tuned against reality instead of guesses.

Legitimate parallel packets at any given time: one Phase-1-track packet + one
editor-track packet (badges or importer) + at most one client-only workspace
packet (R1) — all with disjoint file scopes declared up front.

## 3. Phase 1a — worker test harness

### Packet W1 — generalize the Miniflare harness; first worker route tests

- **Outcome:** `worker/` code is testable under `npm test`; auth routing, the
  share API, and workspace API boundaries have deterministic Worker-level
  tests. Findings M16/M21 get their first real coverage; M22 (the MCP DO path)
  gets a tracked follow-up test.
- **Files:** new `src/testing/worker-harness.ts` (extract/generalize the
  esbuild + Miniflare pattern from `src/workspace/document-do.test.ts`); new
  worker test files; `src/workspace/document-do.test.ts` (refactor onto the
  shared harness); `vite.config.ts` if the include glob changes.
- **Approach:**
  - Harness API: `buildWorkerBundle(entry)` (esbuild, temp file, cleanup) +
    `startMiniflare({ bundle, kvNamespaces, durableObjects, vars })` returning
    a fetchable handle.
  - **Decision: reuse esbuild + Miniflare, not
    `@cloudflare/vitest-pool-workers`.** The in-repo pattern is proven, needs
    zero new dependencies, and already handles SQLite DO classes. Revisit
    trigger: adopt pool-workers if harness friction becomes a repeated cost
    across three packets.
  - First test targets: `/login` / `/logout` / `/callback` redirect + cookie
    shapes (M18 regression guard), `GET /api/topology/:id`, `/api/me`, the
    `/api/workspaces` auth boundary (401 unauthenticated), and cross-owner
    isolation on one workspace route.
  - Test entry point: a thin fixture worker that mounts
    `worker/default-handler.ts` with stubbed OAuth helpers, so tests never
    need a live GitHub round-trip.
- **Risk:** low (test-only). **Validation:** baseline gates; new tests run in
  CI. **Deployment impact:** none.

## 4. Phase 1 — proposal 0004: isolated staging and deployment pipeline

This phase maps 0004's Phases 0–6 onto repo packets D1–D6 plus an operator
checklist (§4.7) for everything that cannot live in the repo. 0004 Phase 0 and
Phases 4–6 are predominantly operator work; Phases 1–3 are where the repo
changes live.

### Packet D1 — `env.staging` + config safety check _(0004 Phase 1, repo half)_

- **Outcome:** `wrangler deploy --env staging` produces a fully isolated
  `topology-dojo-staging` Worker; CI fails if staging ever shares a production
  resource id.
- **Files:** `wrangler.jsonc`; new `scripts/check-wrangler-env.mjs`;
  `.github/workflows/ci.yml`; `package.json`.
- **Approach:**
  - Add the `env.staging` block per the proposal's shape: staging
    `PUBLIC_BASE_URL`, staging `GITHUB_CLIENT_ID`,
    `"WORKSPACE_ENABLED": "true"`, both KV bindings with staging ids (supplied
    by the operator — blocked on checklist item O2), all three DO bindings
    **without `script_name`**, and the full `v1`–`v3` migration history
    repeated.
  - `scripts/check-wrangler-env.mjs`: strip JSONC comments, parse, assert
    (a) every staging KV id differs from every top-level id, (b) no staging DO
    binding sets `script_name`, (c) the staging migrations array is identical
    to top-level, (d) the staging worker name and `PUBLIC_BASE_URL` differ
    from production. Run it in the CI `check` job.
  - **Close L1:** delete the `deploy` npm script. Add `deploy:staging` =
    `npm run build && node scripts/check-wrangler-env.mjs && wrangler deploy --env staging`
    as the only wrangler-invoking script. No script deploys production from a
    laptop.
- **Risk:** medium (mis-scoped bindings would be a production-data incident —
  exactly what the check script prevents). **Validation:** unit-test the check
  script against good/bad fixture configs;
  `wrangler deploy --env staging --dry-run` as bundle validation.
  **Deployment impact:** binding-or-secret (staging resources; production
  untouched).

### Packet D2 — `WORKSPACE_ENABLED` feature flag _(0004 Phase 4 precondition)_

- **Outcome:** one runtime flag cleanly severs workspace entry points from the
  migration deploy, making the production `v3` bootstrap operationally inert.
- **Files:** `worker/env.ts` (add `WORKSPACE_ENABLED?: string` + a
  `workspaceEnabled(env)` helper); `worker/default-handler.ts` (gate
  `/api/workspaces` and `/api/workspaces/*` — return 503 with a stable JSON
  body `{ "error": "workspace_disabled" }`); `worker/mcp.ts` (skip
  registration of the eight workspace MCP tools when disabled, so they don't
  appear in discovery); `src/main.ts` (the Agent Workspace panel shows a
  "not enabled on this deployment" state on 503 instead of a raw error);
  `DEPLOYMENT_RUNBOOK.md` / `ROLLBACK.md` (make their existing references
  true).
- **Approach:** unset ⇒ enabled (preserves local dev and staging behavior);
  only the explicit string `"false"` disables. The production bootstrap deploy
  sets `"WORKSPACE_ENABLED": "false"` at the top level of `wrangler.jsonc`;
  the activation deploy flips it. The bootstrap bundle still exports
  `TopologyDocument`, keeps its binding and migration `v3` — the flag gates
  _traffic_, not the class. The default-on choice must be re-challenged by the
  adversarial reviewer (default-off is safer but breaks every existing dev
  flow; mitigations are the explicit production value plus a smoke assertion).
- **Risk:** medium (auth/routing surface). **Validation:** W1 harness tests
  for both flag states — routes 503 vs 200, MCP tool list excludes/includes
  workspace tools. **Deployment impact:** routine (flag var only; the deploys
  that use it are checklist items).

### Packet D3 — `/healthz` + authenticated readiness _(0004 Phase 3, endpoints)_

- **Outcome:** an unauthenticated liveness endpoint proving worker + version,
  and a deeper authenticated readiness check proving bindings.
- **Files:** `worker/default-handler.ts` (both routes; `/healthz` joins the
  unauthenticated allow-set alongside `/v/:id` and the OAuth endpoints);
  `worker/env.ts` (optional `GIT_SHA?: string` var); deploy workflows pass
  `--var GIT_SHA:$GITHUB_SHA`.
- **Approach:** `GET /healthz` → `200 { ok, sha, workspaceEnabled }` — touches
  no bindings, exposes no state or secrets. `GET /readyz` — owner-authenticated
  (reuse the session check behind `/api/me`); performs a `TOPOLOGY_KV`
  round-trip, a `TOPOLOGY_REGISTRY` DO echo, and (when the flag is on) a
  `TOPOLOGY_DOCUMENT` DO echo; returns per-binding pass/fail; never enumerates
  data.
- **Risk:** low. **Validation:** W1 harness tests (unauthenticated `/healthz`
  200; `/readyz` 401 without a session, per-binding results with one).
  **Deployment impact:** routine.

### Packet D4 — smoke script _(0004 Phase 3, automation)_

- **Outcome:** one command that verifies a deployment from outside, safe
  against staging or production, wired into both deploy workflows.
- **Files:** new `scripts/smoke.mjs`; `package.json` (`smoke` script taking a
  base URL).
- **Approach (unauthenticated-safe subset):** `GET /healthz` (200, expected
  sha when passed); `GET /` (200 HTML referencing the built bundle);
  `GET /login` (redirect shape to GitHub);
  `GET /.well-known/oauth-authorization-server` (valid metadata);
  unauthenticated `POST /mcp` → 401; `GET /api/workspaces` → 401; with
  `--expect-workspace-disabled`, assert the 503 body instead. Non-zero exit on
  any failure; JSON summary for the workflow step summary. Browser OAuth,
  proposal acceptance, lease enforcement, and lazy migration remain manual
  staging UAT (they need a real GitHub session) — listed in the runbook, not
  the script.
- **Risk:** low. **Validation:** run against local `wrangler dev` and against
  staging once it exists. **Deployment impact:** none.

### Packet D5 — deploy workflows _(0004 Phase 2)_

- **Outcome:** GitHub Actions is the only path that can change staging or
  production; production requires green checks plus protected approval; every
  deploy leaves an audit trail.
- **Files:** new `.github/workflows/deploy-staging.yml`, new
  `.github/workflows/deploy-production.yml`; `.github/workflows/ci.yml`
  (convert the `check` job to `workflow_call` so deploy workflows re-run the
  identical gate; pin the Node version; SHA-pin actions per finding L2 as a
  stretch goal).
- **Approach:**
  - **deploy-staging.yml:** `workflow_dispatch` (input: ref);
    `concurrency: { group: topology-dojo-staging, cancel-in-progress: true }`;
    call the shared check; then a job with `environment: staging` that checks
    out the exact dispatched SHA, `npm ci && npm run build`, runs
    `check-wrangler-env.mjs`, `wrangler deploy --env staging` (secrets
    `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` from the environment),
    then `scripts/smoke.mjs` against the staging origin; write SHA, actor,
    deployment id, migration tags, and the smoke JSON to
    `$GITHUB_STEP_SUMMARY`.
  - **deploy-production.yml:** `workflow_dispatch` with an optional
    `recovery_sha` input, guarded to `main` (fail unless
    `github.ref == refs/heads/main` or an explicit recovery SHA);
    `concurrency: topology-dojo-production` without cancel-in-progress;
    `environment: production` with required reviewers (checklist O6); same
    check → deploy (`wrangler deploy`, no `--env`) → smoke → summary chain.
  - No workflow anywhere runs `wrangler versions upload`.
- **Risk:** high (this _is_ the production control plane). **Validation:**
  workflow dry-run on a branch; first real execution is the staging bootstrap
  (O8); the production path is proven during the `v3` bootstrap (O10).
  **Deployment impact:** binding-or-secret (GitHub environments + scoped
  Cloudflare tokens).

### Packet D6 — documentation truth-up + findings closure

- **Outcome:** `DEPLOYMENT_RUNBOOK.md` and `ROLLBACK.md` describe the pipeline
  that actually exists; H7, M14, M15, L1 carry evidence-backed closure notes.
- **Files:** `docs/DEPLOYMENT_RUNBOOK.md`, `docs/ROLLBACK.md`,
  `docs/launch-readiness/FINDINGS_REGISTER.md`, `docs/ROADMAP.md` (move the
  item to Shipped), `docs/ARCHITECTURE.md` (deployment section: "target" →
  "current").
- **Risk:** low (docs-only). **Validation:** link/format checks; each closure
  note cites the workflow run URL / config lines as evidence.
  **Deployment impact:** none.

### 4.7 Operator-action checklist for 0004 (cannot be done from the repo)

Ordered; items reference the packets they unblock. Per the workflow authority
model, none of these may be performed by an implementation agent.

| #   | Action                                                                                                                                                                                                                                                                                                            | Where                | Unblocks / follows                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------- |
| O1  | Disable Workers Builds non-production branch builds on the production Worker (stops the broken `versions upload` previews / error 10211)                                                                                                                                                                          | Cloudflare dashboard | 0004 Phase 0 — do immediately                     |
| O2  | Create staging KV namespaces (`OAUTH_KV`, `TOPOLOGY_KV`); record ids                                                                                                                                                                                                                                              | Cloudflare           | D1 needs the ids                                  |
| O3  | Create the staging GitHub OAuth App with only the staging callback; record client id                                                                                                                                                                                                                              | GitHub settings      | D1 (staging `GITHUB_CLIENT_ID`)                   |
| O4  | Set the staging `GITHUB_CLIENT_SECRET` (`wrangler secret put --env staging`)                                                                                                                                                                                                                                      | Cloudflare           | first staging deploy                              |
| O5  | Create GitHub environments `staging` and `production`; store a scoped `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` in each                                                                                                                                                                                    | GitHub settings      | D5                                                |
| O6  | Configure `production` required reviewers, restrict to `main`; branch protection with the CI `check` as a required status                                                                                                                                                                                         | GitHub settings      | D5; 0004 decision 3                               |
| O7  | ✅ Decided: staging hostname (via O3), approvers (O6), manual-only staging dispatch, and the observation window / error-rate stop thresholds (see `DEPLOYMENT_RUNBOOK.md` → "Activation observation window and thresholds")                                                                                       | Humans               | D5 finalization                                   |
| O8  | First staging deploy via `deploy-staging.yml` — applies `v1`–`v3` to the staging script; run smoke + manual OAuth/MCP/workspace UAT; perform the forward-recovery exercise (deploy a flag-off build, verify, re-enable)                                                                                           | GitHub Actions       | 0004 Phase 1/3 exits; rollback-exercise criterion |
| O9  | Disconnect Workers Builds entirely once both Actions paths are proven                                                                                                                                                                                                                                             | Cloudflare           | 0004 Phase 2 exit                                 |
| O10 | Production `v3` bootstrap: set top-level `"WORKSPACE_ENABLED": "false"` (tiny PR), run `deploy-production.yml` with approval; verify smoke (`--expect-workspace-disabled`), migration `v3` applied, `TopologyDocument` bound; create no workspaces                                                                | Actions + dashboard  | 0004 Phase 4                                      |
| O11 | Workspace activation: flip the flag (tiny PR), deploy with approval, run the full manual workspace smoke (create, hand off, propose, accept/reject, lease grant/revoke, reconnect, lazy-migrate a disposable legacy draft); watch error rates for the O7 window; forward-deploy flag-off if a stop condition hits | Actions + dashboard  | 0004 Phase 5                                      |
| O12 | Configure Cloudflare alerting for Worker error rate + notifications for failed deploy workflows; schedule the nightly staging smoke                                                                                                                                                                               | Cloudflare + GitHub  | 0004 Phase 3/6                                    |

## 5. Phase 2 — inline canvas layout badges (parallel workflow pilot)

### Packet B1 — on-canvas warning badges

- **Outcome:** `analyzeLayout` / `validateDocument` problems appear as small
  badges anchored to the offending elements on the canvas, in addition to the
  existing clickable problems panel. Closes the roadmap item "Surface layout
  warnings in the GUI (inline badges)".
- **Files:** new `src/editor/problem-badges.ts`; `src/main.ts`
  (`renderProblems()` — extract the problem→element-id mapping it already
  computes into a shared helper feeding both the panel and the badge layer);
  `src/editor/editor.ts` (expose a hook to mount a non-interactive overlay
  group in the interaction SVG; reuse `src/api/geometry.ts` AABBs for anchor
  points).
- **Approach:** a pure function `(problems, page) → badge placements`; render
  into a dedicated overlay group above art, below interaction handles;
  `pointer-events: none` except the badge hit-target so drags never snag;
  click badge ⇒ select element + scroll the panel entry into view; a toolbar
  toggle hides badges (view state — an explicit `DESIGN.md` #2 carve-out like
  pan/zoom, since the underlying data is already API-reachable via
  `validate_topology`); badges refresh on the same debounce as the problems
  panel.
- **Risk:** low. **Validation:** unit tests for placement math; manual UAT per
  the diagram-UX workflow template (pointer, keyboard reachability of the
  toggle, no drag interference, zoom behavior). **Deployment impact:** routine
  (static assets only).

## 6. Phase 3 — workspace review polish

Serialized within the phase where noted; all `worker/document.ts` changes come
after Phase 1 so their releases ride the staging pipeline.

### Packet R0 — extract the Agent Workspace panel (enabling refactor)

- **Outcome:** the workspace panel moves out of `src/main.ts` into
  `src/ui/workspace-panel.ts` with a narrow mount API, so R1/R2/R4 and later
  S-packets don't all contend on `main.ts`.
- **Files:** `src/main.ts`, new `src/ui/workspace-panel.ts`.
- **Approach:** behavior-preserving move per the architecture/refactor
  template — characterization tests of the panel render states first, then
  relocate; no logic changes.
- **Risk:** medium (M25: `main.ts` untested). **Validation:** characterization
  tests pass before and after; manual panel walkthrough.
  **Deployment impact:** routine.

### Packet R1 — rendered before/after proposal preview _(client-only)_

- **Outcome:** reviewing a proposal shows per-affected-page before/after
  rendered SVG side by side, with changed elements highlighted.
- **Files:** new `src/workspace/preview.ts` (pure);
  `src/ui/workspace-panel.ts`; reuses `src/workspace/operations.ts`
  (`applyOperations`, `operationPageIds`, `operationTargets` — all exported)
  and `src/render/core.ts`.
- **Approach:** pure `computeProposalPreview(snapshotPages, operations)` — for
  each affected page id, `structuredClone` the page, run `applyOperations` on
  the copy, return `{ before, after, changedElementIds }`; render both frames
  with the already-loaded browser engine class (`{ calm: true }` for static
  parity); highlight changed ids with overlay outline rects from
  `api/geometry.ts` AABBs — never touch the engine output; render lazily on
  proposal expand and cap preview pages with an "n more pages affected" note.
- **Risk:** low (no server change, no writes). **Validation:** unit tests on
  `computeProposalPreview` (add/update/remove/multi-page, agreement with the
  coordinator's own application); manual review UAT.
  **Deployment impact:** routine.

### Packet R2 — selective acceptance

- **Outcome:** the owner can accept a coherent subset of a proposal's
  operations as one revision; the remainder stays reviewable or is rejected.
- **Files:** `worker/document.ts` (`acceptProposal` gains
  `selectedOperationIndices` + subset-coherence validation);
  `worker/workspace-api.ts` (accept route body); `src/workspace/model.ts`,
  `src/workspace/client.ts`; `src/ui/workspace-panel.ts` (per-operation
  checkboxes grouped by page/target, driven by `describeOperation` /
  `summarizeOperations`); manifest proposal status reflects partial
  acceptance.
- **Approach:** validate the subset server-side — an operation referencing an
  element created by an _unselected_ operation in the same proposal is
  rejected with an explicit dependency error (computed via `operationTargets`
  ordering); the accepted subset applies atomically as one attributed
  revision; residual operations remain in the proposal, re-validated against
  the new revision on next view.
- **Risk:** medium (data integrity in the coordinator). **Validation:** W1
  harness DO tests — dependency rejection, partial accept + residual
  re-validation, idempotency semantics, conflict with an interleaved user
  revision. **Deployment impact:** routine (staging smoke before production).

### Packet R3 — named checkpoints, restore, fork

- **Outcome:** the owner (and agents, for create/list) can snapshot a named
  checkpoint, restore one as a new forward revision, or fork one into a new
  workspace.
- **Files:** `worker/document.ts`; `worker/workspace-api.ts`;
  `worker/workspaces.ts` (fork = initialize a new directory entry from a
  checkpoint snapshot via the existing initialize path);
  `src/workspace/model.ts`, `src/workspace/client.ts`;
  `src/ui/workspace-panel.ts`; MCP tools in `worker/mcp.ts` + the
  `src/mcp/README.md` tool table (the sync test enforces it).
- **Approach:**
  - Storage (bounded, per 0002's layout): `checkpoint:<id>` meta
    `{ id, name, actor, createdAt, revision, pageIds }` +
    `checkpoint:<id>:page:<pageId>` copies, respecting the existing 1.8 MiB
    per-page cap. Hard cap on checkpoint count (~12); creating beyond the cap
    requires deleting one — never silent eviction of a named checkpoint;
    oversize fails visibly before mutation.
  - Restore is forward-only: materialize the checkpoint as replace-page
    operations applied as one new revision — history is never rewritten.
  - Fork: new workspace id initialized from the checkpoint pages.
  - Authority split: `create_checkpoint` / `list_checkpoints` become MCP tools
    (agents legitimately checkpoint before risky batches); restore and fork
    stay browser-owner actions in this slice, mirroring the
    proposal-acceptance authority boundary. Recorded as an explicit, temporary
    `DESIGN.md` #2 carve-out (workspace _authority_, not document vocabulary).
- **Risk:** medium (DO storage growth + new mutation paths). **Validation:**
  harness DO tests — create/list/restore/fork round-trip, cap enforcement,
  restore-as-revision attribution, fork isolation; staging smoke.
  **Deployment impact:** routine (same DO class, new keys — no migration).

### Packet R4 — revision timeline UI

- **Outcome:** a timeline in the workspace panel: revisions with actor,
  summary (already stored per `change:<revision>`), proposal-acceptance
  markers, checkpoint markers, and the history floor ("older revisions
  compacted").
- **Files:** `src/ui/workspace-panel.ts`; `src/workspace/client.ts` (add the
  missing paged `getChanges` accessor — the REST route already exists); minor
  `worker/workspace-api.ts` if a summaries-only projection is needed.
- **Risk:** low. **Validation:** UI tests over fixture change logs; manual
  UAT. **Deployment impact:** routine.

## 7. Phase 4 — workspace resilience

### Packet S1 — WebSocket push + presence (hibernation-friendly)

- **Outcome:** open editors learn of new revisions/proposals/lease changes in
  near-real time and see who else is present; polling remains the fallback.
- **Files:** `worker/document.ts` (hibernation WebSocket API:
  `state.acceptWebSocket`, `webSocketMessage` / `webSocketClose`, serialized
  attachments for actor + last-seen revision); `worker/workspace-api.ts`
  (upgrade route `GET /api/workspaces/:id/socket`, owner-authenticated before
  DO handoff); `src/workspace/client.ts` (socket lifecycle + automatic
  downgrade to the existing manifest polling on failure);
  `src/ui/workspace-panel.ts` (presence chips, live status).
- **Approach:** push payloads are compact notices only —
  `{ revision, proposalCount, lease, presence }` — never document content;
  clients then use the existing `getChanges` / element hydration, so a lost
  message degrades to exactly the current polling behavior. Broadcast from the
  coordinator's existing revision/proposal/lease choke points. Presence lives
  in ephemeral socket attachments (actor kind/label, current page id) — no
  storage writes. Hibernation-safe: no in-memory state that isn't
  reconstructible from attachments.
- **Risk:** medium-high (concurrency on the production coordinator).
  **Validation:** harness tests with Miniflare WebSockets (connect, notice on
  revision, reconnect resume, fallback when the route 404s); staging soak
  before production. **Deployment impact:** routine (same DO class; the
  client falls back cleanly if the server predates the route).

### Packet S2 — gesture-native operations (retire the snapshot-diff adapter)

- **Outcome:** editor gestures emit semantic operations directly (drag-end →
  move, inspector commit → update, palette drop → add, delete → remove)
  instead of reconstructing them via `diffDocuments`; agent-visible change
  summaries become faithful to user intent.
- **Files:** `src/editor/editor.ts` (mutation seam), `src/main.ts` /
  `src/ui/workspace-panel.ts` (commit funnel), `src/workspace/operations.ts`
  (keep `diffDocuments`), new tests.
- **Approach (architecture/refactor template):** characterization tests for
  the existing diff-adapter commit path first (M24 mitigation); introduce one
  funnel through which all editor document mutations pass, emitting
  `{ operation, undoInverse }`; a referee assertion — emitted operations,
  applied via `applyOperations`, must equal the post-gesture document
  (`diffDocuments` as the referee) — runs in tests and behind a dev flag; then
  flip the workspace commit path to emitted operations, keeping
  `diffDocuments` for the import/open path and as the referee.
- **Risk:** high (touches the ~3,000-line untested editor core; silent
  divergence would corrupt agent-visible history). **Validation:** the
  referee assertion across a recorded gesture corpus; undo/redo equivalence
  tests; full manual editor UAT. **Deployment impact:** routine (client-only).

### Packet S3 — IndexedDB offline cache + crash recovery

- **Outcome:** the browser caches the workspace snapshot and any
  unacknowledged operation batch in IndexedDB; after a crash or offline
  period, the editor reopens the last state and replays the pending batch
  (idempotency ids make replay safe — the protocol already supports this).
- **Files:** new `src/workspace/offline.ts`; `src/workspace/client.ts`
  (queue-through-cache, replay on reconnect, stale-revision conflicts surfaced
  via the existing rebase/conflict path); `src/ui/workspace-panel.ts`
  (offline/pending indicator).
- **Risk:** medium (client data integrity). **Validation:** unit tests with a
  fake IndexedDB; simulated offline/replay/conflict tests; manual kill-tab
  UAT. **Deployment impact:** routine.

### Packet S4 — finer element-set leases _(demand-permitting; last in phase)_

- **Outcome:** a lease can scope to an explicit element-id set, not only the
  current page; the coordinator checks coverage via `operationTargets`.
- **Files:** `worker/document.ts` (lease shape + enforcement),
  `worker/workspace-api.ts`, `src/workspace/model.ts`,
  `src/ui/workspace-panel.ts` (grant-from-selection), lease surfaces in
  `worker/mcp.ts`.
- **Approach:** additive lease scope union
  `{ kind: 'page' } | { kind: 'elements'; ids: string[] }` with a bounded id
  set; page leases unchanged; element leases must not block the human editor
  (locked decision 6 — leases are authority, not mutexes).
- **Risk:** medium. **Validation:** harness tests — coverage checks, expiry,
  revocation, human-edit non-blocking. **Deployment impact:** routine.
  _Slip criterion:_ if no concrete multi-agent contention appears by the time
  S3 ships, park it in the deferred list.

## 8. Phase 5 — legacy Topology Studio importer _(parallel from Phase 3)_

### Packet I1 — pure conversion module

- **Outcome:** `convertLegacyStudio(json)` → `{ document, warnings }`: a
  best-effort mapping of legacy Topology Studio JSON to flipbook pages, with
  every unmapped construct reported, never silently dropped.
- **Files:** new `src/import/legacy.ts`; fixtures extracted from
  `reference/legacy-studio.zip` into `fixtures/legacy/`; tests.
- **Approach:** first sub-task is a written mapping table (legacy
  scenes/acts/steps → pages; legacy node/link types → catalog types via
  `api/builtins.ts`, unknown types → nearest builtin + warning; legacy
  annotations → zones/flow paths/policy markers where expressible); the
  converter is pure and DOM-free; output is always run through
  `validateDocument` in tests — fixtures must validate clean or with expected,
  asserted warnings; ids are regenerated for uniqueness; malformed input
  returns typed errors, never raw throws (the M1/M13 lesson — do not extend
  `parseDoc`'s blind-cast pattern).
- **Risk:** low-medium (pure, but format archaeology). **Validation:** fixture
  round-trips + `validateDocument`; baseline gates. **Deployment impact:**
  none.

### Packet I2 — GUI + MCP surfaces

- **Outcome:** the GUI open flow detects and converts legacy files (with a
  warnings summary before load); `import_topology` accepts the legacy format.
- **Files:** `src/main.ts` (open flow: sniff legacy shape →
  `convertLegacyStudio` → existing load path; `parseDoc` stays strict and
  untouched); `src/mcp/tools.ts` + `src/mcp/register.ts` (`import_topology`
  gains `format: 'auto' | 'topology-dojo' | 'legacy-studio'` and returns
  warnings); `src/mcp/README.md` tool table.
- **Risk:** low. **Validation:** MCP schema/runtime-validation tests; GUI open
  UAT with fixture files. **Deployment impact:** routine.

## 9. Phase 6 — proposal 0003: adaptive authoring profiles (phases A–C)

Sequencing restated: P2 is **migration-bearing** (new DO class ⇒ migration
`v4`) and must ride the proven Phase 1 pipeline; the learner's persistence
guardrail consumes Phase 3 checkpoints; thresholds want real usage data.

### Packet P1 (0003-A) — deterministic feature extraction

- **Outcome:** pure `src/profile/features.ts`:
  `(operations, documentContext) → SemanticFeatures` — archetype heuristics
  (hub-and-spoke, leaf/spine, multi-region), tier/grouping/alignment
  relations, agent-target vs user-correction overlap — geometry in, intent
  out, no pixel coordinates retained.
- **Files:** new `src/profile/features.ts` + tests; reuses
  `src/api/geometry.ts`, `src/api/layout.ts`,
  `src/workspace/operations.ts` (`operationTargets`).
- **Risk:** low (pure). **Validation:** heavy unit tests including the
  proposal's motivating example (radial → layered regional) as a named
  fixture. **Deployment impact:** none.

### Packet P2 (0003-A) — `AuthoringProfile` DO + observe-only learner

- **Outcome:** a per-owner candidate store populated asynchronously from
  attributed outcomes; zero change to agent output.
- **Files:** new `worker/profile.ts` (DO class `AuthoringProfile`, keyed by
  the stable numeric owner id — same identity scheme as
  `worker/workspaces.ts`); `worker/env.ts` (`AUTHORING_PROFILE` binding);
  `wrangler.jsonc` (binding in both top-level and `env.staging`, migration
  `"v4": { "new_sqlite_classes": ["AuthoringProfile"] }` in both);
  `worker/document.ts` (outcome-emission hook); shared `AuthoringPreference`
  type per the proposal's record shape.
- **Approach:**
  - Storage decision — a new DO, not `TopologyRegistry`: the registry is the
    legacy lazy-migration source scheduled to shrink, and profile
    compaction/decay lifecycle is alien to it. The cost (migration `v4`) is
    exactly what the Phase 1 pipeline exists to absorb. Gate behind a
    `PROFILES_ENABLED` var using the same bootstrap-then-activate pattern as
    `WORKSPACE_ENABLED`.
  - Learner: on an accepted proposal or leased agent commit, the coordinator
    records a bounded outcome window; when later owner revisions touch the
    same targets _and survive the next checkpoint_ (persistence guardrail,
    from R3), it emits one compact structured outcome — P1 features, never
    raw documents or operations — to the owner's profile DO via
    `ctx.waitUntil`, never blocking editing.
  - Candidate dedupe by (semantic rule, scope); one editing burst = one
    outcome; conservative thresholds per the proposal; bounded, compacted
    evidence refs.
- **Risk:** high (migration-bearing; a new async path in the coordinator).
  **Validation:** harness DO tests (dedupe, burst coalescing, bound
  enforcement, cross-owner isolation); full staging deploy +
  forward-recovery check with `PROFILES_ENABLED=false` per the migration
  template. **Deployment impact:** **migration-bearing** (`v4`; staging
  first, production bootstrap flag-off, then activate).

### Packet P3 (0003-A) — Authoring Preferences panel (observe-only)

- **Outcome:** an owner-facing surface listing candidates, evidence
  summaries, and observations, with pause/forget actions. No agent behavior
  change yet.
- **Files:** new `src/ui/profile-panel.ts`; `src/main.ts` (mount); a small
  owner-authenticated read/manage route set (`worker/profile-api.ts` or an
  extension of `worker/workspace-api.ts`).
- **Risk:** low. **Validation:** UI tests over fixture profiles; manual UAT.
  **Deployment impact:** routine.

### Packet P4 (0003-B) — confirmation, scoping, `get_authoring_guidance`

- **Outcome:** repeated candidates trigger the confirm-and-scope question in
  the panel (browser-owner only — no MCP confirmation path exists, by
  construction); confirmed rules are served to agents through
  `get_authoring_guidance` under hard budgets; agents disclose applied rules
  in proposal summaries.
- **Files:** `worker/profile.ts` (confirmation, `profileRevision`,
  compiled-guidance cache keyed
  `(profileRevision, guidanceRevision, workspace, archetype)`);
  `worker/mcp.ts` + `src/mcp/register.ts` (tools `get_authoring_guidance`,
  `list_authoring_preferences`, `explain_authoring_preference`);
  `src/mcp/README.md`; `src/ui/profile-panel.ts`; a static versioned
  `src/profile/guidance-packs.ts` exposing `guidanceRevision`.
- **Approach:** the budgets are tests, not aspirations — unit tests assert
  ≤5 rules, ≤400-token default / 800 absolute, `notModified` on unchanged
  revisions, and ids + omission count on overflow.
- **Risk:** medium (authority boundary + token discipline). **Validation:**
  budget tests; harness tests proving MCP cannot confirm/broaden/undelete a
  preference (acceptance criterion 7); staging smoke.
  **Deployment impact:** routine.

### Packet P5 (0003-C) — outcome refinement

- **Outcome:** overrides, contradictions, and "not for this diagram" feedback
  narrow triggers, recalibrate confidence, and decay stale candidates toward
  review.
- **Files:** `worker/profile.ts`; `src/profile/features.ts`
  (trigger-narrowing); `src/ui/profile-panel.ts`.
- **Risk:** medium. **Validation:** deterministic decay/contradiction unit
  tests; 0003 acceptance criteria 3–4 as named tests.
  **Deployment impact:** routine.

## 10. Explicitly deferred

| Deferred item                                   | Rationale / revisit trigger                                                                                                                                                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CRDTs / offline multi-master                    | 0002 says add only on _measured_ need; S3's idempotent replay covers single-writer offline. Revisit on real multi-device concurrent editing demand.                                                             |
| Collaborator/organization ACLs + org workspaces | The single-owner model has no second user yet; speculative auth surface is the riskiest kind. Revisit at the first concrete multi-user request; prerequisite for 0003-C workspace conventions beyond the owner. |
| Comments, mentions, review threads              | Multi-user feature; deferred with ACLs.                                                                                                                                                                         |
| Per-key MCP auth (mint/revoke/label)            | Remote MCP already runs OAuth 2.1 via GitHub; the roadmap item is self-described as conditional. Revisit if multiple independently revocable credentials are needed.                                            |
| 0003 Phase D (governed product guidance)        | Requires aggregate signals that only exist after A–C run in production, plus a maintainer review pipeline. Nothing in A–C blocks on it.                                                                         |
| Per-PR ephemeral Worker environments            | 0004 non-goal; revisit only if Cloudflare ships stateful preview isolation.                                                                                                                                     |
| S4 finer leases (conditional)                   | Ships only if multi-agent lease contention is observed; see the slip criterion in §7.                                                                                                                           |
| More node/link art, richer inspector controls   | Continuous demand-driven work, not plannable packets; pull individual items as standard-feature packets when a concrete need names them.                                                                        |

## 11. Open decisions to confirm before execution

1. `WORKSPACE_ENABLED` default semantics (unset ⇒ enabled; D2) — confirm or
   flip to default-off.
2. 0004's required decisions 2–5 (staging hostname, approvers, observation
   window, manual-only staging dispatch) — operator checklist O7.
3. Worker test location: extend the vitest `include` to worker test files vs
   keeping them under `src/` (W1).
4. Checkpoint cap value and the restore/fork authority carve-out (R3).
5. `AuthoringProfile` as a new DO class (migration `v4`) vs piggybacking
   `TopologyRegistry` (P2) — this plan recommends the new class.
