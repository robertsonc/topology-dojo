# Proposal 0008 — Wiring-diagram conventions: tiers, port pills, bundles, link key, port tables, sheet frame

**Status:** Implemented (W1–W7 and the rounded-orthogonal half of W8,
2026-10-15). Harness routing (the second half of W8) remains deferred and is
tracked on the roadmap. Everything shipped is additive document vocabulary
plus renderer/layout work; no Durable Object migration, no flag. Two
decisions diverged from the draft below: port pills, bundle rings, port
tables and the sheet frame are drawn as TypeScript document overlays
(`src/render/overlays.ts`) rather than inside the engine — the engine only
receives each node's pill band so zone boxes grow around the pills — and a
bundle ring is drawn only around two or more pills (a single ESI-LAG leg is
carried by the port table instead).

**Captured:** 2026-10-15

**Addresses:** the gap between what Topology Dojo renders today (an
icon-and-wire topology with glass label chips) and the physical
wiring-diagram style a network team actually hands to a cabling crew. The
reference is the "HPE Discover 2026 – Venue Distribution Leaf Details" sheet
(QFX5120 distribution pair, MX304 core pair, Aruba 9114 / ME-MX-6 gateways):
tiered, port-accurate, keyed by media and speed, with per-device port tables
and a title block. The roadmap's "More node/link art — richer per-type
inspector controls (ports …)" item is the nearest existing hook.

## Context

### What the reference sheet does, convention by convention

Read off the drawing, in the order a reader's eye takes them:

1. **Sheet, not canvas.** A white, bordered ANSI C landscape sheet; the
   document title centred at the top in brand green; a title block
   bottom-right (event, sheet name, drawn by, revision, date, size, logo); a
   **Key** bottom-left. Print is the first-class output.
2. **Tiers as horizontal bands.** Gateways on top, "Distribution" in the
   middle, "Core" at the bottom. Each band is a rounded dashed box with a
   bold caption (top for the gateway groups, bottom for Distribution/Core).
   Vertical position encodes role, not link depth.
3. **Paired devices, mirrored.** `-01` left, `-02` right, same y; the
   inter-chassis link (ICL) runs horizontally between them with a port pill
   at each end. Everything above and below is symmetric about the page's
   vertical centre line.
4. **Device name + model.** Bold green name, grey `(vendor model)` sublabel
   beneath, above a front-panel chassis image.
5. **Port pills at the attachment point.** Every link leaves the chassis
   through a dark rounded pill carrying the interface name, rotated
   perpendicular to the device edge, placed _on_ the edge where the link
   attaches, and spread evenly along that edge so pills never overlap.
6. **Bundles drawn on the pills.** A LAG is an outline oval enclosing its
   member pills on one device (`ae0` = two pills on a gateway, one pill on
   each of the two switches for an ESI-LAG); ECMP is the dashed variant. Both
   appear in the Key.
7. **Wire colour = media class.** 10G DAC green, 25G DAC blue, 40G yellow,
   50G purple, 100G red; fibre variants (SR/LR) are a shade of the same hue.
   The Key is a list of line samples keyed by `<speed>BASE-<media>`.
8. **Harnessed routing.** Links from one pill fan out as smooth
   large-radius curves; links of the same class between the same two tiers
   run parallel as a bundle; crossings are allowed but clean.
9. **Per-device port table.** `Port | LAG | PHY | Peer|Port` for every
   device, placed in the margin beside its tier, derived from the links. The
   table is the cabling crew's work order; the drawing is the picture of it.

### What already exists (verified in code)

