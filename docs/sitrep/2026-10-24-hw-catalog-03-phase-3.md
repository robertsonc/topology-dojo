# Sitrep 03 — hw-catalog Phase 3: MCP tools for agents

Status: **done**, in review. Next: Phase 4 (wire-sheet rendering). Phase 2
merged as PR #286.

## What landed

Five tools in `src/mcp/hardware-tools.ts`, registered only where a catalog
loader is wired (stdio server: disk; Worker: ASSETS), plus the cable
schedule. Schemas and results are documented in `src/mcp/README.md`
("Hardware catalog").

- **`list_hardware`** `{ query?, vendor?, family?, category?, limit=20 }` →
  `{ catalogVersion, total, models[] }`, each
  `{ model, name, category, skus, portSummary, confidence, gaEligible }`.
  `portSummary` reproduces the brief's examples exactly:
  `4x RJ45 1G (lan0-1,wan0-1)`, `24x RJ45 1G + 4x SFP56 1-50G` (names are
  listed for fixed, ≤ 8-port groups; `{member}` templates are not).
- **`describe_hardware`** `{ model }`: interfaces grouped by role + kind +
  speeds with ranges collapsed (`{member}/1/1-24`), bond groups with LACP
  support, SKU variants, stacking, provenance **tiers** per group and as
  counts, `todo`, panel confidence. No geometry and **no provenance
  sources**: those can name internal documents, which is why the Worker
  refuses public `/catalog/*` in the first place. A test asserts that no
  coordinates, ports, glyphs, sources or URLs leak.
- **`bind_hardware`** `{ topologyId, nodeId, pageIndex?, model, sku?,
stackMembers?, face? }`: the Phase 2 `bindHardware()` against the
  document's pinned catalog (else the latest), so it pins on first use. It
  returns the cabling errors already on that node, so a re-bind that breaks
  existing interfaces says so right away.
- **`assign_interfaces`** `{ topologyId, linkIds?, strategy, apply? }`
  (`src/catalog/assign.ts`): proposes by default, writes only with
  `apply: true`, and always returns the catalog errors that remain after
  the plan. Strategies:
  - `by-role` (default): wan toward clouds, ISPs and modems (also unbound
    routers, and labels like ISP / MPLS / LTE); lan toward the inside; ha
    toward a same-category peer; bond-group members for a bundle named like
    the group (planned first); cage uplinks on switches toward network gear;
    copper access ports toward endpoints. A cage port facing a fixed copper
    port is the last resort.
  - `first-free`: catalog order, ignoring role.
  - `keep`: only fills empty ends.

  `by-role` and `first-free` also re-plan ends that cannot work: an unknown
  name, console / usb, a member outside the stack, or the second cable on a
  port (the first keeps it, and out-of-scope links always keep theirs).
  It never picks optics: a cage pick says "declare the optic". Speeds must
  overlap with the far end when that end is known. If nothing fits, the end
  is listed in `unassigned` with the reason.

- **`catalog_diff`** `{ topologyId, toVersion? }` (`src/catalog/diff.ts`):
  for each bound model, `unchanged` / `changed` (the fields that differ,
  interfaces added or removed; a shared platform geometry change shows as
  `platform geometry`) / `removed`. It also returns `newFindings` and
  `clearedFindings` (validation under both versions) and `linksNowFailing`.
  It is read-only and refuses an unpinned document.
- **`export_topology` `cable-schedule`** (`src/export/cable-schedule.ts`):
  CSV by default, `scheduleFormat: "xlsx"` for a workbook. The columns are
  the brief's, plus a leading `page` column only when a multi-page document
  is exported whole. Media and negotiated speed come from the same
  validation pass as `validate_topology` (`wiringReport`). `notes` is the
  link label plus the rule codes on that cable. CSV cells that a spreadsheet
  would run as a formula get a `'` prefix. The XLSX holds inline strings
  only (never formulas), has a frozen bold header and an autofilter. It
  works on unbound documents and without a catalog (ids instead of names,
  blank media and speed, and a note saying so). The inline view's download
  menu offers it as XLSX.
- **`describe_capabilities`** grows by one key, `hardware`, a single pointer
  line naming the tools, and only where a catalog is wired. A test asserts
  it is the only new key.

## Supporting changes

- `gaEligible` and `canonicalJson` moved from `build.ts` (which uses
  `node:fs`) into the pure `catalog.ts`, so the Worker can use them;
  `build.ts` re-exports both.
- `validate.ts` gains `wiringReport()`: the same pass, plus per-cable media
  (and the conflicting pair when the ends disagree) and the negotiated
  speed. `validateWiring()` is unchanged, and the 15 golden fixtures still
  pass.
- Workspace `DOCUMENT_FIELDS` gains `catalogVersion` (deferred from Phase
  2); the document-field ⇄ tool parity test maps it to `bind_hardware`.
- `catalog_diff` joins the shared-workspace read allowlist (it clones the
  document before awaiting). `list_hardware`, `describe_hardware` and
  `catalog_diff` skip the legacy store write-back. `bind_hardware` and
  `assign_interfaces` count against the mutating-tool quota.

## Deviations from the brief, with reason

- `list_hardware` wraps its array as `{ catalogVersion, total, models }`,
  so an agent can tell whether `limit` cut the list and which catalog
  answered.
- `assign_interfaces`'s strategies are defined above. The brief names
  `keep` without saying what it keeps; I read it as "never change an
  existing assignment".
- `assign_interfaces` on a shared workspace id is refused like every other
  writing tool, even with `apply: false`. Planning against a workspace
  snapshot is possible later if agents need it.

## Pre-existing gap noticed, not changed

`MUTATING_MCP_TOOLS` (the per-user write quota) does not list
`define_bundle`, `define_tier`, `define_link_style`, `set_sheet` or
`set_port_table`. They mutate but are not rate-limited. This is out of
scope here; worth a one-line fix PR.

## Verification

| Claim                                      | How it was verified                                                                                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every tool has tests                       | `src/mcp/hardware-tools.test.ts` (19): filters, summaries, no-leak, bind pin/refusals, assign strategies, diff, CSV / XLSX, the capabilities line                 |
| `portSummary` matches the brief's examples | Asserted for EC-10104 and CX 6300M                                                                                                                                |
| A branch plans the way an engineer would   | Test branch: ISPs → wan0 / wan1, blan0 → lan0 + lan1, CX side copper 1/1/1-2 (the far end is fixed copper), AP → 1/1/3, core → 1/1/25 (cage, "declare the optic") |
| Applied plan validates                     | `assign_interfaces apply:true` → `validate_topology`: no E\_\* findings                                                                                           |
| XLSX opens                                 | openpyxl 3.1.5 with warnings as errors, and LibreOffice headless `--convert-to csv`: same strings; `=1+1` stays a string cell                                     |
| Real stdio session                         | `list_hardware` → `bind_hardware` ×2 → `assign_interfaces apply` → `validate_topology` (valid) → `cable-schedule` CSV → `describe_capabilities`                   |
| Nothing else moved                         | Full suite, lint, typecheck (root + worker), build, `catalog:check`, Python tools (15/15)                                                                         |

Not verified by observation: the tools on a deployed Worker (no deploy was
made; the ASSETS loader is covered by Phase 1's Miniflare test), and the
XLSX in Microsoft Excel.
