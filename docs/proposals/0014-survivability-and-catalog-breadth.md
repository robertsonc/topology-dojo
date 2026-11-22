# Proposal 0014: Survivability analysis, dependency vocabulary and catalog breadth

**Status:** Draft, not accepted. No packet has started.

**Captured:** 2026-11-22. Reviewed against the code at `39c5513` the same
day; section 12 lists what the review changed.

**Owner:** Topology Dojo maintainers

**Supersedes:** the "Architect Enhancement Roadmap & Plugin SDK Plan" drafts
(v1 and v2), which were written from a file listing. This proposal keeps the
three ideas from those drafts that hold up against the code and drops the
rest (see "Considered and dropped").

## 1. Problem

A Dojo page can say what is connected. It cannot say what stops working when
something fails. Architects get that question at every design review and
change board. The hardware catalog and wire sheets should be able to answer
it, because the page already knows which cables share a switch, a LAG or a
transport.

Three gaps stand between the current code and that answer:

1. **No failure analysis.** `analyzePath` (`src/api/path.ts`) already routes
   around `blocked` links and `status: "down"` elements, but nothing asks
   "which single failure separates A from B" or "what is cut off if this
   goes down".
2. **No dependency vocabulary.** The document has no way to say that two
   cables share a conduit, a provider or a PDU, or that an overlay tunnel
   depends on specific underlay elements. `bandwidth` is a free string, so
   capacity cannot be summed.
3. **Five hardware models.** `catalog/data/models/` holds five entries.
   Wire sheets and the catalog rules are only as useful as the hardware
   they cover, and the official feed (hw-catalog Phase 6) has no source yet.

## 2. Goals

- **G1. Honest answers.** Every result is labelled topological: it reports
  what the drawn graph permits, never what a routing protocol will do.
- **G2. No new MCP tools.** The tool list is at its ceiling (section 4).
  Everything here ships as arguments, `edit_topology` operations, export
  formats and document fields.
- **G3. Additive document change only.** New optional fields, tolerant
  parsing, no `schemaVersion`, no migration, no new stored operation type.
- **G4. One graph.** Survivability uses the graph `path.ts` already builds
  (layers, anchors, parallel links, blocked rules). No second definition.
- **G5. Catalog breadth without diluting trust.** Community-sourced models
  are visibly not GA-eligible and their panels are visibly schematic, using
  the provenance machinery that already exists.
- **G6. Stop the two large files growing** while this work lands.

## 3. Non-goals

- Forwarding simulation: no BGP/OSPF convergence, no HA timers, no policy
  or stateful-firewall evaluation. Reachability policy stays out of scope.
- Traffic-aware capacity. There is no demand matrix; the engine reports
  remaining nominal capacity, never "oversubscribed".
- Story output. `compile_flow_story` (T4) stays held. `src/stories/` works
  on provider records (`FabricState`), not on page graphs, so it cannot take
  page-level results without new adapter work.
- A plugin SDK, a `src/shell/` split or a rewrite of the render pass.
- Derived Logical / Overlay pages. A good idea that depends on S1 and S4;
  proposed separately once `ridesOn` exists.
- Juniper Mist. Decision 0002 gates it behind the EdgeConnect E packets.
- Topology import from NetBox (0009 IM3). Packet C imports device types
  into the hardware catalog, which is a different lane.
- Modular chassis composition. Needs its own fixture first (hw-catalog.md,
  "Seed coverage").

## 4. What already exists (verified in code at `39c5513`, 2026-11-22)

