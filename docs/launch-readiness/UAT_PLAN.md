# Topology Dojo — Production Launch UAT Plan

> **Historical pre-launch snapshot (2026-07-04), superseded by the live
> production system.** The launch window this plan describes has passed;
> production has been live and iterating for weeks. For current status, see
> [`../ROADMAP.md`](../ROADMAP.md) and
> [`../CAPABILITY_MATRIX.md`](../CAPABILITY_MATRIX.md). Preserved as a record
> of the original UAT script, not as current guidance.

**Version:** 1.0 · **Date:** 2026-07-04 · **UAT window:** 30 days (Day 0 = kickoff, Day 30 = go/no-go)
**Product under test:** Topology Dojo — the canvas editor, the headless authoring API as exposed over MCP (stdio + remote Cloudflare `/mcp`), and shared services (validation, tidy/layout, render, share links, flipbook export).
**Environments:** Stable isolated staging Worker (app + `/mcp`, staging OAuth App, KV, and Durable Object namespaces) as the production candidate; production only for final smoke; local stdio MCP server for the agent-operator track; `TOPOLOGY_PROVIDER=mock` fixture fabric for live-data scenarios (plus one real EdgeConnect Orchestrator if available). Every UAT result records the active staging SHA; see [`../DEPLOYMENT_RUNBOOK.md`](../DEPLOYMENT_RUNBOOK.md).

---

## 1. UAT Objectives & Acceptance Criteria

### Objectives

1. **Dual-author parity.** Confirm the core product promise: the same document, renderer, and capabilities are available to a human at the canvas and an agent over MCP — no UI-only surfaces, no MCP-only surprises. Documents must round-trip between the two without loss.
2. **Authoring fitness for network/SASE engineers.** Confirm a network architect or presales SE can author a realistic, multi-page SASE topology (nodes, links, zones, flow paths, policy markers, layers) faster and with less friction than their current tool, using direct manipulation only.
3. **Agent authoring quality.** Confirm the agent loop (discover → build → validate → tidy → render) reliably produces overlap-free, presentable diagrams without human coordinate babysitting.
4. **Sharing & delivery.** Confirm `share_topology` links, flipbook HTML export, SVG render, and JSON import/export are dependable enough to put in front of customers.
5. **Operational readiness.** Confirm OAuth sign-in, private-draft registry behavior, canonical workspace revisions/migration, browser recovery, and share-link expiry semantics are understood and acceptable to real users.
6. **Release confidence.** Confirm the isolated staging deployment, source-SHA evidence, migration bootstrap/activation gates, smoke suite, and forward-recovery exercise are understandable and executable by the release owner.

### Launch acceptance criteria (all must hold at Day 30)

| #    | Criterion                                                                     | Threshold                                                                                    |
| ---- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| AC-1 | All **P0 scenarios** (S-A1, S-A2, S-B1, S-B2, S-C1, S-C2, S-X1) pass          | 100% pass, zero open Sev-1 defects                                                           |
| AC-2 | P1 scenarios pass                                                             | ≥ 90% pass; failures have workarounds and are ticketed                                       |
| AC-3 | Round-trip fidelity (editor → `get_topology` → `import_topology` → editor)    | Byte-equivalent document semantics; zero element loss across all test documents              |
| AC-4 | Agent-built diagrams after `validate_topology` + `tidy_topology`              | Zero overlap/crowding/off-page **warnings** remaining on ≥ 95% of runs; zero semantic errors |
| AC-5 | Persona satisfaction (rubric §5)                                              | Mean ≥ 4.0/5 per persona; no dimension below 3.0                                             |
| AC-6 | "Would you use this for your next customer diagram?" (SE persona)             | ≥ 75% yes                                                                                    |
| AC-7 | Share links open correctly in a clean browser (no auth, no cache)             | 100% across tested documents                                                                 |
| AC-8 | No data-loss incidents (autosave, session state, or export) during the window | 0 incidents, or each fully explained by documented session semantics with sign-off           |

---

## 2. Participant Personas

### P-A: Network Architect ("Asha")

