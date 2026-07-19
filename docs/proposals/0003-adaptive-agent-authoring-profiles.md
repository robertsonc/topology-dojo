# Proposal 0003: Adaptive agent authoring profiles

**Status:** Implemented (Phases A–C, packets P1–P5). Live in production
(migration `v4`, `PROFILES_ENABLED:"true"`). Phase D (governed product
guidance) remains deliberately out of scope — see `../ROADMAP.md`. Status
corrected 2026-07-19; see `../DISCREPANCY_REGISTER.md` row 5.

**Captured:** 2026-07-12
**Depends on:** Proposal 0002 revisions, semantic operations, proposals, and actor attribution

## Intent

Topology Dojo should become more intuitive for each owner over time. When an
agent repeatedly produces a technically valid diagram and the user repeatedly
makes the same meaningful correction, future agent-authored diagrams should
begin with that preference already applied.

This must not become uncontrolled self-modifying MCP behavior. Tool schemas are
a versioned product contract and remain code-reviewed. Adaptation lives in a
separate, bounded **Authoring Profile**: structured, scoped guidance retrieved
only when it is relevant to the current topology and task.

The design must maintain three disciplines:

1. **Token discipline:** never replay raw documents, operation history, or a
   growing memory transcript into model context.
2. **Performance discipline:** preference extraction is asynchronous and
   retrieval is precomputed, bounded, and cacheable.
3. **Learning discipline:** a one-off edit is evidence, not a lesson. Only
   repeated or explicitly confirmed intent becomes durable guidance, and a user
   can inspect, correct, scope, disable, or forget it.

## Motivating example: regional hub-and-spoke

An agent initially interprets "hub and spoke" geometrically: hubs in the center,
with spokes radiating outward. The user rearranges it into a leaf/spine-like
composition:

- regional hubs form a horizontal spine or super-spine tier;
- each region's spokes form a leaf group beneath its hubs;
- inter-region links exist only at the hub tier;
- spokes remain visually and semantically grouped by region.

This may be a one-off requirement, a workspace convention, or a durable user
preference. The system must determine which before applying it elsewhere. It
should learn the semantic constraint—not copy exact coordinates.

A confirmed rule might be represented as:

> For multi-region hub-and-spoke designs, use a layered regional composition:
> hubs on the spine tier, each region's spokes grouped below its hubs, and
> inter-region connectivity confined to the hub tier. Avoid radial placement.

Its trigger is not merely the phrase "hub and spoke." It applies when the
topology contains multiple regions, region-local spokes and hubs, and hub-only
regional interconnect.

## Non-goals

- Agents do not rewrite MCP tool schemas, descriptions, or system instructions.
- One user's preferences never train or alter another user's experience.
- A rejected proposal, transient drag, or abandoned experiment is not learning
  evidence.
- The system does not preserve raw document history forever merely to learn.
- Adaptation does not replace validation, layout constraints, or explicit task
  requirements. A current user instruction always wins.

## Three classes of knowledge

Every inferred lesson must be classified before storage or retrieval.

| Class                   | Example                                                   | Promotion authority                                            |
| ----------------------- | --------------------------------------------------------- | -------------------------------------------------------------- |
| Current-document intent | "Put the DR site on the right in this diagram"            | Current revision/task only                                     |
| Workspace convention    | "This customer always uses two hub tiers"                 | Workspace owner confirms                                       |
| User preference         | "For multi-region WANs, group spokes below regional hubs" | User confirms or strong repeated cross-document evidence       |
| Product guidance        | "Never use radial layout for this topology archetype"     | Maintainer review, tests, and a released guidance-pack version |

User behavior may propose the first three. It can never automatically promote a
rule into product-wide MCP instructions. Product guidance follows the normal
code/review/release path, informed only by privacy-safe aggregate signals.

## Learning loop

### 1. Observe attributed outcomes

Proposal 0002 provides actor-attributed operation batches and revisions. The
learner watches a bounded outcome window around an agent change set:

1. agent proposal or leased commit;
2. user accept/reject decision;
3. user corrections that remain in the document through a later checkpoint;
4. optional user explanation such as "regional hierarchy, not cosmetic."