| Fact                                                                                                                                                                                                                                                                                                                                                                                                                   | Where                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `analyzePath` avoids `blocked` links and `status: "down"` nodes and links, but when only blocked routes exist it still returns them as `found` with `blockedOnly: true`. The two ends may themselves be down. Several links between the same two elements are one hop                                                                                                                                                  | `src/api/path.ts`                                 |
| The graph holds only visible layers (`layerVisible`). `buildGraph` is private and takes the two ends, because a down node is exempt when it is an end                                                                                                                                                                                                                                                                  | `src/api/path.ts`                                 |
| `analyze_path` is one tool of 883 bytes in the list, with a comment asking it to stay under 900                                                                                                                                                                                                                                                                                                                        | `src/mcp/path-tools.ts`                           |
| Tool-list ratchets: stdio 35 tools / 44,200 B, hosted 64 tools / 67,800 B, 3,400 B per tool                                                                                                                                                                                                                                                                                                                            | `src/mcp/token-budget.test.ts`                    |
| Measured: stdio 35 tools / 44,088 B (112 B free); hosted 64 tools / 67,614 B (186 B free). Both tool counts are at their cap. `export_topology` is 3,278 B, so 122 B under the per-tool cap. `edit_topology` is 1,955 B                                                                                                                                                                                                | measured with a temporary copy of the budget test |
| Document-level declarations (`define_bundle`, `define_tier`, `define_link_style`) are op-only `edit_topology` operations (`OP_ONLY_TOOLS`), not tools and not field-catalog fields. Each op name is printed in both the `edit_topology` and `describe_operations` descriptions                                                                                                                                         | `src/mcp/tools.ts`                                |
| Workspace edits to document-level fields go through the existing `document.patch` operation, limited to `DOCUMENT_FIELDS` (which lists `tiers` and `bundles`)                                                                                                                                                                                                                                                          | `src/workspace/operations.ts`                     |
| Bundles are per link end (`fromBundle` / `toBundle`), declared in `doc.bundles`; one bundle name can span two nodes (ESI-LAG)                                                                                                                                                                                                                                                                                          | `src/api/bundles.ts`                              |
| `LinkConfig` has `bandwidth?: string`, `transport?: string`, `status`; `NodeConfig` has `status`. No SRLG or dependency field anywhere                                                                                                                                                                                                                                                                                 | `src/vendor/topology-ds.ts`                       |
| The field catalog has `number`, `ref` and `refs` kinds. `layer` and `tier` are already `ref` fields that point at document-level declarations. A `FieldSpec` does not say what a ref points at                                                                                                                                                                                                                         | `src/api/catalog.ts`                              |
| Negotiated speed per bound cable is computed (`speedMbps`) during catalog validation, which loads the catalog asynchronously. The loader is wired on stdio (`src/mcp/server.ts`) and on the Worker                                                                                                                                                                                                                     | `src/catalog/validate.ts`, `src/mcp/tools.ts`     |
| `export_topology` formats are an enum; `cable-schedule` is a derived report with a CSV / XLSX switch                                                                                                                                                                                                                                                                                                                   | `src/mcp/export-tools.ts`                         |
| `provenance` rows (`official_doc`, `internal_doc`, `reseller`, `inferred`), `position_confidence` (`traced`, `schematic`), `slots`, `breakout`. Every interface requires `name`, `physical` (a platform port) and `role` (`data`, `wan`, `lan`, `mgmt`, ...)                                                                                                                                                           | `catalog/schema/catalog.schema.json`              |
| GA-eligible means at least one `official_doc` or `internal_doc` row; the stencil export leaves the rest out, and the catalog build prints one `WARN` per non-GA model. The tier enum is mirrored in `src/catalog/types.generated.ts`                                                                                                                                                                                   | `src/catalog/catalog.ts`, `src/catalog/build.ts`  |
| Optic acceptance rows (`cage_accepts`) exist for `sfp`, `sfp_plus`, `sfp28`, `sfp56`, `qsfp28` only                                                                                                                                                                                                                                                                                                                    | `catalog/data/optics.json`                        |
| Catalog tools are "stdlib + jsonschema"; CI pins `jsonschema==4.23.0` and runs `check_seed.py`, `ref_validate.py` and `resolve_probe.py`                                                                                                                                                                                                                                                                               | `catalog/README.md`, `.github/workflows/ci.yml`   |
| The six headless directories (`core`, `api`, `catalog`, `connect`, `import`, `export`) compile with `lib: ["ES2022"]` and `types: ["node"]` except for 3 errors: `window` and `SVGSVGElement` in `src/vendor/topology-ds.ts`, `window` in `src/nodes/render.ts`. Dropping Node types adds more, because `src/catalog/build.ts` and `gen-types.ts` use `node:fs`, and because `structuredClone` is typed by DOM or Node | `tsc` with a temporary config                     |
| Five files import `../editor/legend.js` from outside `src/editor`: `src/render/overlays.ts`, `src/render/port-table.ts`, and three tests (`src/api/link-styles.test.ts`, `src/render/status.test.ts`, `src/render/port-pills.test.ts`). `legend.ts` itself imports only from `src/pages` and `src/api`                                                                                                                 | grep                                              |
| `eslint.config.js` has no import rules today                                                                                                                                                                                                                                                                                                                                                                           | `eslint.config.js`                                |
| `src/main.ts` is 7,145 lines; `src/editor/editor.ts` is 6,199                                                                                                                                                                                                                                                                                                                                                          | `wc -l`                                           |
| The SD-WAN generator puts underlay tunnels (layer hidden by default on EdgeConnect), overlay tunnels, transport clouds and WAN circuits on one page. Circuits and clouds are drawn only at device detail                                                                                                                                                                                                               | `src/connect/generate.ts`                         |
| `TunnelRecord` has `scope` and `overlay` but no bonded-to-member list                                                                                                                                                                                                                                                                                                                                                  | `src/connect/types.ts`                            |