Designs enterprise WAN/SASE reference architectures. Cares about correctness, layer semantics (underlay/overlay/policy/service), custom node vocabulary, and that diagrams stay maintainable as documents-of-record. Power user: expects keyboard shortcuts (Ctrl+F find, `T` tidy), align/distribute, select-by, undo/redo depth. Will exercise: Node Designer, document layers, validation, JSON export as source of truth.

### P-B: Presales SE ("Ben")

Draws customer-specific topologies under time pressure, often live in meetings. Cares about speed-to-pretty: templates (`sdwan-branch`, `ztna`, `hub-spoke`), palette/branding (`set_palette` equivalent in-editor), legend, flipbook storytelling across pages, calm-canvas for projector demos, and above all **shareability** (share link, flipbook HTML, SVG). Moderate tool skill; low tolerance for friction.

### P-C: AI-Agent Operator ("Cleo")

Runs an MCP client (Claude Desktop/Claude Code) connected to Topology Dojo — locally over stdio and remotely at `https://<domain>/mcp` via GitHub OAuth. Prompts an agent to build topologies from prose and from live fabric data (mock provider; real Orchestrator if available). Cares about: tool discoverability (`describe_capabilities`, `layout_guidelines`), the validate→tidy loop, idempotent re-runs (`upsert_by_source`), `build_flow_topology`, and handing results to humans (`share_topology`).

**Recruitment target:** 3–4 participants per persona (9–12 total), plus 1 facilitator and 1 note-taker per session. P-C participants must have prior MCP client experience.

---

## 3. End-to-End Scenarios

Severity legend: **P0** = launch-blocking, **P1** = must-fix-or-waiver, **P2** = advisory.
Each scenario is run as a scripted session (facilitated, think-aloud) and scored pass/fail per step plus the rubric in §5.

---

### Persona A — Network Architect

#### S-A1 (P0): Author a 3-site SASE topology across 5 pages and export it as the document of record

**Goal:** Build "Acme Global SASE" — HQ, branch, and data-center sites converging on a SASE PoP — told across 5 flipbook pages (baseline → underlay → overlay tunnels → policy → steady state).

**Script:**

1. Open the app; create a new document; rename it via document properties in the inspector.
2. Page 1 ("Sites"): from the catalog palette, place per site: `host` users, `ec` (Edge Connector), `router`, `firewall`, `switch`; a `cloud` (Internet) and `saas` node; group each site's nodes into a **zone** from the current selection. Use grid + snap and smart alignment guides throughout.
3. Define document **layers** underlay / overlay / policy; assign elements as built.
4. Page 2: duplicate Page 1 from the filmstrip; add underlay `line`/`optical` links (tagged `layer: underlay`); bend at least one link with **waypoint editing** (drag handle, add via segment midpoint, double-click remove).
5. Page 3: duplicate; add `tunnel` and `wireguard` overlay links between ECs and the PoP; attach one link to a free-floating **anchor** using the anchor tool.
6. Page 4: duplicate; add **policy markers** (on the policy layer) and a **flow path** tracing branch-user → SaaS via the PoP.
7. Page 5: duplicate; set per-page `duration`/`transition` in the inspector; verify the filmstrip **play** control steps through all 5 frames.
8. Run **Tidy** (`T`) on the messiest page; use align/distribute on one site's node row; use Ctrl+F to jump to a named node; use select-by (type = `ec`) then invert.
9. Toggle layer visibility (hide underlay, show overlay+policy); toggle light/dark and calm-canvas.
10. Export document JSON; close the tab; reopen — confirm **autosave** restored the document; then import the exported JSON into a fresh browser profile and confirm identity.

**Pass criteria:**

- Every step completes without documentation lookup beyond in-product affordances.
- Duplicating a page never mutates its sibling (flipbook independence verified by editing page 3 and checking page 2).
- Zones auto-contain their members; waypoints, anchors, layers, durations all survive export → import byte-for-byte semantically.
- Tidy leaves zero overlapping nodes/labels and moves nothing off-page.
- Autosave restores the exact pre-close state.
  **Fail if:** any element type in the palette cannot be placed/edited via inspector; any cross-page edit leakage; any export/import loss; undo/redo corrupts state at any step.

#### S-A2 (P0): Custom vocabulary with the Node Designer, reachable from both authoring surfaces

**Script:**

