# Topology Dojo — Living User Acceptance Test Plan

| Plan metadata     | Value                                                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Version           | 2.1                                                                                                                                                                                              |
| Effective date    | 2026-08-19                                                                                                                                                                                       |
| Status            | Living release-acceptance plan                                                                                                                                                                   |
| System under test | Topology Dojo browser editor, public shared-copy experience, human-agent workspace, MCP authoring service, adaptive authoring preferences, owner administration, exports, and release operations |

This plan verifies that Topology Dojo produces acceptable business outcomes for
its intended users. It is not a replacement for automated or exploratory QA.
Detailed technical coverage lives in the [QA test plan](./QA_TEST_PLAN.md), the
end-user procedures live in the [user guide](../USER_GUIDE.md), and requirement,
test, and evidence coverage lives in the
[traceability matrix](./TRACEABILITY_MATRIX.md).

The plan is updated whenever a user-visible capability, feature flag, supported
environment, material residual risk, or acceptance threshold changes. Every UAT
cycle records the tested source SHA and the version of this plan.

---

## 1. Acceptance purpose and business outcomes

UAT answers whether representative users can complete their work safely and
confidently on a production candidate. It does not attempt to repeat every API,
validation, security, or rendering test already owned by QA.

The release is acceptable when the following outcomes are demonstrated:

| ID    | Business outcome                                                                                                             | Acceptance measure                                                                                                                                        |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BO-01 | A new author can produce and deliver a clear network topology without specialist training.                                   | The participant completes UAT-NA-01 unaided or with only the user guide, rates confidence at least 4/5, and produces a usable exported artifact.          |
| BO-02 | An experienced author can create a maintainable, multi-page document without losing work.                                    | UAT-PU-01 and UAT-NA-02 pass, including page independence, complete per-page undo/redo, recoverable page deletion, and recovery from an autosave failure. |
| BO-03 | A public recipient can inspect a shared snapshot without an account and without damaging the recipient's own saved document. | UAT-PR-01 and UAT-PR-02 pass in a signed-out browser and in a browser containing pre-existing local work.                                                 |
| BO-04 | A human and an agent can collaborate through reviewable, attributable changes.                                               | UAT-WS-01 through UAT-WS-03 pass without silent overwrite, unreviewed agent mutation, or loss of recoverable state.                                       |
| BO-05 | An MCP operator can obtain a presentable result through a compact, bounded authoring loop.                                   | UAT-MCP-01 and UAT-MCP-02 pass using capability discovery, batch editing, validation, layout, `inspect_render`, and final rendering.                      |
| BO-06 | Authoring preferences remain explainable and under the user's control.                                                       | UAT-PM-01 passes; observed behavior has no effect until confirmed, and pause, reject, and forget controls work.                                           |
| BO-07 | Owner administration exposes operational metadata without exposing diagram content.                                          | UAT-AD-01 passes for owner, non-owner, and signed-out identities.                                                                                         |
| BO-08 | A release operator can identify, deploy, verify, disable, and recover the exact candidate safely.                            | UAT-OP-01 and the applicable parts of UAT-OP-02 pass with complete evidence.                                                                              |
| BO-09 | Core journeys are usable with keyboard, assistive technology, zoom, and reduced-motion preferences.                          | UAT-AX-01 passes the critical-journey acceptance bar.                                                                                                     |

Document-semantic capabilities are expected to round-trip between browser and
headless authoring surfaces. Local view controls and browser preferences, such
as pan, zoom, theme, open panels, and calm-canvas state, are intentionally human
interaction state and are not part of MCP parity acceptance.

---

## 2. Participants, roles, and responsibilities

### 2.1 Acceptance personas

| Persona                          | Representative need                                                                                           | Primary scenarios                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| New author                       | Create, edit, save, and deliver a first topology with understandable in-product guidance.                     | UAT-NA-01, UAT-NA-02               |
| Power user / network architect   | Build a rich multi-page story efficiently and preserve document semantics through advanced edits and exports. | UAT-PU-01, UAT-PU-02               |
| Public recipient / reviewer      | Open a public snapshot without signing in, navigate it, and avoid replacing unrelated local work.             | UAT-PR-01, UAT-PR-02               |
| Human-agent workspace owner      | Hand off a document, review proposals, resolve conflicts, manage authority, and recover work.                 | UAT-WS-01, UAT-WS-02, UAT-WS-03    |
| MCP operator                     | Configure an MCP client and guide an agent through efficient, bounded topology authoring.                     | UAT-MCP-01, UAT-MCP-02, UAT-MCP-03 |
| Preference manager               | Review, scope, pause, reject, and forget adaptive authoring preferences.                                      | UAT-PM-01                          |
| Deployment owner / administrator | Review access and usage metadata without access to document content.                                          | UAT-AD-01                          |
| Release operator                 | Promote an exact build through the gated deployment and recovery process.                                     | UAT-OP-01, UAT-OP-02               |

Accessibility is a characteristic of every persona, not a separate kind of
user. UAT-AX-01 is therefore run across the new-author, public-recipient, and
workspace-review journeys by participants who use keyboard-only navigation and
at least one supported screen reader.

### 2.2 Execution roles

| Role                      | Responsibility                                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Product owner             | Owns business acceptance, residual-risk decisions, and final GO / CONDITIONAL GO / NO-GO decision.                                  |
| UAT lead                  | Freezes the cycle scope, briefs participants, protects test independence, tracks execution, and compiles the acceptance report.     |
| Participant               | Executes the script in their own words, records observed behavior and confidence, and does not diagnose implementation details.     |
| Facilitator               | Provides only the help allowed by the scenario, timestamps material friction, and captures evidence.                                |
| QA lead                   | Confirms QA entry criteria, reproduces failures, assigns severity with the product owner, and links defects to regression coverage. |
| Engineering owner         | Investigates defects, supplies fixed builds, and identifies scenarios requiring re-execution.                                       |
| Security/privacy reviewer | Reviews public-link, authentication, isolation, adaptive-preference, and admin-data acceptance evidence.                            |
| Release operator          | Records environment, flags, deployment run, exact SHA, smoke evidence, and forward-recovery evidence.                               |

One person may hold multiple roles in a small release, but the participant must
not be the implementer of the capability being accepted.

---

## 3. Scope, capability states, and exclusions

### 3.1 Capability-state rules

