# Implementation Plan — Active

**Status:** Accepted plan of record
**Captured:** 2026-07-19
**Revalidated:** 2026-08-09 — documentation packets N1–N3 are complete; use
[`ROADMAP.md`](ROADMAP.md) and [`CAPABILITY_MATRIX.md`](CAPABILITY_MATRIX.md)
for current capability status before starting any remaining packet.
**Supersedes:** [`archive/IMPLEMENTATION_PLAN_2026-07-12.md`](archive/IMPLEMENTATION_PLAN_2026-07-12.md)
(fully executed — see that file's banner)
**Executed as:** bounded implementation packets per
[`AGENTIC_IMPLEMENTATION_WORKFLOW.md`](AGENTIC_IMPLEMENTATION_WORKFLOW.md) —
one packet ≈ one reviewable PR, one active writer per branch, human
merge/release gates throughout. That discipline held for ~20 packets across
the previous plan; nothing here changes it.

This plan captured six initiatives from [`ROADMAP.md`](ROADMAP.md) §"Now":
the completed documentation reset (N), Cloudflare alerting + production game day
(O), agent activity + explainability (A), guided topology briefs + semantic
templates (B), EdgeConnect live-import hardening (E), and time-aware flow/
failure storytelling (T).

## How to use this document

1. Read `ROADMAP.md` §"Current production baseline" first if you haven't —
   it's the ground truth this plan builds on, verified against code on
   2026-07-19 (see `CAPABILITY_MATRIX.md`).
2. Find the next unstarted packet in the dependency graph below, respecting
   the "can run in parallel" notes.
3. Each packet's spec is under its initiative's "Implementation packets"
   subsection — that's the actual work order (outcome, scope, files,
   non-goals, tests, acceptance criteria). The packet register at the bottom
   is a flat index for cross-referencing, not a duplicate spec.
4. Packet = branch = PR. Run the full gate before opening a PR:
   `npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e`, plus
   `node scripts/check-wrangler-env.mjs` for anything touching
   `wrangler.jsonc`.
5. **None of the six initiatives in this plan require a new Durable Object
   migration** under the architecture proposed below (see each initiative's
   "Migration impact"). If an implementing agent finds a design in this plan
   genuinely requires one, treat that as a signal to stop and get explicit
   human sign-off before proceeding — migrations are the one class of change
   this repo has never taken lightly (see `DEPLOYMENT_RUNBOOK.md`).

## Dependency graph

```mermaid
graph TD
    N1[N1: Repository discovery] --> N2[N2: Rewrite ROADMAP + archive old plan]
    N2 --> N3[N3: Rewrite HANDOFF + doc truthfulness fixes + PR]

    O3[O3: Generalize ROLLBACK.md to v3-v5] --> O2[O2: Staging game day]
    O1[O1: Configure Cloudflare alerting]

    A1[A1: Agent-session activity model] --> A2[A2: Instrument TopologyMcp]
    A2 --> A3[A3: Owner-gated read API]
    A3 --> A4[A4: Explainability linkage]
    A3 --> A5[A5: Admin dashboard UI]
    A4 --> A6[A6: Tests + gate + rollout]
    A5 --> A6

    B1[B1: Brief contract types] --> B2[B2: Semantic template compiler x3]
    B2 --> B3[B3: MCP tool create_from_brief]
    B2 --> B4[B4: GUI brief wizard]
    B2 --> B5[B5: Expand archetype coverage]
    B3 --> B6[B6: Validation guardrails]
    B4 --> B6
    B6 --> B7[B7: Tests + gate + rollout]
    B5 --> B7

    E1[E1: Recorded-fixture verification] --> E4[E4: Live-import GUI]
    E2[E2: No-delete-on-transient-failure test] --> E4
    E3[E3: Retry/partial-failure handling] --> E4
    E4 --> E7[E7: Tests + gate + rollout]
    E5[E5: Credential provisioning runbook] --> E7
    E6[E6: Staleness/freshness UI] --> E7

    T1[T1: Scenario contract types] --> T2[T2: Story compiler]
    T2 --> T3[T3: Failure-moment annotations]
    T2 --> T4[T4: MCP tool compile_flow_story]
    T3 --> T5[T5: GUI scenario-timeline authoring]
    T4 --> T5
    T5 --> T6[T6: Playback caption polish]
    T6 --> T7[T7: Tests + gate + rollout]

    N3 -.blocks nothing, but should land first for a clean baseline.-> O1
    N3 -.-> A1
    N3 -.-> B1
    N3 -.-> E1
    N3 -.-> T1
    E2 -.compile.ts hotspot, land before.-> T2
```

**Reading this graph:** solid arrows are hard dependencies (can't start until
the source packet is merged). Dotted arrows from N3 are soft — nothing is
blocked on documentation, but starting the other five initiatives against an
already-corrected baseline avoids compounding the exact kind of doc drift
this reset just fixed. The one hard cross-initiative dependency is **E2 → T2**
(both touch `src/connect/compile.ts`; land E-series's safeguard first so
T-series's story compiler is built on the hardened version, not the other way
around).

**What can run fully in parallel once N3 lands:** O-series, A-series,
B-series, and E-series have zero shared dependencies on each other and touch
almost entirely disjoint files (see "Shared-file hotspots" below for the
exceptions). T-series should start after E2 specifically, not all of
E-series — T1 (pure types) can start immediately in parallel with everything.

## Shared-file hotspots

Concurrency planning, in the spirit of the previous plan's §1.1 (which this
one inherits — it worked for ~20 packets with zero merge disasters):