1. In the Node Designer, create a custom node type "SSE-POP" (declarative spec: shape + icon + label styling); place instances on the canvas; confirm live art preview in the palette.
2. Export the document JSON; confirm the `CustomNodeSpec` is stored **as data** in `customNodes`.
3. Via MCP (`import_topology` on the stdio server), load the same JSON; call `describe_capabilities` with the `topologyId` and confirm "SSE-POP" appears with its fields; have the agent `add_node` of that type; `render_svg` and visually compare against the browser render.
4. Round-trip back into the editor and edit the agent-added instance.

**Pass criteria:** custom type is discoverable, addable, renderable, and editable identically on both surfaces; renders are visually equivalent (same art, static frame, no replay artifacts).
**Fail if:** custom type is UI-only in any respect (violates the catalog parity contract).

#### S-A3 (P1): Validation as a safety net

**Script:** Deliberately break a copy of the S-A1 document (dangling link endpoint via raw JSON edit, duplicate id, out-of-range enum, node dragged off-page, two nodes stacked). Import; run validation via MCP `validate_topology`; confirm each defect is reported (semantic errors vs. layout warnings correctly classified); confirm rendering still succeeds despite warnings ("fail loud at author time, never silent at present time"); fix via editor + `update_element`/`remove_element` (with dependent cascade) and re-validate to clean.

**Pass criteria:** all five seeded defects detected and correctly classed; `remove_element` cascades dependents (links on a removed node); clean re-validation. **Fail if:** any seeded defect is silently accepted or breaks the render.

---

### Persona B — Presales SE

#### S-B1 (P0): From template to customer-branded topology and share it with a customer — under 45 minutes

**Goal:** Simulate the real presales motion: customer meeting at 2pm, diagram needed now.

**Script:**

1. Create from the `sdwan-branch` template; extend to the customer's shape: 3 branches, 2 DCs, dual PoPs — reusing template elements via copy/duplicate.
2. Apply customer branding: brand palette (canvas accents + chrome), enable and position the auto-generated **legend**, set the document title.
3. Add a `blocked` link to show the "before" state and a `flow` link for the "after"; set per-link flow controls (speed/particles/direction) on the money shot.
4. Tell the story in 3 pages (before / migration / after) with page durations; verify play.
5. **Share:** use the share flow to publish a durable snapshot; open the returned `/v/<id>` link in an incognito window (no GitHub auth, cold cache) and confirm the customer-view loads the full document into the editor.
6. **Export flipbook:** produce the standalone self-playing HTML; open it from the filesystem with no network and confirm all pages play on their durations.
7. Re-publish the share after one more edit; confirm the link semantics (new/refreshed snapshot) and confirm the 30-day expiry is communicated to the user somewhere discoverable.

**Pass criteria:** end-to-end in ≤ 45 min by a first-week user; share link works logged-out; flipbook HTML is fully offline-standalone; branding and legend appear in the shared/exported artifacts identically to the canvas. **Fail if:** the share link requires auth, breaks after the MCP/browser session ends, or the exported flipbook depends on the network.

#### S-B2 (P0): Live demo resilience

**Script:** Present the S-B1 flipbook on a projector profile: calm-canvas on (animations paused), dark mode, zoom/pan with space-drag, minimap navigation, Ctrl+F jump to "Branch 3" mid-demo, answer an on-the-spot "what if we add a 4th branch?" by live-editing (place node, draw tunnel, Tidy) in front of the audience, undo it all afterwards.

**Pass criteria:** no visual glitches on theme/calm toggles; live edit + Tidy + full undo chain works under pressure; find/jump lands the viewport correctly. **Fail if:** any interaction requires a reload or loses state.

#### S-B3 (P1): Rescue an ugly diagram

**Script:** Import a provided fixture document with deliberately bad geometry (agent-generated, overlapping). Use the **arrange…** dropdown (hierarchical, then grid) and **Tidy**; compare; pick the best; hand-polish with align/distribute and spacing guides.

**Pass criteria:** at least one arrange algorithm yields a presentable result in < 5 minutes; Tidy is deterministic (same input → same output on re-run). **Fail if:** arrange/tidy makes geometry worse or destabilizes zones.

---

### Persona C — AI-Agent Operator (MCP)

#### S-C1 (P0): Agent builds a topology via MCP and a human refines it in the editor