Not verified: no test suite was run end to end, no Orchestrator payload was
inspected, and the upstream NetBox device-type library (licence, interface
type slugs) was not re-read in this review.

## 5. Design

### G0. Guardrails

1. Move `legend.ts` from `src/editor/` to `src/render/` and update its five
   outside importers (two modules, three tests). Leave a re-export in
   `src/editor/` only if the editor's own imports are many. This removes
   every import from `src/api` or `src/render` into `src/editor`.
2. Fix the three DOM references reached from headless code, or isolate
   them behind a browser-only module.
3. Add `tsconfig.headless.json` (`lib: ["ES2022"]`, `types: ["node"]`, no
   DOM) over the six headless directories and run it in `ci.yml`. It
   checks "no DOM". It does not check that code runs on the Worker, since
   Node types stay in. Say so in the file.
4. Add `no-restricted-imports` to `eslint.config.js`, in a block scoped to
   `src/{core,api,catalog,connect,import,export,stories,pages,render}`
   including their tests: they may not import `src/editor` or `src/ui`.
5. Add `max-lines` as an error on the two files, set to their line counts
   when G0 merges (7,145 and 6,199 today; ESLint's default counting, blank
   lines and comments included). The number only goes down, in the PR that
   shrinks it.

No file is split in this packet.

### S1. Document vocabulary

All optional. Element fields go through the field catalog, so
`describe_capabilities`, `edit_topology`, the workspace operation vocabulary
and the properties panel get them. The document-level declaration goes the
way `doc.bundles` and `doc.tiers` already go. Neither path adds a stored
operation type (0008 criterion 2).

- **`doc.riskGroups?: RiskGroupDef[]`** declares shared-risk groups:
  `{ id, label?, kind?: 'provider' | 'circuit' | 'conduit' | 'power' | 'site' }`.
  Written by a new op-only `edit_topology` operation, `define_risk_group`
  (added to `OP_ONLY_TOOLS`, with `remove: true` like `define_bundle`), and
  in a workspace by `document.patch` once `riskGroups` is added to
  `DOCUMENT_FIELDS`. No tool is added. The op name is printed in two tool
  descriptions, about 40 bytes of the stdio list's 112 B headroom; S1
  measures it and states the number.
- **`srlg?: string[]`** on nodes and links names the groups an element
  belongs to: a `refs` field pointing at `doc.riskGroups`, with the same
  precedent as `tier` pointing at `doc.tiers`. An undeclared id is a
  validation warning. A risk-group id that equals an element id on any
  page is a validation error, because `fail` (S3) takes both in one list.
- **`capacityMbps?: number`** on links. When it is absent on a link whose
  ends are bound to hardware, the engine may use the negotiated speed the
  catalog computes (S2). `bandwidth` stays display text and is never
  parsed.
- **`ridesOn?: string[]`** on links: ids of nodes or links on the same page
  that this link depends on. **`ridesOnMode?: 'all' | 'any'`** (default
  `all`). An underlay tunnel that needs its circuit and its transport cloud
  is `all`. A bonded overlay tunnel that survives while any member tunnel
  is up is `any`. References are page-local because pages are independent
  frames. A cycle is a validation error.

