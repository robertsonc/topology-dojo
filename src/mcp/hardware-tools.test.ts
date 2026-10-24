/**
 * hw-catalog Phase 3: the hardware MCP tools — list / describe / bind /
 * assign / diff — and the cable-schedule export, through createTools.
 */
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { TopologyStore } from './store.js';
import { createTools, type ToolDeps } from './tools.js';
import { ContentResult } from './content.js';
import { renderDocumentToSVG } from '../server/render.js';
import { nodeCatalogLoader } from '../server/catalog.js';
import { buildBundle, loadCatalogDir } from '../catalog/build.js';
import { CatalogLoader } from '../catalog/loader.js';
import type { CatalogBundle } from '../catalog/catalog.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const BUNDLE = buildBundle(loadCatalogDir(`${root}catalog/data`));

function setup(catalog: ToolDeps['catalog'] | null = nodeCatalogLoader()) {
  const store = new TopologyStore();
  const tools = createTools(store, {
    renderDocument: renderDocumentToSVG,
    ...(catalog ? { catalog } : {}),
  });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const t = tools.find((x) => x.name === name);
    if (!t) throw new Error(`no tool ${name}`);
    return (await t.handler(args)) as Record<string, unknown>;
  };
  return { store, tools, call };
}

/**
 * A branch: an EC-10104 with two ISPs, an HA peer, a 2-link blan0 bond to a
 * 2-member CX VSF stack, an AP and an unbound core switch off the CX.
 */
function branch(store: TopologyStore): string {
  const { id, document } = store.create('Branch');
  const page = document.pages[0]!;
  page.nodes.push(
    { id: 'ec1', type: 'ec', x: 300, y: 200, label: 'EC-01' },
    { id: 'ec2', type: 'ec', x: 600, y: 200, label: 'EC-02' },
    { id: 'isp1', type: 'cloud', x: 200, y: 50, label: 'ISP A' },
    { id: 'isp2', type: 'cloud', x: 400, y: 50, label: 'ISP B' },
    { id: 'sw', type: 'switch', x: 450, y: 400, label: 'SW-01' },
    { id: 'ap', type: 'ap', x: 300, y: 600, label: 'AP-01' },
    { id: 'core', type: 'switch', x: 700, y: 600, label: 'Core' },
  );
  page.links.push(
    { id: 'w1', type: 'line', from: 'ec1', to: 'isp1' },
    { id: 'w2', type: 'line', from: 'ec1', to: 'isp2' },
    { id: 'ha', type: 'line', from: 'ec1', to: 'ec2' },
    {
      id: 'b1',
      type: 'line',
      from: 'ec1',
      to: 'sw',
      fromBundle: 'blan0',
      toBundle: 'lag1',
    },
    {
      id: 'b2',
      type: 'line',
      from: 'ec1',
      to: 'sw',
      fromBundle: 'blan0',
      toBundle: 'lag1',
    },
    { id: 'a1', type: 'line', from: 'sw', to: 'ap' },
    { id: 'c1', type: 'line', from: 'sw', to: 'core' },
  );
  return id;
}

async function bindBranch(
  call: (n: string, a: Record<string, unknown>) => Promise<unknown>,
  id: string,
): Promise<void> {
  await call('bind_hardware', {
    topologyId: id,
    nodeId: 'ec1',
    model: 'edgeconnect-ec-10104',
  });
  await call('bind_hardware', {
    topologyId: id,
    nodeId: 'ec2',
    model: 'edgeconnect-ec-10104',
  });
  await call('bind_hardware', {
    topologyId: id,
    nodeId: 'sw',
    model: 'aruba-cx-6300m-jl664a',
    stackMembers: 2,
  });
}

describe('list_hardware', () => {
  it('lists every model with the compact summary', async () => {
    const { call } = setup();
    const r = await call('list_hardware');
    expect(r.total).toBe(5);
    expect(r.catalogVersion).toBe(BUNDLE.version);
    const models = r.models as { model: string; portSummary: string }[];
    expect(
      models.find((m) => m.model === 'edgeconnect-ec-10104'),
    ).toMatchObject({
      portSummary: '4x RJ45 1G (lan0-1,wan0-1)',
      confidence: 'traced',
      gaEligible: true,
      skus: ['S3N69A', 'S3N78A'],
    });
    expect(
      models.find((m) => m.model === 'aruba-cx-6300m-jl664a'),
    ).toMatchObject({
      portSummary: '24x RJ45 1G + 4x SFP56 1-50G',
      confidence: 'schematic',
      gaEligible: false,
    });
  });

  it('filters by category, vendor, query (incl. SKU) and limit', async () => {
    const { call } = setup();
    const ids = async (a: Record<string, unknown>) =>
      ((await call('list_hardware', a)).models as { model: string }[]).map(
        (m) => m.model,
      );
    expect(await ids({ category: 'switch' })).toEqual([
      'aruba-cx-6300m-jl664a',
    ]);
    expect(await ids({ vendor: 'juniper' })).toEqual(['juniper-srx300']);
    expect(await ids({ query: 's3n78a' })).toEqual(['edgeconnect-ec-10104']);
    const r = await call('list_hardware', { family: 'edgeconnect', limit: 1 });
    expect(r.total).toBe(2);
    expect((r.models as unknown[]).length).toBe(1);
  });
});

