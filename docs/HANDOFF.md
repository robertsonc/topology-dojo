# Handoff — session 2 close (2026-07-15, end of day)

The current pick-up doc. Session 2 ran 2026-07-13 → 07-15 and shipped the
R-train, the S-train (minus S4), the flat viewer, and proposal 0003 packets
P1–P3 — including the **first `v4` migration deploy through the 0004 pipeline**
with a successful forward-recovery drill.

## Where things stand (everything merged; no open PRs)

- **`main` is the complete state**: R2/R3/R4, flat viewer, S1/S2/S3, P1
  (feature extraction), P2 (`AuthoringProfile` DO + observe-only learner,
  migration `v4`), P3 (Authoring Preferences panel + `/api/profile*` routes),
  the session handoff + runbook v4 gates, and all docs truth-ups.
- **Staging** (`topology-dojo-staging`): running with **`v4` applied** and
  **`PROFILES_ENABLED="true"`** — the observe-only learner is live and
  accumulating candidates from the owner's MCP correction loops. Last verified
  deploy + smoke: 7/7 green (see Gate A evidence below). NOTE: `main` has moved
  past the last staging deploy (P3 merged after) — **dispatch
  `deploy-staging.yml` from `main`** to get the prefs panel onto staging and
  see the learner's candidates.
- **Production**: still on the legacy Workers Builds path (operator O9/O10
  pending). Carries no `v3`/`v4` yet; `PROFILES_ENABLED` unset ⇒ learner
  inert by design. The first gated production deploy will apply `v1`–`v4`
  together (documented in `DEPLOYMENT_RUNBOOK.md` §"Migration `v4`").
- **Git**: clean. All session branches merged + pruned (local and remote);
  ~113 historical merged remotes also deleted. One unrelated branch
  `claude/hideable-frames-panel-ohlc73` appeared on origin from another
  session.

## Gate A — v4 staging proof (DONE, 2026-07-15)