`ridesOn` is contract data like `source`: the renderer ignores it. The
properties panel needs to know what `srlg` and `ridesOn` point at to offer
a picker. `FieldSpec` has no target hint today, so S1 adds one (or
special-cases the two fields the way `tier` is handled). Pick one in the S1
PR.

### S2. Engine: `src/api/survive.ts`

Pure and DOM-free. It reuses the graph builder from `path.ts` (exported
for this, currently private) and does not change how `analyzePath` reads a
page.

- **Faults are removed, not blocked.** A faulted element is left out of the
  graph entirely. It is not marked down. Otherwise `analyzePath`'s
  blocked-only fallback would return a route through the failed element as
  `found` with `blockedOnly`. The hidden-layer hint (`hiddenLayers`) is
  computed without the faulted elements as well.
- **Connected** means `found` without `blockedOnly`, both before and after.
  "Before" is the page as it stands, including elements already marked
  down.
- **`expandFaults(page, faults)`** takes element ids and risk-group ids and
  returns the full down set: group members, then `ridesOn` dependents, until
  nothing changes. Expansion reads every element on the page **whatever its
  layer's visibility**. A generated EdgeConnect page hides the underlay by
  default, and an overlay tunnel that rides on hidden underlay tunnels must
  still go down with them. The baseline expands existing `status: "down"`
  elements the same way, so "before" and "after" are consistent. It never
  mutates the page.
- **An endpoint in the expanded set** is reported as `endpointFailed`, never
  routed around. That covers a site-power group that contains the branch
  itself.
- **`analyzeFaults(page, pairs, faults, opts)`** reports for each pair: was
  it connected before and after, the change in hop count, and for each hop
  on the surviving route that has parallel links, the remaining nominal
  capacity. That is members up over members total, in Mbps when every member
  has a capacity, otherwise as a count. Capacity is per hop (the parallel
  group), not per bundle. Bundles are named per link end, and an ESI-LAG's
  bundle spans two hops. When every link in a hop shares one bundle name,
  the hop carries that name.
- **Negotiated speed is an input.** `survive.ts` takes an optional
  `speeds: Map<linkId, Mbps>`. The tool layer fills it from the catalog
  loader (asynchronous; stdio and Worker both have one). Without it, links
  with no `capacityMbps` count as members only. This keeps the engine
  synchronous and catalog-free.
- **`findSpofs(page, pairs, opts)`** fails each fault unit in turn (each
  node that is not an endpoint, each link, each risk group; never an
  anchor), expands it, and tests every pair. One breadth-first search per
  distinct source answers every pair that shares it, so the cost is units ×
  sources × (V + E). It carries a step budget and sets `truncated` the way
  `analyzePath` does.
- **Pairs.** Explicit when given. Otherwise the first and last waypoint of
  each `flowPath` on the page. With neither, `findSpofs` ranks fault units
  without pairs. Each unit's score is the number of nodes (anchors not
  counted) it separates from the largest surviving piece of their own
  baseline component, so a page already drawn as two islands is not one
  big finding. Units whose separated set is a single node of baseline
  degree 1 are suppressed. That rule keeps a page of single-homed access
  ports from producing a wall of findings.
- **Order.** Single faults only in this packet. Dual-fault enumeration is
  the same loop squared and is deferred until the step budget is tuned on
  real pages.
- Every result carries `model: "topological"` and an `assumptions` array:
  "no routing or policy evaluated", "capacity is nominal", which pairs were
  used and where they came from, the layer set the graph used, and whether
  the page carries any `srlg` / `ridesOn` (results on untagged pages cover
  drawn elements only). The label has to live in the data, because an agent
  will paraphrase any prose around it.

### S3. Surfaces, with zero new tools

- **What-if:** `analyze_path` gains `fail?: string[]` (element and
  risk-group ids). The route answer is computed on the degraded graph and
  adds `failed` (the expanded set), `endpointFailed` when it applies, and
  `model`. With `fail`, `show: "page"` is allowed and its caption names the
  failed set and says "topological". `show: "emphasis"` and `show: "flow"`
  are refused, because they would write a degraded route onto the live page
  with no label. Decided 2026-11-22: the byte ratchets may be raised for
  this. Raise both list totals by the measured cost of S1 and S3 and no
  more, in the S3 PR, with the reason stated there. The tool-count caps do
  not move. `analyze_path` will pass its 900-byte comment; update the
  comment to the new number in the same PR.