describe('describe_hardware', () => {
  it('groups interfaces with ranges collapsed, never returning geometry', async () => {
    const { call } = setup();
    const r = await call('describe_hardware', {
      model: 'aruba-cx-6300m-jl664a',
    });
    expect(r.interfaces).toContainEqual(
      expect.objectContaining({
        role: 'data',
        kind: 'RJ45',
        speeds: '1G',
        count: 24,
        names: '{member}/1/1-24',
        tiers: ['reseller'],
      }),
    );
    expect(r.interfaces).toContainEqual(
      expect.objectContaining({
        kind: 'SFP56',
        cage: true,
        names: '{member}/1/25-28',
      }),
    );
    expect(r.stackable).toEqual({ tech: 'vsf', maxMembers: 10 });
    expect(r.memberNote).toMatch(/member number/);
    expect((r.todo as string[]).length).toBeGreaterThan(0);
    expect(r.provenanceTiers).toMatchObject({ reseller: 2 });
    const text = JSON.stringify(r);
    for (const leak of ['"x":', '"ports"', 'glyphs', '"source"', 'http'])
      expect(text).not.toContain(leak);
  });

  it('reports bond groups and LACP support', async () => {
    const { call } = setup();
    const r = await call('describe_hardware', { model: 'edgeconnect-ec-xs' });
    expect(r.bondGroups).toEqual([
      expect.objectContaining({
        name: 'blan0',
        members: ['lan0', 'lan1'],
        lacp: 'unsupported',
      }),
      expect.objectContaining({ name: 'bwan0', lacp: 'unsupported' }),
    ]);
  });

  it('names the fix for an unknown model', async () => {
    const { call } = setup();
    await expect(
      call('describe_hardware', { model: 'cx-9999' }),
    ).rejects.toThrow(/list_hardware/);
  });
});

describe('bind_hardware', () => {
  it('binds, pins once, sets the type, and reports cabling problems on the node', async () => {
    const { store, call } = setup();
    const id = branch(store);
    const doc = store.get(id);
    doc.pages[0]!.links[0]!.fromInterface = 'wan9';
    const r = await call('bind_hardware', {
      topologyId: id,
      nodeId: 'ec1',
      model: 'edgeconnect-ec-10104',
      sku: 'S3N69A',
    });
    expect(r).toMatchObject({
      nodeId: 'ec1',
      hw: { model: 'edgeconnect-ec-10104', sku: 'S3N69A' },
      type: 'ec',
      pinned: true,
      catalogVersion: BUNDLE.version,
    });
    expect(r.problems).toEqual([
      { code: 'E_PORT_UNKNOWN', where: "page[0].link 'w1' end ec1" },
    ]);
    const sw = await call('bind_hardware', {
      topologyId: id,
      nodeId: 'core',
      model: 'aruba-cx-6300m-jl664a',
    });
    expect(sw.pinned).toBe(false);
    expect(doc.catalogVersion).toBe(BUNDLE.version);
  });

  it('refuses unknown nodes, models, SKUs and stack sizes without writing', async () => {
    const { store, call } = setup();
    const id = branch(store);
    const bind = (a: Record<string, unknown>) =>
      call('bind_hardware', { topologyId: id, nodeId: 'sw', ...a });
    await expect(
      call('bind_hardware', {
        topologyId: id,
        nodeId: 'nope',
        model: 'juniper-srx300',
      }),
    ).rejects.toThrow(/unknown node/);
    await expect(bind({ model: 'cx-9999' })).rejects.toThrow(
      /unknown hardware model/,
    );
    await expect(
      bind({ model: 'aruba-cx-6300m-jl664a', sku: 'JL000A' }),
    ).rejects.toThrow(/no SKU/);
    await expect(
      bind({ model: 'aruba-cx-6300m-jl664a', stackMembers: 11 }),
    ).rejects.toThrow(/at most 10/);
    expect(store.get(id).catalogVersion).toBeUndefined();
    expect(
      store.get(id).pages[0]!.nodes.find((n) => n.id === 'sw')!.hw,
    ).toBeUndefined();
  });
});