**Goal:** The flagship handoff loop, run against the **remote** `/mcp` endpoint.

**Script:**

1. Connect the MCP client to `https://<domain>/mcp`; complete the GitHub OAuth 2.1 flow (single authorize click, dynamic client registration, no pasted tokens).
2. Prompt: _"Build a 3-site SASE topology: HQ, branch, DC, each with users → Edge Connector, converging on a SASE PoP with ZTNA to two SaaS apps. Zones per site, tunnels on an overlay layer, one policy marker at the PoP, a flow path from branch user to SaaS. Make it clean, then hand the draft into our shared workspace."_
3. Observe the agent loop; the expected tool sequence is: `describe_capabilities` → `layout_guidelines` → `create_topology` → authoring tools → `validate_topology` → `tidy_topology` (or `layout_topology`/`balance_topology`) → `render_svg` → `get_workspace_manifest` (lazy handoff).
4. Record: does validation come back clean (or warnings resolved by tidy)? Inspect the rendered SVG.
5. Human opens the topology from the Agent Workspace list, refines it (rename nodes, bend a link, adjust a zone, add a page), and confirms compact revision sync.
6. Agent calls `get_workspace_changes` from its prior revision, hydrates only the affected elements, and submits one label change with `propose_workspace_changes`. Human reviews and accepts it. Repeat a disjoint concurrent edit (must rebase) and a same-field edit (must conflict).

**Pass criteria:**

- OAuth completes without manual token handling; discovery endpoints work with the client.
- Final agent-built page has **zero** layout warnings and zero semantic errors.
- The SVG matches the document (all elements present, layers stacked correctly).
- The workspace opens the agent's exact result; human edits and accepted agent proposals compose without loss or whole-document resend.
  **Fail if:** any editor-expressible element (zone, waypointed link, anchor, layer, custom node, page duration) fails to survive either direction of the handoff — this is a direct violation of the product contract and is automatically Sev-1.

#### S-C2 (P0): Agent builds from live fabric data (mock provider) — the one-shot and the idempotent re-run

**Script (stdio server, `TOPOLOGY_PROVIDER=mock`):**

1. Prompt the agent to inventory the fabric: `describe_data_source`, `list_appliances`, `list_tunnels`, `get_overlay_policies`, `list_flows` (+ one `get_flow_details`).
2. Run **`build_flow_topology`** — confirm the output: appliances as nodes, sites as zones, underlay/overlay tunnels as links on their declared layers, flows as animated flow paths with per-hop data, policy markers on the steering overlay; every element carries a `source` ref.
3. `validate_topology` → confirm clean or tidy-to-clean; `render_svg` with `visibleLayers` filtering (underlay only, then overlay only).
4. **Re-run** `build_flow_topology` / the upsert flow against the same document: confirm convergence via `upsert_by_source` — element counts unchanged, no duplicates, freshness updated.
5. Confirm credential hygiene: the agent transcript contains no credentials; provider config came only from env (`ORCH_BASE_URL`/`ORCH_API_KEY` or mock).
6. _(If a real Orchestrator is available: repeat 1–4 against it as P1.)_

**Pass criteria:** one-shot produces a layered, tidy, validated document; re-run is idempotent (converges, never duplicates); layer filtering renders correctly; zero credentials in tool arguments or output. **Fail if:** re-import duplicates sourced elements or any credential appears in a tool call.

#### S-C3 (P1): Session-state honesty and template/flipbook coverage over MCP

**Script:**

1. Remote session: build a small private draft. Kill/expire the MCP transport session; reconnect and confirm the per-owner registry rehydrates it. Hand it into a workspace, expire the session again, then confirm the browser and a new MCP session see the same canonical revision. Confirm `share_topology` remains a separate published-snapshot workflow.
2. `list_templates` → instantiate each of the six templates (`three-tier`, `sdwan-branch`, `ztna`, `firewall-dmz`, `spine-leaf`, `hub-spoke`) → `validate_topology` + `render_svg` each: all must be warning-free out of the box.
3. Build a 3-page document with `add_page` + `set_page_properties` (name, viewBox, duration); `export_flipbook`; open the HTML artifact and verify page timing.
4. Exercise remaining metadata tools: `set_node_metadata` (serial/hostname/site), `set_legend`, `set_palette` (then `clear`), `define_node_type`, `set_document_title`; confirm each is visible in a subsequent `get_topology` and in the render.