- **Report:** `export_topology` gains the format `survivability`: the
  `findSpofs` result as JSON, with the same CSV / XLSX switch
  `cable-schedule` has. This is the artefact for a change-board packet and
  the structured answer for an agent. The tool has 122 B left under the
  3,400 B per-tool cap, and that cap is **not** raised. The enum value and a
  clause of at most about 80 bytes have to fit. The column list goes in
  `describe_capabilities`.
- **`validate_topology`:** undeclared `srlg` (warning), risk-group id equal
  to an element id (error), `ridesOn` to a missing id (error), `ridesOn`
  cycle (error), `capacityMbps` not positive (error). No SPOF findings in
  validation; they are a report, not a problem with the document.
- **Editor** (S5, optional): the existing path panel
  (`src/ui/path-panel.ts`) gets "fail this" on the selection and shows the
  degraded route. Nothing is persisted, so design principle 2 holds.

### S4. Populating `ridesOn`

- **Generator first.** `src/connect/generate.ts` knows which overlay rides
  which transport when it builds a fabric. It writes `riskGroups` (one per
  transport per region) and puts `srlg` on the circuits, the clouds **and
  the underlay tunnels themselves**, so failing a transport group works at
  every detail level, including when no circuit or cloud is drawn.
  `ridesOn` points only at elements actually drawn on the page: underlay
  tunnels at their circuits and cloud (`all`) when those are drawn, and
  EdgeConnect bonded overlay tunnels at their underlay tunnels (`any`).
  Generated fabrics are then analysable with no hand tagging.
- **Live import later.** `TunnelRecord` gains `members?: string[]` for
  bonded tunnels, and the compiler turns it into `ridesOn` (`any`). Whether
  the Orchestrator bonded-tunnel payload carries its member tunnels is
  not verified; pin it against a recorded fixture in packet E3. This half
  stays behind `LIVE_DATA_ENABLED` like the rest of the live tools.

### C. NetBox device-type library as a hw-catalog Phase 6 source

The upstream library is stated to be CC0-1.0 (re-check, and vendor its
`LICENSE` with the fixtures). Its device types carry interface names and
types, console and power ports, `u_height` and module bays. They do not
carry port positions, breakout rules, optic compatibility, a device role or
an interface role. So the importer is narrow on purpose.

- **C1. Schema and rules.** Add the provenance tier `community`
  ("community-maintained definition, not vendor-verified") to the schema,
  `types.generated.ts` (regenerated, so the drift check passes) and the
  Python checker. `gaEligible` is unchanged, so community-only models are
  not GA-eligible and stay out of the default stencil export. Decided
  2026-11-22: community models are allowed on customer-facing wire sheets.
  The schematic badge covers the panel; the cable schedule's notes column
  and `describe_hardware` name the tier, so the source of the port list is
  visible too. Extend `optics.json` `cage_accepts` before any model with a
  `qsfp_plus`, `qsfp56`, `qsfp_dd` or `osfp` cage is admitted; until then
  the importer rejects such models.
