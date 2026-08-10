# Packet-ready issue descriptions

Issue-ready Markdown for every not-yet-started packet in
[`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) (N1–N3 are complete; see
that document). Each block below is
formatted to paste directly into a new GitHub issue if/when this repo starts
using Issues as a tracking tool.

**Why these are templates rather than live GitHub issues:** planning in this
repository has historically lived in `docs/`. Opening the full packet set would
introduce a different tracking workflow. Revalidate a packet against current
code and the roadmap before copying it into any tracker.

Full context (architecture, dependency graph, hotspots, risk register) for
every packet below lives in `IMPLEMENTATION_PLAN.md`; this file trades that
context for a template a tracker expects.

---

## O1 — Configure Cloudflare alerting

**Problem:** The repository cannot verify current Cloudflare notification
policy state or delivery. The exact thresholds are documented
(`DEPLOYMENT_RUNBOOK.md` §"Rate-based stops"/"Hard stops"), but an operator
must inspect/configure the policies and attach a delivered-test record.

**Outcome:** Cloudflare Notification policies exist matching those
thresholds, routed to the owner's email; `DEPLOYMENT_RUNBOOK.md` is updated
with the actual configured policy names/ids.

**Scope:** Cloudflare dashboard configuration (or API scripting of the
same); a small runbook update.

**Non-goals:** No new code-side monitoring/instrumentation.

**Dependencies:** None — can start immediately.

**Acceptance criteria:** `docs/HANDOFF.md` operator checklist item O12 flips
from "◑ Partial" to "✅ done," citing the configured policy.

**Test requirements:** None (not code). Verify by triggering a synthetic
error spike against **staging** and confirming the alert fires.

**Deployment and migration notes:** None.

**Human approval requirements:** 100% human — this is a Cloudflare dashboard
action no agent can complete.

---

## O2 — Staging forward-recovery game day

**Problem:** `docs/ROLLBACK.md`'s "Staging game day" procedure has never been
executed and recorded as a single dated exercise against the current
(`v3`–`v5`) system, only against `v4` in isolation.

**Outcome:** A dated, recorded execution of the full 8-step checklist.

**Scope:** Deploy known-good staging → create a disposable draft →
deliberately deploy broken workspace behavior → confirm forward recovery →
re-enable → record the result.

**Non-goals:** No code changes beyond whatever the drill's "deliberately
broken" deploy requires (should be a flag flip, not new code).

**Dependencies:** O3 (rollback doc should be accurate first).

**Acceptance criteria:** A dated completion record exists matching the
checklist in `docs/ROLLBACK.md`.

**Test requirements:** The drill itself is the test.

**Deployment and migration notes:** Staging only — never run this against
production.

**Human approval requirements:** Significant — a human operator must observe
and confirm each step live.

---

## O3 — Generalize `docs/ROLLBACK.md` beyond `v3`

**Problem:** `docs/ROLLBACK.md`'s worked examples and game-day checklist
reference only migration `v3`, even though `v4` and `v5` have since shipped
with their own gate sequences documented in `DEPLOYMENT_RUNBOOK.md`.

**Outcome:** `docs/ROLLBACK.md`'s language generalizes to the current
migration set or a genuinely migration-agnostic template.

**Scope:** Small doc edit.

**Non-goals:** No process changes — the forward-only recovery principle is
unchanged.

**Dependencies:** None.

**Acceptance criteria:** `docs/ROLLBACK.md` no longer implies `v3` is the
only or latest migration.

**Test requirements:** None.

**Deployment and migration notes:** None.

**Human approval requirements:** None beyond normal PR review.

---

## A1 — Agent-session activity data model

**Problem:** No structured model exists for "what did an agent do in an MCP
session" — needed before anything can be recorded or displayed.

**Outcome:** Pure types + pure shaping/eviction helpers for a bounded
per-session tool-call trail and a bounded per-owner session index, mirroring
`src/admin/roster.ts`'s existing split (pure helpers, unit-tested; the DO is
a thin shell).

**Scope:** `src/agent-activity/model.ts`, `src/agent-activity/trail.ts` (new).

**Non-goals:** No raw prompt/argument logging — tool name, timestamp, and a
coarse outcome only.

**Dependencies:** None.

**Acceptance criteria:** Pure, deterministic, 100% locally testable (no
workerd needed).

**Test requirements:** Ring-buffer append/evict bounds; index upsert
(first-seen vs. returning) — mirror `src/admin/roster.test.ts`.

**Deployment and migration notes:** None — and **this initiative is
specifically designed to avoid a new migration** (see A1's "open decision" in
`IMPLEMENTATION_PLAN.md`: reuse `AnalyticsLog`, migration `v5`, already
live). Flag this design choice for review before implementing A2.

**Human approval requirements:** None beyond normal PR review.

---

## A2 — Instrument `TopologyMcp` session lifecycle + tool dispatch

**Problem:** `TopologyMcp` records nothing beyond its in-memory document
store today — no session start/end, no tool-call trail.

**Outcome:** Every remote MCP tool call appends a bounded event to its own
session DO's storage; session start appends to the owner's `AnalyticsLog`
session index — best-effort, `ctx.waitUntil`, never blocking a tool call.

**Scope:** Wire A1's helpers into `worker/mcp.ts`'s `init()` and tool
dispatch.

**Non-goals:** No behavior change to any existing tool's response.

**Dependencies:** A1.

**Acceptance criteria:** No existing MCP tool test's expected output
changes; a new test proves the trail is recorded.

**Test requirements:** A Miniflare test proving a tool call still succeeds
and returns unchanged output even if activity recording is made to
fail/throw internally.

**Deployment and migration notes:** No new migration. Gated by whichever
flag A1 settled on (recommended: reuse `ANALYTICS_ENABLED`).

**Human approval requirements:** Normal PR review + deploy approval.

---

## A3 — Owner-gated read API for agent sessions

**Problem:** No route exists to list or inspect recorded agent-session
activity.

**Outcome:** `GET /api/admin/sessions` and `GET /api/admin/sessions/:id`,
mirroring `worker/admin-api.ts`'s existing gate pattern exactly.

**Scope:** New routes in `worker/admin-api.ts` or a sibling file.

**Non-goals:** No MCP-facing read tool for this data in this packet.

**Dependencies:** A2.

**Acceptance criteria:** Same fail-closed guarantees as the existing admin
API, verified by tests.

**Test requirements:** Mirror `src/testing/admin-api.test.ts` (401 unauth,
403 non-admin, 200 for the owner).

**Deployment and migration notes:** No new migration.

**Human approval requirements:** Normal PR review + deploy approval.

---

## A4 — Explainability linkage on the revision timeline

**Problem:** A workspace revision made by an agent shows no signal of
whether the agent consulted authoring guidance before making it.

**Outcome:** A revision-timeline entry shows whether `get_authoring_guidance`
was called earlier in the same MCP session — an honest "guidance was
consulted" signal, never a causal claim.

**Scope:** Cross-reference a revision's session id against that session's
tool-call trail; may require adding a `sessionId` field to agent-actor
metadata on revisions/proposals (additive, not a schema version bump — if
implementation reveals it needs to be one, stop and confirm with a human
first, per `IMPLEMENTATION_PLAN.md`'s top-level migration warning).

**Non-goals:** No causal inference beyond "tool X was called before this
commit in the same session."

**Dependencies:** A3.

**Acceptance criteria:** The signal is visibly present and provably accurate
against test cases (with and without a prior guidance call).

**Test requirements:** A workspace-level test proving both cases.

**Deployment and migration notes:** No new migration expected; verify this
holds during implementation.

**Human approval requirements:** Normal PR review + deploy approval. This
one touches `worker/document.ts`, a sensitive/well-tested file — extra
scrutiny warranted.

---

## A5 — Admin dashboard "Agent Sessions" UI

**Problem:** No UI surfaces agent-session activity even once it's recorded
and readable via API.

**Outcome:** A new tab/section in the existing admin dashboard listing
recent agent sessions per user, with drill-down into a session's trail.

**Scope:** `src/ui/admin-dashboard.ts`, `src/admin/client.ts`.

**Non-goals:** No new visual design system — match the existing dashboard.

**Dependencies:** A3.

**Acceptance criteria:** Visually/behaviorally consistent with the existing
dashboard; escapes untrusted text exactly like the roster rendering does.

**Test requirements:** Pure render tests mirroring
`src/ui/admin-dashboard.test.ts`.

**Deployment and migration notes:** None.

**Human approval requirements:** Normal PR review + deploy approval.

---

## A6 — Agent activity: tests, docs, gate, rollout

**Problem:** N/A — closeout packet.

**Outcome:** Full gate green; `docs/HANDOFF.md`/`docs/ROADMAP.md` truth-up;
PR merged and deployed.

**Scope:** Standard closeout.

**Dependencies:** A4, A5.

**Acceptance criteria:** Owner can see "what has my agent been doing"
end-to-end in production.

**Test requirements:** Full existing gate stays green plus everything added
in A1–A5.

**Deployment and migration notes:** A normal gated deploy; no
bootstrap-then-activate ceremony needed if `ANALYTICS_ENABLED` was reused
(it's already on).

**Human approval requirements:** Approve the production deploy (standard).

---

## B1 — Brief contract types

**Problem:** No structured "describe the topology you want" contract exists
— today's `create_from_template` is 6 static, unparameterized fixtures.

**Outcome:** `src/briefs/model.ts` defines a `TopologyBrief` type (archetype

- params), aligned with `src/profile/features.ts`'s existing archetype
  taxonomy.

**Scope:** Pure types only.

**Non-goals:** No compiler logic yet.

**Dependencies:** None.

**Acceptance criteria:** Archetype enum values map cleanly to
`src/profile/features.ts`'s taxonomy with no naming collision.

**Test requirements:** Type-level only.

**Deployment and migration notes:** None.

**Human approval requirements:** Normal PR review.

---

## B2 — Semantic template compiler (3 initial archetypes)

**Problem:** No parametric generator exists for any archetype — templates
today are fixed JSON, not compiled from parameters.

**Outcome:** A pure `compileBrief(brief): Document` covering hub-spoke,
spine-leaf, and three-tier-DMZ, each genuinely parametric.

**Scope:** `src/briefs/compile.ts`, one generator per archetype.

**Non-goals:** No MCP/GUI surface yet; no archetypes beyond the initial 3.

**Dependencies:** B1.

**Acceptance criteria:** `compileBrief` is pure and deterministic; every
output passes `validateDocument`/`analyzeLayout` with zero warnings.

**Test requirements:** Per archetype: brief → document → clean validation;
parameter-variation tests.

**Deployment and migration notes:** None.

**Human approval requirements:** Normal PR review — this is genuinely new
generative logic, worth a careful read.

---

## B3 — MCP tool `create_from_brief`

**Problem:** No MCP tool exists for an agent to author from a structured
brief.

**Outcome:** A new tool taking a `TopologyBrief` (Zod schema), returning a
`topologyId`, mirroring `create_from_template`'s registration pattern.

**Scope:** `src/mcp/tools.ts`, `src/mcp/README.md`.

**Non-goals:** No changes to `create_from_template` — additive, not a
replacement.

**Dependencies:** B2.

**Acceptance criteria:** An agent can call `create_from_brief` and get back
a validated, laid-out document in one round trip.

**Test requirements:** Tool-registration test; the existing README-sync
test will force the table update.

**Deployment and migration notes:** None — always-registered tool.

**Human approval requirements:** Normal PR review.

---

## B4 — GUI "New from brief" wizard

**Problem:** No GUI path exists for a human to author from a structured
brief — only the static template picker.

**Outcome:** A form wizard calling the same `compileBrief` function
headlessly, no duplicated logic between MCP and GUI.

**Scope:** `src/ui/brief-wizard.ts` (new), wired into `src/main.ts`.

**Non-goals:** No redesign of the existing template picker.

**Dependencies:** B2 (not B3).

**Acceptance criteria:** A human can produce the same document a
`create_from_brief` MCP call would.

**Test requirements:** Pure render tests for the wizard form states.

**Deployment and migration notes:** None.

**Human approval requirements:** Normal PR review.

---

## B5 — Expand archetype coverage

**Problem:** Only 3 archetypes are covered after B2.

**Outcome:** Additional archetypes (SD-WAN/SASE and others with demonstrated
demand), following B2's established pattern.

**Scope:** One generator file per new archetype.

**Non-goals:** None beyond what B2 already excluded.

**Dependencies:** B2 (parallel-friendly with B3/B4).

**Acceptance criteria:** Same as B2, per new archetype.

**Test requirements:** Same shape as B2's per-archetype tests.

**Deployment and migration notes:** None.

**Human approval requirements:** Normal PR review.

---

## B6 — Validation guardrails as an explicit acceptance gate

**Problem:** No parity test exists asserting every archetype's compiler
output is always clean — a future archetype addition could ship broken
silently.

**Outcome:** A repo-wide test iterating every registered archetype, asserting
clean validation/layout, mirroring `src/api/catalog.test.ts`'s coverage test.

**Scope:** `src/briefs/compile.test.ts` (extend or add).

**Non-goals:** None.

**Dependencies:** B3, B4.

**Acceptance criteria:** The test fails loudly if any archetype's output has
a validation/layout warning.

**Test requirements:** The parity test itself.

**Deployment and migration notes:** None.

**Human approval requirements:** Normal PR review.

---

## B7 — Guided briefs: tests, docs, gate, rollout

**Problem:** N/A — closeout packet.

**Outcome:** Full gate green; docs truth-up; PR merged and deployed.

**Scope:** Standard closeout.

**Dependencies:** B5, B6.

**Acceptance criteria:** A human or agent can go from "describe what I want"
to a validated starting topology in one step, in both GUI and MCP.

**Test requirements:** Full gate.

**Deployment and migration notes:** No flag needed — always-on, additive
tool/UI.

**Human approval requirements:** Approve the production deploy (standard).

---

## E1 — EdgeConnect recorded-fixture verification

**Problem:** `EdgeConnectProvider` has only ever been tested against an
injectable mock `fetchImpl`, never a real or recorded Orchestrator payload —
its own code comment flags this as an open risk.

**Outcome:** The provider is exercised against a realistic recorded (or
carefully hand-constructed, if no real access exists) fixture set.

**Scope:** New fixture files + tests using the existing injectable seam.

**Non-goals:** No changes to field-normalization logic unless fixtures
reveal a real bug.

**Dependencies:** None.

**Acceptance criteria:** The "to be pinned against recorded fixtures"
comment in `src/connect/edgeconnect.ts` can be updated or removed.

**Test requirements:** Fixture-driven tests.

**Deployment and migration notes:** None.

**Human approval requirements:** Ideally, access to real (even anonymized)
Orchestrator API responses — flag as a request if unavailable; hand-built
fixtures are the documented fallback.

---

## E2 — No-delete-on-transient-failure safeguard + test

**Problem:** No explicit test proves a failed/empty provider fetch can't
cause `compileFabric`/`compileFlow` to delete previously-compiled elements —
only an architectural intent, not an enforced behavior.

**Outcome:** An explicit regression test codifying this; a code fix only if
the audit finds an actual gap (unlikely — `upsertBySource` appears already
safe).

**Scope:** Audit `src/connect/compile.ts` call sites; add the test either
way.

**Non-goals:** No broader retry/backoff logic (that's E3).

**Dependencies:** None.

**Acceptance criteria:** The test exists and passes.

**Test requirements:** A fetch-returns-empty / fetch-throws scenario
asserting prior elements survive unchanged.

**Deployment and migration notes:** None. **This packet must land before
`IMPLEMENTATION_PLAN.md` packet T2 starts** — both touch
`src/connect/compile.ts`.

**Human approval requirements:** Normal PR review.

---

## E3 — Retry / partial-failure / staleness handling

**Problem:** A multi-call fetch failing partway through today may silently
return partial data indistinguishable from a complete result.

**Outcome:** `EdgeConnectProvider` surfaces a staleness signal on partial
failure instead of silent partial data.

**Scope:** `edgeconnect.ts`'s fetch orchestration.

**Non-goals:** No general-purpose retry framework.

**Dependencies:** None (parallel to E1/E2).

**Acceptance criteria:** A partial failure is visibly distinguishable from a
complete, fresh result by any caller.

**Test requirements:** Injected partial-failure scenarios via the mock
`fetchImpl` seam.

**Deployment and migration notes:** None.

**Human approval requirements:** Normal PR review.

---

## E4 — Live-import GUI

**Problem:** Live fabric import is MCP-tool-only today — no GUI path for a
human to trigger/review one.

**Outcome:** An authenticated route + panel letting a human trigger a live
import and review it as a diff before accepting, reusing the existing
proposal-preview machinery (already shipped, R1).

**Scope:** New route wrapping `compileFlowTopology`; extends
`src/ui/workspace-panel.ts`'s existing proposal-review flow.

**Non-goals:** No new diff-rendering component — must reuse R1's preview,
not fork it.

**Dependencies:** E1, E2, E3.

**Acceptance criteria:** A human can go from "I have a real fabric" to
"I can see and accept/reject a live import as a normal proposal" without
touching MCP tools directly.

**Test requirements:** An end-to-end Miniflare test: trigger a live import
against a mock provider, confirm it lands as a reviewable proposal, confirm
accept/reject both work.

**Deployment and migration notes:** None — composes entirely from
already-shipped primitives.

**Human approval requirements:** Normal PR review.

---

## E5 — Credential provisioning runbook

**Problem:** The repository cannot reveal whether any deployment has
`ORCH_BASE_URL`/`ORCH_API_KEY` provisioned, so the seven live-fabric MCP tools'
current availability is unverified; no documented procedure exists for
changing that safely.

**Outcome:** A documented procedure for provisioning the secrets on
**staging**; confirmation that `describe_data_source` can smoke-test
connectivity without importing anything.

**Scope:** `docs/DEPLOYMENT_RUNBOOK.md` new section; possibly a small
`describe_data_source` extension.

**Non-goals:** Do not provision real secrets in CI/CD; staging only, never
production without a separate, explicit decision.

**Dependencies:** None.

**Acceptance criteria:** An operator can follow the runbook to stand up a
real EdgeConnect connection on staging and verify it before any production
decision.

**Test requirements:** A test that `describe_data_source` behaves sanely
with no provider configured (existing) and with a provider configured but
unreachable (new).

**Deployment and migration notes:** None until a human actually provisions
secrets.

**Human approval requirements:** 100% human — `wrangler secret put` for the
actual credential values.

---

## E6 — Staleness/freshness UI

**Problem:** `source.freshness` already exists in the contract but is never
shown anywhere in the GUI.

**Outcome:** The inspector shows "this element was last confirmed live at T"
for provider-sourced elements.

**Scope:** Inspector UI extension in `src/main.ts`.

**Non-goals:** No new data model.

**Dependencies:** None (parallel to E4/E5).

**Acceptance criteria:** A provider-sourced element visibly shows freshness.

**Test requirements:** Pure render test.

**Deployment and migration notes:** None.

**Human approval requirements:** Normal PR review.

---

## E7 — EdgeConnect: tests, docs, gate, rollout

**Problem:** N/A — closeout packet.

**Outcome:** Full gate green; docs truth-up; PR merged.

**Scope:** Standard closeout.

**Dependencies:** E4, E5, E6.

**Acceptance criteria:** The provider is verified and safe against transient
failures with a real GUI path, but still inactive in every production
deployment until credentials are explicitly provisioned (E5), consistent
with this repo's activation discipline throughout.

**Test requirements:** Full gate.

**Deployment and migration notes:** Normal gated deploy; E5's secret
provisioning remains a separate follow-up decision.

**Human approval requirements:** Approve the production deploy (standard).

---

## T1 — Scenario contract types

**Problem:** No structured model exists for "walk through this fabric
before/during/after a failure" — today's flow compiler produces one
point-in-time snapshot only.

**Outcome:** `src/stories/model.ts` defines a `FlowScenario` (ordered named
steps, each a fabric-state delta), reusing existing `src/connect/types.ts`
shapes wherever possible.

**Scope:** Pure types.

**Non-goals:** No compiler logic yet.

**Dependencies:** None — can start immediately.

**Acceptance criteria:** Steps can express "a tunnel goes down" and "a flow
reroutes" without needing a future breaking change.

**Test requirements:** Type-level only.

**Deployment and migration notes:** None.

**Human approval requirements:** Normal PR review.

---

## T2 — Story compiler

**Problem:** No mechanism exists to turn a scenario into a multi-page
flipbook — and the flipbook's independent-pages-only design (no
inheritance) means this can't be built as cross-page deltas.

**Outcome:** `compileFlowStory(scenario): Document` — runs the flow compiler
once per step, producing N independent, fully-materialized pages wired via
`add_page`/`set_page_properties`, never as deltas.

**Scope:** `src/stories/compile.ts`, composing (not modifying)
`compileFlowTopology`.

**Non-goals:** **No cross-page delta storage** — this is the one behavior
this packet must not implement. If you find yourself storing one page as a
diff from another, stop; that's an explicitly excluded architecture
(`ROADMAP.md` §"Deliberately excluded").

**Dependencies:** T1, **and `IMPLEMENTATION_PLAN.md` packet E2** (shared-file
hotspot on `src/connect/compile.ts` — land E2 first).

**Acceptance criteria:** Deleting or corrupting one page in a compiled
scenario has zero effect on the others.

**Test requirements:** A 3-step scenario compiles to 3 independent,
individually-valid pages, each passing validation on its own.

**Deployment and migration notes:** None. Should not need to modify
`src/connect/compile.ts` at all if it only calls the existing exported
`compileFlowTopology` per step — confirm this holds.

**Human approval requirements:** Normal PR review — flag the
"no-inheritance" constraint explicitly in the PR description for reviewer
attention.

---

## T3 — Failure-moment annotations

**Problem:** No visual marker exists for "this link is down here" / "this
flow rerouted here" on a scenario page.

**Outcome:** Markers reusing `add_policy_marker`'s existing machinery (new
marker types only if the existing enum genuinely can't express this).

**Scope:** Extend the policy-marker catalog if needed; wire into the story
compiler's per-step output.

**Non-goals:** No new annotation kind unless policy markers can't cover it
— check first.

**Dependencies:** T2.

**Acceptance criteria:** A viewer can visually identify what changed between
two adjacent scenario pages without prose explanation.

**Test requirements:** A scenario step with a failure produces the expected
marker(s) on the expected element(s).

**Deployment and migration notes:** None.

**Human approval requirements:** Normal PR review.

---

## T4 — MCP tool `compile_flow_story`

**Problem:** No MCP tool exists for an agent to produce a failure-scenario
flipbook.

**Outcome:** A new tool taking a `FlowScenario`, returning a `topologyId`
with all scenario pages populated, mirroring `build_flow_topology`'s
registration pattern (gated on `deps.provider`, same as the other 7
live-fabric tools).

**Scope:** `src/mcp/tools.ts`, `src/mcp/README.md`.

**Non-goals:** None beyond what T2 already excluded.

**Dependencies:** T2.

**Acceptance criteria:** An agent with live-fabric access can produce a
multi-page failure-scenario flipbook in one call.

**Test requirements:** Tool-registration test; README-sync test.

**Deployment and migration notes:** None — gated the same way the other
live-fabric tools already are (inert without `ORCH_*` secrets).

**Human approval requirements:** Normal PR review.

---

## T5 — GUI scenario-timeline authoring affordance

**Problem:** No UI lets a human see/edit scenario step names/order — only
the generic page filmstrip exists.

**Outcome:** A labeling/authoring layer on the existing filmstrip UI making
the existing reorder/rename affordances scenario-aware.

**Scope:** Small extension to `src/main.ts`'s filmstrip UI.

**Non-goals:** No new canvas/rendering work.

**Dependencies:** T3, T4.

**Acceptance criteria:** A human can rename/reorder scenario steps the same
way they already can with ordinary flipbook pages.

**Test requirements:** Pure UI test for the new labeling affordance.

**Deployment and migration notes:** None.

**Human approval requirements:** Normal PR review.

---

## T6 — Playback caption polish

**Problem:** An exported failure-scenario flipbook isn't self-narrating —
`export_flipbook`'s playback bar may not surface each page's `name`.

**Outcome:** The playback bar shows each page's `name` as a caption during
autoplay (if not already surfaced).

**Scope:** Small extension to `src/render/flipbook.ts`'s playback bar.

**Non-goals:** No new narration/audio — text caption only, from existing
data.

**Dependencies:** T5.

**Acceptance criteria:** An exported failure-scenario flipbook is
understandable standalone, no accompanying prose needed.

**Test requirements:** Export a scenario, confirm the caption appears in the
generated HTML.

**Deployment and migration notes:** None.

**Human approval requirements:** Normal PR review.

---

## T7 — Time-aware storytelling: tests, docs, gate, rollout

**Problem:** N/A — closeout packet.

**Outcome:** Full gate green; docs truth-up; PR merged.

**Scope:** Standard closeout.

**Dependencies:** T6.

**Acceptance criteria:** A human or agent with live-fabric access can
produce and play back a self-narrating "before/during/after a failure"
flipbook.

**Test requirements:** Full gate.

**Deployment and migration notes:** Normal gated deploy; inert until
`ORCH_*` secrets exist (same posture as the existing live-fabric tools).

**Human approval requirements:** Approve the production deploy (standard).