| Step                                    | Evidence                                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `v4` applied to staging (P2 build)      | [run 29386077720](https://github.com/robertsonc/topology-dojo/actions/runs/29386077720) — CI (incl. workerd DO suites) + deploy green      |
| External smoke, learner observing       | 7/7 incl. sha assertion                                                                                                                    |
| Forward-recovery drill: flag-off deploy | [run 29386230142](https://github.com/robertsonc/topology-dojo/actions/runs/29386230142) — smoke 7/7, learner disabled cleanly forward-only |
| Re-enable                               | [run 29386327844](https://github.com/robertsonc/topology-dojo/actions/runs/29386327844) — smoke 7/7                                        |

This satisfies the runbook's v4 Gate A **and** constitutes a real
forward-recovery exercise performed in staging (a 0004 acceptance criterion).
Owner UAT of MCP workspace flows (propose/accept/lease) was confirmed done by
the operator. Full evidence also posted on PR #176.

Merge-history footnote: P2's content reached `main` via **#178** (the drill
branch was stacked on P2, and its auto-created PR was merged), which also
briefly pinned staging's flag off; **#179** restored `PROFILES_ENABLED="true"`.
GitHub therefore shows #176 as merged without its own merge commit.

## What shipped in session 2 (chronological, all on `main`)

| PR        | What                                                                     |
| --------- | ------------------------------------------------------------------------ |
| #159      | O7 activation observation window + stop thresholds (runbook)             |
| #160      | Slim hover-reveal scrollbars                                             |
| #161      | D6 docs truth-up + findings closure (H7/M14/M15/L1)                      |
| #162      | Collapsed-palette icon fix; minimap docked left; Problems pinned right   |
| #163      | **R2** selective proposal acceptance                                     |
| #164/#167 | **R3** checkpoints, forward-only restore, fork (+ 2 MCP tools)           |
| #165/#171 | **R4** revision timeline                                                 |
| #166      | **Flat viewer** (glow = emphasis-only channel; exports match)            |
| #168      | Roadmap truth-up + adjustable-viewer item                                |
| #169      | **S1** WebSocket push + presence (hibernation-friendly)                  |
| #171      | **S2** gesture-native operations + referee fallback                      |
| #173      | **S3** IndexedDB offline cache + crash recovery                          |
| #174      | Roadmap: resize link labels (`labelScale`)                               |
| #175      | **P1** deterministic feature extraction (`SemanticFeatures`)             |
| #176/#178 | **P2** `AuthoringProfile` DO + observe-only learner (**migration `v4`**) |
| #177      | Session handoff + runbook v4 gates                                       |
| #179      | Restore staging `PROFILES_ENABLED="true"`                                |
| #180      | **P3** Authoring Preferences panel (prefs button, pause/forget)          |

**S4 (finer element-set leases) deliberately skipped** — per-page leases are
fine; revisit only on measured contention.

## Operator checklist

| Item                              | Status                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| O1–O8                             | ✅ (staging isolated + live; CI-gated pipeline proven; O7 thresholds set)                                                       |
| v4 Gate A (staging + drill)       | ✅ **done this session** (evidence above)                                                                                       |
| Staging UAT (MCP workspace flows) | ✅ confirmed by operator                                                                                                        |
| O9                                | ⏳ Disconnect Workers Builds once the production Actions path is proven                                                         |
| O10/O11                           | ⏳ First gated production deploy (applies `v1`–`v4`; `WORKSPACE_ENABLED:"false"` bootstrap → smoke → workspace activation flip) |
| O12                               | ⏳ Cloudflare error-rate alerting + failed-workflow notifications + nightly staging smoke                                       |
| Profiles activation (prod)        | ⏳ later, after P4/P5 make profiles useful: tiny PR adding top-level `"PROFILES_ENABLED": "true"`                               |

## Next repo work, in order

1. **Deploy staging from `main`** (anyone can dispatch) — puts the P3 prefs
   panel live so the learner's accumulated candidates become visible. Quick
   sanity: sign in → prefs button → candidates listed.
2. **P4 (0003-B)** — confirmation & scoping in the panel (browser-owner only —
   no MCP confirm path, by construction) + `get_authoring_guidance` /
   `list_authoring_preferences` / `explain_authoring_preference` MCP tools
   under **hard token budgets as tests** (≤5 rules, ≤400 default / 800
   absolute, `notModified` on unchanged `profileRevision`, ids + omission
   count on overflow). Files: `worker/profile.ts` (confirmation +
   compiled-guidance cache keyed `(profileRevision, guidanceRevision,
workspace, archetype)`), `worker/mcp.ts` + `src/mcp/register.ts` +
   README tool table, `src/ui/profile-panel.ts`, a versioned
   `src/profile/guidance-packs.ts`. Medium risk (authority boundary + token
   discipline). Note: P3 already bumps `profileRevision` on manage actions.
3. **P5 (0003-C)** — outcome refinement: overrides/contradictions narrow
   triggers + recalibrate confidence; stale candidates decay toward review.
   Deterministic decay/contradiction unit tests; 0003 acceptance criteria 3–4
   as named tests.
4. Then: 0003-D (governed product guidance) is out of scope per the plan;
   remaining roadmap candidates in `ROADMAP.md` §Next.

## Working conventions (unchanged from session 2)

- Packet = branch = PR; session model does discovery → sub-agent implements
  from a precise brief → session model **independently verifies the risky
  properties + runs the gate** before committing.
- DO/Miniflare + `session.ts` webcrypto suites fail to _start_ locally (no
  `workerd`/`File`/`crypto`) — they run in CI; keep packet correctness locally
  verifiable via pure helpers/fakes.
- Staging deploys are safe to dispatch on request (`deploy-staging.yml`,
  optional `ref`); production requires the protected environment approval.
  Migration recovery is forward-only.

## Key pointers

- Coordinator: `worker/document.ts` (revisions, proposals, leases, checkpoints,
  WS presence, P2 learner window/emission).
- Profiles: `src/profile/{features,model,learner,client}.ts`,
  `worker/profile.ts` (DO), `worker/profile-api.ts` (routes),
  `src/ui/profile-panel.ts` (panel); all gated by `profilesEnabled()`
  (opt-in, unlike `workspaceEnabled`).
- Workspace panel: `src/ui/workspace-panel.ts`; editor gesture funnel:
  `src/editor/editor.ts` + referee in the panel; render seam:
  `flattenViewer` in `src/vendor/topology-ds.ts`.
