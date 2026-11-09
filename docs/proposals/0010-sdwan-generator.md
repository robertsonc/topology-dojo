# Proposal 0010 — SD-WAN topology generator

**Status:** Spec accepted; slices 1 (PR #293), 2 (PR #295), 4 (PR #296) and 3
implemented (2026-11-08; branch-to-branch mesh deferred). Slice 5 is in
research.

**Captured:** 2026-11-08

**Owner:** Topology Dojo maintainers

## 1. Problem

Drawing an SD-WAN fabric by hand is the slowest diagram a TME or SE makes, and
the one most often drawn wrong. A 3-region, dual-hub, 8-branch, dual-transport
fabric is hundreds of tunnels, and the counts depend on vendor behaviour the
person drawing it has to remember: which labels match, whether HA members
tunnel separately, where LTE lands. People cut corners (one line per site, no
underlay), and the result looks like a hub-and-spoke cartoon rather than the
customer's fabric.

A generator wizard is the right interaction: a handful of choices, a live
preview, a running count. But generated SD-WAN diagrams commonly take four
modelling shortcuts that this one must not:

1. **"2 hubs (HA)"** drawn as an HA cluster (heartbeat cables) _and_ with
   every branch tunnelling to both members — mixing an HA cluster up with dual
   independent hubs.
2. **No underlay.** Tunnels run box-to-box with no transport cloud, so the
   diagram cannot show which overlay rides which transport.
3. **No transport matching.** Every branch tunnels to every hub over every
   transport, whether or not both ends have it.
4. **Per-member tunnels for every vendor.** Correct for EdgeConnect HA; wrong
   for an SRX chassis cluster or a FortiGate FGCP cluster.

## 2. Goals

- **G1 — Correct by vendor.** Tunnel, circuit and HA counts follow the selected
  vendor's behaviour, and the preview count equals what lands on the canvas.
- **G2 — One pipeline.** Generated fabrics compile through the same
  `compileFabric` as a live EdgeConnect Orchestrator pull, so a design and the
  live fabric look the same: same layers, zones, colours, source conventions.
- **G3 — Readable at size.** Dense planes are layers that can be hidden; a
  site-level view exists for the executive diagram; the layout stays
  overlap-free (`analyzeLayout` clean) across the whole input range.
- **G4 — Agent parity.** Everything the wizard can do, an agent can do over MCP
  with the same intent object.
- **G5 — Honest provenance.** Generated elements can never be mistaken for live
  data by source-drift reconciliation.

## 3. Non-goals

- Config generation (no Orchestrator templates, Junos set commands, Mist JSON).
- Routing-protocol detail (BGP sessions, route reflectors, OSPF areas).
- Capacity or path simulation (bandwidth, SLA, failover behaviour).
- Arbitrary topologies — this is hub-and-spoke with optional hub mesh. Full mesh
  and on-demand branch-to-branch shortcuts are a later slice (§9).
- Pixel-matching any vendor's own topology view.

## 4. Users and stories

- **SE preparing a customer meeting:** "Show the customer's 3 regions, dual
  hubs, INET+MPLS with LTE backup, as EdgeConnect" — in under a minute, with
  counts they can quote.
- **TME building a demo or doc:** generate a clean baseline, then edit it in the
  canvas (rename sites, add a cloud on-ramp).
- **Agent over MCP:** "Generate a Juniper fabric like this one, then add the
  ZTNA connector" — one tool call, then normal edit tools.
- **Architect comparing designs:** flip vendor or HA mode and watch the tunnel
  count change, to explain why dual hubs cost what they cost.

## 5. Intent model

One object is the contract for the wizard, the MCP tool and tests.

| Field                | Type                                | Default       | Bounds                                   |
| -------------------- | ----------------------------------- | ------------- | ---------------------------------------- |
| `vendor`             | `edgeconnect` \| `juniper`          | required      | —                                        |
| `detail`             | `device` \| `site`                  | `device`      | —                                        |
| `regions`            | int                                 | 1             | 1–4                                      |
| `regionNames`        | string[]                            | AMER, EMEA, … | distinct, ≤24 chars                      |
| `hubsPerRegion`      | int                                 | 2             | 1–2 (independent hubs)                   |
| `branchesPerRegion`  | int \| int[]                        | 4             | 1–12 each; array length = `regions`      |
| `transports`         | (`inet`\|`mpls`\|`lte`)[]           | `['inet']`    | 1–3 entries, port order; repeats allowed |
| `branchHa`           | boolean                             | false         | —                                        |
| `branchLan`          | `none` \| `switch` \| `switch-ap`   | `none`        | device detail only                       |
| `interRegionHubMesh` | boolean                             | `regions > 1` | —                                        |
| `overlayName`        | string                              | `Default`     | ≤32 chars; EdgeConnect BIO name          |
| `cloudHub`           | `none` \| `aws` \| `azure` \| `gcp` | `none`        | slice 4                                  |
| `sse`                | `none` \| `branch` \| `hub`         | `none`        | slice 4                                  |
| `title`              | string                              | derived       | ≤120 chars                               |

Invalid input fails with an error that names the field and the allowed range;
nothing is created.

## 6. Behaviour

### 6.1 Common rules (all vendors)

- **WAN labels** follow port order per transport: `INET1`, `INET2`, `MPLS1`,
  `LTE1`.
- **Hubs** are independent appliances, never an HA pair. Each hub terminates one
  circuit per transport family its region's branches use. LTE is not a hub
  family: an LTE circuit is matched to the hub's Internet label (`LTE1→INET1`).
- **Branch → hub** tunnels go to every hub in the branch's own region.
- **Hub ↔ hub** tunnels always mesh within a region, and mesh across regions
  when `interRegionHubMesh` is set.
- **Transport clouds** (device detail): one per family per region (Internet,
  MPLS); every WAN circuit links its appliance to the cloud.
- **Provenance:** every compiled element has `source.system = "synthetic"` and a
  fixed `fetchedAt`; output is byte-identical for identical intent.

### 6.2 Vendor rules

| Aspect          | EdgeConnect                                                         | Juniper SRX (Mist WAN Assurance)                       |
| --------------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| Glyph           | `ec`                                                                | `firewall`                                             |
| Underlay layer  | One tunnel per matching label per appliance pair; hidden by default | none (layer omitted)                                   |
| Overlay layer   | One bonded tunnel per appliance pair, labelled with the BIO         | One IPsec tunnel per WAN path per spoke–hub pair       |
| Branch HA       | Two active appliances + HA link                                     | Chassis cluster node0/node1 + control and fabric links |
| HA circuits     | Alternate across members (WAN1 → member 1, WAN2 → member 2, …)      | Every circuit on both nodes (reth)                     |
| Tunnels from HA | Each member, all labels (shared over the HA link)                   | The cluster, drawn on node0 only                       |
| LAN             | AOS-CX switch, AP                                                   | EX switch, Mist AP                                     |

### 6.2a Cloud hubs and SSE on-ramp (slice 4)

- **Cloud hub** (`cloudHub`): one per region, `<region>-cloud01`, the vendor's
  virtual edge (EdgeConnect EC-V, Juniper vSRX). It is a hub: branches and the
  region's hubs tunnel to it, and it joins the hub mesh. It terminates Internet
  only, so MPLS-only branches do not reach it; with a cloud hub, data-center
  hubs always carry an Internet circuit so they can mesh with it.
  - Device detail adds the provider's router on the hub row, linked by its
    peering: AWS Transit Gateway via TGW Connect (GRE + BGP); Azure Virtual WAN
    hub (EdgeConnect as an NVA in the hub, otherwise an NVA in a connected
    VNet, both BGP); Google Cloud Router via an NCC router appliance (BGP).
  - Site detail draws the cloud hub tile as the provider's router.
- **SSE on-ramp** (`sse`): one SSE PoP per region (`sse_<region>`) on the hub
  row; IPsec tunnels on the `sse` layer (kind `service`). `branch`: from every
  tunnel end (both EC HA members; SRX cluster node0) — local breakout. `hub`:
  from the data-center hubs only — backhaul. One tunnel per edge; real
  deployments usually add a secondary PoP.
- SSE PoPs and cloud routers are not counted as devices; SSE tunnels are counted
  in `tunnels` and reported as `sseTunnels`.

### 6.3 Detail levels

- **`device`:** every appliance, cloud, circuit, HA/cluster link and LAN device.
  Branch zones wrap a site's devices only when there are two or more.
- **`site`:** one place tile per site — hubs `datacenter`, branches
  `branchoffice`, named for the site (`amer-br01`) — one overlay tunnel per
  branch–hub pair and per meshed hub pair, no clouds, circuits or LAN. Each
  branch tile's sublabel summarizes the site (`HA pair · INET1+MPLS1`).
- **`overview`** (slice 2): page 1 (`sdwan`) is the `site` view; then one
  `device` page per region (`sdwan-<region>`) with that region's fabric only.
  Every overview tile carries `href: "#page=sdwan-<region>"` and each region
  page a **◂ Overview** text link back. The inter-region hub mesh is drawn on
  the overview only.

**Page links** (slice 2): an element `href` of the form `#page=<pageId>` links
to another page of the document. Validation warns when the page does not exist;
Ctrl/Cmd+click in the editor switches pages; draw.io export writes draw.io's
own page link (`data:page/id,<id>`) and import maps it back. Renderer, Visio,
PowerPoint and PDF outputs emit only http(s) links, so page links never leak
as broken URLs.

### 6.4 Layout

Deterministic, no force layout. Each region is a dashed zone containing rows:
hubs, transport clouds, branches (wrapping at 6 per row, 4 for HA), then LAN.
Regions tile one or two across. With three or four regions the top grid row is
mirrored (LAN on top, hubs at the bottom), so every region's hubs face one
central hub band, the inter-region hub mesh stays inside that band, and region
names label the hub edge. The page `viewBox` fits the content. Above 24
tunnels, tunnel captions move into link metadata to keep the canvas legible.
Finally every page runs automatic label placement (`render/label-auto`): each
node's label moves to the compass side crossed by the fewest drawn links —
hubs whose tunnels fan downward get their names above — without breaking any
layout rule.

## 7. Surfaces

- **Headless API:** `generateSdwan(intent) → { doc, intent, stats }` in
  `src/connect/generate.ts`.
- **MCP:** `generate_sdwan_topology` (zod-validated intent; stores the
  document, returns `{ id, title, stats, intent }`; counted against the mutating
  rate limit).
- **Editor:** **＋ template… → Generate SD-WAN…** opens a modal: one question
  per field, conditional questions (inter-region mesh only with 2+ regions; LAN
  only in device detail; one "WAN n type" per link), HA labelled per vendor
  (HA pair / Chassis cluster), a live preview and counts, and a hint to switch to
  site detail above 120 visible tunnels. Create replaces the document after
  confirmation, like a template. Keyboard: focus trap, Esc to close.

## 8. Acceptance criteria

| #    | Criterion                                                                                                                     | Slice 1                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| AC1  | The baseline case (EC, 1 region, 2 hubs, 4 branches, 1 INET) gives 9 underlay, 9 overlay, 6 devices, no HA cable between hubs | ✅ unit                  |
| AC2  | Underlay tunnels form only between matching labels; LTE yields `LTE1→INET1`; no LTE cloud is drawn                            | ✅ unit                  |
| AC3  | EdgeConnect HA: both members tunnel to every hub; circuits alternate members; one HA link                                     | ✅ unit                  |
| AC4  | SRX cluster: no tunnel touches node1; control + fabric links; each circuit on both nodes; no underlay layer                   | ✅ unit                  |
| AC5  | Inter-region mesh adds exactly the cross-region hub pairs                                                                     | ✅ unit                  |
| AC6  | Site detail: one tile per site, one tunnel per branch–hub pair, no cables                                                     | ✅ unit                  |
| AC7  | Every vendor × detail × regions × HA × LAN combination validates with no errors and `analyzeLayout` is empty                  | ✅ unit (32-case matrix) |
| AC8  | Identical intent → identical JSON; every sourced element is `synthetic`                                                       | ✅ unit                  |
| AC9  | Out-of-range input names the field; nothing is stored                                                                         | ✅ unit + MCP            |
| AC10 | Wizard counts equal the counts on the canvas after Create; Esc leaves the document untouched                                  | ✅ e2e                   |
| AC11 | MCP tool returns a document that `validate_topology` reports valid and layout-clean                                           | ✅ MCP                   |
| AC12 | Wizard is usable at phone width (390px) with the preview above the form                                                       | ✅ manual screenshot     |
| AC13 | Site detail uses place icons (hubs `datacenter`, branches `branchoffice`), tiles named for their site                         | ✅ unit (slice 2)        |
| AC14 | `overview` gives 1 + regions pages; every overview tile links to its region page and each region page links back              | ✅ unit + e2e (slice 2)  |
| AC15 | Ctrl/Cmd+click follows a page link in the editor and never edits the document                                                 | ✅ e2e (slice 2)         |
| AC16 | A dangling page link is a validation warning; draw.io export/import keeps page links pointing at the right page               | ✅ unit (slice 2)        |
| AC17 | A blank region name falls back to that region's default by position; names whose slugs collide are rejected                   | ✅ unit (slice 2)        |
| AC18 | A cloud hub per region joins branch tunnels and the hub mesh over Internet labels only, peered with the provider router       | ✅ unit (slice 4)        |
| AC19 | SSE `branch` draws one IPsec tunnel per tunnel-terminating edge; `hub` only from data-center hubs; on the `sse` layer         | ✅ unit + e2e (slice 4)  |
| AC20 | Every vendor × detail × cloud × SSE combination at 4 regions with HA and LAN validates and lays out overlap-free              | ✅ unit (18 cases)       |
| AC21 | `mapBackdrop` puts each region's continent behind its zone by name; unknown names get none; fill only, inside the zone box    | ✅ unit (slice 3)        |

## 9. Slices

| Slice | Scope                                                                                                                                                                                                                                                                                                                                                           | Depends on                      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **1** | Intent, EdgeConnect + Juniper SRX vendor rules, device/site detail, layout, MCP tool, wizard. **Done (PR #293).**                                                                                                                                                                                                                                               | —                               |
| **2** | **Site tiles and drill-down.** Site detail uses place icons; `overview` detail adds one device page per region, linked by in-document page links (`href: "#page=<id>"`). Region names and per-region branch counts in the wizard. **Done.**                                                                                                                     | Place icons (0011 tier 1, done) |
| **3** | **Geography.** `mapBackdrop`: each region zone draws its business-region map (Natural Earth 1:110m countries, public domain, Equal Earth projection; North America, LATAM, AMER, Europe, Africa, EMEA, APAC, World; Russia cut at 60°E outside the World map) faintly inside its box, matched by region name. A zone `backdrop` field anyone can set. **Done.** | —                               |
| **4** | **Cloud and SASE edges.** Cloud hub per region (AWS / Azure / GCP) and SSE on-ramp (branch breakout or hub backhaul). **Done**; branch-to-branch mesh deferred.                                                                                                                                                                                                 | SSE/SASE PoP icon (0011, done)  |
| 5     | **More vendors.** Juniper SSR (Secure Vector Routing — tunnel-free, needs its own profile), Fortinet SD-WAN/ADVPN (FGCP cluster terminates once).                                                                                                                                                                                                               | Vendor review                   |

## 10. Risks and open questions

- **Juniper hub-to-hub tunnels (open):** slice 1 draws one per shared transport.
  Verify against how Mist hub profiles are deployed before customer use.
- **EdgeConnect HA circuit placement (assumption):** alternating members is the
  common pattern, not the only one. A per-circuit placement option may be needed.
- **Density:** EdgeConnect device detail at the top of the range (4 regions ×
  12 HA branches × 3 transports) produces several hundred underlay tunnels. The
  layer is hidden by default and the wizard steers to site detail; if editor
  performance suffers, cap device detail lower than site detail.
- **Cloud integration patterns (assumption):** TGW Connect, NVA in the vWAN hub
  (EdgeConnect) or in a connected VNet (vSRX), and NCC router appliance are the
  common patterns; check each against the vendor's current cloud docs before a
  customer sees them. Direct Connect / ExpressRoute / Interconnect (MPLS-like
  private paths into the cloud) are not modelled.
- **SSE PoP redundancy:** one tunnel per edge to one PoP; primary/secondary PoP
  pairs are not drawn yet.
- **Hub transports:** hubs take every family their branches use. A hub that
  lacks MPLS (and branches that therefore tunnel over INET only) is not
  expressible yet.
