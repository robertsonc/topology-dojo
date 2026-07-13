/**
 * `convertLegacyStudio` / `detectLegacyStudio` acceptance.
 *
 * Two kinds of coverage:
 *  1. Every real fixture under `fixtures/legacy/` (pulled verbatim from the
 *     legacy app's own `tests-e2e/fixtures/`) is converted and checked
 *     against hand-derived page/node/link counts and an exact warning list.
 *     The counts are derived by hand-applying the module's own documented
 *     "first show wins, then holds" resolution rule (see the big comment at
 *     the top of `legacy.ts`) to each fixture's `steps[].phases[].show`
 *     arrays — the derivation is written out in a comment on each case so
 *     it can be checked without running the code.
 *  2. Small, synthetic documents exercise the malformed/edge paths a real
 *     fixture never hits: hard-fail input, unknown node/link types, missing
 *     coordinates, dangling references, elements never revealed by any
 *     step, and the zone/flow-path/policy-marker "global overlay" rule.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { convertLegacyStudio, detectLegacyStudio } from './legacy.js';
import { validateDocument } from '../api/validate.js';

function loadFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../fixtures/legacy/${name}`, import.meta.url)),
      'utf8',
    ),
  );
}

/**
 * A fresh counter-based id generator every call — so two independently
 * seeded conversions of the same input mint identical id sequences, and the
 * determinism test can assert full structural equality (not just "modulo
 * some opaque id string").
 */
function seededIds(): (prefix: string) => string {
  let n = 0;
  return (prefix: string) => `${prefix}${n++}`;
}

interface ExpectedPage {
  name: string;
  nodes: number;
  links: number;
}

interface FixtureCase {
  file: string;
  pages: ExpectedPage[];
  warnings: string[];
}