describe('assign_interfaces', () => {
  it('plans by role: WAN to ISPs, bond-group members for blan0, uplink cage toward the core, copper toward the AP', async () => {
    const { store, call } = setup();
    const id = branch(store);
    await bindBranch(call, id);
    const r = await call('assign_interfaces', { topologyId: id });
    expect(r.applied).toBe(false);
    const pick = (link: string, end: string) =>
      (
        r.assignments as {
          linkId: string;
          end: string;
          interface: string;
          why: string;
        }[]
      ).find((a) => a.linkId === link && a.end === end);
    expect(pick('w1', 'from')!.interface).toBe('wan0');
    expect(pick('w2', 'from')!.interface).toBe('wan1');
    expect(pick('b1', 'from')).toMatchObject({ interface: 'lan0' });
    expect(pick('b1', 'from')!.why).toMatch(/bond group blan0/);
    expect(pick('b2', 'from')!.interface).toBe('lan1');
    // The CX faces fixed copper on the EC: copper, not an SFP56 cage.
    expect(pick('b1', 'to')!.interface).toBe('1/1/1');
    expect(pick('b2', 'to')!.interface).toBe('1/1/2');
    expect(pick('a1', 'from')!.interface).toBe('1/1/3');
    expect(pick('c1', 'from')).toMatchObject({ interface: '1/1/25' });
    expect(pick('c1', 'from')!.why).toMatch(/declare the optic/);
    // ec1 ran out of lan ports (both in blan0) for the HA link: wan/lan only.
    expect(pick('ha', 'from')).toBeUndefined();
    expect(r.unassigned).toContainEqual(
      expect.objectContaining({ linkId: 'ha', end: 'from', node: 'ec1' }),
    );
    expect(pick('ha', 'to')!.why).toMatch(/HA peer/);
    expect(r.remainingErrors).toEqual([]);
    // Proposal only: nothing written.
    expect(store.get(id).pages[0]!.links.some((l) => l.fromInterface)).toBe(
      false,
    );
  });

  it('writes the plan with apply:true, and validate_topology agrees', async () => {
    const { store, call } = setup();
    const id = branch(store);
    await bindBranch(call, id);
    await call('assign_interfaces', { topologyId: id, apply: true });
    const links = store.get(id).pages[0]!.links;
    expect(links.find((l) => l.id === 'w1')!.fromInterface).toBe('wan0');
    const v = await call('validate_topology', { topologyId: id });
    expect((v.problems as { code?: string }[]).filter((p) => p.code)).toEqual(
      [],
    );
    expect(
      (v.warnings as { code: string }[]).map((w) => w.code).sort(),
    ).toEqual(['W_INTERFACE_UNASSIGNED', 'W_OPTIC_UNDECLARED']);
  });

  it('first-free ignores roles; keep never replaces; by-role re-plans broken picks', async () => {
    const { store, call } = setup();
    const id = branch(store);
    await bindBranch(call, id);
    const ff = await call('assign_interfaces', {
      topologyId: id,
      strategy: 'first-free',
      linkIds: ['w1'],
    });
    expect(ff.assignments).toEqual([
      expect.objectContaining({
        linkId: 'w1',
        interface: 'lan0',
        why: 'first free',
      }),
    ]);
    const links = store.get(id).pages[0]!.links;
    links.find((l) => l.id === 'w1')!.fromInterface = 'wan7';
    links.find((l) => l.id === 'w2')!.fromInterface = 'console';
    const keep = await call('assign_interfaces', {
      topologyId: id,
      strategy: 'keep',
      linkIds: ['w1', 'w2'],
    });
    expect(keep.assignments).toEqual([]);
    expect(
      (keep.remainingErrors as { code: string }[]).map((e) => e.code).sort(),
    ).toEqual(['E_PORT_UNKNOWN', 'E_ROLE_NOT_DATA']);
    const fix = await call('assign_interfaces', {
      topologyId: id,
      linkIds: ['w1', 'w2'],
    });
    expect(fix.assignments).toEqual([
      expect.objectContaining({
        linkId: 'w1',
        interface: 'wan0',
        replaced: 'wan7',
      }),
      expect.objectContaining({
        linkId: 'w2',
        interface: 'wan1',
        replaced: 'console',
      }),
    ]);
    expect(fix.remainingErrors).toEqual([]);
  });

  it('un-doubles a port cabled twice, and falls back when the role runs out', async () => {
    const { store, call } = setup();
    const { id, document } = store.create('ISPs');
    const page = document.pages[0]!;
    page.nodes.push({ id: 'ec', type: 'ec', x: 0, y: 0 });
    for (let i = 1; i <= 5; i++) {
      page.nodes.push({ id: `isp${i}`, type: 'cloud', x: i * 100, y: 0 });
      page.links.push({ id: `l${i}`, type: 'line', from: 'ec', to: `isp${i}` });
    }
    await call('bind_hardware', {
      topologyId: id,
      nodeId: 'ec',
      model: 'edgeconnect-ec-10104',
    });
    page.links[0]!.fromInterface = 'wan0';
    page.links[1]!.fromInterface = 'wan0';
    const r = await call('assign_interfaces', { topologyId: id });
    const got = r.assignments as {
      linkId: string;
      interface: string;
      why: string;
      replaced?: string;
    }[];
    expect(got.find((a) => a.linkId === 'l2')).toMatchObject({
      interface: 'wan1',
      replaced: 'wan0',
    });
    expect(got.find((a) => a.linkId === 'l3')!.why).toMatch(
      /no free wan port; fell back to lan/,
    );
    expect(r.unassigned).toEqual([
      expect.objectContaining({
        linkId: 'l5',
        reason: expect.stringMatching(/no free compatible/),
      }),
    ]);
  });

  it('pins the catalog on apply when the binding was made without bind_hardware', async () => {
    const { store, call } = setup();
    const id = branch(store);
    const doc = store.get(id);
    doc.pages[0]!.nodes[0]!.hw = { model: 'edgeconnect-ec-10104' };
    const r = await call('assign_interfaces', { topologyId: id, apply: true });
    expect(r.pinned).toBe(true);
    expect(doc.catalogVersion).toBe(BUNDLE.version);
  });
});