Each cycle records the state below before execution. A scenario must not be
marked PASS when its prerequisite capability is disabled, unavailable, or
untested.

| State                   | Meaning                                                                                                              | UAT treatment                                                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core                    | Part of every supported deployment and release decision.                                                             | Must execute and pass unless the entire release is rejected.                                                                                                                                  |
| Feature-gated           | Shipped code whose surface depends on deployment configuration.                                                      | Record the flag and effective state. Execute when enabled in the target release; otherwise mark `N/A — gated off`, confirm the disabled experience, and obtain product-owner acknowledgement. |
| Conditional integration | Requires an external system, credential, licensed service, or representative data that is not a baseline dependency. | Execute the documented mock/fixture baseline. Execute the real integration only when explicitly declared in release scope; otherwise mark `N/A — condition unavailable`, never PASS.          |
| Deliberately excluded   | Not a supported outcome for this release.                                                                            | Do not execute as an acceptance requirement; confirm the limitation is documented where users could expect it.                                                                                |

| Capability                                                                                     | State for this plan                                                      | Activation or condition                                                                                                   |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Browser authoring, local persistence, import, JSON/SVG/PNG export, and public shared snapshots | Core                                                                     | Supported browser and production-candidate build                                                                          |
| MCP standalone flipbook HTML export                                                            | Core for MCP acceptance; not a browser-toolbar action                    | Hosted or local MCP client and a multi-page document                                                                      |
| Remote MCP authoring and OAuth                                                                 | Core for hosted releases; local stdio remains a diagnostic/operator path | Hosted `/mcp`, GitHub OAuth application, and MCP client                                                                   |
| Human-agent workspace, proposals, leases, checkpoints, presence, and offline recovery          | Feature-gated                                                            | `WORKSPACE_ENABLED=true`                                                                                                  |
| Adaptive authoring preferences                                                                 | Feature-gated                                                            | `PROFILES_ENABLED=true`                                                                                                   |
| Owner analytics/admin dashboard                                                                | Feature-gated and identity-gated                                         | `ANALYTICS_ENABLED=true` and a valid `ADMIN_GITHUB_ID`                                                                    |
| Agent-session activity + guidance-consulted timeline signal                                    | Feature-gated (reuses analytics)                                         | Same `ANALYTICS_ENABLED` / admin identity; remote MCP only                                                                |
| Mock live-fabric workflow                                                                      | Conditional integration baseline                                         | `TOPOLOGY_PROVIDER=mock` in a non-production test environment                                                             |
| Real EdgeConnect import                                                                        | Conditional integration                                                  | Approved non-production Orchestrator, `ORCH_BASE_URL`, and secret `ORCH_API_KEY`; no secrets in prompts or tool arguments |
| Touch-first full editing                                                                       | Deliberately excluded                                                    | Public-view readability may be assessed on narrow/touch devices; full touch authoring is not accepted here                |
| Organization ACLs and CRDT-style multi-master editing                                          | Deliberately excluded / residual risk                                    | Absence must be disclosed; see §12                                                                                        |

### 3.2 In scope

- Critical browser authoring and document-storytelling workflows.
- Local autosave truthfulness, downloadable recovery, import, and page history.
- Public snapshot viewing and safe separation from the recipient's local work.
- Document-semantic round trips between browser, JSON, MCP, and supported
  exports.
- Human-agent handoff, proposal review, authority, conflict, checkpoint, and
  offline workflows when the workspace flag is on.
- Efficient MCP discovery, bounded reads, `edit_topology`, validation, layout,
  `inspect_render`, render, and error recovery.
- Adaptive preferences, admin roster/workspace metadata, Agent Sessions, and
  the non-causal guidance-consulted timeline signal when analytics is on.
- Critical-journey accessibility, usability, operational release evidence, and
  conditional live-fabric import.

### 3.3 Out of scope

- Exhaustive field, schema, fuzz, concurrency, load, penetration, and browser
  regression testing; those belong to the QA plan.
- Treating a visual preference or local viewport position as persisted document
  semantics.
- Destructive migration experiments in production.
- Production use of customer credentials or sensitive customer topology data.
- Product capabilities identified as deliberately excluded in §3.1.

---

## 4. Prerequisites, environment, and test data

### 4.1 Entry prerequisites for a cycle

Before the UAT lead opens a cycle:

1. The release candidate has a unique source SHA and immutable build/deployment
   identifier.
2. Required QA gates in the [QA test plan](./QA_TEST_PLAN.md) are green on the
   candidate. This includes both Linux CI jobs and all 11 current Chromium
   cases, including the three canonical visual comparisons. Any exception has
   a written risk decision from the QA and product owners; the local macOS
   8/11 partial browser run is not the canonical entry gate.
3. The isolated staging deployment serves the candidate SHA and uses staging
   OAuth, KV, Durable Object namespaces, secrets, and callback URLs.
4. The effective workspace, profile, analytics, admin-identity, and provider
   configuration is captured without exposing secret values.
5. Test identities, MCP clients, supported browsers, screen readers, and test
   fixtures are ready.
6. Known Sev-1 and Sev-2 defects are disclosed to the UAT lead. An open Sev-1
   unconditionally blocks formal acceptance entry. Scoped exploratory or fix
   verification may continue only under an explicit **NO-GO** state.
7. The [user guide](../USER_GUIDE.md) and
   [traceability matrix](./TRACEABILITY_MATRIX.md) identify the candidate's
   current workflows and residual risks.

### 4.2 Environment matrix

| Environment                      | Purpose                                                                                               | Permitted scenarios                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Isolated staging                 | Primary acceptance environment; production-like auth, Worker, storage, flags, and MCP transport       | All applicable scenarios                               |
| Production                       | Read-only or low-impact final smoke after approval; never failure injection or a destructive game day | UAT-OP-01 smoke subset, UAT-PR-01 with disposable data |
| Local browser/Vite               | Controlled storage-failure, offline, accessibility, and exploratory reproduction                      | UAT-NA-02, UAT-WS-03, UAT-AX-01                        |
| Local stdio MCP                  | Client compatibility and mock provider baseline                                                       | UAT-MCP-01 and UAT-MCP-03                              |
| Approved EdgeConnect test system | Optional real live-fabric acceptance                                                                  | Conditional branch of UAT-MCP-03 only                  |