- **C2. Importer and schematic panels.** `catalog/tools/import_dtl.py`,
  stdlib plus PyYAML (`yaml.safe_load` only; the input is untrusted),
  pinned in `ci.yml` the way `jsonschema` is, with `catalog/README.md`
  updated. It reads a local clone (no network in tests, per the hw-catalog
  non-negotiables). Inputs: the clone path, the upstream commit SHA, and an
  allowlist file. For each manufacturer and model glob, the allowlist gives
  the target model `id`, `vendor`, `family`, `os`, `category`, `symbol` and
  a default interface `role` with per-interface overrides. The schema
  requires all of these and upstream has none, so they come from the
  reviewed allowlist, not from a heuristic. A firewall's WAN and LAN ports
  in particular cannot be guessed. Output goes to `catalog/drafts/`, which
  is not bundled. Each draft carries a `community` provenance row whose
  `source` is the upstream path at the pinned SHA.
  - Interface type mapping seen in upstream samples: `1000base-t` to
    `rj45`, `1000base-x-sfp` to `sfp`, `10gbase-x-sfpp` to `sfp_plus`,
    `25gbase-x-sfp28` to `sfp28`. Other slugs are added to the table only
    after checking them against the upstream type list. An unmapped type
    rejects the model and lands in a coverage report. Nothing is guessed.
  - Speeds are the nominal speed only. Multi-rate support (10/100 on a
    1G copper port, 10G in an SFP28 cage) is not in the source, so it
    goes in `todo`.
  - `mgmt_only: true` maps to the `mgmt` role. Module bays are ignored
    and noted in `todo` (fixed-configuration switches list PSU and fan
    bays, so the presence of bays cannot be the rejection test).
  - Every interface needs a `physical` platform port, so a model cannot
    pass `check_seed.py` without its platform. The importer therefore also
    lays ports out in upstream order on a panel of the model's `u_height`
    and emits the platform with `position_confidence: "schematic"` and an
    `inferred` row for the positions. The schematic badge then applies with
    no new code.
  - Collisions are checked on the target `id` **and** on vendor plus SKU /
    part number against `catalog/data/`. A community SRX300 under a new id
    must not slip past the seeded `juniper-srx300`. A collision skips the
    model and reports it.
- **C3. Glyphs.** A generated front-panel glyph per schematic platform
  that passes the existing `check_seed.py` anchor contract and the SVG
  sanitizer.
- **C4. First batch.** Promote a reviewed allowlist of the families
  hw-catalog.md already names (Juniper EX / QFX / SRX, AOS-CX). Promotion
  is a human-reviewed data change. Each promoted model adds one `WARN`
  line to the catalog build (not GA-eligible); that is expected. When
  official data arrives for a model, it replaces the community entry.
  Documents keep the catalog version they were bound with
  (`catalogVersion`).

Bundle splitting and lazy per-vendor loading are not proposed. Measure the
bundle after C4; split only if it is a problem. The Worker's refusal to
serve `/catalog/*` publicly is unchanged.

## 6. Packets and sequencing

| Packet | Scope                                                                                                                | Depends on | Risk                                                                                     |
| ------ | -------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------- |
| G0     | legend move, 3 DOM fixes, headless tsconfig, import lint, `max-lines`                                                | none       | Low; no behaviour change.                                                                |
| S1     | `riskGroups` (`define_risk_group`, `DOCUMENT_FIELDS`), `srlg`, `capacityMbps`, `ridesOn`, `ridesOnMode`, validations | none       | Low; additive. Measures its tool-list bytes; watch the `describe_capabilities` ratchets. |
| S2     | `survive.ts`, exported graph builder, unit tests on fixtures                                                         | S1         | Medium; the pair-free ranking needs tuning on real pages.                                |
| S3     | `analyze_path` `fail`, `export_topology` `survivability`                                                             | S2         | Medium; list bytes, and `export_topology`'s 122 B under the per-tool cap.                |
| S4a    | generator writes risk groups, `srlg` and `ridesOn`                                                                   | S1         | Low.                                                                                     |
| S4b    | `TunnelRecord.members`, compiler mapping                                                                             | S1, E3     | Unknown until a payload is recorded.                                                     |
| S5     | path-panel "fail this"                                                                                               | S3         | Low; UI only.                                                                            |
| C1     | `community` tier, optics rows                                                                                        | none       | Low.                                                                                     |
| C2     | importer, allowlist, drafts with schematic platforms, vendored CC0 fixtures, PyYAML pin                              | C1         | Medium; mapping coverage.                                                                |
| C3     | generated glyphs                                                                                                     | C2         | Medium; glyph contract.                                                                  |
| C4     | first reviewed batch                                                                                                 | C2, C3     | Low; data task.                                                                          |

G0, S1 and C1 are independent and can start together. S and C never touch
the same files. S3 and any other packet that edits `src/mcp/tools.ts` or
`export-tools.ts` merge one at a time (the existing rule). S1 also edits
`tools.ts` (`OP_ONLY_TOOLS`). Acceptance criterion 3 uses a generated
fabric, so S4a merges before S3 is called done.