describe('catalog_diff', () => {
  /** Two published versions: v2 drops an SFP56 port and changes a speed. */
  function twoVersions(): CatalogLoader {
    const v2: CatalogBundle = structuredClone(BUNDLE);
    v2.version = 'abcdefabcdef';
    const cx = v2.models.find((m) => m.id === 'aruba-cx-6300m-jl664a')!;
    cx.interfaces = cx.interfaces.filter(
      (i) => i.name !== '{member}/1/28',
    ) as typeof cx.interfaces;
    const files: Record<string, string> = {
      'manifest.json': JSON.stringify({
        latest: v2.version,
        versions: [BUNDLE.version, v2.version],
      }),
      [`catalog-${BUNDLE.version}.json`]: JSON.stringify(BUNDLE),
      [`catalog-${v2.version}.json`]: JSON.stringify(v2),
    };
    return new CatalogLoader(async (f) => {
      if (!(f in files)) throw new Error(`no ${f}`);
      return files[f]!;
    });
  }

  it('reports changed models and the links that would newly fail', async () => {
    const { store, call } = setup(twoVersions());
    const id = branch(store);
    const doc = store.get(id);
    doc.catalogVersion = BUNDLE.version;
    doc.pages[0]!.nodes.find((n) => n.id === 'sw')!.hw = {
      model: 'aruba-cx-6300m-jl664a',
    };
    doc.pages[0]!.nodes.find((n) => n.id === 'ec1')!.hw = {
      model: 'edgeconnect-ec-10104',
    };
    const c1 = doc.pages[0]!.links.find((l) => l.id === 'c1')!;
    c1.fromInterface = '1/1/28';
    c1.fromOptic = '10GBASE-SR';
    const r = await call('catalog_diff', { topologyId: id });
    expect(r.fromVersion).toBe(BUNDLE.version);
    expect(r.toVersion).toBe('abcdefabcdef');
    expect(r.models).toEqual([
      {
        model: 'aruba-cx-6300m-jl664a',
        status: 'changed',
        fields: ['interfaces'],
        interfacesRemoved: ['{member}/1/28'],
      },
      { model: 'edgeconnect-ec-10104', status: 'unchanged' },
    ]);
    expect(r.linksNowFailing).toEqual([
      { page: 0, linkId: 'c1', codes: ['E_PORT_UNKNOWN'] },
    ]);
    // Read-only: the pin does not move.
    expect(doc.catalogVersion).toBe(BUNDLE.version);
  });

  it('needs a pinned document', async () => {
    const { store, call } = setup();
    const id = branch(store);
    await expect(call('catalog_diff', { topologyId: id })).rejects.toThrow(
      /no pinned catalog version/,
    );
  });
});