The target manual browser set is current Chrome, Edge, Firefox, and Safari on
macOS. Each cycle records its declared support matrix and exact versions. Any
omitted target requires product-owner approval plus the same narrowed claim in
the User Guide and release notes. At minimum, run the primary authoring journey
in Chrome and Edge, the public-recipient journey in Firefox and Safari, and the
accessibility journey in each browser/screen-reader pairing declared by the
cycle.

### 4.3 Test-data pack

Create disposable data with no customer secrets:

- `TD-UAT-BLANK`: new browser profile with no saved document.
- `TD-UAT-LOCAL-MARKER`: a locally saved two-page document titled
  `DO NOT REPLACE — LOCAL WORK`, with a unique node on each page.
- `TD-UAT-RICH`: a five-page SASE story containing nodes, links, anchors,
  waypoints, zones, flow paths, policy markers, layers, captions, emphasis,
  legend, stencil, custom node type, transitions, and brand palette.
- `TD-UAT-UNDO`: a two-page document and an ordered 12-edit script spanning
  element fields, geometry, layers, links, deletion cascades, and page switches.
- `TD-UAT-UGLY`: overlapping, off-grid, but semantically valid geometry for
  layout recovery.
- `TD-UAT-CONFLICT`: a shared workspace with two browser sessions for the same
  owner plus an MCP agent prepared to edit disjoint and identical fields from
  the same base revision.
- `TD-UAT-PREF`: an agreed sequence of repeated corrections that should form a
  preference candidate, plus a contradictory correction.
- `TD-UAT-SHARE`: a disposable published snapshot with its id, publication
  time, expected expiry, and non-sensitive contents.
- Owner, non-owner, and signed-out identities; the owner identity must match the
  configured numeric admin id for the admin scenario.
- A supported MCP client, an agent capable of using the exposed tools, and a
  transcript-capture method that redacts tokens and secrets.
- Mock provider fixtures and, only when approved, a read-only EdgeConnect test
  tenant with a known expected appliance/tunnel inventory.

---

## 5. Execution method and result format

### 5.1 Scenario format

Every execution record contains:

| Field              | Required content                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Run ID             | `<cycle>-<scenario>-<sequence>`                                                                                                     |
| Candidate          | Git SHA, deployment/build id, environment, origin, date/time                                                                        |
| Capability state   | Relevant flag/provider state, recorded without secrets                                                                              |
| Participant        | Persona and anonymized participant id                                                                                               |
| Client             | Browser/OS, viewport, MCP client/model where relevant, assistive technology                                                         |
| Preconditions/data | Fixture ids, starting revision, public snapshot id, local-storage state                                                             |
| Step results       | PASS/FAIL per numbered step, actual result, timestamp for material friction                                                         |
| Evidence           | Screenshots/video, exported artifacts, sanitized transcript, API response, revision/proposal/checkpoint ids, logs or deployment run |
| Defects            | Linked defect id, severity, workaround, owner                                                                                       |
| Outcome            | PASS, FAIL, BLOCKED, or N/A with reason                                                                                             |
| Participant score  | Task confidence and output fitness, each 1–5, plus free-text feedback                                                               |
| Review             | Facilitator, QA reviewer, and date                                                                                                  |

`BLOCKED` is not a pass. `N/A` is valid only for a documented gated-off or
unavailable conditional capability and requires the product owner's acceptance
of that cycle scope.

### 5.2 Common pass rule

A scenario passes only when every required step meets its expected result,
required evidence is attached, no undisclosed data loss or security/privacy
exposure occurs, and the participant can explain what state the product saved or
shared. Facilitator intervention beyond the user guide is recorded as usability
friction and may fail a scenario whose outcome requires unaided completion.

---

## 6. Executable acceptance scenarios

### UAT-NA-01 — New author creates and delivers a first topology

**Priority:** P0
**Capability state:** Core
**Persona:** New author
**Business outcomes:** BO-01, BO-09
**Time box:** 30 minutes

**Preconditions:** `TD-UAT-BLANK`; no facilitator walkthrough; user guide may be
opened.

**Steps and expected results:**

1. Sign in to staging and create a new document from a relevant starter
   template. The editor opens without an auth loop; the participant can identify
   the palette, canvas, pages, inspector, status, and export controls.
2. Rename the document and page. Add at least four nodes, two different link
   types, one zone, and one annotation; edit labels and one visual property in
   the inspector. Every intended change is visible and remains selected or
   discoverable.
3. Move elements with grid/snap, use one align or distribute action, run Tidy,
   and resolve any visible problem indicator. No node overlap, off-page content,
   detached endpoint, or unexpected semantic loss remains.
4. Use find, fit-to-content, zoom, and pan to locate and inspect an element.
   These view changes do not alter document semantics.
5. Undo and redo the last three edits. The exact intended states return in
   order.
6. Export JSON, SVG, and PNG. Re-import the JSON in the same test profile after
   starting a new document. The document-semantic content matches; SVG and PNG
   are non-empty, correctly framed, and presentation-ready.
7. Rate task confidence and output fitness from 1–5 and state where the
   participant would expect help for the next task.

**Acceptance:** All steps pass; confidence and output fitness are each at least
4/5; no undocumented facilitator intervention; exported artifacts are attached.

### UAT-NA-02 — Autosave truthfulness, complete undo, and recoverable page deletion

**Priority:** P0
**Capability state:** Core
**Persona:** New author / power user
**Business outcome:** BO-02

**Preconditions:** `TD-UAT-UNDO`; a safe method approved by QA to deny or exhaust
browser storage; an exported starting JSON backup.

**Steps and expected results:**

1. On page 1, perform the ordered edits 1–6 from the fixture script. Switch to
   page 2 and perform edits 7–10, including a link plus its dependent waypoint
   or anchor and a layer/property change.
2. Return to page 1 and undo two edits. Only page 1 changes; page 2 remains
   exactly as left. Redo both and verify complete state, including selection-
   relevant geometry and dependent references.
3. Return to page 2 and undo its last two edits. The page-specific history is
   intact after switching pages, and cascaded element state is restored without
   dangling references.
4. Delete page 2. The UI provides the documented recovery interval and action.
   Recover it before expiry. Its content and history-bearing document state are
   intact. Delete it again and allow the interval to expire; the deletion then
   remains committed and another page is active.
5. Make an edit with normal storage available, wait for the saved indication,
   close/reopen, and verify the exact final edit is restored.