**Pass criteria:** draft and canonical workspace persistence match docs exactly; all six templates validate clean; every metadata tool round-trips into document JSON. **Fail if:** a template ships with validation warnings, a transport session loss drops owner data, or any tool "succeeds" without durable state.

---

### Cross-cutting

#### S-X1 (P0): Contract parity audit

With one rich reference document (superset: every builtin node type incl. `shape:*` and `text`, every link type `line/tunnel/wireguard/flow/packet/blocked/wifi/poe/optical`, anchors, all annotation kinds, all four layers, custom node, legend, palette, metadata, multi-page with durations): author half in the editor and half via MCP; round-trip both ways; render on browser, Node (stdio `render_svg`), and Worker (remote `render_svg`); diff the three SVGs for material differences. **Pass:** full vocabulary reachable from both surfaces; three renderers agree. This scenario operationalizes AC-3 and Design Principle #2.

#### S-X2 (P1): Scale & endurance

A 5-page document with ~60 nodes/page, 10 zones, 20 flow paths: editor interaction latency (drag, marquee, guides) subjectively acceptable (< ~100 ms feel); Tidy completes < 5 s; `render_svg` < 10 s remote; autosave keeps up; a 2-hour editing session with ≥ 200 undo steps stays stable.

#### S-X3 (P2): Accessibility & environment sweep

Chrome/Firefox/Safari/Edge current; 13" laptop and external 4K; keyboard-only pass through core flows; light/dark/calm in each.

---

## 4. Feedback Capture

- **During sessions:** facilitator runs the script; note-taker logs per-step outcome (pass / pass-with-friction / fail), verbatim think-aloud quotes, timestamps, and screen recordings. Every friction point gets a severity + the step ID (e.g. `S-B1.5`).
- **Defects:** filed same-day in the tracker with scenario/step ID, document JSON attached (the JSON _is_ the repro), agent transcript for MCP scenarios, and SVG/screenshot. Severity: **Sev-1** data loss / contract-parity break / auth failure / share-link failure; **Sev-2** scenario blocked with workaround; **Sev-3** friction/polish; **Sev-4** cosmetic.
- **Post-scenario survey** (per participant, per scenario): the rubric below plus three free-text prompts — "What almost made you give up?", "What surprised you positively?", "What's missing for your real work?"
- **Agent-run telemetry (P-C):** for each agent scenario, archive the full tool-call sequence, validation warning counts before/after tidy, and retry counts — these feed AC-4 quantitatively.

### Scoring Rubric (1–5 per dimension, per scenario)

| Dimension                                                                                             | 1                           | 3                               | 5                                |
| ----------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------- | -------------------------------- |
| **Task success**                                                                                      | Abandoned                   | Completed with facilitator help | Completed unaided                |
| **Efficiency**                                                                                        | > 2× time budget            | Within budget with friction     | Well under budget                |
| **Output quality**                                                                                    | Wouldn't show a customer    | Acceptable with touch-up        | Customer-ready as produced       |
| **Trust** (validation/tidy/autosave/share did what was expected)                                      | Lost work or was misled     | Minor surprises, recoverable    | Fully predictable                |
| **Learnability**                                                                                      | Needed docs/help constantly | Occasional lookup               | Discovered everything in-product |
| **Agent quality** (P-C only: warnings-after-tidy, tool-call efficiency, no hallucinated capabilities) | Broken output               | Usable after human rescue       | Clean, minimal loop              |

Weighted score per persona = mean across their scenarios; AC-5 applies.

---

## 5. Go/No-Go Decision Framework

**Decision meeting: Day 28.** Attendees: product owner, eng lead, UAT facilitator, one representative per persona. Decision is **GO / CONDITIONAL GO / NO-GO**, recorded with rationale.