describe('export_topology cable-schedule', () => {
  async function exported(a: Record<string, unknown>) {
    const { store, call } = setup();
    const id = branch(store);
    await bindBranch(call, id);
    await call('assign_interfaces', { topologyId: id, apply: true });
    const links = store.get(id).pages[0]!.links;
    links.find((l) => l.id === 'w1')!.label = '=HYPERLINK("x")';
    const r = (await call('export_topology', {
      topologyId: id,
      format: 'cable-schedule',
      ...a,
    })) as unknown as ContentResult;
    return { r, store, id };
  }

  it('CSV: the brief’s columns, catalog media + speed, formula-safe cells', async () => {
    const { r } = await exported({});
    expect(r.structuredContent).toMatchObject({
      filename: 'Branch_cables.csv',
      mimeType: 'text/csv',
      rows: 7,
      catalogVersion: BUNDLE.version,
    });
    const res = r.content.find((c) => c.type === 'resource') as {
      resource: { text: string };
    };
    const lines = res.resource.text.trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'cable id,A device,A model,A interface,A optic,Z device,Z model,Z interface,Z optic,media,negotiated speed,bundle,layer,notes',
    );
    expect(lines).toContain(
      'b1,EC-01,EdgeConnect 10104,lan0,,SW-01,CX 6300M 24-port 1GbE and 4-port SFP56 Switch,1/1/1,,copper,1G,blan0 / lag1,,',
    );
    const w1 = lines.find((l) => l.startsWith('w1,'))!;
    expect(w1).toContain(`"'=HYPERLINK(""x"")"`);
    const c1 = lines.find((l) => l.startsWith('c1,'))!;
    expect(c1).toContain('W_OPTIC_UNDECLARED');
  });

  it('XLSX: a one-sheet workbook of inline strings', async () => {
    const { r } = await exported({ scheduleFormat: 'xlsx' });
    expect(r.structuredContent).toMatchObject({
      filename: 'Branch_cables.xlsx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const res = r.content.find((c) => c.type === 'resource') as {
      resource: { blob: string };
    };
    const zip = unzipSync(Buffer.from(res.resource.blob, 'base64'));
    expect(Object.keys(zip).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/core.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    const sheet = strFromU8(zip['xl/worksheets/sheet1.xml']!);
    expect(sheet).toContain('<t xml:space="preserve">negotiated speed</t>');
    expect(sheet).toContain('<t xml:space="preserve">wan0</t>');
    expect(sheet).not.toContain('<f>');
    expect(sheet).toContain('<autoFilter ref="A1:N8"/>');
  });

  it('works without bindings or a catalog, and adds a page column on multi-page documents', async () => {
    const { store, call } = setup(null);
    const { id, document } = store.create('Plain');
    const p = document.pages[0]!;
    p.nodes.push(
      { id: 'a', type: 'router', x: 0, y: 0 },
      { id: 'b', type: 'router', x: 100, y: 0 },
    );
    p.links.push({
      id: 'l',
      type: 'line',
      from: 'a',
      to: 'b',
      fromLabel: 'ge-0/0/0',
    });
    document.pages.push({ ...structuredClone(p), id: 'p2', name: 'After' });
    const r = (await call('export_topology', {
      topologyId: id,
      format: 'cable-schedule',
    })) as unknown as ContentResult;
    const text = (
      r.content.find((c) => c.type === 'resource') as {
        resource: { text: string };
      }
    ).resource.text;
    const lines = text.trimEnd().split('\r\n');
    expect(lines[0]!.startsWith('page,cable id,')).toBe(true);
    expect(lines.length).toBe(3);
    expect(lines[2]).toBe('After,l,a,,ge-0/0/0,,b,,,,,,,,');
  });
});

describe('describe_capabilities', () => {
  it('grows by one pointer line, only where a catalog is wired', async () => {
    const withCat = await setup().call('describe_capabilities');
    const without = await setup(null).call('describe_capabilities');
    const extra = Object.keys(withCat).filter((k) => !(k in without));
    expect(extra).toEqual(['hardware']);
    expect(withCat.hardware).toMatch(/list_hardware/);
  });

  it('registers the hardware tools only with a catalog', () => {
    const names = (t: ReturnType<typeof setup>) => t.tools.map((x) => x.name);
    const hw = [
      'list_hardware',
      'describe_hardware',
      'bind_hardware',
      'assign_interfaces',
      'catalog_diff',
    ];
    expect(names(setup())).toEqual(expect.arrayContaining(hw));
    expect(names(setup(null)).filter((n) => hw.includes(n))).toEqual([]);
  });
});