6. Activate the approved storage-failure condition and make a distinctive edit.
   The UI must not claim success. A persistent, keyboard-accessible recovery
   action offers downloadable JSON containing the current in-memory document.
7. Download the recovery JSON, open it in a clean profile, and verify the
   distinctive edit. Restore storage, make one further edit, and confirm the
   status returns to a truthful saved state.

**Acceptance:** No cross-page undo leakage, incomplete snapshot, dangling
reference, false saved indication, or unrecoverable in-memory work. Attach the
normal export, recovery export, and before/after screenshots.

### UAT-PU-01 — Power user creates a maintainable multi-page network story

**Priority:** P0
**Capability state:** Core
**Persona:** Power user / network architect
**Business outcomes:** BO-02, BO-05
**Time box:** 60 minutes

**Preconditions:** `TD-UAT-RICH` may be used as an outcome reference, but the
participant starts from a suitable template.

**Steps and expected results:**

1. Build a three-site SASE topology with site zones, underlay and overlay
   layers, tunnel links, a free anchor, a manual waypoint, a flow path, and a
   policy marker.
2. Use copy/cut/paste, duplicate, format painter, lock/unlock, z-order,
   select-by, align/distribute, Tidy, and Balance. Repeated operations remain
   predictable; locked items do not move unexpectedly; attachments remain with
   moved nodes; final layout has no overlap warning.
3. Add a custom stencil and a custom node type, then place and edit instances.
   Search and inspector controls expose the resulting elements.
4. Create four story pages through add and duplicate. Rename/reorder them; set
   caption, emphasis, duration, transition, legend, layer visibility/opacity,
   and brand/display settings as appropriate. Editing a duplicate does not
   mutate its source page.
5. Use page playback and calm/reduced-motion-friendly presentation controls.
   The narrative order, durations, captions, emphasis, and layers are coherent.
6. From the browser, export JSON, SVG, and PNG. Re-import JSON and compare the
   rich semantics against the source. Validate standalone flipbook HTML through
   UAT-MCP-01; it is not a browser-toolbar action.

**Acceptance:** The participant judges the result customer-ready at least 4/5;
all semantic features survive JSON round-trip; browser-supported export formats
are complete, correctly framed, and visually consistent with the intended
page.

### UAT-PU-02 — Import, repair, and diagnose an imperfect topology

**Priority:** P1
**Capability state:** Core
**Persona:** Power user

**Preconditions:** `TD-UAT-UGLY` and a legacy-format fixture with a documented
expected conversion result.

**Steps and expected results:**

1. Import the legacy fixture. Any conversion warnings are understandable and
   actionable; supported content is preserved.
2. Import `TD-UAT-UGLY`; inspect the Problems surface and on-canvas indicators.
   Problems identify the relevant elements without relying only on color.
3. Compare Arrange, Tidy, and Balance; finish with manual align/distribute. No
   anchors or manual link waypoints are stranded, and Balance does not create a
   new overlap.
4. Export and re-import the repaired result, then recheck the Problems surface.

**Acceptance:** The participant repairs the document in 15 minutes or less;
there are no remaining semantic errors or layout overlaps; conversion losses,
if any, match the user guide rather than appearing silently.

### UAT-PR-01 — Public recipient opens a shared copy without losing local work

**Priority:** P0
**Capability state:** Core
**Persona:** Public recipient
**Business outcome:** BO-03

**Preconditions:** A valid `TD-UAT-SHARE` URL; browser A is signed out and has no
local document; browser B is signed out or signed in but contains
`TD-UAT-LOCAL-MARKER` in its local slot.

**Steps and expected results:**

1. Open the link in browser A. It loads without GitHub authentication and makes
   clear that this is a shared copy. Navigate pages, zoom/pan, inspect content,
   and export a non-sensitive artifact.
2. Edit the shared copy and refresh. Its edits resume from the separate shared
   autosave slot; no claim is made that the published snapshot itself changed.
3. Open the same link in browser B. The shared-copy banner states that the
   recipient's own document is untouched and provides `back to my document` and
   `keep this copy` choices.
4. Make a distinctive edit to the shared copy, select `back to my document`,
   and verify `TD-UAT-LOCAL-MARKER` returns with both original pages and unique
   nodes intact.
5. Open the link again, select `keep this copy`, and verify an explicit
   confirmation warns that the locally saved document will be replaced. Cancel
   once and confirm local work remains; repeat and confirm only after accepting.
6. Confirm the user guide or publish guidance states that the URL is public to
   anyone who has it, expires after 30 days, can be revoked by the publisher,
   and may be cached for about a minute. No sensitive fixture data is used.

**Acceptance:** The link works signed out; local and shared autosave slots never
silently overwrite one another; back and keep behave exactly as described; the
public-link residual risk is discoverable and understood by the participant.

### UAT-PR-02 — Invalid, expired, and refreshed shared-link behavior

**Priority:** P1
**Capability state:** Core
**Persona:** Public recipient

**Preconditions:** One invalid id, one expired/deleted test fixture supplied by
QA where possible, and one valid snapshot whose shared-slot edits already exist
in the browser.

**Steps and expected results:**

1. Open the invalid id and expired fixture. The error distinguishes not found or
   expired from a general load failure where the platform can know the result;
   it does not replace local or shared saved work.
2. Reopen the valid snapshot. The browser resumes the saved shared-copy edits
   according to the documented slot behavior.
3. Publish a changed source document as a new snapshot. Verify the previous URL
   remains its immutable old snapshot with its original expiry, while the new
   URL contains the change and starts its own lifetime.

**Acceptance:** Errors are actionable, no saved document is lost, and snapshot
immutability/new-link semantics match the user guide.

### UAT-WS-01 — Handoff, proposal preview, and selective acceptance

**Priority:** P0 when workspace is enabled
**Capability state:** Feature-gated — `WORKSPACE_ENABLED`
**Persona:** Human-agent workspace owner
**Business outcome:** BO-04

**Preconditions:** `TD-UAT-CONFLICT`; owner browser and authorized MCP agent;
recorded starting revision; workspace flag on.

**Steps and expected results:**

1. Hand the local document into a workspace. The panel shows a stable workspace
   id, page/revision summary, active sync state, and an understandable agent chip
   state. The local result equals the canonical starting revision.
2. Have the agent propose a mixed change set: move and relabel a node, add a
   link, update an annotation, and delete a separate element. The canonical
   revision does not change before human acceptance.