| Convention                  | Status today                                                                                                                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Name + model                | `label` + `sublabel` on a node, `labelPlacement`, `labelWidth` (`src/vendor/topology-ds.ts`, `src/render/node-labels.ts`). Done.                                                                                                                                                                       |
| Bands / groups              | Zones: auto-sized dashed/solid/dotted box, `label`, `sublabel`, `labelAlign`, `padding`, nesting (`src/render/zone-box.ts`). Caption is top-only.                                                                                                                                                      |
| Port names on a link        | `fromLabel` / `toLabel` render as glass chips inset 20 px along the wire and 10 px off it, text horizontal (`_renderEndpointLabels`, `public/vendor/topology-ds.js:4484`). Not on the edge, not rotated, not slot-aware.                                                                               |
| Spread endpoints on an edge | Experimental `linkAttach: { pad, distribute }` on a page or node, plus `fromPort`/`toPort` and `fromPortOffset`/`toPortOffset` on a link (`src/render/link-attach.ts`, PR #274). This is the slot machinery the pills need.                                                                            |
| Media / speed on a link     | `bandwidth`, `transport`, `vlan`, `subnet` exist as first-class fields and render as a wire chip when `showMeta` is set. Nothing maps them to a colour, and the legend ignores them.                                                                                                                   |
| Key                         | `doc.legend` (`src/editor/legend.ts`) is derived live from node types, statuses, policy markers and declared layers. **No link rows.**                                                                                                                                                                 |
| Title / sheet               | `doc.title`, page `viewBox` (default `0 0 1050 700`), page `caption` as an export subtitle, `theme: 'light'` export, `palette` for brand accent. No border, no title block, no sheet-size vocabulary.                                                                                                  |
| Tier layout                 | `layout_topology` `hierarchical` assigns rows by longest path over `from→to` (`src/api/autolayout.ts`). On a dual-homed fabric this is link-direction-dependent and nothing says "distribution sits between gateways and core". `balance` aligns near-rows and centres the bounding box; no mirroring. |
| Routing                     | `lineStyle: 'orthogonal' \| 'curved'`, manual waypoints, parallel-sibling fan-out (`_parallelOffset`), optional line jumps (`page.lineJumps`). No rounded orthogonal corners, no bundling.                                                                                                             |
| Chassis art                 | `image` node type (uploaded picture), Node Designer specs with `ports`/`portCount`/`portPos`. No wide rack-unit stock shape.                                                                                                                                                                           |
| Port table                  | Nothing. `inspect_render` and the inspector can enumerate a node's links, but no element draws them.                                                                                                                                                                                                   |

So the conventions split cleanly: four are presentation of data the document
already carries (pills, link key, port table, sheet frame), two need one new
field each (tier, bundle), and one is a routing algorithm (harnessing). None
needs a UI-only persisted field, so principle #2 holds throughout.

## Goals

1. An agent or a human can produce the reference sheet from a document, with
   the port tables, key and title block **derived**, never hand-maintained.
2. Every new field is in the document JSON, in the catalog, reachable over
   MCP, and validated (principles #2, #3, #5).
3. Layout rules for tiers and pills join `layoutGuidelines` so agents are
   told, checked, and corrected by the same numbers (principle #6).
4. All of it is opt-in; an unset document renders exactly as today
   (principle #8). Golden-render tests pin that.

## Non-goals

- Photo-realistic chassis renders for specific SKUs. `image` nodes cover it
  today; a generic rack-unit stock shape is in scope, SKU art is not.
- Automatic port assignment from a CMDB or NetBox. That is importer work
  (proposal 0006 upsert path); this proposal only draws what the links say.
- Replacing the engine's label chips for non-wiring diagrams. Pills are a
  mode, not the new default.
- Bundled ("harness") routing in the first release. It is the only packet
  with real algorithmic risk and is sequenced last.

## Design

Each sub-section names the contract change, the render change, and the
layout/validation hook. Field names are proposals; the catalog entry is the
source of truth once landed.

### W1. Link styles: a document-level key for wire classes

**Contract.**

```ts
// document
linkStyles?: LinkStyleDef[];
interface LinkStyleDef {
  id: string; // '100g-dac'
  label: string; // '100GBASE-DA (DAC)'  ← the Key row text
  color: string;
  width?: number; // default 1.6
  dash?: 'solid' | 'dashed' | 'dotted';
}
// link
style?: string; // id of a LinkStyleDef
```

Precedence on a link: explicit `color` > `style` > type default. That keeps
every existing document byte-identical. `bandwidth`/`transport` stay as data;
a style is the _presentation_ of a class, so one style can serve `100G` +
`DAC` across a hundred links, and changing the class colour is one edit.

**Render.** Engine resolves `style` to colour/width/dash before drawing;
`fromLabel`/`toLabel`/meta chips take the resolved colour.

**Legend.** `buildLegendItems` gains `shape: 'line'` rows, one per style in
use on the page, in declaration order, drawn as a 24 px sample stroke with
the style's dash. This is the bottom-left Key.

**Catalog / MCP.** `define_link_style` (or fold into `edit_topology`
`document.patch`), `style` as a `ref` field on every link type; `validate`
flags a dangling style id.

**Starter.** A built-in `ethernet-media` style set (10G/25G/40G/50G/100G ×
DAC/SR/LR, the reference's hues) exposed through `list_templates`-style
discovery so an agent does not invent colours.

### W2. Tiers: a role axis for layout

**Contract.**

```ts
// document
tiers?: TierDef[]; // top → bottom
interface TierDef {
  id: string;
  name?: string; // 'Distribution'
}
// node
tier?: string;
```

Declared order is vertical order. Nodes without a tier are "free" and are
placed by the existing algorithms.

**Layout.** `layout_topology` gains `algorithm: 'tiered'`: rows by tier
order, row spacing from `LAYOUT_RULES`, nodes within a row ordered by the
barycentre of their neighbours in adjacent rows (one sweep down, one up —
enough to stop the gateway fan-in crossing itself), then `balance`. A
`mirror: true` option pairs nodes whose ids differ only by a trailing
`-01`/`-02` (or that share an ICL link, when W3's bundle kind says so) and
places them symmetric about the page centre line. Rows carry anchors and
waypoints exactly as `tidy` does today (`carryAttachments`).

**Zones.** A tier is not a zone, but the reference draws one per tier. A
`tierZones: true` layout option emits a zone per tier with the tier name as
caption; `ZoneConfig` gains `labelPosition?: 'top' | 'bottom'` so the
Distribution/Core captions can sit at the bottom edge as drawn. Zone box
math is unchanged; only the caption strip moves, and `zoneBox` /
`analyzeLayout` already treat the strip as an obstacle.

**Guidelines.** `layoutGuidelines` adds: tier rows are `≥ 2 × minNodeGap +
pill height` apart; a link between non-adjacent tiers is a warning
(`validate`), since the reference never draws one.

### W3. Bundles: LAG / ECMP per link end

**Contract.**

```ts
// link
fromBundle?: string; // 'ae0'
toBundle?: string;
// document (optional naming, else kind defaults to 'lag')
bundles?: { id: string; kind: 'lag' | 'ecmp' | 'icl'; label?: string }[];
```

Per end, because a LAG is a per-device object: in the reference, `ae0` on
SW-VENUE-01 is one member while `0/0/4 + 0/0/5` on GW-WLAN-01 is a two-member
MC-LAG to two switches. One field per end expresses both without a new
element type.

**Render.** After pills are placed (W4), the engine draws one outline per
(node, bundle) around the union of that bundle's pill rects, inset 2 px,
`rx` = full pill height: solid for `lag`, dashed for `ecmp`. The legend gets
a `shape: 'bundle'` row per kind in use ("LACP LAG", "ECMP"), matching the
Key.

**Validate.** A bundle name used on one end of exactly one link is fine (a
single-member LAG is real). A bundle whose members attach to different
nodes at the same end is an error.

### W4. Port pills: endpoint labels on the edge

**Contract.** `page.portLabels?: 'chip' | 'pill'` with a node-level
override (merging like `linkAttach`). `'chip'` is today's rendering.
`'pill'` requires `linkAttach` and implies `distribute: true`.

**Render.** In pill mode `_renderEndpointLabels` places the chip at the
attachment point on the anchor-box edge, rotates it to the side's normal
(vertical text on north/south edges, horizontal on east/west), fills it with
the theme's "ink" colour (dark on light theme, light on dark) with the text
in the sheet colour, and reads the slot from `link-attach` so neighbours
never overlap. Pills become obstacles for the existing `nudgePill` pass so
wire-centre labels avoid them. `src/render/link-attach.ts` and
`src/render/wire-labels.ts` are mirrored to the engine byte-for-byte today;
pill metrics join `WIRE_LABEL` as a fourth kind and the mirror test pins
them.

**Layout.** The anchor box's side length bounds how many pills fit; the
analyzer warns when `n × (pillH + gap)` exceeds the side, and `tidy`'s
de-overlap uses the inflated box so a node with twelve 10G ports is given the
room. `nodeFootprint` grows by the pill band on sides that carry pills.

### W5. Port tables: derived, like the legend

**Contract.**

```ts
// node
portTable?: { show: boolean; side?: 'w' | 'e'; columns?: PortTableColumn[] };
type PortTableColumn = 'port' | 'bundle' | 'style' | 'peer';
```

**Render.** For a node with `portTable.show`, the renderer collects every
link touching it, sorts by this end's label (natural sort, so
`xe-0/0/8` precedes `xe-0/0/10`), and emits rows `Port | LAG | PHY |
Peer|Port` from `fromLabel`/`toLabel`, `fromBundle`/`toBundle`, the
style label (falling back to `bandwidth`), and the far node's label + far
label. Header strip in the node's colour. The table is drawn in the page
margin on `side`, vertically aligned with the node and stacked when several
nodes on one side would collide, in the same `<g>` the export path injects
the legend through, so canvas and SVG/PNG/PDF agree.

**Layout.** Tables take page space the layout must reserve: `analyzeLayout`
treats a table as a footprint; the `tiered` algorithm leaves a margin column
on each side with tables when any node in the row asks for one. A warning
fires when a table would exceed the page edge rather than silently
clipping (principle #5).

**Why derived, not authored.** The alternative, a `table` node type, would
let the picture and the work order drift. The legend already proved the
derived pattern; the port table is the same idea on the link graph, and
importers (proposal 0006) get it for free.

### W6. Sheet frame and title block

**Contract.**

```ts
// document
sheet?: {
  size?: 'ansi-a' | 'ansi-b' | 'ansi-c' | 'ansi-d' | 'a4' | 'a3' | 'a2' | 'custom';
  orientation?: 'landscape' | 'portrait';
  border?: boolean;
  title?: { show: boolean; align?: 'center' | 'left' };
  titleBlock?: {
    show: boolean;
    fields?: { label: string; value: string }[]; // Drawn by / Revision / Date / Size
    subtitle?: string; // 'Venue Distribution Leaf Details'
    logoHref?: string; // document-carried; nothing brand-specific ships in the repo
  };
};
```

Sheet sizes map to viewBox presets at 96 dpi (ANSI C landscape = 2112 × 1632) and set `page.viewBox` on pages that opt in; the legend's corner
placement and the title block share the page-margin constant. Exports:
`theme: 'light'` already paints a white backdrop; the border and blocks are
drawn in the same injected overlay group as the legend. PDF export
(`src/editor/export.ts`) picks the paper size from `sheet.size` instead of
inferring landscape/portrait from the viewBox alone.

This is the one packet with real new _authored_ fields (drawn by, revision,
date). They are document metadata, not diagram vocabulary, and they are
agent-reachable through `document.patch`, so principle #2 is satisfied.

### W7. Rack-unit stock shape

A `chassis` stock spec in `src/nodes/stock.ts`: a wide, low rounded rect
(≈ 140 × 24 at default size) with a port row along the south edge, the hit
box sized to match so pills and the anchor box land on the real silhouette.
A document that wants a photo uses an `image` node with the same hit box.
No per-SKU art.

### W8. Harness routing (sequenced last, separate flag)

`lineStyle: 'rounded'` first: orthogonal routing with a fixed corner radius,
which alone gives most of the reference's look once pills and distribute are
on. Bundling proper — links sharing (from-node side, style, to-tier) routed
along a shared trunk with fan-in at each end — is a new router. It should
ship behind a page-level `routing: 'harness'` opt-in and its own golden
tests, and only after W1–W5 have stabilised the geometry it consumes. Line
jumps already handle the remaining crossings.

## Packets and sequencing

| Packet | Scope                                                        | Depends on | Risk                                                                    |
| ------ | ------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------- |
| W1     | `linkStyles`, link `style`, legend line rows, media starter  | —          | Low; additive.                                                          |
| W2     | `tiers`, node `tier`, `tiered` layout, zone `labelPosition`  | —          | Medium; barycentre ordering needs crossing-count tests.                 |
| W3     | per-end `bundle`, bundle outlines, legend rows, validation   | W4 for art | Low once pills exist.                                                   |
| W4     | pill mode for endpoint labels on the anchor box              | PR #274    | Medium; touches the engine mirror, needs golden renders in both themes. |
| W5     | derived port tables                                          | W1, W3     | Medium; margin reservation interacts with tidy/balance.                 |
| W6     | sheet sizes, border, title, title block, PDF paper selection | —          | Low.                                                                    |
| W7     | `chassis` stock shape                                        | —          | Low.                                                                    |
| W8     | rounded orthogonal, then harness routing                     | W2, W4     | High; flagged.                                                          |

W1, W2, W6 and W7 are independent and can run in parallel. W4 is the
critical path for the "sharp" look; W5 is the critical path for the
"useful" one.

## Acceptance criteria

1. A fixture document reproducing the reference topology (two gateways per
   mobility group, two QFX, two MX, port names and media as drawn) renders
   through `render_svg` with `theme: 'light'` to a sheet a reviewer judges
   equivalent to the reference: tiers, pills, LAG ovals, key, port tables,
   title block. The fixture lives in `fixtures/` and its render is a golden
   test in both themes.
2. Every new field appears in `describe_capabilities`, passes the catalog
   parity test, and round-trips through `edit_topology` and the workspace
   operation vocabulary without a new stored operation type.
3. `validate_topology` reports: dangling `style`, bundle members on
   different nodes, a pill band wider than its side, a port table past the
   page edge, a link spanning non-adjacent tiers.
4. `layoutGuidelines` text and `LAYOUT_RULES` numbers cover tiers and pills,
   and `inspect_render` counts pill/pill and pill/label collisions.
5. Existing fixtures and e2e visual baselines are unchanged with every new
   field unset.
6. `docs/USER_GUIDE.md`, `CAPABILITY_MATRIX.md` and the QA/UAT plans gain
   the wiring-diagram workflow in the same PRs that ship it (roadmap item 1).

## Risks and trade-offs

- **Engine mirror drift.** W4 and W3 add geometry that both
  `public/vendor/topology-ds.js` and `src/render/*` must agree on. The
  existing 0.01 px mirror tests are the guard; the packets must extend
  them before touching the engine.
- **Page real estate.** Port tables and pills want a bigger sheet than
  `1050 × 700`. W6 gives the vocabulary; W2 and W5 should default to warning
  rather than resizing a page the author did not ask to resize.
- **Scope creep toward a cabling database.** The pull after W5 will be
  "import ports from NetBox". That is proposal 0006's lane, not this one;
  the port table only ever reads links.
- **Brand assets.** The reference carries an HPE logo and HPE green. The
  repo ships neither; a document carries its own `logoHref` and `palette`.

## Principles check

Serves #2 (every convention is document vocabulary, nothing UI-only), #3
(catalog-driven fields and discovery), #5 (new validations fail loud), #6
(tier and pill rules join the ground truth), #8 (all opt-in, classic render
untouched). Violates none; W6's authored metadata fields are the only new
non-diagram data and are agent-reachable.