## 7. Acceptance criteria

1. `npm run lint` fails on a new import from `src/api` or `src/render`
   (tests included) into `src/editor`, and CI fails on a DOM global in a
   headless directory.
2. Every S1 element field appears in `describe_capabilities` and passes the
   catalog parity test. `define_risk_group` appears in
   `describe_operations`. All of them round-trip through `edit_topology`
   and the workspace operations (`riskGroups` through `document.patch`).
   Existing fixtures and visual baselines are unchanged with the fields
   unset.
3. On a generated dual-hub, dual-transport fabric at device detail,
   `analyze_path` with `fail: [<one transport's risk group>]` still finds a
   route between a branch and a hub and lists every tunnel that went down
   with it. Failing both transports reports the pair as `disconnected`,
   not as `found` with `blockedOnly`. The same holds at the detail level
   where no circuits are drawn.
4. On a fixture with a two-member LAG, failing one member reports the
   pair connected with half the capacity, in Mbps when both members carry
   one.
5. `export_topology` `survivability` on a page with no flow paths returns
   a ranked list in which a single-homed access port does not appear.
6. Every survivability result carries `model: "topological"` and a
   non-empty `assumptions` array, asserted by test.
7. The token-budget test passes, with any raised limit explained in the
   PR that raises it. The tool count and the per-tool cap do not change.
8. A fault set that expands to include an endpoint reports
   `endpointFailed`. A `fail` id that matches both a risk group and an
   element cannot occur, because validation rejects the document.
9. `import_dtl.py` run on the vendored fixtures produces drafts (models and
   schematic platforms) that pass `check_seed.py` and `ref_validate.py`
   once C3's glyphs exist. A model with an unmapped interface type, a
   rejected cage, or an id / SKU collision is skipped and reported.
10. A community-only model names its tier in the cable schedule notes,
    reports `gaEligible: false` in `describe_hardware`, is left out of
    `catalog:stencil` without `--all`, and renders its wire-sheet panel
    with the schematic badge.

## 8. Risks and trade-offs

- **False confidence.** A connected graph is not a working network. The
  mitigation is the label in the data (G1, criterion 6) and never using
  the words "reroute" or "failover" in output.
- **Layers in one graph.** A generated page draws circuits, clouds and
  tunnels on one page. With every layer shown, a "route" can run branch →
  circuit → cloud → circuit → hub alongside the tunnel. That is true of the
  drawing, and the circuit dependence still holds, but it is not a
  forwarding path. The result names the layer set it used (S2), and the
  editor and the tool default to the page's visible layers, as
  `analyzePath` already does.
- **Tagging burden.** Hand-drawn pages will have no `srlg` or `ridesOn`,
  so results on them cover only what is drawn. S4a makes generated
  fabrics useful on day one; hand-drawn pages get node and link failures
  only until someone tags them. The report says which it was (S2
  `assumptions`).
- **`ridesOn` shape.** `all` / `any` over page-local ids is the smallest
  thing that expresses circuit, transport and bonded-tunnel dependence.
  It cannot express "any two of three". Accept that until a real page
  needs it.
- **Tool-list budget.** 112 and 186 bytes of headroom, and 122 B under the
  per-tool cap on `export_topology`. S3 raises the list totals (decided).
  The cost is paid by every connected agent on every session, so the
  `fail` description stays to one clause and the detail goes in
  `describe_capabilities`.
- **Community data quality.** Upstream entries can be wrong. The tier,
  the GA rule and the allowlist review are the guard; the importer adds
  no trust of its own.
- **Two sources for one model.** Handled by the id and SKU collision check
  (C2).
- **A new Python dependency.** PyYAML joins jsonschema, pinned in CI; parsed
  with `safe_load` only.
- **Capacity.** One maintainer plus agents (0009). G0, then S1 to S3, is
  the critical path; C runs behind it and should not preempt the roadmap's
  "Now" items.

## 9. Considered and dropped

- **Plugin SDK:** no consumer, no trust model for third-party code on a
  hosted Worker, and `TopologyProvider` plus the field catalog already
  are the extension points.