3. Open the proposal. Preview highlights identify every affected element kind
   using geometry and a non-color-only visual treatment; the UI communicates
   added, changed, and deleted effects.
4. Selectively accept a coherent subset. The UI prevents or explains an
   incoherent subset with missing dependencies. The accepted operations create
   one attributable revision; rejected operations do not appear.
5. Reject the remaining proposal and verify it no longer changes canonical
   state. The agent chip and live status announcement communicate the result.
6. Refresh both browser and MCP views; hydrate the affected elements through
   bounded workspace reads. Both surfaces agree on revision and accepted state.

**Acceptance:** No agent proposal mutates canonical state before acceptance;
preview is understandable without relying only on color; selective acceptance
preserves referential integrity; revision attribution and announcements are
evidenced.

### UAT-WS-02 — Conflict handling and scoped agent authority

**Priority:** P0 when workspace is enabled
**Capability state:** Feature-gated — `WORKSPACE_ENABLED`
**Persona:** Human-agent workspace owner
**Business outcome:** BO-04

**Preconditions:** Two browser sessions authenticated as the same workspace
owner plus an agent at the same base revision; two pages; no active lease. The
current product does not grant a second owner identity access to the workspace.

**Steps and expected results:**

1. From the same base revision, let the human and agent change different fields
   on different elements. Submit the agent proposal after the human commit. The
   disjoint changes rebase without losing either result.
2. Repeat with both editing the same field. The product reports a conflict and
   does not choose a silent winner. Resolve deliberately and verify canonical
   state and timeline attribution.
3. Repeat with one actor deleting an element while the other edits it. The
   conflict or dependency result is explicit; no dangling reference is created.
4. Attempt direct agent application without a lease. It fails with actionable
   guidance and no revision change.
5. Grant a ten-minute lease scoped to the current page. A direct operation on
   that page succeeds; an operation on another page fails; the agent cannot
   grant, broaden, or extend its own lease.
6. Revoke the lease and verify a further direct operation fails. If practical,
   issue a short-lived test lease and verify expiry produces the same safe
   result.

**Acceptance:** Disjoint work composes, contested work never resolves silently,
authority is page-scoped and owner-controlled, and every attempt has revision
and UI evidence.

### UAT-WS-03 — Checkpoints, offline replay, and workspace recovery

**Priority:** P1 when workspace is enabled; P0 for a release changing recovery
**Capability state:** Feature-gated — `WORKSPACE_ENABLED`
**Persona:** Human-agent workspace owner
**Business outcome:** BO-04

**Preconditions:** Active workspace with several revisions; browser network
controls; enough disposable checkpoints to exercise the documented cap.

**Steps and expected results:**

1. Create named checkpoints before and after a meaningful edit. Confirm they
   appear with identity/time metadata and that the documented checkpoint cap is
   enforced predictably.
2. Restore an earlier checkpoint. Restoration is forward-only: a new revision
   is created rather than history being erased. Verify the timeline and current
   document.
3. Fork a checkpoint. A genuinely new workspace/document id opens with copied
   content and independent subsequent history.
4. Delete a checkpoint through its confirmation flow; other checkpoints and the
   canonical document remain unchanged.
5. Take the browser offline, make supported edits, and observe clear offline
   status. Reload once while offline if supported by the documented workflow.
   Reconnect and replay; operations appear exactly once and the final revision
   is coherent.
6. Create a deliberate same-field server change while the offline client holds
   a pending edit. Reconnect; the product surfaces recovery/conflict choices
   rather than discarding either side.
7. Exercise `sync local`, `reload server`, and `detach` using disposable edits.
   Each action explains which authority wins and matches the resulting state.

**Acceptance:** Restore/fork/delete semantics are clear; offline operations do
not duplicate or vanish; conflicts and recovery choices are explicit; timeline,
checkpoint ids, and before/after exports are attached.

### UAT-MCP-01 — Compact MCP authoring loop with batch edit and render inspection

**Priority:** P0 for hosted MCP releases
**Capability state:** Core hosted MCP; repeat key flow over local stdio
**Persona:** MCP operator
**Business outcome:** BO-05

**Preconditions:** Supported MCP client; remote OAuth endpoint; local stdio
configuration; sanitized transcript capture; no topology ids from another owner.

**Steps and expected results:**

1. Connect remotely and complete GitHub OAuth without copying tokens into chat.
   List available tools and request compact capability discovery relevant to a
   SASE topology rather than the entire schema when the client supports it.
2. Create a private topology. Use `edit_topology` to add a coherent batch of
   nodes, links, a zone, layers, and annotations. A malformed operation in a
   separate test returns a structured actionable error and does not corrupt the
   document.
3. Use bounded/summary reads to inspect page ids, counts, and only the elements
   needed for the next edit. The normal loop does not repeatedly return the
   entire rich document.
4. Validate, then run the appropriate layout/Tidy/Balance operations. Anchors
   and manual waypoints remain attached; the final validation has no semantic
   error or overlap warning.
5. Call `inspect_render`. Use its compact findings to correct at least one
   intentionally seeded visual-quality issue, then call it again and confirm
   improvement.
6. Render final SVG once. Export standalone flipbook HTML, save the returned
   artifact, and open it with networking disabled. Compare the output's pages,
   labels, layers, timing, and framing with bounded document reads and
   `inspect_render`.
7. Repeat a small create/edit/validate/inspect/render loop over stdio and confirm
   document-semantic tool behavior is consistent with the remote path.

**Acceptance:** The loop completes without manual JSON surgery, unbounded
repeated reads, credential exposure, detached attachments, or false tool
success. Transcript, validation result, inspection summaries, SVG, and offline
flipbook are attached.

### UAT-MCP-02 — MCP-to-browser round trip and recovery from tool errors

**Priority:** P0 when hosted MCP and workspace are enabled
**Capability state:** Core MCP plus feature-gated workspace
**Persona:** MCP operator / workspace owner
**Business outcomes:** BO-04, BO-05

**Preconditions:** Rich agent-authored document, browser owner, workspace flag
on.

**Steps and expected results:**

1. Through MCP, create a two-page document containing an anchor, manual
   waypoint, annotation, layer settings, captions/emphasis, duration/transition,
   legend, palette, and custom node type.
2. Hand it into a workspace and open it in the browser. Compare against the MCP
   representation and final SVG; no document-semantic field is lost.