| File                                               | Touched by                                                                                                                  | Discipline                                                                                                                                                                                                                     |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/mcp/tools.ts`                                 | B3 (`create_from_brief`), T4 (`compile_flow_story`)                                                                         | One packet merges before the next starts editing this file. Both are late in their initiative's sequence, so natural staggering likely avoids collision — but don't assume it; check the file's HEAD before starting B3 or T4. |
| `src/connect/compile.ts`                           | E2, E3 (safeguards/retry), T2 (story compiler calls into it)                                                                | **Hard sequencing**: E2 must merge before T2 starts (see dependency graph). E3 can land before or after T2 since it's additive (retry wrapping), but coordinate if both are in flight.                                         |
| `worker/env.ts`, `wrangler.jsonc`                  | Any packet introducing a new flag (only if A-series decides against reusing `ANALYTICS_ENABLED` — see A1's "open decision") | Same discipline as every prior flag-introducing packet (D2, P2, the admin-dashboard work): one packet, one flag, one PR.                                                                                                       |
| `docs/HANDOFF.md`                                  | Every initiative's completion update                                                                                        | Expected and fine — HANDOFF is a living status doc; each packet's "N/A" or completion note is a small, non-conflicting append in practice (this repo's history shows this working cleanly ~20 times).                          |
| `worker/admin-api.ts`, `src/ui/admin-dashboard.ts` | A3, A5 only                                                                                                                 | No cross-initiative conflict expected.                                                                                                                                                                                         |

## Migration, flag, secret, and tool inventory (what to watch for)

Per-initiative call-outs, consolidated:

| Initiative            | New DO?                                                                                                              | New migration? | New MCP tool(s)?                                        | New secret?                                                                                                                                              | New flag?                                                                                   | Production operator step?                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| N (docs)              | No                                                                                                                   | No             | No                                                      | No                                                                                                                                                       | No                                                                                          | No                                                                                        |
| O (alerting/game day) | No                                                                                                                   | No             | No                                                      | No                                                                                                                                                       | No                                                                                          | **Yes** — O1 (Cloudflare dashboard config) and O2 (running the drill) are both human-only |
| A (explainability)    | No — reuses `AnalyticsLog` (v5) for the owner-scoped index and `TopologyMcp`'s own per-session storage for the trail | No             | No — HTTP-only admin routes, no MCP surface planned     | No                                                                                                                                                       | **Open decision**: reuse `ANALYTICS_ENABLED` (recommended) or introduce a new flag — see A1 | Only if a new flag is introduced                                                          |
| B (briefs/templates)  | No                                                                                                                   | No             | **Yes** — `create_from_brief` (name TBD by implementer) | No                                                                                                                                                       | No                                                                                          | No                                                                                        |
| E (EdgeConnect)       | No                                                                                                                   | No             | No (uses existing live-fabric tools)                    | **Yes, if verifying against a real Orchestrator** — `ORCH_BASE_URL`/`ORCH_API_KEY` on staging only (never production without an explicit human decision) | No                                                                                          | **Yes** — E5 (secret provisioning) is human-only                                          |
| T (storytelling)      | No                                                                                                                   | No             | **Yes** — `compile_flow_story` (name TBD)               | No                                                                                                                                                       | No                                                                                          | No                                                                                        |

If any implementing agent finds a design in §"Implementation packets" below
actually requires a new DO or migration, that's a deviation from this plan —
stop and confirm with a human before proceeding (see "How to use this
document" above).

---

## Initiative N — Documentation and roadmap reset

**Goal:** Replace stale planning docs with a plan of record that distinguishes
shipped/partial/pending/deferred/evidence-triggered/excluded work, backed by
code evidence, so a new agent can act without reconstructing months of
history.

**Current baseline:** `docs/IMPLEMENTATION_PLAN.md` (as of 2026-07-12) called
Proposals 0003 and 0004 "unimplemented" when both are fully shipped and live
in production; `docs/ROADMAP.md` had one stale "Next/candidate" bullet;
`docs/HANDOFF.md`'s title undersold how current its body actually was;
`docs/launch-readiness/FINDINGS_REGISTER.md` understated closure progress
(4 Critical findings fixed in code but never annotated closed). Full detail
in `docs/DISCREPANCY_REGISTER.md`.

**Dependencies:** None — this is the first initiative, by design.

**Architecture:** N/A — pure documentation, plus tiny, evidence-backed
correction edits (findings-register closure notes, proposal status-header
flips, a `worker/env.ts` comment fix) that make existing docs/comments
truthful without changing behavior.

**Implementation packets:**

### N1 — Repository discovery + capability matrix + discrepancy register

- **Outcome:** `docs/CAPABILITY_MATRIX.md` and `docs/DISCREPANCY_REGISTER.md`
  exist, every row cites file:line evidence, and both were produced by
  auditing code directly (not by trusting prior docs).
- **Dependencies:** None.
- **Scope:** Six parallel subsystem audits (MCP/connector platform, shared
  workspace, adaptive authoring, core topology editor, docs-claims inventory,
  GitHub state) plus direct verification of operations/deployment config and
  the public login/showcase surface.
- **Likely files:** `docs/CAPABILITY_MATRIX.md`, `docs/DISCREPANCY_REGISTER.md`
  (new).
- **Non-goals:** No product code changes.
- **Risk level:** None (read-only research).
- **Migration/deployment impact:** None.
- **Human action required:** None.
- **Required tests:** None (not code).
- **Acceptance criteria:** Every capability-matrix row and discrepancy-register
  row has a file:line citation; classifications match what a second
  independent read of the same code would conclude.
- **Status: done, this PR.**

### N2 — Rewrite ROADMAP.md, archive the old plan, write the new plan

- **Outcome:** `docs/ROADMAP.md` restructured into Current Production
  Baseline / Now / Next / Later / Evidence-Triggered / Deliberately Excluded
  / Completed Historical Milestones; the old `docs/IMPLEMENTATION_PLAN.md`
  moved to `docs/archive/IMPLEMENTATION_PLAN_2026-07-12.md` with an
  unmistakable historical banner; this document exists as the new active
  plan.
- **Dependencies:** N1 (needs the capability matrix as evidence).
- **Scope:** As described.
- **Likely files:** `docs/ROADMAP.md`, `docs/archive/IMPLEMENTATION_PLAN_2026-07-12.md`
  (moved + banner), `docs/IMPLEMENTATION_PLAN.md` (new).
- **Non-goals:** No product code changes.
- **Risk level:** None.
- **Migration/deployment impact:** None.
- **Human action required:** None.
- **Required tests:** None.
- **Acceptance criteria:** No shipped feature is described as future work in
  the new `ROADMAP.md`; the archived plan cannot be mistaken for current (a
  reader hitting it via search/link sees the banner before any stale claim).
- **Status: done, this PR.**

### N3 — Rewrite HANDOFF.md, findings-register truthfulness fixes, packet-ready issues, validation gate, PR

- **Outcome:** `docs/HANDOFF.md` becomes the primary, accurate entry point;
  `docs/launch-readiness/FINDINGS_REGISTER.md` gets closure annotations for
  C1–C4 and H7 plus a refreshed top-line count; `docs/proposals/0003-*.md`
  and `docs/proposals/0004-*.md` status headers flip from
  "Candidate"/"Proposed" to "Implemented"; small pointer-note fixes to
  `docs/ROLLBACK.md` and `docs/ARCHITECTURE.md`; `docs/PACKET_ISSUES.md`
  (issue-ready Markdown for every packet in this plan); full validation gate
  run; draft PR opened.
- **Dependencies:** N2.
- **Scope:** As described — see `docs/DISCREPANCY_REGISTER.md` rows 1–14 for
  the exact set of corrections.
- **Likely files:** `docs/HANDOFF.md`, `docs/launch-readiness/FINDINGS_REGISTER.md`,
  `docs/proposals/0003-adaptive-agent-authoring-profiles.md`,
  `docs/proposals/0004-isolated-staging-and-deployment-pipeline.md`,
  `docs/ROLLBACK.md`, `docs/ARCHITECTURE.md`, `worker/env.ts` (comment only),
  `docs/PACKET_ISSUES.md` (new).
- **Non-goals:** No product code changes beyond the one comment fix; no
  rewrite of `docs/launch-readiness/QA_TEST_PLAN.md`/`UAT_PLAN.md` bodies
  (banner only, if time permits).
- **Risk level:** Low (doc + comment edits; the `worker/env.ts` comment
  change has zero runtime effect — verify with `npm run typecheck` anyway).
- **Migration/deployment impact:** None.
- **Human action required:** Merge the PR (same as every prior packet in this
  repo's history — no special approval beyond the normal review).
- **Required tests:** Full gate (`typecheck`, `lint`, `test`, `build`,
  `check-wrangler-env`) must stay green; this is a docs change, so the bar is
  "nothing regresses," not new test coverage.
- **Acceptance criteria:** Matches `ROADMAP.md`'s "Completion criteria" list
  (see the original assignment) — no shipped feature described as future,
  no incomplete feature described as production-ready, historical plans
  can't be mistaken for current, a new agent can determine the next action
  from `HANDOFF.md` alone.
- **Status: done (documentation reset landed; living QA/UAT/user-guide refresh
  revalidated the baseline on 2026-08-09).**

**Testing strategy:** No new automated tests (documentation initiative); the
existing full gate must stay green throughout.

**Deferred work:** Full generalization of `docs/ROLLBACK.md` to a
migration-agnostic template (N3 adds only a pointer note; see O3 for the
fuller fix); `docs/launch-readiness/QA_TEST_PLAN.md`/`UAT_PLAN.md` body
rewrites (banner only).

---

## Initiative O — Cloudflare alerting and production game day

**Goal:** Close the externally verified monitoring gap. The repository cannot
read current Cloudflare notification policy state, so inspect or configure the
dashboard against the thresholds already defined in
`docs/DEPLOYMENT_RUNBOOK.md`, and complete a recorded staging
forward-recovery game day exercising the current (`v3`–`v5`) rollback
procedures end-to-end.

**Current baseline (updated 2026-07-19 — the repo-side half of this
initiative has landed):** Nightly staging smoke ships and works
(`nightly-staging-smoke.yml`). GitHub's built-in Actions failure emails
cover deploy-pipeline failures. The observability PR added: a production
alert matrix + severity model (`docs/ALERTS.md`), the exact human dashboard
checklist (`docs/CLOUDFLARE_OPERATOR_RUNBOOK.md`), a repeatable game-day
framework + evidence template (`docs/GAME_DAY.md`,
`docs/GAME_DAY_EVIDENCE_TEMPLATE.md`), daily + on-demand production
verification with issue dedup and deployed-SHA-mismatch detection
(`production-verify.yml`), smoke growth to 14 checks with per-flag
disabled-contract assertions, staging-only flag-override inputs on
`deploy-staging.yml`, and a triple-gated staging-only synthetic-fault route
(`worker/staging-fault.ts`). What remains is the human-only evidence: inspect or
configure the Cloudflare dashboard and prove delivery (O1), then
execute/record the drill (O2).

**Dependencies:** None — can start immediately, in parallel with everything
else.

**Architecture:** Cloudflare Notifications routed to the owner's
email/webhook destination, matching `docs/ALERTS.md` (which inherits
`docs/DEPLOYMENT_RUNBOOK.md`'s approved thresholds). **Correction to this
plan's earlier assumption:** specific "Workers" alert types for error
rate/CPU could **not** be verified in current Cloudflare documentation —
the operator runbook therefore starts with a verbatim catalog survey
(CF-3) and records what actually exists on this account/plan, with the
GitHub synthetic layer as the plan-independent baseline and Health
Checks / zone HTTP alerts / OTLP-export-to-external as the plan-dependent
options.

**Implementation packets:**

### O1 — Configure Cloudflare alerting

- **Status (2026-08-09): specification complete, awaiting current human
  dashboard verification.** Everything an agent can produce exists —
  `docs/ALERTS.md` (what + thresholds) and
  `docs/CLOUDFLARE_OPERATOR_RUNBOOK.md` (exact steps CF-1..CF-6 with
  evidence requirements). Completion = the operator checklist at the bottom
  of that runbook fully checked, with the catalog-survey result recorded in
  `ALERTS.md`'s L3 rows.
- **Outcome:** Cloudflare Notification policies exist for the production
  Worker matching `DEPLOYMENT_RUNBOOK.md`'s documented thresholds; the
  runbook is updated with the actual policy names/ids so it's no longer
  purely aspirational prose.
- **Dependencies:** None.
- **Scope:** Cloudflare dashboard configuration (or API scripting of the
  same); a small `DEPLOYMENT_RUNBOOK.md` update recording what was
  configured.
- **Likely files:** `docs/DEPLOYMENT_RUNBOOK.md` (update only).
- **Non-goals:** No new code-side monitoring/instrumentation — reuse what
  `/healthz` and Cloudflare's own platform metrics already expose.
- **Risk level:** Low (a misconfigured alert threshold produces noisy or
  missing alerts, not an outage).
- **Migration/deployment impact:** None.
- **Human action required:** 100% — this is a Cloudflare dashboard action; no
  agent can complete it.
- **Required tests:** None (not code). Verification: trigger a synthetic
  error spike against staging (not production) and confirm the alert fires.
- **Acceptance criteria:** `docs/HANDOFF.md` operator checklist item O12
  flips from "◑ Partial" to "✅ done," citing the configured policy.

### O2 — Staging forward-recovery game day

- **Status (2026-07-19): framework + tooling complete, drill NOT executed.**
  The runnable plan is `docs/GAME_DAY.md` (Phases 1–4, scenarios
  S-0..S-12 / P-1..P-12) with `docs/GAME_DAY_EVIDENCE_TEMPLATE.md`;
  supporting mechanisms (staging fault route, staging flag-override deploy
  inputs, disabled-contract smoke flags, production-verify) all shipped.
  Remaining: a human operator runs it and files the dated evidence record.
- **Outcome:** A dated, recorded execution of the game-day drill
  (`docs/GAME_DAY.md`, which supersedes `docs/ROLLBACK.md`'s original
  "Staging game day" checklist) against the current system state.
- **Dependencies:** O3 (done — the rollback doc is accurate before running
  the drill against it). Scenarios S-2..S-4 additionally need the
  staging-only `DIAGNOSTICS_TOKEN` secret provisioned (human, see
  `CLOUDFLARE_OPERATOR_RUNBOOK.md` CF-4).
- **Scope:** Deploy known-good staging → create a disposable draft →
  deliberately deploy broken workspace behavior → confirm forward recovery →
  re-enable → record the result.
- **Likely files:** `docs/ROLLBACK.md` or `docs/HANDOFF.md` (completion
  record only).
- **Non-goals:** No code changes beyond whatever the drill's "deliberately
  broken" deploy requires (should be a flag flip, not new code, to keep this
  low-risk).
- **Risk level:** Low if confined to staging (by design — never run this
  drill against production).
- **Migration/deployment impact:** None (uses existing migrations/flags).
- **Human action required:** Significant — must be run against live staging
  with an operator observing/confirming each step; not something to automate
  away given its purpose is building operator confidence in the real
  procedure.
- **Required tests:** The drill itself is the test.
- **Acceptance criteria:** A dated completion record exists, matching the
  8-step checklist in `docs/ROLLBACK.md`.

### O3 — Generalize `docs/ROLLBACK.md` beyond `v3`

- **Status (2026-07-19): DONE** (observability PR): the header note makes
  the document explicitly migration-agnostic, the forward-recovery section
  names the `v4`/`v5` substitutions inline, the per-flag procedures live in
  `GAME_DAY.md` §"Forward-recovery reference", and the old `v3`-only
  "Staging game day" section now points at the full framework.
- **Outcome:** `docs/ROLLBACK.md`'s worked examples and the game-day checklist
  reference the current migration set (`v3`–`v5`) or a genuinely
  migration-agnostic template, not just `v3`.
- **Dependencies:** None.
- **Scope:** Small doc edit — either generalize the language (preferred: "the
  currently-highest migration tag, see `wrangler.jsonc`") or add explicit
  `v4`/`v5` worked examples alongside the existing `v3` one, cross-referencing
  `DEPLOYMENT_RUNBOOK.md`'s per-migration gate sections.
- **Likely files:** `docs/ROLLBACK.md`.
- **Non-goals:** No process changes — the underlying forward-only recovery
  principle is unchanged; this is purely making the document's language keep
  up with the migration count.
- **Risk level:** None (pure doc edit).
- **Migration/deployment impact:** None.
- **Human action required:** None.
- **Required tests:** None.
- **Acceptance criteria:** `docs/ROLLBACK.md` no longer implies `v3` is the
  only or latest migration.

**Testing strategy:** O1/O3 have no automated tests (config/docs); O2's
"test" is the drill itself, with a pass/fail recorded outcome.

**Deferred work:** Automating the game day itself (a scripted chaos-drill) —
not proposed; the value here is a human operator building confidence in a
manual procedure they'll need to execute for real during an actual incident.

---

## Initiative A — Agent activity and explainability

**Goal:** Give the workspace owner (and eventually the agent itself)
visibility into what an AI agent did across MCP sessions and why — closing
the admin dashboard's explicit MVP deferral ("agents / MCP-session detail")
and the workspace revision timeline's current per-document-only scope.

**Current baseline:** Workspace revision entries already carry
actor/summary/source badges (`worker/document.ts`), but that's scoped to one
workspace, not cross-workspace or per-MCP-session. `TopologyMcp` (the
per-session Durable Object) records nothing beyond its in-memory document
store — no session start/end, no tool-call trail. The authoring-profile
guidance tools (`get_authoring_guidance` etc.) are called at an agent's sole
discretion with zero record of whether/when they were consulted before a
given edit.

**Dependencies:** None on other initiatives; soft dependency on N3 landing
first for a clean baseline.

**Architecture — the key design decision, made here rather than left open:**
**no new Durable Object migration.** Two existing pieces of infrastructure
already have exactly the right shape:

1. **Per-call activity trail**: `TopologyMcp` is _already_ a Durable Object
   instantiated fresh per MCP session (`worker/mcp.ts`). It can record its
   own bounded ring buffer of `{toolName, at, outcome}` events to its own
   `ctx.storage` — zero new migration, zero new DO class, the data is
   naturally scoped and already cleaned up when the session DO's storage is
   eventually evicted.
2. **Cross-session discovery index**: a human needs to list "my recent agent
   sessions" without knowing individual session DO ids in advance. Extend
   `AnalyticsLog` (migration `v5`, already live) with a second bounded,
   per-owner index — record `{sessionId, startedAt, toolCallCount}` when
   `TopologyMcp.init()` runs, mirroring the exact `recordLogin`/bounded-log
   discipline `AnalyticsLog` already implements for the login roster. This
   keeps the privacy posture identical (metadata only, owner-gated,
   fail-closed) and reuses a store this repo has already built, tested, and
   activated in production — rather than standing up a sixth DO class for a
   closely related concern.

**Flag decision (resolved 2026-08-19):** reuse `ANALYTICS_ENABLED` (already
on in production) — same owner-visibility posture as the admin dashboard.
No new flag, no bootstrap-then-activate ceremony.

**Status (2026-08-19):** Packets A1–A6 are implemented in one PR. Privacy:
metadata only (tool name, timestamp, coarse success/error); no raw prompt
or argument logging. The revision-timeline guidance marker is an honest
non-causal presence signal. This PR must not be merged or deployed by the
implementing agent.

**Implementation packets:**

### A1 — Agent-session activity data model

- **Outcome:** Pure types + pure shaping/eviction helpers for the per-session
  ring buffer and the per-owner session index, mirroring `src/admin/roster.ts`'s
  split (pure helpers, unit-tested, DO is a thin shell).
- **Dependencies:** None.
- **Scope:** `src/agent-activity/model.ts` (types: `SessionSummary`,
  `ToolCallEvent`), `src/agent-activity/trail.ts` (bounded ring-buffer
  append/evict, pure).
- **Likely files:** `src/agent-activity/model.ts`, `src/agent-activity/trail.ts`
  (new), plus their `.test.ts` files.
- **Non-goals:** No raw prompt/argument logging — tool name, timestamp, and a
  coarse outcome (success/error) only, consistent with "Deliberately
  Excluded" in `ROADMAP.md`.
- **Risk level:** Low.
- **Migration impact:** None.
- **Deployment impact:** None (not wired to anything yet).
- **Human action required:** None.
- **Required tests:** Ring-buffer append/evict bounds; index upsert
  (first-seen vs. returning), mirroring `src/admin/roster.test.ts`'s pattern.
- **Acceptance criteria:** Pure, deterministic, 100% locally testable (no
  workerd needed), matching this repo's established pattern for DO-adjacent
  logic.
- **Status: implemented this PR.**

### A2 — Instrument `TopologyMcp` session lifecycle + tool dispatch

- **Outcome:** Every MCP tool call on the remote server appends a bounded
  event to its own session DO's storage; session start appends an entry to
  the owner's `AnalyticsLog` session index (best-effort, `ctx.waitUntil`,
  never blocking a tool call — same discipline as `recordLogin`).
- **Dependencies:** A1.
- **Scope:** Wire `A1`'s pure helpers into `worker/mcp.ts`'s `init()` and
  tool-dispatch path.
- **Likely files:** `worker/mcp.ts`, `worker/analytics.ts` (extend with the
  session-index RPC).
- **Non-goals:** No behavior change to any existing tool's response — this
  is purely additive, best-effort recording.
- **Risk level:** Medium — touches the hot path every tool call goes through;
  must be provably non-blocking and provably unable to throw back into a
  tool response (mirror the try/catch discipline in `worker/auth.ts`'s
  `recordLogin`).
- **Migration impact:** None.
- **Deployment impact:** Gated by whichever flag was chosen in A1's open
  decision; inert until that flag is on.
- **Human action required:** None beyond the normal deploy approval.
- **Required tests:** A Miniflare-harness test proving a tool call still
  succeeds and returns unchanged output even if the activity-recording call
  is made to fail/throw internally (the "never blocks or breaks the primary
  path" property, mirroring how login recording is tested).
- **Acceptance criteria:** No existing MCP tool test's expected output
  changes; a new test proves the trail is recorded.

### A3 — Owner-gated read API

- **Outcome:** `GET /api/admin/sessions` (recent sessions across the owner's
  workspaces) and `GET /api/admin/sessions/:id` (that session's tool-call
  trail, read directly from its own `TopologyMcp` DO instance) — mirrors
  `worker/admin-api.ts`'s existing gate pattern exactly (401/403/fail-closed).
- **Dependencies:** A2.
- **Scope:** New routes in `worker/admin-api.ts` (or a sibling
  `worker/agent-activity-api.ts` if the file is getting large).
- **Likely files:** `worker/admin-api.ts` or new file, `src/admin/model.ts`
  (extend types).
- **Non-goals:** No MCP-facing read tool for this data in this packet (an
  agent reading its own activity trail is a plausible future extension, not
  in scope here).
- **Risk level:** Low (read-only, same auth pattern as the existing admin
  API).
- **Migration impact:** None.
- **Deployment impact:** None beyond A2's flag.
- **Human action required:** None.
- **Required tests:** Mirror `src/testing/admin-api.test.ts`'s pattern (401
  unauth, 403 non-admin, 200 for the owner).
- **Acceptance criteria:** Same fail-closed guarantees as the existing admin
  API, verified by tests.

### A4 — Explainability linkage on the revision timeline

- **Outcome:** A workspace revision-timeline entry authored by an agent shows
  whether `get_authoring_guidance` was called earlier in the same MCP
  session — an honest "guidance was consulted before this edit" signal, not
  a causal claim (the audit found consumption is advisory/discretionary, and
  this feature must not overstate that).
- **Dependencies:** A3.
- **Scope:** Cross-reference a revision's session id (if the revision-log
  actor can be tied to a session — may require adding a `sessionId` field to
  agent-authored revisions/proposals, a small, additive schema change, not a
  new migration) against that session's tool-call trail.
- **Likely files:** `worker/document.ts` (add `sessionId` to agent-actor
  metadata if not already derivable), `src/ui/workspace-panel.ts` (surface
  the signal).
- **Non-goals:** No causal inference beyond "guidance tool X was called
  before this commit in the same session" — do not claim the guidance
  _caused_ the edit.
- **Risk level:** Medium — touches the revision/proposal write path
  (`worker/document.ts`), a well-tested but sensitive file; keep the change
  purely additive (an optional field, never required, never changes existing
  behavior for callers that omit it).
- **Migration impact:** None (additive field on an existing revision record,
  not a schema version bump — verify this holds; if it doesn't, treat as a
  signal to stop per this plan's top-level warning).
- **Deployment impact:** None beyond A2/A3's flag.
- **Human action required:** None.
- **Required tests:** A workspace-level test proving an agent commit made
  after a guidance call shows the linkage, and one made without a prior
  guidance call does not falsely show it.
- **Acceptance criteria:** The signal is visibly present in the panel and
  provably accurate against the test cases above.

### A5 — Admin dashboard "Agent Sessions" UI

- **Outcome:** A new tab/section in the existing admin dashboard
  (`src/ui/admin-dashboard.ts`) listing recent agent sessions per user, with
  drill-down into a session's tool-call trail.
- **Dependencies:** A3.
- **Scope:** UI only, mirrors the existing roster/workspace-list rendering
  pattern in `src/ui/admin-dashboard.ts`.
- **Likely files:** `src/ui/admin-dashboard.ts`, `src/admin/client.ts`.
- **Non-goals:** No new visual design system — match the existing dashboard's
  look exactly.
- **Risk level:** Low (pure UI, same pattern as an already-shipped feature).
- **Migration impact:** None.
- **Deployment impact:** None beyond A2/A3's flag.
- **Human action required:** None.
- **Required tests:** Pure render tests mirroring `src/ui/admin-dashboard.test.ts`.
- **Acceptance criteria:** Visually and behaviorally consistent with the
  existing dashboard; escapes untrusted text (tool names, session ids) exactly
  like the roster rendering does.

### A6 — Tests, docs, gate, rollout

- **Outcome:** Full gate green; `docs/HANDOFF.md`/`docs/ROADMAP.md` truth-up
  marking the initiative implemented in this PR. Merge and production
  deploy are human-only — this implementing agent must not merge or
  deploy. Because `ANALYTICS_ENABLED` was reused (already on), a later
  human deploy is a normal gated deploy with no bootstrap-then-activate
  ceremony.
- **Dependencies:** A4, A5.
- **Scope:** Standard closeout packet (docs + gate), mirrors every prior
  initiative's final packet in this repo's history except merge/deploy.
- **Likely files:** `docs/HANDOFF.md`, `docs/ROADMAP.md`.
- **Non-goals:** Merge, production deploy, or any new Durable Object /
  migration.
- **Risk level:** Low.
- **Migration impact:** None (per this initiative's design).
- **Deployment impact:** A later human-approved gated deploy; no
  bootstrap-then-activate ceremony — `ANALYTICS_ENABLED` was reused and is
  already on.
- **Human action required:** Review/merge this PR, then approve the
  production deploy (standard). The implementing agent does not merge or
  deploy.
- **Required tests:** Full existing gate stays green plus everything added in
  A1–A5.
- **Acceptance criteria:** Code + docs land in one reviewable PR. After a
  human merge and deploy, the owner can see "what has my agent been doing"
  end-to-end in production.

**Testing strategy:** Pure-logic packets (A1) are locally testable without
workerd; DO-touching packets (A2, A3) need the Miniflare harness (CI-only,
per this repo's established pattern — write tests that at least parse/compile
locally even though they only execute in CI).

**Deferred work:** An MCP-facing tool for an agent to read its own activity
trail (plausible follow-on, not required for the owner-visibility goal this
initiative targets); long-term/unbounded activity retention (explicitly
evidence-triggered — see `ROADMAP.md`).

---

## Initiative B — Guided topology briefs and semantic templates

**Goal:** Replace "pick one of 6 static templates" with a structured "brief"
(archetype + parameters) that compiles into a scaffolded, validated starting
document — usable identically by a human (a form) and an agent (an MCP tool).

**Current baseline:** `list_templates`/`create_from_template` are static,
unparameterized fixtures (confirmed in the MCP/connector audit). The
capability catalog (`src/api/catalog.ts`) and the fluent builder
(`src/api/builder.ts`) already provide everything a compiler would need to
target. The authoring-profile learner already has an archetype taxonomy
(`src/profile/features.ts`) worth reusing for naming consistency rather than
inventing a second one.

**Dependencies:** None on other initiatives; soft dependency on N3.

**Architecture:** A "brief" is a structured input: `{archetype, params}`
where `archetype` reuses (or closely aligns with) the existing profile
feature-extraction archetype vocabulary, and `params` is archetype-specific
(site count, tiers, security posture flags). A "semantic template" is a pure
function `(brief) => DocumentBuilder program`, replacing today's static JSON
fixtures with parametric generators — each one calls `src/api/builder.ts`,
then `layout_topology`/`tidy_topology`, then `validateDocument`/`analyzeLayout`
as a hard gate before returning. This exact "compile → layout → validate"
shape already exists once in this codebase (`compileFlowTopology` in
`src/connect/compile.ts`) — B-series's compiler should follow that precedent,
not invent a new one.

**Implementation packets:**

### B1 — Brief contract types

- **Outcome:** `src/briefs/model.ts` defines the `TopologyBrief` type
  (archetype enum + per-archetype params), aligned with
  `src/profile/features.ts`'s existing archetype taxonomy.
- **Dependencies:** None.
- **Scope:** Pure types only.
- **Likely files:** `src/briefs/model.ts` (new).
- **Non-goals:** No compiler logic yet.
- **Risk level:** Low.
- **Migration impact:** None.
- **Deployment impact:** None.
- **Human action required:** None.
- **Required tests:** Type-level only (compiles); no runtime test needed for
  pure types with no logic.
- **Acceptance criteria:** Archetype enum values match or cleanly map to
  `src/profile/features.ts`'s taxonomy (confirm no naming collision/drift
  between the two systems).

### B2 — Semantic template compiler (3 initial archetypes)

- **Outcome:** A pure `compileBrief(brief): Document` function covering the 3
  archetypes that already have static templates (hub-spoke, spine-leaf,
  three-tier-DMZ), each parametric (e.g., hub-spoke takes a site count,
  three-tier-DMZ takes a "with firewall inspection" flag).
- **Dependencies:** B1.
- **Scope:** `src/briefs/compile.ts`, one generator function per archetype.
- **Likely files:** `src/briefs/compile.ts` (new), `src/briefs/archetypes/*.ts`
  (new, one file per archetype for readability).
- **Non-goals:** No MCP or GUI surface yet (B3/B4); no archetypes beyond the
  initial 3 (B5).
- **Risk level:** Medium — this is genuinely new generative logic; get the
  compile→layout→validate discipline right here since every later archetype
  copies this pattern.
- **Migration impact:** None.
- **Deployment impact:** None.
- **Human action required:** None.
- **Required tests:** For each archetype: brief → document → assert
  `validateDocument`/`analyzeLayout` both return clean (this is the core
  acceptance property — a brief-compiled document must never need manual
  cleanup), plus parameter-variation tests (e.g., site count 2 vs. 6 produces
  the right node count).
- **Acceptance criteria:** `compileBrief` is pure, deterministic (same brief
  → byte-identical document, mirroring the flow compiler's determinism), and
  every output passes validation with zero warnings.

### B3 — MCP tool `create_from_brief`

- **Outcome:** A new MCP tool taking a `TopologyBrief` (Zod schema) and
  returning a `topologyId`, mirroring `create_from_template`'s existing
  shape and registration pattern.
- **Dependencies:** B2.
- **Scope:** Wire `compileBrief` into `src/mcp/tools.ts`.
- **Likely files:** `src/mcp/tools.ts`, `src/mcp/README.md` (tool table —
  the existing sync test will force this).
- **Non-goals:** No changes to `create_from_template` (keep both — a brief is
  additive, not a replacement for the fixed templates).
- **Risk level:** Low (additive tool, same registration pattern as every
  other tool).
- **Migration impact:** None.
- **Deployment impact:** None (always-registered, like `create_from_template`).
- **Human action required:** None.
- **Required tests:** Tool-registration test (name appears, Zod schema
  round-trips); `src/mcp/tools.test.ts`'s README-sync test will fail loudly
  if the README isn't updated — treat that as the acceptance gate it already
  is for every other tool.
- **Acceptance criteria:** An agent can call `create_from_brief` and get back
  a validated, laid-out document in one round trip.

### B4 — GUI "New from brief" wizard

- **Outcome:** A form-based wizard in the app (archetype picker + parameter
  fields) that calls the same `compileBrief` function headlessly — no
  duplicated compiler logic between MCP and GUI.
- **Dependencies:** B2 (not B3 — the GUI can call `compileBrief` directly,
  it doesn't need to go through the MCP tool).
- **Scope:** New UI module, likely `src/ui/brief-wizard.ts`, wired into the
  existing "new document" entry point in `src/main.ts`.
- **Likely files:** `src/ui/brief-wizard.ts` (new), `src/main.ts`.
- **Non-goals:** No redesign of the existing template picker — the wizard is
  a new, additional entry point.
- **Risk level:** Low.
- **Migration impact:** None.
- **Deployment impact:** None.
- **Human action required:** None.
- **Required tests:** Pure render tests for the wizard form states, mirroring
  the panel-testing pattern used throughout `src/ui/*.test.ts`.
- **Acceptance criteria:** A human can produce the same document a
  `create_from_brief` MCP call would, through the GUI.

### B5 — Expand archetype coverage

- **Outcome:** Additional archetypes beyond the initial 3 (SD-WAN/SASE and
  any others with demonstrated demand), following B2's established pattern.
- **Dependencies:** B2 (parallel-friendly with B3/B4 once B2's pattern is
  proven).
- **Scope:** One generator file per new archetype.
- **Likely files:** `src/briefs/archetypes/*.ts`.
- **Non-goals:** None beyond what B2 already excluded.
- **Risk level:** Low (repeating an established pattern).
- **Migration impact:** None.
- **Deployment impact:** None.
- **Human action required:** None.
- **Required tests:** Same shape as B2's per-archetype tests.
- **Acceptance criteria:** Same as B2, per new archetype.

### B6 — Validation guardrails as an explicit acceptance gate

- **Outcome:** A repo-wide test asserting every registered archetype's
  compiler output passes `validateDocument`/`analyzeLayout` cleanly — a
  parity test in the same spirit as `src/api/catalog.test.ts`'s catalog
  coverage test, so a future archetype addition can't accidentally ship
  broken.
- **Dependencies:** B3, B4.
- **Scope:** One new test file iterating every registered archetype.
- **Likely files:** `src/briefs/compile.test.ts` (extend or add a parity
  section).
- **Non-goals:** None.
- **Risk level:** Low.
- **Migration impact:** None.
- **Deployment impact:** None.
- **Human action required:** None.
- **Required tests:** The parity test itself.
- **Acceptance criteria:** The test fails loudly if any archetype's output
  has a validation/layout warning.

### B7 — Tests, docs, gate, rollout

- **Outcome:** Full gate green; `docs/HANDOFF.md`/`docs/ROADMAP.md` truth-up;
  PR merged and deployed (no flag needed — always-on, additive tool/UI).
- **Dependencies:** B5, B6.
- **Scope:** Standard closeout packet.
- **Likely files:** `docs/HANDOFF.md`, `docs/ROADMAP.md`.
- **Non-goals:** None.
- **Risk level:** Low.
- **Migration impact:** None.
- **Deployment impact:** Normal gated deploy.
- **Human action required:** Approve the production deploy (standard).
- **Required tests:** Full gate.
- **Acceptance criteria:** A human or agent can go from "describe what I
  want" to a validated starting topology in one step, in both the GUI and
  over MCP.

**Testing strategy:** Entirely local-testable (pure compiler functions, no
Durable Object involvement) — a genuinely easy initiative to develop against
compared to A/E/T, which all touch worker/DO code somewhere.

**Deferred work:** Reusable/shareable component libraries (parameterized
sub-topologies a user can save and reuse) — noted in `ROADMAP.md` §"Next" as
a natural follow-on once the brief contract exists, not in scope here.

---

## Initiative E — EdgeConnect live-import hardening and UI

**Goal:** Verify the EdgeConnect provider against real/recorded data (closing
the "integration-unverified" gap the audit found), add explicit safeguards
against the "transient failure looks like deletion" failure mode, and give a
human a GUI path to trigger and review a live import (today it's
MCP-tool-only, and requires provider configuration whose deployed state is not
visible in this repository).

**Current baseline:** `src/connect/edgeconnect.ts` is a real HTTP client
against the HPE Aruba EdgeConnect Orchestrator REST API, tested only via an
injectable mock `fetchImpl` — never against a real or recorded live payload.
The repository cannot reveal whether a deployment currently has
`ORCH_BASE_URL`/`ORCH_API_KEY` provisioned, so activation must be verified from
the deployed tool list and operator evidence. The flow compiler
(`src/connect/compile.ts`) is tested and uses
`upsertBySource` throughout for convergent re-import.

**Dependencies:** None on other initiatives; T-series has a soft dependency
on E2 specifically (shared-file hotspot on `compile.ts`).

**Architecture:** No new abstractions — this initiative hardens and exposes
what already exists rather than building new provider machinery.

**Implementation packets:**

### E1 — Recorded-fixture verification

- **Outcome:** `EdgeConnectProvider` is exercised against a realistic
  recorded (or carefully hand-constructed, if no real Orchestrator access
  exists) fixture set covering the field-name variance its own code comments
  already flag as a risk ("release-dependent... to be pinned against
  recorded fixtures").
- **Dependencies:** None.
- **Scope:** New fixture files + tests using the existing injectable
  `fetchImpl` seam.
- **Likely files:** `src/connect/edgeconnect.test.ts` (extend), new fixture
  JSON under `fixtures/edgeconnect/`.
- **Non-goals:** No changes to `edgeconnect.ts`'s actual field-normalization
  logic unless the fixtures reveal a real bug.
- **Risk level:** Low (test-only, unless it reveals and requires fixing a
  real normalization bug — treat that as an in-scope fix, small and
  well-contained).
- **Migration impact:** None.
- **Deployment impact:** None.
- **Human action required:** Ideally, access to a real Orchestrator's API
  responses (even anonymized) to build genuinely representative fixtures —
  flag this as a request if no such access exists; hand-constructed fixtures
  are the fallback, clearly labeled as such.
- **Required tests:** The fixture-driven tests themselves.
- **Acceptance criteria:** `edgeconnect.ts`'s own "to be pinned against
  recorded fixtures" comment can be updated to reference the fixtures that
  now exist, or removed if fully satisfied.

### E2 — No-delete-on-transient-failure safeguard + test

- **Outcome:** An explicit test proving a failed or empty provider fetch
  never causes `compileFabric`/`compileFlow`/`upsertBySource` to remove
  previously-compiled elements — codifying the "Deliberately Excluded"
  principle from `ROADMAP.md` as an enforced behavior, not just a stated
  intent.
- **Dependencies:** None.
- **Scope:** Audit `src/connect/compile.ts`'s call sites for any implicit
  "absence means delete" logic; add the explicit regression test either way.
- **Likely files:** `src/connect/compile.ts` (only if the audit finds an
  actual gap — otherwise test-only), `src/connect/compile.test.ts`.
- **Non-goals:** No broader retry/backoff logic (that's E3).
- **Risk level:** Low if the audit confirms current behavior is already
  safe (likely, per this session's read of `upsertBySource`); Medium if it
  finds a real gap requiring a code change.
- **Migration impact:** None.
- **Deployment impact:** None.
- **Human action required:** None.
- **Required tests:** A fetch-returns-empty / fetch-throws scenario asserting
  prior compiled elements survive unchanged.
- **Acceptance criteria:** The test exists and passes; **this packet must
  land before T2 starts** (shared-file hotspot on `compile.ts`).

### E3 — Retry / partial-failure / staleness handling

- **Outcome:** `EdgeConnectProvider` surfaces a staleness signal when a
  sub-fetch fails partway through a multi-call operation, rather than
  silently returning partial data as if it were complete.
- **Dependencies:** None (can run parallel to E1/E2).
- **Scope:** `edgeconnect.ts`'s fetch orchestration.
- **Likely files:** `src/connect/edgeconnect.ts`, `src/connect/types.ts` (if
  a staleness field needs adding to a return type).
- **Non-goals:** No general-purpose retry framework — scope this to what
  EdgeConnect's own multi-call patterns (e.g., the appliance-flow-table
  proxy) actually need.
- **Risk level:** Medium (touches real request logic; get the failure-mode
  semantics right, since this directly serves the "don't misread a transient
  failure" principle E2 tests for).
- **Migration impact:** None.
- **Deployment impact:** None.
- **Human action required:** None.
- **Required tests:** Injected partial-failure scenarios via the existing
  mock `fetchImpl` seam.
- **Acceptance criteria:** A partial failure is visibly distinguishable from
  a complete, fresh result by any caller.

### E4 — Live-import GUI

- **Outcome:** An authenticated HTTP route + panel letting a human trigger a
  live import into a workspace and review it as a diff before accepting —
  reusing the existing proposal-preview machinery (R1, already shipped)
  rather than inventing new diff UI.
- **Dependencies:** E1, E2, E3.
- **Scope:** New route wrapping `compileFlowTopology`, presented through the
  workspace panel's existing proposal-review flow.
- **Likely files:** `worker/workspace-api.ts` or a new
  `worker/live-import-api.ts`, `src/ui/workspace-panel.ts` (extend).
- **Non-goals:** No new diff-rendering component — must reuse R1's existing
  preview machinery, not fork it.
- **Risk level:** Medium (new authenticated write path, though it composes
  entirely from already-shipped, already-tested primitives — the proposal
  pipeline, the flow compiler).
- **Migration impact:** None.
- **Deployment impact:** None (uses existing workspace infrastructure).
- **Human action required:** None beyond normal review.
- **Required tests:** An end-to-end Miniflare test: trigger a live import
  against a mock provider, confirm it lands as a reviewable proposal, confirm
  accept/reject both work through the existing pipeline.
- **Acceptance criteria:** A human can go from "I have a real fabric" to "I
  can see and accept/reject a live import as a normal proposal" without
  touching MCP tools directly.

### E5 — Credential provisioning runbook

- **Outcome:** A documented procedure for provisioning `ORCH_BASE_URL`/
  `ORCH_API_KEY` as Worker secrets, plus confirmation that
  `describe_data_source` (or an extension of it) can smoke-test connectivity
  without importing anything.
- **Dependencies:** None.
- **Scope:** Documentation + a small connectivity-check enhancement to
  `describe_data_source` if it doesn't already cover this.
- **Likely files:** `docs/DEPLOYMENT_RUNBOOK.md` (new section), possibly
  `src/mcp/tools.ts` (`describe_data_source` extension).
- **Non-goals:** Do not provision real secrets in this repo's CI/CD — this
  packet documents the _procedure_ for a human operator to do so on
  **staging only**, matching this repo's established pattern of never
  activating a new capability in production without a separate, explicit
  operator decision.
- **Risk level:** Low (docs + a read-only connectivity check).
- **Migration impact:** None.
- **Deployment impact:** None until a human actually provisions the secrets.
- **Human action required:** Provisioning the actual secret values (via
  `wrangler secret put`) is 100% human-only, and should happen on staging
  first, matching every prior activation in this repo's history.
- **Required tests:** A test that `describe_data_source` behaves sanely with
  no provider configured (already covered) and with a provider configured
  but unreachable (new).
- **Acceptance criteria:** An operator can follow the runbook to stand up a
  real EdgeConnect connection on staging and verify it's working before any
  production decision.

### E6 — Staleness/freshness UI

- **Outcome:** The inspector shows "this element was last confirmed live at
  T" for provider-sourced elements, surfacing the existing `source.freshness`
  field that's already part of the contract but not yet shown anywhere.
- **Dependencies:** None (parallel-friendly with E4/E5).
- **Scope:** Inspector UI extension.
- **Likely files:** `src/main.ts` (inspector field rendering).
- **Non-goals:** No new data model — `source.freshness` already exists
  (`src/api/source.ts`); this is purely a display gap.
- **Risk level:** Low.
- **Migration impact:** None.
- **Deployment impact:** None.
- **Human action required:** None.
- **Required tests:** Pure render test for the new inspector field.
- **Acceptance criteria:** A provider-sourced element visibly shows its
  freshness in the inspector.

### E7 — Tests, docs, gate, rollout

- **Outcome:** Full gate green; docs truth-up; PR merged.
- **Dependencies:** E4, E5, E6.
- **Scope:** Standard closeout packet.
- **Likely files:** `docs/HANDOFF.md`, `docs/ROADMAP.md`.
- **Non-goals:** None.
- **Risk level:** Low.
- **Migration impact:** None.
- **Deployment impact:** Normal gated deploy.
- **Human action required:** Approve the production deploy (standard); E5's
  secret provisioning remains a separate, explicit follow-up decision, not
  bundled into this deploy.
- **Required tests:** Full gate.
- **Acceptance criteria:** The EdgeConnect provider is verified, safe against
  transient failures, and has a real GUI path — but is still not active in
  any production deployment until a human explicitly provisions credentials
  (E5), consistent with this repo's activation discipline throughout.

**Testing strategy:** E1–E3 are fully local-testable via the existing
injectable `fetchImpl` seam; E4 needs the Miniflare harness (workspace/DO
code); E5/E6 are docs/pure-UI respectively.

**Deferred work:** The second real provider implementation — decided
2026-08-20 to be **Juniper Mist** (Mist Campus Fabric + Mist WAN Assurance;
see [`decisions/0002-second-provider-juniper-mist.md`](decisions/0002-second-provider-juniper-mist.md))
— stays in `ROADMAP.md` §"Next" and is not started until this one is proven.

---

## Initiative T — Time-aware flow and failure storytelling

**Goal:** Extend the flow compiler's point-in-time snapshot into a
multi-page scenario — "before, during, and after a failure" — built entirely
on the existing flipbook contract (independent pages, no inheritance) rather
than inventing a new cross-page mechanism.

**Current baseline:** Flipbook pages are independent, full-frame documents by
design (`DESIGN.md` #1, `docs/decisions/0001-flipbook-vs-beats.md`) — this is
a hard architectural constraint T-series must respect, not work around. Flow
paths already animate per-hop. The flow compiler produces one point-in-time
snapshot per compile. Pages already have `duration`/`transition` and the
filmstrip UI already supports reordering/renaming.

**Dependencies:** E2 must land first (shared-file hotspot on
`src/connect/compile.ts`); otherwise independent of the other initiatives.

**Architecture — respecting the "no cross-page inheritance" constraint
explicitly:** A "scenario" is an ordered sequence of named steps, each fully
describing a fabric-state delta (e.g., "tunnel X down, flow Y reroutes via
Z"). The **story compiler runs the full flow compiler independently for each
step**, producing N fully-materialized, independent pages — it is a compiler
that happens to run N times and call `add_page` N times, never a mechanism
that stores steps as diffs against a base page. This is a deliberate
design choice to keep T-series compliant with `ROADMAP.md`'s "Deliberately
Excluded" list; if an implementing agent finds themselves building anything
that stores one page as a delta from another, stop — that's the excluded
pattern.

**Implementation packets:**

### T1 — Scenario contract types

- **Outcome:** `src/stories/model.ts` defines a `FlowScenario` (ordered
  named steps, each a fabric-state delta description reusing existing
  `src/connect/types.ts` shapes wherever possible).
- **Dependencies:** None (can start immediately, in parallel with
  everything).
- **Scope:** Pure types.
- **Likely files:** `src/stories/model.ts` (new).
- **Non-goals:** No compiler logic yet.
- **Risk level:** Low.
- **Migration impact:** None.
- **Deployment impact:** None.
- **Human action required:** None.
- **Required tests:** Type-level only.
- **Acceptance criteria:** Each step's delta description is expressive enough
  to represent "a tunnel goes down" and "a flow reroutes" without needing a
  future breaking change.

### T2 — Story compiler

- **Outcome:** `compileFlowStory(scenario): Document` — runs the flow
  compiler once per step, producing N independent, fully-materialized pages
  wired together via `add_page`/`set_page_properties` (duration/transition),
  never as deltas.
- **Dependencies:** T1, **and E2** (shared-file hotspot on `compile.ts` —
  land E2 first).
- **Scope:** `src/stories/compile.ts`, composing (not modifying) the existing
  `compileFlowTopology`.
- **Likely files:** `src/stories/compile.ts` (new); should not need to
  modify `src/connect/compile.ts` at all if it only calls the existing
  exported `compileFlowTopology` per step — confirm this holds, since it's
  the cleanest way to avoid the E/T hotspot entirely for everything except
  the E2 ordering.
- **Non-goals:** No cross-page delta storage (see architecture note above —
  this is the one behavior this packet must not implement).
- **Risk level:** Medium (new generative logic, though composed from
  already-tested primitives).
- **Migration impact:** None.
- **Deployment impact:** None.
- **Human action required:** None.
- **Required tests:** A 3-step scenario (before/during/after) compiles to 3
  independent, individually-valid pages; each page passes
  `validateDocument`/`analyzeLayout` on its own (same discipline as B2's
  brief compiler).
- **Acceptance criteria:** Deleting or corrupting one page in a compiled
  scenario has zero effect on the others (proves independence, not just
  by-construction claim).

### T3 — Failure-moment annotations

- **Outcome:** Visual markers for "this link is down here" / "this flow
  rerouted here" on the relevant scenario page, reusing
  `add_policy_marker`'s existing machinery (new marker types if the existing
  enum doesn't cover it) rather than inventing a new annotation kind.
- **Dependencies:** T2.
- **Scope:** Extend the policy-marker catalog if needed; wire into the story
  compiler's per-step output.
- **Likely files:** `src/api/catalog.ts` (only if new marker types are
  needed), `src/stories/compile.ts`.
- **Non-goals:** No new annotation kind unless policy markers genuinely can't
  express this (check first — `deny`/`redirect`/`log` marker types may
  already cover "link down"/"rerouted" semantically).
- **Risk level:** Low.
- **Migration impact:** None.
- **Deployment impact:** None.
- **Human action required:** None.
- **Required tests:** A scenario step with a failure produces the expected
  marker(s) on the expected element(s).
- **Acceptance criteria:** A viewer can visually identify what changed
  between two adjacent scenario pages without needing prose explanation.

### T4 — MCP tool `compile_flow_story`

- **Outcome:** A new MCP tool taking a `FlowScenario` and returning a
  `topologyId` with all scenario pages populated.
- **Dependencies:** T2.
- **Scope:** Wire `compileFlowStory` into `src/mcp/tools.ts`, mirroring
  `build_flow_topology`'s existing registration pattern (gated on
  `deps.provider`, same as every other live-fabric tool).
- **Likely files:** `src/mcp/tools.ts`, `src/mcp/README.md`.
- **Non-goals:** None beyond what T2 already excluded.
- **Risk level:** Low (additive tool, established registration pattern).
- **Migration impact:** None.
- **Deployment impact:** None (gated the same way the other 7 live-fabric
  tools already are — inert without `ORCH_*` secrets, same as today).
- **Human action required:** None.
- **Required tests:** Tool-registration test; README-sync test (existing,
  will force the table update).
- **Acceptance criteria:** An agent with live-fabric access can produce a
  multi-page failure-scenario flipbook in one call.

### T5 — GUI scenario-timeline authoring affordance

- **Outcome:** A labeling/authoring layer on the existing filmstrip UI so a
  human can see and edit scenario step names/order — no new rendering, just
  making the existing page-reorder/rename affordances scenario-aware.
- **Dependencies:** T3, T4.
- **Scope:** Small UI extension to the existing filmstrip.
- **Likely files:** `src/main.ts` (filmstrip UI).
- **Non-goals:** No new canvas/rendering work — this is purely an authoring
  affordance on data the story compiler already produced.
- **Risk level:** Low.
- **Migration impact:** None.
- **Deployment impact:** None.
- **Human action required:** None.
- **Required tests:** Pure UI test for the new labeling affordance.
- **Acceptance criteria:** A human can rename/reorder scenario steps the same
  way they already can with ordinary flipbook pages.

### T6 — Playback caption polish

- **Outcome:** `export_flipbook`'s playback bar shows each page's `name` as a
  caption during autoplay (if not already surfaced) — makes an exported
  scenario self-narrating without extra authoring work, since `Page.name` is
  already part of the contract.
- **Dependencies:** T5.
- **Scope:** Small extension to `src/render/flipbook.ts`'s playback bar, if
  the name isn't already shown.
- **Likely files:** `src/render/flipbook.ts`.
- **Non-goals:** No new narration/audio — text caption only, from existing
  data.
- **Risk level:** Low.
- **Migration impact:** None.
- **Deployment impact:** None.
- **Human action required:** None.
- **Required tests:** Export a scenario, confirm the caption appears in the
  generated HTML.
- **Acceptance criteria:** An exported failure-scenario flipbook is
  understandable standalone (no accompanying prose needed) because each page
  is captioned.

### T7 — Tests, docs, gate, rollout

- **Outcome:** Full gate green; docs truth-up; PR merged.
- **Dependencies:** T6.
- **Scope:** Standard closeout packet.
- **Likely files:** `docs/HANDOFF.md`, `docs/ROADMAP.md`.
- **Non-goals:** None.
- **Risk level:** Low.
- **Migration impact:** None.
- **Deployment impact:** Normal gated deploy; inert until `ORCH_*` secrets
  exist (same posture as E-series/the existing live-fabric tools).
- **Human action required:** Approve the production deploy (standard).
- **Required tests:** Full gate.
- **Acceptance criteria:** A human or agent with live-fabric access can
  produce and play back a self-narrating "before/during/after a failure"
  flipbook.

**Testing strategy:** T1–T3 are fully local-testable (pure compiler
functions composing already-tested primitives); T4 needs the same MCP
tool-registration test pattern as every other tool; T5/T6 are pure UI.

**Deferred work:** Live, real-time scenario replay (as opposed to a
pre-compiled flipbook) — a materially different and much larger feature
(would need streaming flow data, not point-in-time compiles); not proposed
here and would need its own evidence-triggered justification.

---

## Packet register (flat index)

_Full specs are in each initiative's section above; this is a cross-reference
index only._

| Packet | Initiative        | Depends on | Migration? | New flag/tool/secret?      | Human action?                                                      |
| ------ | ----------------- | ---------- | ---------- | -------------------------- | ------------------------------------------------------------------ |
| N1     | Docs reset        | —          | No         | No                         | No — **done**                                                      |
| N2     | Docs reset        | N1         | No         | No                         | No — **done**                                                      |
| N3     | Docs reset        | N2         | No         | No                         | **Done**                                                           |
| O1     | Alerting/game day | —          | No         | No                         | **Yes, 100%**                                                      |
| O2     | Alerting/game day | O3         | No         | No                         | **Yes, significant**                                               |
| O3     | Alerting/game day | —          | No         | No                         | No                                                                 |
| A1     | Explainability    | —          | No         | Reused `ANALYTICS_ENABLED` | No — **implemented this PR**                                       |
| A2     | Explainability    | A1         | No         | No                         | No — **implemented this PR**                                       |
| A3     | Explainability    | A2         | No         | No                         | No — **implemented this PR**                                       |
| A4     | Explainability    | A3         | No         | No                         | No — **implemented this PR**                                       |
| A5     | Explainability    | A3         | No         | No                         | No — **implemented this PR**                                       |
| A6     | Explainability    | A4, A5     | No         | No                         | Merge/deploy approval — **code+docs this PR; do not merge/deploy** |
| B1     | Briefs/templates  | —          | No         | No                         | No                                                                 |
| B2     | Briefs/templates  | B1         | No         | No                         | No                                                                 |
| B3     | Briefs/templates  | B2         | No         | New tool                   | No                                                                 |
| B4     | Briefs/templates  | B2         | No         | No                         | No                                                                 |
| B5     | Briefs/templates  | B2         | No         | No                         | No                                                                 |
| B6     | Briefs/templates  | B3, B4     | No         | No                         | No                                                                 |
| B7     | Briefs/templates  | B5, B6     | No         | No                         | Deploy approval                                                    |
| E1     | EdgeConnect       | —          | No         | No                         | Real API access, ideally                                           |
| E2     | EdgeConnect       | —          | No         | No                         | No                                                                 |
| E3     | EdgeConnect       | —          | No         | No                         | No                                                                 |
| E4     | EdgeConnect       | E1, E2, E3 | No         | No                         | No                                                                 |
| E5     | EdgeConnect       | —          | No         | New secret (staging)       | **Yes, 100%**                                                      |
| E6     | EdgeConnect       | —          | No         | No                         | No                                                                 |
| E7     | EdgeConnect       | E4, E5, E6 | No         | No                         | Deploy approval                                                    |
| T1     | Storytelling      | —          | No         | No                         | No                                                                 |
| T2     | Storytelling      | T1, **E2** | No         | No                         | No                                                                 |
| T3     | Storytelling      | T2         | No         | No                         | No                                                                 |
| T4     | Storytelling      | T2         | No         | New tool                   | No                                                                 |
| T5     | Storytelling      | T3, T4     | No         | No                         | No                                                                 |
| T6     | Storytelling      | T5         | No         | No                         | No                                                                 |
| T7     | Storytelling      | T6         | No         | No                         | Deploy approval                                                    |

## Risk register (cross-cutting)

Beyond each packet's individual risk level:

| Risk                                                                                                               | Likelihood | Impact                                                    | Mitigation                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------ | ---------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| An implementing agent discovers A4's "additive field" on agent revisions actually requires a schema/migration bump | Low        | High (migrations are this repo's highest-ceremony change) | Explicit stop-and-confirm instruction at the top of A4 and at the top of this document                                                          |
| E3/T2 concurrent edits to `src/connect/compile.ts` cause merge conflicts                                           | Medium     | Low (conflict, not correctness)                           | Explicit hotspot table + hard T2-after-E2 dependency                                                                                            |
| B-series or T-series archetype/scenario compilers silently ship a document with layout warnings                    | Medium     | Medium (defeats the "always clean" value proposition)     | B6 and T2's acceptance criteria both make "zero warnings" an explicit, tested gate                                                              |
| O2 (game day) is run against production instead of staging by mistake                                              | Low        | Critical                                                  | O2's scope explicitly states "staging only"; this mirrors the existing, already-proven ROLLBACK.md discipline                                   |
| E5's credential provisioning accidentally targets production                                                       | Low        | High                                                      | E5 explicitly scopes to staging-only; matches this repo's established pattern (every flag activation in this repo's history went staging-first) |
| Flag sprawl (A-series introduces a new flag instead of reusing `ANALYTICS_ENABLED`)                                | Medium     | Low                                                       | A1 explicitly recommends reuse and frames the alternative as an "open decision," not a default                                                  |

## Human/operator prerequisite list

Consolidated from every packet above:

1. **O1** — Configure Cloudflare Notification policies (dashboard action).
2. **O2** — Execute and observe the staging forward-recovery game day.
3. **E1** — Ideally, provide (even anonymized) real Orchestrator API
   responses for fixture-building; otherwise hand-constructed fixtures are
   used with that limitation documented.
4. **E5** — Provision `ORCH_BASE_URL`/`ORCH_API_KEY` as staging Worker
   secrets via `wrangler secret put --env staging` — a deliberate, separate
   decision, never bundled into a feature-shipping deploy.
5. **Every initiative's final packet (N3, A6, B7, E7, T7)** — approve the
   production deploy through the existing protected-environment gate (no
   different from any prior packet in this repo's history).

None of these require inventing new process — every one matches a pattern
this repo has already executed successfully (staging-first activation,
protected production approval, a documented drill before trusting a
recovery procedure).
