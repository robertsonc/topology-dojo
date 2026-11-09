# Proposal 0012 — SD-WAN vendor research: Fortinet FortiGate and Juniper SSR

**Status:** Research only — **not committed to build.** Captured 2026-11-08 as
input for proposal 0010 slice 5 ("more vendors"). The generator today models
HPE Aruba Networking EdgeConnect and Juniper SRX (Mist WAN Assurance); this
note records how two further vendors would be modelled if and when slice 5 is
scheduled. The roadmap entry under "Later" points here.

**Method:** web research against vendor documentation. **D** marks a
documented statement (with its source); **I** marks an inference. Juniper's
SSR and Mist documentation now redirects to networkingdocs.hpe.com and some
Mist pages returned 404 during research; the URLs below are the original
paths. Re-verify every rule against current vendor docs before building, and
before any diagram reaches a customer.

## 1. Fortinet FortiGate SD-WAN

Fortinet fits the generator's existing model closely (per-transport IPsec
overlays, independent dual hubs, cluster as one endpoint).

### Overlays

- **D** The hub runs "a separate dial-up IPsec endpoint" on each underlay;
  branches "typically build overlays over all available WAN ports";
  one-to-one mapping (branch underlay → matching hub underlay) is "the most
  common overlay design"; full mesh is "generally not recommended" for
  multi-DC.
  [SD-WAN architecture for enterprise — IPsec overlays](https://docs.fortinet.com/document/fortigate/7.2.0/sd-wan-architecture-for-enterprise/242149/ipsec-overlays)
- **D** In a dual-hub region with INET and MPLS, "every Spoke will build four
  static IPsec tunnels."
  [SD-WAN / SD-Branch architecture for MSSPs 7.4](https://docs.fortinet.com/document/fortigate/7.4.0/sd-wan-sd-branch-architecture-for-mssps/757698)
- **D** The FortiManager SD-WAN overlay template names tunnels per hub and
  WAN (HUB1-VPN1, HUB1-VPN2, HUB2-VPN1, HUB2-VPN2), groups them in one SD-WAN
  zone per hub, adds one health check per hub, and builds no overlay on a WAN
  marked "Private Link".
  [FortiManager — objects created by the SD-WAN overlay template](https://docs.fortinet.com/document/fortimanager/7.4.0/administration-guide/28292/objects-and-templates-created-by-the-sd-wan-overlay-template)
- **D** One spoke underlay can terminate on more than one hub underlay
  (ADVPN 2.0 example: a single-link spoke builds H1_T11 and H1_T22).
  [FortiOS 7.6 admin guide](https://docs.fortinet.com/document/fortigate/7.6.7/administration-guide/204310)
- **I** An LTE underlay can terminate on the hub's Internet endpoint (a
  dial-up endpoint accepts any reachable public peer), as its own tunnel. No
  document shows LTE specifically.
- **Rule:** one IPsec tunnel per (branch WAN × hub endpoint of the same
  transport); LTE → hub INET endpoint; one overlay zone per hub; no overlay on
  a private link. Same counting as the SRX profile.

### ADVPN shortcuts

- **D** ADVPN is enabled on all hubs and spokes in the MSSP design (URL
  above).
- **D** ADVPN 2.0 (FortiOS 7.4.2+): spokes learn each other's underlays and
  build shortcuts only "using underlays available on both spokes", chosen by
  link health; "all created shortcuts use unique underlay paths".
  [ADVPN 2.0 edge discovery and path management](https://docs.fortinet.com/document/fortigate/7.4.0/new-features/637049/advpn-2-0-edge-discovery-and-path-management-7-4-2)
- **I** ADVPN 1.0 creates shortcuts per parent overlay (potentially many);
  2.0 creates one per distinct reachable, in-SLA underlay pair.
- **Rule:** shortcuts are optional, dashed, labelled "on-demand", on their
  own layer hidden by default; with 2.0, one per shared transport between two
  branches (INET↔INET, MPLS↔MPLS), never one per overlay.

### Dual hubs and multi-region

- **D** Hubs "are independent of each other"; spokes connect to both hubs
  over all underlays.
  [Gateway components](https://docs.fortinet.com/document/fortigate/7.2.0/sd-wan-architecture-for-enterprise/506696/gateway-components)
- **D** Dual-hub regions are "the most recommended"; each hub is an
  independent BGP route reflector.
  [MSSP architecture 7.0](https://docs.fortinet.com/document/fortigate/7.0.0/sd-wan-sd-branch-architecture-for-mssps/698032)
- **D** FortiManager templates offer Single Hub, Dual Hub Primary/Secondary
  and Dual Hub Primary/Primary.
  [Configuring an SD-WAN overlay template](https://docs.fortinet.com/document/fortimanager/7.4.0/administration-guide/275483/configuring-an-sd-wan-overlay-template)
- **D** Regional hubs build static tunnels between regions, typically full
  mesh, over all or some transports; ADVPN in forwarder mode can optionally
  allow inter-regional shortcuts (MSSP 7.4 URL above). The 7.0 design says
  cross-region traffic "will always flow through the regional hubs."
  [Multi-regional design example](https://docs.fortinet.com/document/fortigate/7.0.0/sd-wan-sd-branch-architecture-for-mssps/435097/design-example-multi-regional-design)
- **Rule:** dual hubs are independent (already the generator's model);
  inter-region hubs full mesh (already modelled); inter-region shortcuts an
  optional flag.

### HA (FGCP)

- **D** Active-passive is recommended for gateways at a DC or HQ; branches
  "terminate their overlays to the active device" and are "unaware the
  gateway is a cluster"; active-active "will not change" the SD-WAN design;
  FGSP is called advanced and out of scope.
  [Intra-datacenter failover](https://docs.fortinet.com/document/fortigate/7.2.0/sd-wan-architecture-for-enterprise/705617/intra-datacenter-failover)
- **D** Recommended "double back-to-back heartbeat connections" and "similar
  connections from each member to the switches".
  [HA active-passive cluster setup](https://docs.fortinet.com/document/fortigate/7.4.0/administration-guide/62403/ha-active-passive-cluster-setup)
- **D** Two members: heartbeat back-to-back; more members: a dedicated
  switch per heartbeat interface.
  [FortiOS 8.0 admin guide](https://docs.fortinet.com/document/fortigate/8.0.0/administration-guide/849059)
- **Rule:** an FGCP pair is one logical overlay endpoint (drawn on the
  primary, like the SRX profile); two heartbeat links between members; each
  WAN reaches both members (through a switch).

### Management

- **D** The FortiManager SD-WAN overlay template generates the IPsec, BGP,
  SD-WAN and template-group objects for hubs and branch groups (defaults:
  loopbacks 172.16/16, overlay 10.10/16, AS 65000, ADVPN optional).
- **I** Draw FortiManager (or FortiManager Cloud) and FortiAnalyzer as
  management-plane nodes with dotted lines to every FortiGate, off the data
  path. FortiAnalyzer specifics were not researched.

### Cloud hubs and SSE

- **D AWS** FortiOS 6.4.3+ supports TGW Connect attachments (GRE + BGP).
  [6.4 new features](https://docs.fortinet.com/document/fortigate/6.4.0/new-features/747813),
  [AWS administration guide](https://docs.fortinet.com/document/fortigate-public-cloud/7.2.0/aws-administration-guide/14501)
- **D Azure** FortiGate NVAs sit **inside the vWAN hub** (two NVAs in the
  example) and peer BGP with vWAN; branches build SD-WAN overlays to them.
  [Azure vWAN SD-WAN NGFW deployment guide](https://docs.fortinet.com/document/fortigate-public-cloud/7.4.0/azure-vwan-sd-wan-ngfw-deployment-guide/606584/planning-the-network)
- **D GCP** FortiGate as an NCC router appliance peering BGP with Cloud
  Router.
  [GCP — SD-WAN transit routing with NCC](https://docs.fortinet.com/document/fortigate-public-cloud/7.2.0/gcp-administration-guide/554824/sd-wan-transit-routing-with-google-network-connectivity-center)
- **D FortiSASE (SPA)** FortiSASE PoPs become spokes of the FortiGate SD-WAN
  hub (one, two or up to four hubs).
  [SPA with a FortiGate SD-WAN](https://docs.fortinet.com/document/fortisase/latest/spa-with-a-fortigate-sd-wan-deployment-guide/834810)
- **D FortiSASE Branch On-Ramp** the branch FortiGate is an IKEv2 dial-up
  client to the PoP with iBGP; the add-on was reportedly discontinued after
  release 25.3.b.
  [FortiSASE release notes](https://docs.fortinet.com/document/fortisase/7.4.0/release-notes/969608)
- **Rule:** cloud hub = FortiGate-VM reached by the same per-transport
  overlays, peering per provider (TGW Connect · GRE + BGP; **NVA in vWAN hub
  · BGP**; NCC router appliance · BGP). SSE = the SPA pattern (PoP as a spoke
  of the hub) by default; Branch On-Ramp only as a legacy option.

### Open questions (Fortinet)

1. No Fortinet document shows an LTE spoke on the hub's INET endpoint — the
   rule is an inference.
2. Whether ADVPN 2.0 forms cross-transport shortcuts (INET ↔ LTE, both
   public) is unclear.
3. Not confirmed whether 7.4+ defaults inter-region traffic to hub transit
   or shortcuts.
4. Small-branch WAN cabling (external switch vs the internal / virtual VLAN
   switch options in the HA guide) not confirmed.
5. Current FortiSASE On-Ramp availability and licensing not checked.

## 2. Juniper Session Smart Router (SSR)

SSR differs in kind: there are no tunnels, and HA works per node.

### Overlay: Secure Vector Routing and peer paths

- **D** Neighborhoods "are a means of specifying which Network Interfaces…
  are connected to each other"; the Conductor "creates the peer
  service-route from the neighborhood configuration"; topology is mesh, hub
  or spoke.
  [SSR glossary](https://www.juniper.net/documentation/us/en/software/session-smart-router/docs/concepts_glossary/)
- **D** Interfaces sharing a neighborhood are assumed routable to each
  other; a waypoint can belong to several neighborhoods. In the design
  guide's data-centre example the hub's Internet interface is in both a
  broadband and an LTE neighborhood; branch LTE interfaces are only in LTE.
  Vectors (broadband, lte, mpls) label paths for service policy.
  [SD-WAN design guide](https://docs.128technology.com/docs/bcp_sdwan_design_guide/)
- **D** BFD runs per peer path; `show peers detail` reports per-path latency,
  loss and jitter.
  [Tuning BFD](https://www.juniper.net/documentation/us/en/software/session-smart-router/docs/howto_tune_bfd)
- **D** Peer-path overlay is `svr` (default) or `bfd-tunnel`.
  [BFD tunnel](https://www.juniper.net/documentation/us/en/software/session-smart-router/docs/config_bfd_tunnel/)
- **I** A peer path is one BFD-monitored adjacency between a local and a
  remote WAN interface in a shared neighborhood.
- **Rule:** one peer path per (local WAN interface, remote WAN interface)
  pair in a shared neighborhood; default neighborhoods INET↔INET,
  MPLS↔MPLS, LTE → hub INET; drawn as SVR paths, not IPsec tunnels.

### Topology

- **D** "Meshes will connect to everything, hubs connect to spokes and
  meshes, and spokes connect to hubs and meshes" (glossary).
- **D** In Mist, mesh is SSR-only, needs static IPs, and excludes the
  interface from other topologies.
  [Manage WAN edge mesh](https://www.juniper.net/documentation/us/en/software/mist/mist-wan/topics/task/manage-wan-edge-mesh.html)
- **D** The validated design describes an optional hub-to-hub overlay and
  warns that mesh designs "always have scale limitations" and suit broadband
  and LTE poorly.
  [JVD WAN edge for SSR — use case](https://www.juniper.net/documentation/us/en/software/jvd/jvd-wan-edge-for-ssr/use_case_and_reference_architecture.html)
- **Rule:** branch → hub by default; hub ↔ hub and branch mesh only as
  options.

### HA

- **D** "A highly available router is comprised of exactly two routing nodes
  within the same router container"; a dedicated sync link carries session
  state; an optional but strongly recommended fabric (dog-leg) link forwards
  between nodes; shared interfaces are active on one node at a time.
  [SSR HA configuration](https://www.juniper.net/documentation/us/en/software/session-smart-router/docs/config_ha/)
- **D** The design guide advises that "the different WAN connections should
  terminate to different nodes".
- **D** Juniper's validated HA design: each hub node owns its own INET and
  MPLS links ("avoid using redundant interface configurations"); the spoke's
  INET is per node and its MPLS is a VRRP active/standby pair; the spoke
  shows "eight tunnels" to the HA hub, two of them down because of the
  standby MPLS member; hub endpoints are named per node (e.g.
  `hahub-N0-INET`).
  [JVD — HA hub-and-spoke with SSR pairs](https://www.juniper.net/documentation/us/en/software/jvd/jvd-wan-edge-for-ssr/appendix_building_a_high_availability_hub-and-spoke_using_ssr_chassis_cluster_pairs_topology.html)
- **I** Peer paths terminate on a node's physical WAN interface, not on the
  logical router.
- **Rule:** an HA site is one router of node0 + node1 joined by sync and
  fabric links; WANs belong to a node (or a shared pair drawn active /
  standby); paths run node WAN ↔ node WAN, with the standby member's paths
  drawn as down. **Open decision:** draw standby paths dimmed (as the JVD
  does) or omit them.

### Management

- **D** The Conductor is "the centralized management node"; all routers
  connect to it for configuration; it can run as an HA pair and scales to
  roughly 2,000 nodes. SSR 6.x can be Mist-managed; Conductor-managed SSR
  5.4+ can still stream telemetry to Mist.
  [SSR WAN overview](https://www.juniper.net/documentation/us/en/software/session-smart-router/docs/wan_overview/)
- **Rule:** Conductor or Mist cloud as an out-of-band management plane with
  dashed lines to every router.

### Encryption, SSE and cloud

- **D** The service security policy encrypts the payload per session; the
  adjacency policy encrypts SVR metadata and HMAC-signs packets; adaptive
  encryption skips already-encrypted traffic.
  [Security policy](https://www.juniper.net/documentation/us/en/software/session-smart-router/docs/sec_security_policy/),
  [Adaptive encryption](https://www.juniper.net/documentation/us/en/software/session-smart-router/docs/sec_adaptive_encrypt/index.html)
- **D** Mist Secure Edge connectors build IPsec or GRE from the SSR to the
  SSE provider (e.g. Zscaler).
  [Secure Edge connector](https://www.juniper.net/documentation/us/en/software/mist/mist-wan/topics/concept/wan-assurance-secure-edge-connector.html),
  [Zscaler integration](https://www.juniper.net/documentation/us/en/software/mist/mist-wan/topics/topic-map/zscaler-inegration.html)
- **Cloud (secondary sources only):** marketplace images exist for AWS,
  Azure and GCP; an AWS Cloud WAN "tunnel-less" integration peers over BGP
  ([Juniper blog](https://www.juniper.net/us/en/the-feed/topics/sd-wan/session-smart-routing-demo-connecting-to-public-cloud-workloads.html)).
  A cloud-hosted hub cannot use MAC-move HA, so the hub overlay is suggested
  instead (JVD use case above). No documented TGW Connect, vWAN or NCC
  pattern was found.
- **Rule:** label peer paths "SVR (per-session encryption)" and name no
  cipher (ciphers differ by release); SSE as IPsec / GRE from each branch
  WAN; cloud hub as a virtual SSR in the same SVR fabric, with the provider
  peering marked as an assumption.

### Mist-managed SSR

- **D** Hub profiles create one overlay hub endpoint per hub WAN; spoke
  templates map each WAN to chosen endpoints (e.g. WAN1 → hub1-INET and
  hub2-INET); hub-to-spoke steering is set in the hub profile.
  [SSR WAN edge template](https://www.mist.com/documentation/ssr-wan-edge-template/),
  [Path selection hub → spoke](https://www.juniper.net/documentation/us/en/software/mist/mist-wan/topics/task/influence-path-selection-from-hub-to-spoke.html)
- **I** Mist replaces free-form neighborhoods with explicit WAN → endpoint
  mappings: the same pairwise model, but which pairs exist is configured.
- **Rule:** in Mist mode, create paths only for template-mapped pairs;
  default to matching transport to all hubs.

### Open questions (SSR)

1. No documented rule for whether LTE maps to the hub's INET endpoint in
   Mist.
2. Mist HA hub-profile behaviour could not be read (pages returned 404).
3. No documented SSR pattern for AWS TGW Connect, Azure vWAN or GCP NCC.
4. Default hub-to-hub behaviour in Conductor mode is unconfirmed.

## 3. Effect on what already shipped

- **Azure cloud-hub label:** the generator labels non-EdgeConnect Azure
  peering "VNet NVA · BGP". That is wrong for Fortinet (NVA inside the vWAN
  hub); the label must become per vendor when Fortinet is added. It remains
  the fallback for vSRX.
- **Management plane:** both vendors point to an optional management-plane
  layer for every vendor (EdgeConnect Orchestrator, Mist / Conductor,
  FortiManager + FortiAnalyzer), with dotted lines off the data path. The
  `orchestrator` stock type already exists.

## 4. Decisions to make before building

1. **Order:** Fortinet first (well documented, fits the existing model),
   then SSR as a separate pass — recommended.
2. **ADVPN shortcuts:** optional layer, hidden by default (like the
   EdgeConnect underlay)?
3. **SSR HA standby paths:** dimmed, or omitted?