3. In the browser, edit one element of each major kind and add a page. The agent
   reads the compact manifest/change summary and hydrates only affected
   elements, then accurately explains the changes.
4. Send invalid element id, out-of-range page target, and invalid enum requests
   one at a time. Each returns an actionable error; the following valid request
   succeeds and canonical state remains valid.
5. Have the agent submit a final proposal, accept it in the browser, and verify
   the same revision through both surfaces.

**Acceptance:** Round-trip semantics, bounded sync, error isolation, and final
revision agreement all pass. Human-only view preferences are not treated as
parity failures.

### UAT-MCP-03 — Conditional live-fabric import and idempotent refresh

**Priority:** P1 for mock baseline; release-gating only when real EdgeConnect is
declared in scope
**Capability state:** Conditional integration
**Persona:** MCP operator

**Preconditions:** Mock provider in a non-production environment. For the real
branch, written approval, a read-only test tenant, known expected inventory, and
secrets injected only through environment configuration.

**Steps and expected results:**

1. With the mock provider, call the discovery/inventory tools and record the
   expected appliance, site, tunnel, policy, and flow counts.
2. Build a flow topology. Verify source identities, site zones, underlay/overlay
   layering, links, flow path, policy markers, validation, layout, and
   `inspect_render` result.
3. Run the same import/update again. Source-based upsert converges: element
   counts remain expected, existing identities are updated, and duplicates are
   not created.
4. Confirm schemas, transcript, and results contain no credential arguments or
   secret values.
5. **Conditional real branch:** repeat steps 1–4 against the approved
   EdgeConnect test tenant and reconcile sampled topology elements to the known
   inventory. Do not write to or reconfigure the source system.

**Acceptance:** Mock steps must pass for the conditional capability baseline.
The real branch is PASS only with complete source reconciliation evidence; when
no approved tenant is available it is `N/A — condition unavailable`, not PASS.

### UAT-PM-01 — Preference observation, confirmation, scope, and control

**Priority:** P1 when profiles are enabled; P0 for a release changing preference
privacy or control
**Capability state:** Feature-gated — `PROFILES_ENABLED`
**Persona:** Preference manager
**Business outcome:** BO-06

**Preconditions:** `TD-UAT-PREF`; authenticated owner; profile flag on; a linked
workspace if workspace-scoped preferences are tested.

**Steps and expected results:**

1. Apply the repeated correction sequence. A candidate preference is described
   in plain language with evidence/status; observation alone does not silently
   change authoring behavior.
2. Confirm the candidate and choose each applicable scope in separate test
   runs: user, archetype, and workspace. Guidance identifies the rule and scope
   without exposing raw prompts or document content.
3. Create an exception or contradictory correction. The UI makes the
   contradiction/review state understandable; the previous rule is not silently
   rewritten.
4. Pause learning. Further corrections do not create active guidance. Resume
   and verify observation can continue.
5. Reject a pending candidate and verify it never becomes guidance. Use forget
   on a confirmed rule with confirmation; it no longer appears in subsequent
   guidance.
6. Verify an agent cannot confirm, broaden, or delete the human's preferences.

**Acceptance:** No unconfirmed behavior change, hidden scope expansion, raw
prompt disclosure, or agent-controlled confirmation. Evidence shows candidate,
confirmed, contradictory, paused, rejected, and forgotten states.

### UAT-AD-01 — Owner administration and metadata privacy

**Priority:** P1 when analytics/admin is enabled; P0 for a release changing auth
or collected data
**Capability state:** Feature-gated and identity-gated — `ANALYTICS_ENABLED`,
`ADMIN_GITHUB_ID`
**Persona:** Deployment owner / administrator
**Business outcome:** BO-07

**Preconditions:** Configured owner, signed-in non-owner, and signed-out browser;
known recent test logins/workspaces; no sensitive diagrams.

**Steps and expected results:**

1. As signed out, request the admin surface/API. Access is denied without
   leaking metadata.
2. As the signed-in non-owner, repeat. Access is denied even if the login name
   resembles the owner; authorization uses the configured stable identity.
3. As the owner, open the dashboard. Review login roster/counts, workspace
   metadata, and recent Agent Sessions (tool names and coarse outcomes only).
   Values are understandable and correspond to the prepared activity.
4. Inspect available detail and exported/network responses with the facilitator.
   They contain operational metadata only, never diagram content, labels, raw
   prompts, MCP arguments, credentials, or tokens.
5. Confirm documented retention/backfill semantics: data not recorded before
   activation is not presented as a complete historical record.
6. In a disposable staging configuration with analytics disabled or admin id
   absent, confirm the surface fails closed with an understandable disabled or
   unauthorized state.

**Acceptance:** Owner access works; signed-out/non-owner access fails closed;
collected fields match the user guide and contain no diagram or secret content.

### UAT-OP-01 — Gated release promotion and production smoke

**Priority:** P0
**Capability state:** Core operations
**Persona:** Release operator
**Business outcome:** BO-08

**Preconditions:** Exact release candidate; green required QA and all
pre-production UAT evidence other than the production-only portion of this
scenario; deployment approver available; runbooks; staging and production
credentials held outside the test record.

**Steps and expected results:**

**Phase A — pre-production acceptance:**

1. Record candidate SHA, workflow run, migration classification, effective
   flags, target environment, and approval. Confirm staging and production
   resources are isolated.
2. Deploy through the documented staging workflow. Confirm health/static
   origin serves the exact SHA; execute auth, editor, public share, remote MCP,
   and each enabled feature's smoke path.
3. Review Worker errors and the documented rate/hard-stop signals. Any stop
   condition halts promotion and is recorded.
4. Record the Phase A result. A GO recommendation requires this staging phase
   to pass; the production phase is intentionally not a pre-production
   sign-off prerequisite.

**Phase B — post-approval production verification:**

5. Obtain the required human approval and run the gated production workflow.
   Do not use an unapproved direct deploy or `versions upload` for a
   migration-bearing release.
6. Confirm production serves the exact approved SHA. Run a disposable smoke:
   sign in, create/edit, truthful save, validate/render through MCP, publish and
   open a non-sensitive shared snapshot signed out, then inspect enabled
   workspace/profile/admin health without altering customer data.
7. Record outcome, timestamps, evidence links, and any monitoring observation.