Pointer-move frames and keystrokes are already coalesced into semantic changes.
Only the settled difference is evaluated.

### 2. Extract semantic features

The system converts geometry into topology intent using deterministic features
where possible:

- topology archetype and node roles;
- region/site/zone membership;
- graph tiers and allowed inter-tier connectivity;
- relative ordering, alignment, grouping, and spacing—not pixel coordinates;
- agent operation targets versus durable user corrections;
- task terms and explicit user rationale.

For the example, the extracted correction is "radial → layered regional
hub/spoke hierarchy," not "move hub-1 to x=410, y=120."

### 3. Create or strengthen a candidate

Candidates are deduplicated by semantic rule and scope. Evidence from one
document is not counted as many independent examples simply because the user
moved several related nodes. Initial thresholds should be conservative:

- one correction: keep as bounded evidence only;
- two similar corrections: show a non-blocking observation in the profile UI;
- three independent corrections across at least two documents: ask whether to
  make it a preference;
- explicit user confirmation: promote immediately at the chosen scope.

The exact thresholds remain tunable, but reducing false learning is more
important than learning quickly.

### 4. Confirm and scope

The UI asks a short causal question rather than silently guessing:

> You have changed multi-region hub-and-spoke diagrams to a layered regional
> layout three times. Should Topology Dojo prefer that layout in the future?

Choices:

- Yes, for my multi-region diagrams
- Only in this workspace
- This was specific to this document
- No, do not learn this

The agent can explain a candidate but cannot confirm it on the user's behalf.

### 5. Retrieve only applicable rules

Before authoring or laying out a topology, the agent requests guidance with the
task archetype, workspace id, relevant page ids, and its last-seen profile
revision. The service returns only the highest-value applicable rules, already
compiled into concise directives.

Current task instructions override workspace conventions, which override user
preferences, which override product defaults.

### 6. Measure and correct

The system records whether an applied preference reduced subsequent correction,
was explicitly praised, was overridden, or was marked "not for this diagram."
Contradictory evidence lowers confidence or narrows the trigger. Stale, unused
preferences decay toward review but are not silently deleted.

## Preference record

```ts
interface AuthoringPreference {
  id: string;
  ownerId: string;
  profileRevision: number;
  scope:
    | { kind: 'user' }
    | { kind: 'workspace'; workspaceId: string }
    | { kind: 'archetype'; archetype: string };
  trigger: {
    archetype?: string;
    requiredTraits: string[];
    excludedTraits?: string[];
  };
  directive: string; // concise instruction supplied to the agent
  rationale: string; // user-visible reason, not always sent to the model
  status: 'candidate' | 'confirmed' | 'paused' | 'rejected';
  confidence: number; // calibrated, never treated as permission
  evidenceDocuments: number;
  supportingOutcomes: number;
  contradictingOutcomes: number;
  sourceRevisionRefs: string[]; // bounded opaque refs, not embedded documents
  createdAt: string;
  lastObservedAt: string;
  lastAppliedAt?: string;
}
```

Evidence references are capped and compacted. They provide auditability without
turning the preference store into a second unbounded document history.

## MCP evolution model

### Stable tools, versioned guidance

MCP clients commonly cache tool definitions. Dynamically rewriting tool schemas
or descriptions per user would create compatibility problems and steadily bloat
discovery context. Therefore:

- base tool names, input schemas, and core descriptions remain stable and
  versioned in code;
- product instructions live in signed/versioned **guidance packs**;
- user/workspace preferences live in the Authoring Profile;
- the manifest exposes only `guidanceRevision` and `profileRevision`;
- agents fetch the compiled delta only when a revision changed or a new task
  archetype requires different guidance.

Proposed future tools:

| Tool                           | Purpose                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `get_authoring_guidance`       | Return bounded product + workspace + user directives applicable to this task |
| `explain_authoring_preference` | Explain scope, rationale, confidence, and evidence summary for one rule      |
| `list_authoring_preferences`   | User-facing/profile-management support; summaries only                       |
| `suggest_preference_scope`     | Explain why a candidate looks one-off, workspace-specific, or user-wide      |

Preference confirmation, editing, and deletion remain browser-owner actions.
There is intentionally no MCP tool that lets an agent confirm its own lesson.