const FIXTURES: FixtureCase[] = [
  {
    file: 'sdwan-branch.json',
    // 8 nodes / 8 links total, 3 steps. Cumulative reveal ("first show
    // wins, then holds"):
    //   s1: {HQ,BRNCH,SSW,BSW} then {SRV,PC,hq-ssw,ssw-srv,br-bsw,bsw-pc}
    //     → 6 nodes, 4 links
    //   s2: {INET,hq-inet,br-inet} then {FW,inet-fw}
    //     → +INET,+FW = 8 nodes (all); +hq-inet,+br-inet,+inet-fw = 7 links
    //   s3: {overlay}
    //     → 8 nodes (unchanged), +overlay = 8 links (all)
    pages: [
      { name: 'Physical Sites', nodes: 6, links: 4 },
      { name: 'Internet Breakout', nodes: 8, links: 7 },
      { name: 'SD-WAN Overlay', nodes: 8, links: 8 },
    ],
    warnings: [
      'document subtitle "Branch connectivity via SD-WAN overlay" has no dedicated field in the flipbook document; appended to the title',
      'act "Act 1 · Baseline" has no destination field in the flipbook document (grouping is preserved only via page order)',
      'act "Act 2 · SD-WAN Overlay" has no destination field in the flipbook document (grouping is preserved only via page order)',
      'glossary (2 terms) has no destination field in the flipbook document: SD-WAN, NGFW',
    ],
  },
  {
    file: 'ztna-user-to-app.json',
    // 7 nodes / 7 links, 3 steps.
    //   s1: {USER,IDP,user-idp} → 2 nodes, 1 link
    //   s2: {SSE,idp-sse} then {user-sse} → +SSE=3 nodes; +idp-sse,+user-sse=3 links
    //   s3: {CONN,sse-conn} then {APP,conn-app} then {DB,FW,app-db,fw-db}
    //     → +CONN,+APP,+DB,+FW = 7 nodes (all); +3 links +2 links = 7 links (all)
    pages: [
      { name: 'User & IdP', nodes: 2, links: 1 },
      { name: 'SSE Policy Evaluation', nodes: 3, links: 3 },
      { name: 'App Connector', nodes: 7, links: 7 },
    ],
    warnings: [
      'document subtitle "Zero Trust access: identity, posture, policy enforcement" has no dedicated field in the flipbook document; appended to the title',
      'act "Act 1 · User Authentication" has no destination field in the flipbook document (grouping is preserved only via page order)',
      'act "Act 2 · ZTNA Tunnel" has no destination field in the flipbook document (grouping is preserved only via page order)',
      'act "Act 3 · App Access" has no destination field in the flipbook document (grouping is preserved only via page order)',
      'glossary (4 terms) has no destination field in the flipbook document: ZTNA, PEP, PDP, SSE',
    ],
  },
  {
    file: 'firewall-blocked-flow.json',
    // 7 nodes / 6 links, 4 steps.
    //   s1: {ATTK,SW1,attk-sw1} → 2 nodes, 1 link
    //   s2: {FW,sw1-fw} → +FW=3 nodes; +sw1-fw=2 links
    //   s3: {LOG,fw-log,"blocked":true} → +LOG=4 nodes; +fw-log=3 links
    //   s4: {SW2,DB,SRV,fw-sw2,sw2-db,sw2-srv} → +3=7 nodes (all); +3=6 links (all)
    // s3's phase also carries `"blocked": true` — the cinematic deny/drop
    // flag has no flipbook equivalent, so it becomes a warning.
    pages: [
      { name: 'Compromised Host', nodes: 2, links: 1 },
      { name: 'Traffic Hits Firewall', nodes: 3, links: 2 },
      { name: 'Policy Denies and Logs', nodes: 4, links: 3 },
      { name: 'Protected Servers', nodes: 7, links: 6 },
    ],
    warnings: [
      'document subtitle "Policy violation: unauthorized lateral movement blocked" has no dedicated field in the flipbook document; appended to the title',
      'act "Act 1 · Lateral Movement Attempt" has no destination field in the flipbook document (grouping is preserved only via page order)',
      'act "Act 2 · Firewall Block" has no destination field in the flipbook document (grouping is preserved only via page order)',
      'glossary (3 terms) has no destination field in the flipbook document: NGFW, SIEM, Lateral Movement',
      'step "s3" has a phase flagged "blocked" (cinematic deny animation) with no flipbook equivalent; consider a policyMarker of type "deny" on the relevant node',
    ],
  },
  {
    file: 'multi-layer-policy.json',
    // 10 nodes / 10 links, 4 steps, 3 declared layers (physical/flow/policy).
    //   s1: {CORE,AGG1,AGG2,core-agg1,core-agg2} then
    //       {SRV1,SRV2,DB1,DB2,agg1-srv1,agg1-srv2,agg2-db1,agg2-db2}
    //     → 7 nodes, 6 links
    //   s2: {INET,inet-core} then {FW,core-fw} → +2=9 nodes; +2=8 links
    //   s3: {LB,fw-lb,lb-srv2} → +LB=10 nodes (all); +2=10 links (all)
    //   s4: {DB1,DB2} — both already visible since s1 → no change (10/10)
    pages: [
      { name: 'Core Infrastructure', nodes: 7, links: 6 },
      { name: 'Internet Ingress', nodes: 9, links: 8 },
      { name: 'Load Balancer Path', nodes: 10, links: 10 },
      { name: 'Segmentation Policy', nodes: 10, links: 10 },
    ],
    warnings: [
      'document subtitle "Overlay diagram: physical fabric, flow paths, and policy markers" has no dedicated field in the flipbook document; appended to the title',
      'act "Act 1 · Physical Fabric" has no destination field in the flipbook document (grouping is preserved only via page order)',
      'act "Act 2 · App Flow Path" has no destination field in the flipbook document (grouping is preserved only via page order)',
      'act "Act 3 · Policy Overlay" has no destination field in the flipbook document (grouping is preserved only via page order)',
      'glossary (2 terms) has no destination field in the flipbook document: Three-Tier, Micro-segmentation',
    ],
  },
  {
    file: 'dense-topology.json',
    // 30 nodes / 30 links, 5 steps (the fixture's "40 links" in its subtitle
    // is aspirational copy, not the actual link count — verified by
    // counting the `links` array).
    //   s1: {CORE1,CORE2,core1-core2} then
    //       {AGG1,AGG2,AGG3,AGG4,core1-agg1,core1-agg2,core2-agg3,core2-agg4}
    //     → 6 nodes, 5 links
    //   s2: {FW1,FW2,LB1,LB2,agg1-fw1,agg2-lb1,agg3-lb2,agg4-fw2}
    //     → +4=10 nodes; +4=9 links
    //   s3: {WEB1,WEB2,WEB3,fw1-web1,fw1-web2,lb1-web3} then
    //       {APP1,APP2,APP3,lb1-app1,lb2-app2,lb2-app3,fw2-app3} then
    //       {DB1,DB2,DB3,DB4,app1-db1,app1-db2,app2-db3,app3-db4}
    //     → +3+3+4=20 nodes; +3+4+4=20 links
    //   s4: {CLOUD1,CLOUD2,SAAS1,SAAS2,core1-cloud1,core2-cloud2,core1-saas1,core2-saas2}
    //     → +4=24 nodes; +4=24 links
    //   s5: {IDP,SSE,NAC,INET,MGMT,MON,core1-idp,core1-inet,agg4-nac,agg4-sse,fw2-mgmt,fw1-mon}
    //     → +6=30 nodes (all); +6=30 links (all)
    pages: [
      { name: 'Core Switching', nodes: 6, links: 5 },
      { name: 'Security Perimeter', nodes: 10, links: 9 },
      { name: 'Application Servers', nodes: 20, links: 20 },
      { name: 'Cloud Connectivity', nodes: 24, links: 24 },
      { name: 'Identity & Security Services', nodes: 30, links: 30 },
    ],
    warnings: [
      'document subtitle "30 nodes, 40 links — performance and rendering stress test" has no dedicated field in the flipbook document; appended to the title',
      'act "Act 1 · Core Fabric" has no destination field in the flipbook document (grouping is preserved only via page order)',
      'act "Act 2 · Application Tier" has no destination field in the flipbook document (grouping is preserved only via page order)',
      'act "Act 3 · Cloud & Security" has no destination field in the flipbook document (grouping is preserved only via page order)',
    ],
  },
  {
    file: 'executive-multi-act.json',
    // 10 nodes / 10 links, 6 steps, 4 acts each with 2-paragraph `intro` text.
    //   s1: {HQ,BRNCH,INET,hq-inet,br-inet} → 3 nodes, 2 links
    //   s2: {overlay} → +overlay = 3 links (nodes unchanged, 3)
    //   s3: {FW,inet-fw} → +FW=4 nodes; +inet-fw=4 links
    //   s4: {SSE,IDP,idp-sse,hq-sse} then {SAAS,sse-saas}
    //     → +SSE,+IDP,+SAAS=7 nodes; +idp-sse,+hq-sse,+sse-saas=7 links
    //   s5: {USER,user-sse} then {CONN,APP,sse-conn,conn-app}
    //     → +USER,+CONN,+APP=10 nodes (all); +user-sse,+sse-conn,+conn-app=10 links (all)
    //   s6: the "full picture" phase re-lists everything already shown → no change
    pages: [
      { name: 'Sites Without Security', nodes: 3, links: 2 },
      { name: 'SD-WAN Overlay', nodes: 3, links: 3 },
      { name: 'Firewall & Inspection', nodes: 4, links: 4 },
      { name: 'Cloud Security Fabric', nodes: 7, links: 7 },
      { name: 'Remote User ZTNA', nodes: 10, links: 10 },
      { name: 'Complete Architecture', nodes: 10, links: 10 },
    ],
    warnings: [
      'document subtitle "Cloud-first SD-WAN + ZTNA + SSE — Board Presentation" has no dedicated field in the flipbook document; appended to the title',
      'act "Act 1 · The Problem" has no destination field in the flipbook document (grouping is preserved only via page order); its 2-paragraph intro text is dropped',
      'act "Act 2 · SD-WAN Foundation" has no destination field in the flipbook document (grouping is preserved only via page order); its 2-paragraph intro text is dropped',
      'act "Act 3 · Zero Trust" has no destination field in the flipbook document (grouping is preserved only via page order); its 2-paragraph intro text is dropped',
      'act "Act 4 · Outcome" has no destination field in the flipbook document (grouping is preserved only via page order); its 2-paragraph intro text is dropped',
      'glossary (5 terms) has no destination field in the flipbook document: SD-WAN, SSE, ZTNA, CASB, SWG',
    ],
  },
];