**Acceptance:** Phase A must pass before a GO recommendation. Phase B must pass
to close the release after deployment; a Phase B failure invokes the runbook's
stop/forward-recovery decision and leaves the release record open. Exact-source
provenance, gates, isolation, approval, smoke, and observation evidence are
complete with no bypass or unexplained migration/config drift.

### UAT-OP-02 — Feature disablement and forward recovery

**Priority:** P1 every cycle; P0 for migration-bearing or workspace/profile/admin
changes
**Capability state:** Core operational process with gated-feature branches
**Persona:** Release operator

**Preconditions:** Isolated staging only; approved game-day window; disposable
workspace/profile/admin data; current deployment and rollback/runbook evidence.

**Steps and expected results:**

1. Select one enabled feature-gated surface changed by the release. Record its
   healthy baseline and data identifiers.
2. Exercise the documented forward-safe disablement in staging. The feature
   becomes unavailable or inert with an understandable response, while core
   editor/export/share behavior remains healthy and stored data is not deleted.
3. Re-enable through a new forward deployment. Verify the exact new SHA and
   expected data/recovery behavior.
4. For a migration-bearing candidate, execute the approved forward-recovery
   game-day case; never roll code back across an applied Durable Object
   migration.
5. Verify an alert or documented observation route detects the injected failure
   or explicitly record the remaining manual-detection limitation.

**Acceptance:** Disable/re-enable and, when applicable, forward recovery are
repeatable, evidence-backed, and non-destructive. Any untested external alert is
recorded as residual operational risk rather than assumed to work.

### UAT-AX-01 — Accessible and usable critical journeys

**Priority:** P0 for critical journeys
**Capability state:** Core, plus enabled workspace branch
**Personas:** New author, public recipient, workspace owner
**Business outcome:** BO-09

**Preconditions:** Declared browser/screen-reader pairs; keyboard-only setup;
200% and 400% browser zoom; reduced-motion OS preference; light/dark themes;
`TD-UAT-RICH` and a pending workspace proposal.

**Steps and expected results:**

1. Without a pointer, execute the critical portion of UAT-NA-01: create/open,
   add/select/edit, undo/redo, switch page, save/export, and recover from or exit
   an overlay. Focus is visible, ordered, not trapped, and returns to the
   invoker when a dialog closes.
2. Open help, find, Node Designer or another modal, context menu, shared-copy
   confirmation, and workspace panel. Escape, Tab/Shift+Tab, arrow keys where
   appropriate, and Enter/Space work; canvas shortcuts do not fire through an
   open overlay.
3. With a screen reader, confirm controls have meaningful names; save failure,
   agent chip/proposal state, errors, and completed actions are announced without
   excessive repetition.
4. Review proposal preview and Problems indicators. Added/changed/deleted and
   warning states remain understandable without color alone.
5. At 200% and 400% zoom and a narrow public-view viewport, complete page
   navigation and shared-copy back/keep decisions without hidden essential
   controls or two-dimensional scrolling that prevents the task.
6. With reduced motion and calm mode, confirm animation does not obstruct
   authoring or playback control. Check light/dark focus and text contrast in
   critical surfaces.

**Acceptance:** Critical journeys meet the project's WCAG 2.2 AA target with no
open accessibility defect that prevents task completion, hides state, traps
focus, or relies on color alone. Record assistive technology, browser, zoom,
theme, participant outcome, and any documented exception.

---

## 7. Cross-scenario acceptance and traceability

The UAT lead updates the [traceability matrix](./TRACEABILITY_MATRIX.md) for the
tested release. At minimum, every production capability row links:

- a user outcome and persona;
- the relevant [user-guide](../USER_GUIDE.md) section;
- automated/manual QA coverage;
- one or more UAT scenario ids;
- applicable feature flag, integration condition, finding, or residual risk;
- the current run evidence and disposition.

For a change that affects document semantics, rerun the relevant authoring,
JSON round-trip, MCP round-trip, and export scenarios. For a change to auth,
storage, workspace, profile, admin, Worker configuration, or migrations, rerun
the related persona scenario plus UAT-OP-01. The QA lead may require additional
scenarios based on the change-risk map in the QA plan.

---

## 8. Defect severity and disposition

| Severity         | UAT definition                                                                                                                                    | Examples                                                                                                                                                         | Release treatment                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Sev-1 — Critical | Data loss, unauthorized access, secret or document-content exposure, persistent corruption, production unavailable, or an unsafe deployment path. | Shared link silently overwrites local work; autosave claims success but no recovery exists; non-owner reaches admin data; accepted proposal corrupts references. | Stop the affected cycle. Must be fixed and fully re-verified before GO.                   |
| Sev-2 — High     | A P0 business outcome cannot be completed reliably and no acceptable workaround exists.                                                           | Cannot export/open a deliverable; workspace silently drops a proposal operation; OAuth prevents hosted MCP use; keyboard user cannot exit a critical modal.      | Blocks GO unless reclassified by evidence; normally fixed and re-tested in the candidate. |
| Sev-3 — Medium   | Material friction or incorrect behavior with a safe, documented workaround.                                                                       | One layout command produces a poor but manually repairable arrangement; stale non-critical status text; a secondary browser needs a reload.                      | May permit CONDITIONAL GO with owner, workaround, due date, and product-owner acceptance. |
| Sev-4 — Low      | Cosmetic or minor documentation issue that does not mislead about saved, shared, authorized, or accepted state.                                   | Spacing, non-blocking copy issue, minor visual inconsistency.                                                                                                    | Does not block; track and prioritize normally.                                            |

Severity is based on user impact, not implementation effort. Any issue involving
public exposure, identity, secrets, data loss, false saved state, or deployment
migration safety is reviewed by QA and the appropriate security/operations
owner before disposition.

---

## 9. Evidence and reporting

Store evidence in the release's approved evidence location, never in public
share links or the repository when it contains tokens, account data, or internal
URLs. Use this naming convention:

`<cycle>-<scenario>-<run>-<sha>-<artifact>`

Required cycle artifacts are:

- environment/configuration record with secrets redacted;
- scenario run sheets and participant scores;
- before/after JSON for persistence and semantic round trips;
- SVG/PNG/flipbook samples for export scenarios;
- screenshots or short recordings of shared-copy, proposal, conflict,
  checkpoint, profile, admin, and accessibility outcomes;
- sanitized MCP transcript plus validation and `inspect_render` results;
- revision, proposal, lease, checkpoint, workspace, and snapshot identifiers
  where applicable;
