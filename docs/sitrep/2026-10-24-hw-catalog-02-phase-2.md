# Sitrep 02 — hw-catalog Phase 2: bind hardware + validate

Status: **done**, merged (PR #286). Next: Phase 3 (MCP tools). Phase 1
merged as PR #285.

## What landed

- **Node binding.** Optional `node.hw` `{ model, sku?, stackMembers?, face? }`
  (`src/vendor/topology-ds.ts`). `bindHardware()` (`src/api/hardware.ts`)
  checks the model, SKU, stack size (≤ `stackable.max_members`, refused on
  non-stackable models) and face against the catalog, pins
  `doc.catalogVersion` on the first binding, and sets the node type from the
  model's category (`CATEGORY_NODE_TYPE`) unless the node uses a Node
  Designer custom type. Phase 3's `bind_hardware` is its caller; until then
  `update_element` can set `hw` directly (unpinned → judged against latest).
- **Link endpoints.** `fromInterface` / `toInterface` / `fromOptic` /
  `toOptic`, new fields (the engine's `fromPort` / `toPort` attachment-side
  fields are untouched). `add_link` accepts them. When an end has an
  interface and no label, every port-label renderer draws the interface name
  — engine chips, port pills and derived port tables, all through one
  helper (`endPortLabel` / `withInterfaceLabels`). An author label wins.
- **Bonds.** A lag bundle (declared `kind: lag` or undeclared) whose link ends
  sit on a bound node is that node's bond; members are those ends'
  interfaces. Per-node LACP is `BundleDef.lacp`: a boolean for every node the
  name spans, or `{ nodeId: boolean }` (one name can span an ESI-LAG pair).
  `define_bundle` takes `lacp`. Every fixture's `bonds[]` maps onto bundles
  one-to-one (asserted in `src/catalog/validate.test.ts`).
- **Validation.** `src/catalog/validate.ts` ports every `ref_validate.py`
  rule, per page, for endpoints on bound nodes only. `validate_topology`
  adds `E_*` to `problems` (errors, with `code`), and new `warnings` (`W_*`)
  and `notes` (`I_*`) arrays plus the `catalogVersion` used. The check runs
  on a snapshot of the document, since loading the catalog awaits.
- **Catalog wiring.** `ToolDeps.catalog`: `nodeCatalogLoader()` in the stdio
  server, `workerCatalogLoader(env.ASSETS)` in the Worker. A missing catalog
  or an unloadable pinned version is a `W_CATALOG_UNAVAILABLE` warning, not
  a crash and not a silent pass.
- **Persistence.** `parseDoc` keeps `hw` (on nodes, as it keeps every node
  field), the link fields, `lacp` (shape-checked) and `catalogVersion`
  (12-hex only). `serializeDoc` and the editor's document swap keep
  `catalogVersion`. A test found that `serializeDoc` was dropping it at
  first. `validateDocument` reports malformed `hw` / link / `lacp` shapes as
  ordinary semantic errors.

## New rule: `W_INTERFACE_UNASSIGNED`

The reference raised `E_PORT_UNKNOWN` (with `if: None`) for an endpoint on a
bound node with no interface. That is the normal state while a sheet is
being drawn (bind first, assign interfaces later), so it is now a warning and
the end stays unconstrained. Added to `ref_validate.py` first, with fixture
`15_interface_unassigned.json`; the TS port matches. 15 fixtures now, not 14.

## Codes outside the wiring contract

`W_CATALOG_UNAVAILABLE` is a server condition (no catalog, or the pinned
version is not published), not a wiring rule, so it has no fixture and is not
in `ref_validate.py`.

## Backward compatibility

- Unbound documents take the old code path: synchronous, exactly `valid`,
  `problems` and `layoutClean`. `src/mcp/validate-unbound.test.ts` snapshots
  four documents (`EdgeHA_after`, `venue-distribution-leaf`, the sample, and
  the sample deliberately broken: 9 problem rows). The snapshot was
  **recorded on main at 7e951f3** (in a worktree) and passes unchanged here.
- No existing field was repurposed. `fromLabel` stays the author's label; the
  interface is only a fallback when it is empty.

## Deferred, with reason

- **`hw` in `describe_capabilities` / editor field specs**: Phase 3 adds the
  catalog tools and the one pointer line; the browser editor cannot load the
  catalog (it is Worker-internal), so hardware validation is MCP / headless
  only for now.
- **Workspace `DOCUMENT_FIELDS`** does not list `catalogVersion` yet, so a
  workspace `document.patch` cannot set it. Pinning arrives with
  `bind_hardware` in Phase 3, which is when that patch path is needed.

## Verification

| Claim                                              | How it was verified                                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Python reference passes all fixtures               | `ref_validate.py`: 15/15                                                                                       |
| TS validator matches on every fixture              | `src/catalog/validate.test.ts`: code multiset equal on 15/15; bonds map 1:1                                    |
| Same through MCP + persistence                     | `src/mcp/hardware-validate.test.ts`: every fixture → `serializeDoc` → `import` → `validate_topology`           |
| Unbound output is byte-for-byte as before          | Snapshot recorded on main, replayed on this branch (4 documents); full suite 1570/1570                         |
| Error / warning / note split, pinning, fallbacks   | `hardware-validate.test.ts` (invalid on E*\*, valid on W*\*, pinned version, missing catalog, missing version) |
| Interface drawn as port label in all three paths   | `src/api/hardware.test.ts` (chip SVG, pill SVG, port-table row; author label wins)                             |
| Stdio server finds the catalog                     | Real stdio MCP session: bind via `update_element`, `add_link` with interfaces → `E_PORT_UNKNOWN` + notes       |
| Lint, typecheck (root + worker), build, catalog CI | `npm run lint`, `npm run typecheck`, `npm run build`, `npm run catalog:check`, the three Python tools          |

Not verified by observation: the Worker path in a deployed environment (the
loader over ASSETS is covered by Phase 1's Miniflare test; no deploy was made).