- **Decomposing `editor.ts` and `main.ts` as a project:** the command
  registry shipped with 0013 and the editor already emits workspace
  operations. Split opportunistically under the G0 ratchet.
- **`schemaVersion` and migrations:** not needed for additive fields.
- **A new provenance field, a new command registry, `src/shell/`:** these
  already exist or are stale.
- **A `define_risk_group` tool:** both tool counts are at their cap; an
  op-only `edit_topology` operation is the existing pattern for
  document-level declarations.
- **Parked as roadmap "Later" one-liners on acceptance:** IaC and cloud
  importers, NetBox / Nautobot topology sync (0009 IM3), BOM and power
  export, policy-aware reachability, a CI action, derived Logical / Overlay
  pages.

## 10. Open questions

1. Should risk groups get a legend row or any rendering, or stay contract
   data only?
2. Does the Orchestrator bonded-tunnel payload list its member tunnels
   (S4b)?
3. Who reviews a C4 batch?
4. S1: a target hint on `FieldSpec` for `ref` / `refs`, or a special case
   for `srlg` and `ridesOn` in the properties panel?

Settled 2026-11-22: the byte-ratchet raise for S1 and S3 is acceptable
(list totals only, not the per-tool cap), and community models may appear
on customer-facing wire sheets (sections 5 S3 and 5 C1).

## 11. Principles check

Serves 2 (every input is document vocabulary; the what-if is an argument,
not persisted UI state, and the one way `fail` writes to the document,
`show: "page"`, is captioned), 3 (element fields come through the field
catalog and the declaration through an existing operation path), 5
(dangling groups, id collisions, cycles and bad capacities fail at author
time), 6 (agents get structured, labelled results) and 8 (all opt-in; unset
documents behave as today). The roadmap's exclusions hold: no second
mutation path, no cross-page inheritance (`ridesOn` is page-local), no
UI-only capability.

## 12. Review changes (2026-11-22)

The first draft was checked against the code at `39c5513`. What changed:

1. **Fault semantics.** `analyzePath` returns blocked-only routes as
   `found` with `blockedOnly`. Faults are now removed from the graph, and
   "connected" excludes `blockedOnly`. Without this, criterion 3's "both
   transports down" would have reported a route.
2. **Endpoints in the fault set** (a site or power group containing the
   branch) now report `endpointFailed` instead of being undefined.
3. **Expansion ignores layer visibility.** The EdgeConnect underlay is
   hidden by default, and bonded overlays ride on it.
4. **`doc.riskGroups` path corrected.** Document-level declarations are
   op-only `edit_topology` operations plus `DOCUMENT_FIELDS`, not field-
   catalog fields. That costs about 40 B of stdio list bytes in S1, which
   the draft did not count.
5. **Per-tool cap.** `export_topology` is 122 B under the 3,400 B per-tool
   cap. The draft only counted list totals.
6. **`show` with `fail`.** `emphasis` and `flow` would have written an
   unlabelled degraded route to the live page. They are refused; `page`
   is captioned.
7. **Capacity is per hop, not per bundle.** Bundles are per link end and
   an ESI-LAG spans two hops. Negotiated speed needs the asynchronous
   catalog loader, so it is an input to the engine, not a lookup inside it.
8. **Id namespace.** `fail` mixes element and risk-group ids, so a
   collision is a validation error.
9. **Pair-free ranking** is per baseline component and does not count
   anchors.
10. **Generator tagging.** Circuits and clouds exist only at device detail,
    so `srlg` also goes on the underlay tunnels.
11. **G0 facts.** There are five outside importers of `legend.ts`, not two;
    one of them is a test in `src/api`, which the lint rule must cover. The
    headless check keeps Node types, because catalog build scripts use
    `node:fs`.
12. **Catalog importer.** Interface `role` and `physical` are required by
    the schema. The allowlist now carries roles. The schematic platform
    moves into C2, because a model cannot pass `check_seed.py` without one,
    and C3 becomes glyphs. Collision checks use the SKU as well as the id.
    PyYAML is a new pinned dependency.
13. **Sequencing.** S4a merges before S3 is called done (criterion 3 uses
    a generated fabric). S1 edits `tools.ts` too.