## Token budget

The compiled guidance response has hard limits, not best-effort aspirations:

- default maximum: 5 applicable rules;
- default serialized instruction budget: 400 tokens;
- absolute maximum: 800 tokens unless the user explicitly requests profile
  inspection;
- no raw operation log, document snapshot, evidence transcript, or examples by
  default;
- unchanged `profileRevision` + `guidanceRevision` returns `notModified` and no
  repeated instruction body;
- rules are ranked by task match, scope specificity, confirmation status,
  confidence, and recency.

If more rules match than fit, the service returns their ids and omission count,
not truncated prose that could change meaning.

## Performance budget

- Preference extraction runs after a durable commit and never blocks editing.
- Deterministic graph/layout feature extraction is preferred to model calls.
- Any model-assisted candidate summarization runs asynchronously against compact
  structured features, not full topology JSON.
- Per-owner profiles are small and pre-indexed by archetype/scope; no global
  vector search is required for normal retrieval.
- Compiled guidance is cached by
  `(profileRevision, guidanceRevision, workspace, archetype)`.

## Guardrails against bad lessons

1. **Persistence test:** only corrections that survive a later checkpoint count.
2. **Independent evidence:** repeated moves in one editing burst are one outcome.
3. **Causal uncertainty:** requirement changes and preference changes are
   distinct; ambiguous cases ask the user.
4. **Structured sources only:** labels, imported text, and document metadata
   cannot inject instructions into a profile.
5. **No self-approval:** agents may nominate or explain; the user controls
   confirmation and scope.
6. **Contradiction tracking:** exceptions narrow a trigger instead of forcing a
   global winner.
7. **Reversible:** every rule is inspectable, editable, pausable, exportable, and
   forgettable.
8. **Tenant isolation:** evidence and rules are addressed by stable owner id and
   never cross users without an explicit future organization policy.
9. **Product promotion gate:** no personal lesson becomes general MCP guidance
   without maintainer review, regression examples, and a released version.

## User experience

An **Authoring Preferences** surface should show:

- Confirmed preferences
- Candidates waiting for clarification
- Recently applied rules and where they affected a diagram
- Exceptions/contradictions
- Scope controls: this document, workspace, topology type, or all my diagrams
- Pause, edit, forget, export, and "not for this diagram" actions

When an agent applies a preference, the proposal summary should say so plainly:

> Applied your confirmed "regional hubs as spine tier" preference.

That makes adaptive behavior explainable rather than spooky.

## Delivery phases

### A. Observe only

- Extract structured agent→user correction patterns.
- Store bounded candidates and evidence summaries.
- Provide an internal/profile UI without changing agent output.

### B. Confirmed guidance

- Ask the user to confirm and scope repeated candidates.
- Add profile revisions and bounded `get_authoring_guidance` retrieval.
- Agents apply confirmed rules and disclose them in proposals.

### C. Outcome refinement

- Track overrides, contradictions, and "not for this diagram" feedback.
- Narrow triggers, calibrate confidence, and decay stale candidates.
- Add organization/workspace conventions after explicit ACLs exist.

### D. Governed product evolution

- Analyze privacy-safe aggregate failure patterns.
- Promote genuinely general lessons only through reviewed guidance-pack releases,
  regression fixtures, token-budget tests, and rollback support.

## Acceptance criteria

1. One layout correction never changes a future document without confirmation.
2. Three independent equivalent corrections can create one deduplicated
   candidate, not three near-duplicate rules.
3. A confirmed regional hub/spoke preference applies only when its multi-region,
   hub-only-interconnect traits match.
4. Current prompt requirements override a stored preference and record a scoped
   exception rather than corrupting the rule.
5. Normal guidance retrieval stays within 400 tokens and returns no document or
   raw revision content.
6. An unchanged profile/guidance revision produces a `notModified` response.
7. The agent cannot confirm, broaden, or undelete a preference through MCP.
8. A user can explain, edit, pause, scope, export, and forget every learned rule.
9. Preferences never cross owner boundaries.
10. Product-wide instruction changes require a reviewed, versioned guidance-pack
    release with regression and token-budget tests.