describe('convertLegacyStudio — real fixtures', () => {
  for (const fx of FIXTURES) {
    describe(fx.file, () => {
      const json = loadFixture(fx.file);

      it('is detected as a legacy Topology Studio document', () => {
        expect(detectLegacyStudio(json)).toBe(true);
      });

      it('converts with the hand-derived page/node/link counts', () => {
        const result = convertLegacyStudio(json);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.document.pages.map((p) => p.name)).toEqual(
          fx.pages.map((p) => p.name),
        );
        result.document.pages.forEach((page, i) => {
          const expected = fx.pages[i];
          expect(expected).toBeDefined();
          expect(page.nodes).toHaveLength(expected!.nodes);
          expect(page.links).toHaveLength(expected!.links);
        });
      });

      it('validates with zero errors', () => {
        const result = convertLegacyStudio(json);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const problems = validateDocument(result.document);
        expect(problems.filter((p) => p.level === 'error')).toEqual([]);
        // These 6 fixtures happen to produce zero validateDocument warnings
        // too (every phase's reveal is self-contained: nodes and the links
        // that connect them always show together) — asserted explicitly so
        // a future regression that introduces stray warnings is visible.
        expect(problems).toEqual([]);
      });

      it('records the expected warning list', () => {
        const result = convertLegacyStudio(json);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.warnings).toEqual(fx.warnings);
      });

      it('is deterministic modulo id regeneration (seeded generator)', () => {
        const a = convertLegacyStudio(json, { idGenerator: seededIds() });
        const b = convertLegacyStudio(json, { idGenerator: seededIds() });
        expect(a.ok).toBe(true);
        expect(b.ok).toBe(true);
        if (!a.ok || !b.ok) return;
        expect(a.document).toEqual(b.document);
        expect(a.warnings).toEqual(b.warnings);
      });
    });
  }

  it('remaps step.focus into page.emphasis, id-for-id (sdwan-branch step 1: HQ, Branch)', () => {
    const result = convertLegacyStudio(loadFixture('sdwan-branch.json'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const page1 = result.document.pages[0]!;
    expect(page1.emphasis).toHaveLength(2);
    const labels = page1.emphasis!.map(
      (id) => page1.nodes.find((n) => n.id === id)?.label,
    );
    expect(labels.sort()).toEqual(['Branch', 'HQ']);
  });

  it('preserves per-node/link fields untouched by the id remap (dashed, sub1, layer)', () => {
    const result = convertLegacyStudio(loadFixture('multi-layer-policy.json'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.layers).toHaveLength(3);
    // legacy layer `type` "physical" → declared layer `kind` "underlay"
    expect(result.document.layers?.[0]).toMatchObject({
      name: 'Physical',
      kind: 'underlay',
      color: '#01a982',
    });
    const core = result.document.pages[0]!.nodes.find(
      (n) => n.label === 'Core Switch',
    );
    expect(core?.layer).toBe(result.document.layers?.[0]?.id);

    const execResult = convertLegacyStudio(
      loadFixture('executive-multi-act.json'),
    );
    expect(execResult.ok).toBe(true);
    if (!execResult.ok) return;
    const sse = execResult.document.pages[3]!.nodes.find(
      (n) => n.label === 'HPE SSE',
    );
    expect(sse?.sub1).toBe('SWG · ZTNA · CASB');
    const dashedLinks = execResult.document.pages[3]!.links.filter(
      (l) => l.dashed,
    );
    expect(dashedLinks.length).toBeGreaterThan(0);
  });
});

describe('detectLegacyStudio — shape sniffing', () => {
  it('rejects non-legacy shapes', () => {
    expect(detectLegacyStudio(null)).toBe(false);
    expect(detectLegacyStudio([])).toBe(false);
    expect(detectLegacyStudio({})).toBe(false);
    expect(detectLegacyStudio(42)).toBe(false);
    expect(detectLegacyStudio('a string')).toBe(false);
    // native TopologyDocument shape — has `pages`, no top-level nodes/links.
    expect(detectLegacyStudio({ title: 'x', pages: [], customNodes: [] })).toBe(
      false,
    );
  });

  it('accepts a legacy document even with an incomplete choreography', () => {
    expect(
      detectLegacyStudio({
        title: 'Truncated',
        viewBox: '0 0 800 600',
        nodes: [['A', { id: 'A', type: 'host', x: 0, y: 0 }]],
        links: [],
      }),
    ).toBe(true);
  });
});

describe('convertLegacyStudio — malformed input', () => {
  it.each([
    ['null', null],
    ['an array', []],
    ['an empty object', {}],
    ['a number', 42],
    ['a string', 'not a document'],
  ])('returns a typed error, never throws, for %s', (_label, input) => {
    expect(() => convertLegacyStudio(input)).not.toThrow();
    const result = convertLegacyStudio(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid-input');
    expect(result.error.message.length).toBeGreaterThan(0);
  });

  it('synthesizes a single full-topology page when there are no steps at all', () => {
    const result = convertLegacyStudio({
      title: 'Truncated Save',
      viewBox: '0 0 800 600',
      nodes: [
        ['A', { id: 'A', type: 'host', x: 10, y: 10, label: 'A' }],
        ['B', { id: 'B', type: 'server', x: 50, y: 50, label: 'B' }],
      ],
      links: [['ab', { id: 'ab', type: 'line', from: 'A', to: 'B' }]],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.pages).toHaveLength(1);
    expect(result.document.pages[0]!.nodes).toHaveLength(2);
    expect(result.document.pages[0]!.links).toHaveLength(1);
    expect(result.warnings).toContain(
      'no steps found in the legacy document; synthesized a single page containing the complete topology',
    );
    expect(
      validateDocument(result.document).filter((p) => p.level === 'error'),
    ).toEqual([]);
  });

  it('skips structurally malformed node entries instead of throwing', () => {
    const result = convertLegacyStudio({
      title: 'Bad shapes',
      viewBox: '0 0 100 100',
      nodes: [
        ['A', { id: 'A', type: 'host', x: 0, y: 0 }],
        'not-a-pair', // wrong shape entirely
        ['B'], // missing the cfg half of the pair
      ],
      links: [],
      steps: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.pages[0]!.nodes).toHaveLength(1);
    expect(result.warnings).toContain('2 malformed node entries were skipped');
  });

  it('falls back unknown node/link types to the nearest builtin, defaults missing coordinates, drops dangling endpoints, and defers never-shown elements to the final page', () => {
    const doc = {
      title: 'Malformed Doc',
      viewBox: '0 0 500 400',
      nodes: [
        ['A', { id: 'A', type: 'widget', x: 10, y: 10, label: 'A' }], // unknown type
        ['B', { id: 'B', type: 'host', label: 'B' }], // missing x/y
        ['C', { id: 'C', type: 'server', x: 100, y: 100, label: 'C' }],
        [
          'ORPHAN',
          { id: 'ORPHAN', type: 'host', x: 200, y: 5, label: 'Orphan' },
        ], // never in a show[]
      ],
      links: [
        ['ab', { id: 'ab', type: 'laser', from: 'A', to: 'B' }], // unknown type
        ['bad', { id: 'bad', type: 'line', from: 'B', to: 'ghost' }], // dangling endpoint
        ['bc', { id: 'bc', type: 'line', from: 'B', to: 'C' }],
      ],
      acts: [],
      steps: [
        {
          id: 's1',
          name: 'Step One',
          narration: 'n1',
          focus: [],
          phases: [{ show: ['A', 'B', 'C', 'ab', 'bc'] }],
        },
        {
          id: 's2',
          name: 'Step Two',
          narration: 'n2',
          focus: [],
          phases: [{ show: [] }],
        },
      ],
    };
    const result = convertLegacyStudio(doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.document.pages).toHaveLength(2);
    const [page1, page2] = result.document.pages as [
      (typeof result.document.pages)[0],
      (typeof result.document.pages)[0],
    ];

    // Step One: A, B, C revealed; ORPHAN not yet (it's never in a show[]).
    expect(page1.nodes.map((n) => n.label).sort()).toEqual(['A', 'B', 'C']);
    // "bad" (dangling endpoint) never resolves to a link on any page.
    expect(page1.links).toHaveLength(2);

    // Step Two: nothing new revealed, but ORPHAN defaults to the final page.
    expect(page2.nodes.map((n) => n.label).sort()).toEqual([
      'A',
      'B',
      'C',
      'Orphan',
    ]);
    expect(page2.links).toHaveLength(2);

    const nodeA = page1.nodes.find((n) => n.label === 'A');
    expect(nodeA?.type).toBe('host'); // unknown "widget" → nearest builtin
    const nodeB = page1.nodes.find((n) => n.label === 'B');
    expect(nodeB).toMatchObject({ x: 0, y: 0 }); // missing coords → (0, 0)
    const linkAB = page1.links.find((l) => l.from === nodeA?.id);
    expect(linkAB?.type).toBe('line'); // unknown "laser" → nearest builtin

    expect(result.warnings).toEqual([
      'node "A" has unknown type "widget"; fell back to "host"',
      'node "B" is missing valid x/y coordinates; defaulted to (0, 0)',
      'link "ab" has unknown type "laser"; fell back to "line"',
      'link "bad" references a missing endpoint ("B" → "ghost"); dropped',
      "1 element(s) are never referenced by any step's reveal list (ORPHAN); placed on the final page only",
    ]);

    // The importer never silently drops ORPHAN — but validateDocument
    // correctly flags it as unconnected on the page it lands on, since it
    // still has no link/zone/marker reference there. That's a genuine,
    // actionable warning about the *source* document, not an importer bug.
    const orphanNode = page2.nodes.find((n) => n.label === 'Orphan');
    const problems = validateDocument(result.document);
    expect(problems.filter((p) => p.level === 'error')).toEqual([]);
    expect(problems).toEqual([
      {
        level: 'warning',
        message:
          'unconnected node — no link, flow, zone, or marker references it',
        where: `page[1] "Step Two" node "${orphanNode?.id}"`,
      },
    ]);
  });

  it('treats flow paths and policy markers as a global overlay, gated on when every reference becomes visible', () => {
    const doc = {
      title: 'Overlay Doc',
      viewBox: '0 0 600 400',
      nodes: [
        ['N1', { id: 'N1', type: 'host', x: 0, y: 0, label: 'N1' }],
        ['N2', { id: 'N2', type: 'server', x: 100, y: 0, label: 'N2' }],
        ['N3', { id: 'N3', type: 'cloud', x: 200, y: 0, label: 'N3' }],
      ],
      links: [
        ['l1', { id: 'l1', type: 'line', from: 'N1', to: 'N2' }],
        ['l2', { id: 'l2', type: 'line', from: 'N2', to: 'N3' }],
      ],
      zones: [
        ['z1', { label: 'Zone A', nodes: ['N1', 'N2'], color: '#fff' }],
        ['zbad', { label: 'Zone Bad', nodes: ['ghost1', 'ghost2'] }],
      ],
      flowPaths: [
        ['fp1', { waypoints: ['N1', 'N2', 'N3'], color: '#0f0' }],
        ['fpbad', { waypoints: ['N1', 'ghost'] }],
      ],
      policyMarkers: [
        ['pm1', { nodeId: 'N3', type: 'deny', label: 'Deny' }],
        ['pmbad', { nodeId: 'ghost', type: 'deny' }],
      ],
      acts: [],
      steps: [
        {
          id: 's1',
          name: 'Step 1',
          focus: [],
          phases: [{ show: ['N1', 'N2', 'l1'] }],
        },
        {
          id: 's2',
          name: 'Step 2',
          focus: [],
          phases: [{ show: ['N3', 'l2'] }],
        },
      ],
    };
    const result = convertLegacyStudio(doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [page1, page2] = result.document.pages as [
      (typeof result.document.pages)[0],
      (typeof result.document.pages)[0],
    ];

    // Zone A's members (N1, N2) are both visible on page 1 already.
    expect(page1.zones).toHaveLength(1);
    expect(page1.zones[0]!.nodes).toHaveLength(2);
    // fp1 and pm1 both need N3, which isn't visible until page 2.
    expect(page1.flowPaths).toHaveLength(0);
    expect(page1.policyMarkers).toHaveLength(0);
    expect(page2.flowPaths).toHaveLength(1);
    expect(page2.policyMarkers).toHaveLength(1);

    expect(result.warnings).toEqual([
      'zone "zbad" references no resolvable member nodes; dropped',
      'flow path "fpbad" references a missing waypoint; dropped',
      'policy marker "pmbad" references a missing node "ghost"; dropped',
    ]);
    expect(
      validateDocument(result.document).filter((p) => p.level === 'error'),
    ).toEqual([]);
  });
});