- linked defects and re-test evidence;
- deployment workflow, exact SHA, approval, smoke, and recovery evidence;
- final UAT summary and signed decision.

Record facts rather than conclusions alone. For example, capture the local
document title before opening a share, the shared-slot title after opening, and
the restored title after `back to my document`, instead of recording only
“share passed.”

---

## 10. Entry and exit criteria

### 10.1 Entry criteria

All §4.1 prerequisites are met, and:

- the cycle scope identifies each capability as core, enabled/disabled gated,
  conditional in/out, or excluded;
- test data and identities are disposable and privacy-safe;
- expected results have been dry-run by the UAT lead without changing the
  participant instructions;
- there is enough time to fix and re-run a failed P0 scenario;
- evidence storage and defect tracking are available.

### 10.2 Exit criteria

A release may be recommended GO only when:

1. Every applicable pre-production core P0 scenario, including Phase A of
   UAT-OP-01, passes on the final candidate.
2. Every enabled feature-gated P0 scenario passes. A gated-off scenario has an
   approved `N/A — gated off` record and the disabled user experience was
   confirmed.
3. Every declared-in-scope conditional integration passes. Unavailable optional
   branches are recorded as N/A, not counted in the pass rate.
4. There are zero open Sev-1 or Sev-2 defects.
5. At least 90% of applicable P1 scenarios pass; each remaining Sev-3 has a
   documented workaround, owner, due date, and product-owner acceptance.
6. New-author confidence/output fitness and power-user customer-readiness scores
   average at least 4/5, with no critical persona outcome below 3/5.
7. Required browser/accessibility combinations have no task-blocking defect.
8. QA, UAT, user-guide, traceability, residual-risk, and exact-release evidence
   agree on what is enabled and supported.
9. The final staging smoke identifies the exact SHA before recommendation.
   Phase B of UAT-OP-01 verifies production after approval and must pass before
   the release record closes; it is not circularly required before approval.
10. Required signatories complete §11.

A recommendation is **CONDITIONAL GO** only for accepted Sev-3/documented
operational limitations; it cannot waive an applicable failed P0, open Sev-1 or
Sev-2, data-loss risk, auth/isolation failure, or untested migration safety.

---

## 11. Sign-off record

The completed cycle copies this table into the UAT report and links the signed
record. Blank rows in this living plan are intentional.

| Role                      | Name | Decision                                   | Date | Conditions/evidence |
| ------------------------- | ---- | ------------------------------------------ | ---- | ------------------- |
| Product owner             |      | GO / CONDITIONAL GO / NO-GO                |      |                     |
| UAT lead                  |      | Recommend / Do not recommend               |      |                     |
| QA lead                   |      | Quality gate accepted / rejected           |      |                     |
| Security/privacy reviewer |      | Accepted / rejected                        |      |                     |
| Release operator          |      | Operational evidence complete / incomplete |      |                     |
| Engineering owner         |      | Known-defect record complete / incomplete  |      |                     |

The final record also states:

- source SHA and deployment/workflow ids;
- UAT plan version and execution dates;
- enabled feature flags and in-scope conditional integrations;
- counts of PASS, FAIL, BLOCKED, and N/A by priority;
- open accepted conditions and due dates;
- link to the release traceability/evidence index.

---

## 12. Known residual risks requiring explicit acceptance

These are not automatic failures when behavior matches the user guide and the
release has not claimed otherwise. They must remain visible in the UAT report:

1. **Public snapshots are bearer links.** Anyone with the URL can open the
   snapshot without authentication. A snapshot expires after 30 days. The
   publisher can revoke/unpublish a live link (Share dialog, MCP
   `unpublish_topology`, or signed-in `DELETE /api/topology/:id`). Public GETs
   may remain in cache for about a minute. Do not publish sensitive topology
   data.
2. **A public snapshot is immutable.** Publishing an update creates another
   snapshot/link; editing a loaded shared copy changes its separate browser
   autosave slot, not the published source.
3. **Browser persistence is local.** The editor has a local document slot and a
   protected shared-copy slot, not a general browser document library. Storage
   can be unavailable or full; truthful failure status and downloadable JSON are
   the recovery path.
4. **Full touch editing is not a release promise.** Narrow/touch public viewing
   must remain usable, but desktop pointer/keyboard interaction is the primary
   authoring target.
5. **Real EdgeConnect evidence is conditional.** Mock-provider acceptance does
   not prove compatibility with a specific customer Orchestrator. A real-system
   claim requires UAT-MCP-03's approved real branch.
6. **Feature availability is deployment-controlled.** Workspace, preferences,
   and admin surfaces may be disabled independently. Documentation and support
   must not promise a gated surface when the target environment has it off.
7. **Admin history is metadata-only and activation-bounded.** It is not a
   complete historical audit log and must never expose diagram content, raw
   prompts, or MCP tool arguments. MCP-session trails are bounded and
   ephemeral with the session Durable Object. The revision-timeline guidance
   marker records only that `get_authoring_guidance` ran earlier in the same
   session — not that guidance caused the edit.
8. **Human view state is not MCP parity state.** Theme, zoom, pan, calm-canvas,
   panel layout, and similar local controls are outside document-semantic
   round-trip guarantees.
9. **Browser automation is not the whole acceptance matrix.** The current
   browser gate is intentionally small; manual UAT and QA evidence remain
   necessary for secondary browsers, assistive technology, hosted auth, Worker,
   and external integrations.
10. **Forward-only migration recovery applies.** Once a Durable Object migration
    is applied, recovery uses a new forward deployment and feature disablement,
    not rollback across the migration.

Any change to these risks requires a user-guide, QA, UAT, and traceability update
in the same release.

---

## 13. Maintenance and change control

- The UAT owner reviews this plan at every material release and at least
  quarterly while the product is active.
- Increment the major version when persona outcomes, scope, scenario intent, or
  acceptance gates change. Increment the minor version for executable-step,
  evidence, or environment refinements that do not change the gate.
- Preserve completed run records separately; do not rewrite historical evidence
  when this living plan changes.
- A feature is not considered acceptance-ready until its user-guide procedure,
  QA coverage, UAT scenario, traceability row, feature-state rule, and residual
  risks agree.
- When a scenario reveals a product defect, update the applicable automated
  regression coverage before closing the defect wherever practical, then rerun
  the full affected business journey on the fixed candidate.