| Gate                                                                                                                                                    | GO                                    | CONDITIONAL GO                                                   | NO-GO            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------- | ---------------- |
| P0 scenarios (S-A1, S-A2, S-B1, S-B2, S-C1, S-C2, S-X1)                                                                                                 | All pass                              | — (P0 failures cannot be conditioned away)                       | Any fail         |
| Sev-1 defects                                                                                                                                           | 0 open                                | 0 open (fixed + re-verified)                                     | Any open         |
| Sev-2 defects                                                                                                                                           | 0 open, or all waived with workaround | ≤ 3 open, each with documented workaround + fix date ≤ Day 30+14 | > 3 open         |
| Contract parity (AC-3, S-X1)                                                                                                                            | Clean                                 | —                                                                | Any element-loss |
| Agent layout quality (AC-4)                                                                                                                             | ≥ 95% clean-after-tidy                | 90–95% with root cause understood                                | < 90%            |
| Rubric (AC-5/AC-6)                                                                                                                                      | Met                                   | Within 0.3 of threshold with an agreed remediation plan          | Below            |
| Operational readiness (OAuth, share-link expiry comms, session-state docs, deploy runbook incl. the `wrangler deploy`-not-`versions-upload` constraint) | Signed off                            | Minor doc gaps                                                   | Runbook untested |

**Conditional GO** requires: named owner per condition, dates, and a scheduled Day 30+14 re-check. Explicitly out of launch scope (do **not** gate on): durable DO session persistence, per-key MCP auth hardening, in-GUI layout-warning badges, legacy Topology Studio importer — all tracked roadmap candidates; UAT should only confirm their absence is _acceptably communicated_, not that they exist.

---

## 6. Schedule — 30-Day Window

| Days      | Phase                        | Activities                                                                                                                                                                                                                                                                                                     | Exit criteria                                           |
| --------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **0–2**   | Readiness                    | Freeze the release candidate; deploy to prod-candidate Worker; verify OAuth app, `OAUTH_KV`, `TOPOLOGY_KV`, `PUBLIC_BASE_URL`; smoke the golden path on all three surfaces; stage fixture documents (S-A3 broken doc, S-B3 ugly doc, S-X1 superset doc) and the mock provider; recruit & schedule participants | Smoke pass; participants confirmed                      |
| **3–4**   | Dry run                      | Facilitators execute every script once themselves; fix script bugs, calibrate time budgets                                                                                                                                                                                                                     | Scripts frozen v1                                       |
| **5–11**  | **Round 1 — persona tracks** | Days 5–7: P-A sessions (S-A1..A3). Days 7–9: P-B sessions (S-B1..B3). Days 9–11: P-C sessions (S-C1..C3). Parallel: S-X3 sweep                                                                                                                                                                                 | All scenarios executed ≥ 3× each; defects triaged daily |
| **12–13** | Triage & fix checkpoint      | Severity triage; Sev-1/Sev-2 fix sprint begins; scripts amended if product changes                                                                                                                                                                                                                             | Fix list committed                                      |
| **14–18** | Cross-cutting & integration  | S-X1 parity audit (2 dedicated days), S-X2 scale, real-Orchestrator run of S-C2 if fabric access lands; regression re-run of any scenario touched by fixes                                                                                                                                                     | Parity audit report; AC-3/AC-4 numbers computed         |
| **19–23** | **Round 2 — verification**   | Re-run every previously failed or friction-heavy scenario with fixes deployed; fresh participants where possible (learnability re-test); collect final rubric surveys                                                                                                                                          | All P0 re-verified on the final build                   |
| **24–26** | Consolidation                | Compile scores vs. AC-1..AC-8; write UAT report; ops runbook sign-off; confirm share-link expiry + session-state messaging shipped in docs/UI                                                                                                                                                                  | Draft go/no-go packet circulated                        |
| **27**    | Buffer                       | Held for slipped re-verification only                                                                                                                                                                                                                                                                          | —                                                       |
| **28**    | **Go/No-Go meeting**         | Apply §5 framework; record decision + conditions                                                                                                                                                                                                                                                               | Decision recorded                                       |
| **29–30** | Launch prep / execute        | GO: production deploy (`npx wrangler deploy`), post-deploy smoke (auth → build → validate → tidy → render → share on the live origin), announce. NO-GO: remediation plan + re-test date                                                                                                                        | Live smoke pass                                         |

**Standing cadence:** 15-min daily defect triage (facilitator + eng lead); Day 12 and Day 21 stakeholder check-ins; all session artifacts (recordings, JSON fixtures, agent transcripts, SVGs) archived per scenario run.
