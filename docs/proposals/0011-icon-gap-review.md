# Proposal 0011 — Icon gap review

**Status:** Tier 1 shipped (2026-11-08). Places: `branchoffice`, `campus`,
`datacenter`, `homeoffice`. The rest: `ssepop`, `nac`, `authserver`,
`directory`, `siem`, `waf`, `l3switch`, `mobile`, `managedendpoint`,
`orchestrator` (laptop stays `host`). Tier 2 is next when needed.

**Captured:** 2026-11-08

**Source:** the published shape palette of a comparable network-diagramming
tool (the reference palette below), read from its documentation. It is about
130 shapes in 15 sections. Ours is 15
built-in engine glyphs (`src/api/builtins.ts`), 28 stock types
(`src/nodes/stock.ts`) and 4 hardware front panels (`catalog/data`).

## Where we are ahead

Don't trade these away while closing gaps:

- **Hyperscaler cloud edges:** AWS Transit / Internet / NAT / VPN / Direct
  Connect gateways, Azure Virtual WAN hub and ExpressRoute, GCP Cloud Router.
  The reference palette has only a generic Cloud, VPC, compute, storage and function.
- **Real hardware:** front panels for EC-XS, AOS-CX 6300M, SRX300 and the 9004
  class, bound to models with OS-native interface names and wire sheets.
- **SASE vocabulary:** `ec`, `connector` (ZTNA connector), `overlayCloud` (SASE
  PoP / overlay), `saas`, `apps`, `idcard` (identity).
- **Network services:** wireless controller, VPN concentrator, modem/ONT,
  Kubernetes, VoIP, IoT.

## Gap list, tiered by our mission (SASE, SD-WAN, campus, DC)

"Have" means an icon exists, possibly under another name.

### Tier 1 — directly used by SASE / SD-WAN / ZTNA diagrams (shipped)

| Reference shape                                      | Have?                                                     | Why it matters here                                                                                                                           |
| ---------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch office / Data centre / Campus / Home (Places) | **Shipped** (Places group)                                | Site tiles for SD-WAN site detail (0010 slice 2) and remote-worker ZTNA stories                                                               |
| SASE / SSE PoP                                       | **Shipped** `ssepop`                                      | A dedicated SSE PoP glyph, distinct from a generic overlay cloud, for slice 4 on-ramps                                                        |
| NAC                                                  | **Shipped** `nac`                                         | ClearPass in every campus and ZTNA posture story                                                                                              |
| Auth server (RADIUS/TACACS+)                         | **Shipped** `authserver`                                  | Pairs with NAC; distinct from the identity provider                                                                                           |
| Directory                                            | **Shipped** `directory`                                   | AD / Entra ID as the account store, separate from the auth server answering requests                                                          |
| SIEM                                                 | **Shipped** `siem`                                        | Log and telemetry destinations in SSE and SOC flows                                                                                           |
| WAF                                                  | **Shipped** `waf`                                         | Private-app and SaaS protection paths                                                                                                         |
| L3 switch                                            | **Shipped** `l3switch`                                    | EVPN-VXLAN leaf/spine and campus core; the reference palette's shape-semantics rule (router 4 arrows, L3 switch 8, switch 2) is worth copying |
| Laptop / Mobile / Managed endpoint                   | **Shipped** `mobile`, `managedendpoint` (laptop = `host`) | ZTNA and SWG stories need managed vs unmanaged devices                                                                                        |
| Orchestrator / cloud controller                      | **Shipped** `orchestrator`                                | EdgeConnect Orchestrator, Mist cloud, Aruba Central: the management plane in every SD-WAN diagram                                             |

### Tier 2 — useful, not urgent

| Reference shape                                                                  | Have?             | Use                                                                |
| -------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------ |
| VRF / virtual context (VDOM, VSYS)                                               | No                | Segmentation views; EVPN tenant VRFs                               |
| Satellite terminal / Satellite                                                   | No                | LEO as an SD-WAN transport (a fourth `transport` in the generator) |
| LTE/5G radio / microwave radio link                                              | Partial (`modem`) | Wireless WAN transports                                            |
| Console server, patch panel, PDU                                                 | No                | Wiring sheets and rack builds (the hardware-catalog track)         |
| Attacker, infected host, file and website verdicts (clean / malicious / unknown) | No                | SSE demos: SWG block, CASB, sandbox verdict storytelling           |
| Jump host, PAM                                                                   | No                | Privileged-access paths in ZTNA                                    |
| Endpoint manager (MDM)                                                           | No                | Device posture source in ZTNA                                      |
| Places: Internet / WAN / MAN / PSTN                                              | Partial (`cloud`) | Typed transport clouds instead of one generic cloud                |

### Tier 3 — out of scope unless a demo needs it

- **OT and industrial:** PLC, safety PLC, RTU, remote I/O, VFD, HMI, engineering
  workstation, SCADA, historian, protocol gateway, substation, relay, solar PV,
  wind turbine, HVAC, fire panel, robot, field cabinet, the Purdue levels
  backdrop, data diode.
- **Optical transport:** DWDM terminal, mux/demux, transponder.
- **Racks and maps:** The reference tool treats these as features, not icons. Track them
  separately: rack elevations on the hardware track, map backdrops in 0010
  slice 3.

## Design rules worth copying

1. **Colour means family, not section.** Security, network, compute and data
   each keep one hue, whatever palette section the shape is listed in.
2. **Shape encodes forwarding role.** Router circle (4 arrows), L3 switch
   rounded square (8 arrows), switch wide chassis (2 arrows). The diagram then
   reads correctly in grey-scale prints.
3. **Passive devices count no optics.** A patch panel or mux/demux end adds no
   transceiver to the bill of materials, which matters once wire sheets count
   optics.

## Next step

Build tier 1 as one node-art packet: engine glyphs, palette entries, search
keywords, `describe_capabilities` coverage, and a visual baseline. The four
place icons come first, because 0010 slice 2 (site tiles) depends on them.
