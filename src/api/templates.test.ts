import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildTemplate,
  generateTemplate,
  listTemplates,
  resolveTemplateParams,
  templateInfo,
  type IntegerParamSpec,
  type TemplateParamSpec,
  type TemplateParams,
} from './templates.js';
import { validateDocument } from './validate.js';
import { analyzeLayout } from './layout.js';
import { inspectPage } from '../render/inspect.js';
import { createAttachContext } from '../render/link-attach.js';
import type { Page, TopologyDocument } from '../pages/model.js';

const page = (doc: TopologyDocument): Page => doc.pages[0]!;

/** A document with its generated page ids replaced by stable ones. */
function withoutGeneratedIds(doc: TopologyDocument): TopologyDocument {
  const copy = structuredClone(doc);
  copy.pages.forEach((p, i) => (p.id = `page${i}`));
  return copy;
}

/**
 * Values a parameter is exercised at. Every value of a small range; for a
 * large one the minimum, the default, the maximum and two in between.
 */
function valuesOf(spec: TemplateParamSpec): (number | boolean)[] {
  if (spec.type === 'boolean') return [false, true];
  const count = spec.max - spec.min + 1;
  if (count <= 24) return Array.from({ length: count }, (_, i) => spec.min + i);
  const mid = (a: number, b: number): number => Math.round((a + b) / 2);
  return [
    ...new Set([
      spec.min,
      mid(spec.min, spec.default),
      spec.default,
      mid(spec.default, spec.max),
      spec.max,
    ]),
  ];
}

/** Every combination of the parameter values above. */
function matrix(specs: TemplateParamSpec[]): TemplateParams[] {
  return specs.reduce<TemplateParams[]>(
    (rows, spec) =>
      rows.flatMap((row) =>
        valuesOf(spec).map((v) => ({ ...row, [spec.name]: v })),
      ),
    [{}],
  );
}

describe('starter templates', () => {
  it('lists templates with id, name, description and parameters', () => {
    const ts = listTemplates();
    expect(ts.map((t) => t.id)).toEqual([
      'three-tier',
      'sdwan-branch',
      'ztna',
      'firewall-dmz',
      'spine-leaf',
      'hub-spoke',
    ]);
    for (const t of ts) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      for (const p of t.params) {
        expect(p.name).toMatch(/^[a-z][A-Za-z]*$/);
        expect(p.label).toBeTruthy();
        expect(p.description).toBeTruthy();
        expect(p.description).not.toMatch(/\n/);
        if (p.type === 'integer') {
          expect(p.min).toBeLessThanOrEqual(p.default);
          expect(p.default).toBeLessThanOrEqual(p.max);
        } else expect(typeof p.default).toBe('boolean');
      }
    }
    const parametric = ts.filter((t) => t.params.length).map((t) => t.id);
    expect(parametric).toEqual([
      'three-tier',
      'firewall-dmz',
      'spine-leaf',
      'hub-spoke',
    ]);
  });

  it('hands out copies of the listing, not the registry', () => {
    (listTemplates()[0]!.params[0] as { default: unknown }).default = 99;
    templateInfo('three-tier')!.params.length = 0;
    expect(resolveTemplateParams('three-tier')).toEqual({
      webServers: 2,
      appServers: 1,
    });
    expect(templateInfo('nope')).toBeUndefined();
  });

  it('builds independent copies (no shared mutable state)', () => {
    const a = buildTemplate('three-tier');
    a.pages[0]!.nodes[0]!.x = 9999;
    const b = buildTemplate('three-tier');
    expect(b.pages[0]!.nodes[0]!.x).not.toBe(9999);
  });

  it('throws on an unknown template id', () => {
    expect(() => buildTemplate('nope')).toThrow(/unknown template/);
    expect(() => resolveTemplateParams('nope', {})).toThrow(
      /unknown template "nope"/,
    );
  });
});

/*
 * The documents every template built before it took parameters, frozen from
 * the fixed templates (page ids replaced: they are generated). A template
 * called with no parameters must keep producing exactly these, so nothing
 * that already instantiates one moves.
 */
const ORIGINAL = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../fixtures/templates/original.json', import.meta.url),
    ),
    'utf8',
  ),
) as Record<string, TopologyDocument>;

describe('templates without parameters build what they always built', () => {
  it('has an original for every template', () => {
    expect(Object.keys(ORIGINAL)).toEqual(listTemplates().map((t) => t.id));
  });

  it.each(
    listTemplates()
      .map((t) => t.id)
      .filter((id) => id !== 'firewall-dmz'),
  )('%s', (id) => {
    // Compared as text: same elements, same values, same key order.
    expect(JSON.stringify(withoutGeneratedIds(buildTemplate(id)))).toBe(
      JSON.stringify(ORIGINAL[id]),
    );
    expect(JSON.stringify(withoutGeneratedIds(buildTemplate(id, {})))).toBe(
      JSON.stringify(ORIGINAL[id]),
    );
  });

  it('firewall-dmz: the same, but the firewall label wraps', () => {
    // The original drew the firewall-to-core link through the end of the
    // one-line "Edge firewall" label (an inspect_render problem). Wrapping
    // the label is the whole difference: no node, link or position moved.
    const doc = withoutGeneratedIds(buildTemplate('firewall-dmz'));
    const fw = page(doc).nodes.find((n) => n.id === 'fw')!;
    expect(fw.labelWidth).toBe(60);
    delete fw.labelWidth;
    expect(JSON.stringify(doc)).toBe(JSON.stringify(ORIGINAL['firewall-dmz']));
  });

  it('gives the default parameters explicitly the same document', () => {
    for (const t of listTemplates()) {
      const defaults = Object.fromEntries(
        t.params.map((p) => [p.name, p.default]),
      );
      expect(withoutGeneratedIds(buildTemplate(t.id, defaults))).toEqual(
        withoutGeneratedIds(buildTemplate(t.id)),
      );
    }
  });
});

/*
 * The guardrail (Initiative B, packet B6): every template, at every
 * combination of parameter values, is a document nobody has to clean up.
 * A new template or a wider parameter range is covered without touching
 * this test; if a value cannot be made clean, lower the parameter's maximum.
 */
describe('every template is valid and clean at every parameter value', () => {
  const cases = listTemplates().flatMap((t) =>
    matrix(t.params).map(
      (params) => [`${t.id} ${JSON.stringify(params)}`, t.id, params] as const,
    ),
  );

  it('covers the minimum, default and maximum of every parameter', () => {
    for (const t of listTemplates())
      for (const p of t.params) {
        const seen = new Set(
          cases.filter(([, id]) => id === t.id).map(([, , c]) => c[p.name]),
        );
        const where = `${t.id}.${p.name}`;
        if (p.type === 'boolean') {
          expect(seen, where).toEqual(new Set([false, true]));
          continue;
        }
        for (const v of [p.min, p.default, p.max])
          expect(seen.has(v), where).toBe(true);
        // …and a couple of values in between, where the range has them.
        expect(seen.size, where).toBeGreaterThanOrEqual(
          Math.min(5, p.max - p.min + 1),
        );
      }
  });

  it.each(cases)('%s', (_, id, params) => {
    const { doc } = generateTemplate(id, params);
    // No problem of any level: not an error, not a warning.
    expect(validateDocument(doc)).toEqual([]);
    expect(analyzeLayout(doc)).toEqual([]);
    const report = inspectPage(page(doc), { maxPerCategory: 10_000 });
    expect(report.omitted).toBe(0);
    expect(report.findings.filter((f) => f.severity === 'problem')).toEqual([]);
    // The only crossings left are the ones a dual-homed mesh forces (every
    // leaf on every spine, every site on both hubs), which inspect reports
    // as notes.
    expect(report.crossings.avoidable).toBe(0);
    for (const f of report.findings)
      if (/\bcross\b/.test(f.message))
        expect(f).toMatchObject({
          severity: 'note',
          category: 'routing',
          message: expect.stringContaining('expected (dual-homed mesh'),
        });
  });
});

describe('generateTemplate', () => {
  it('reports the resolved parameters and the element counts', () => {
    const out = generateTemplate('spine-leaf', { leaves: 12 });
    expect(out.template).toBe('spine-leaf');
    expect(out.params).toEqual({ spines: 2, leaves: 12 });
    expect(out.stats).toEqual({ nodes: 14, links: 24 });
    expect(page(out.doc).nodes).toHaveLength(14);
    expect(generateTemplate('ztna')).toMatchObject({
      template: 'ztna',
      params: {},
      stats: { nodes: 5, links: 4 },
    });
  });

  it('is deterministic: same parameters, same document but the page id', () => {
    for (const t of listTemplates())
      for (const params of matrix(t.params)) {
        const a = buildTemplate(t.id, params);
        const b = buildTemplate(t.id, params);
        expect(a.pages[0]!.id).not.toBe(b.pages[0]!.id);
        expect(JSON.stringify(withoutGeneratedIds(a))).toBe(
          JSON.stringify(withoutGeneratedIds(b)),
        );
      }
  });

  it('spine-leaf: every leaf uplinks to every spine', () => {
    const { doc, stats } = generateTemplate('spine-leaf', {
      spines: 4,
      leaves: 12,
    });
    const p = page(doc);
    expect(stats).toEqual({ nodes: 16, links: 48 });
    expect(p.nodes.filter((n) => n.type === 'switchEnterprise')).toHaveLength(
      4,
    );
    expect(p.nodes.filter((n) => n.type === 'switch')).toHaveLength(12);
    expect(p.nodes.find((n) => n.id === 'l12')!.label).toBe('L12');
    for (let s = 1; s <= 4; s++)
      for (let l = 1; l <= 12; l++)
        expect(p.links.find((k) => k.id === `l${l}-s${s}`)).toMatchObject({
          from: `s${s}`,
          to: `l${l}`,
          // A fabric this size pins its uplinks to the facing sides.
          fromPort: 's',
          toPort: 'n',
        });
    // The page widens to hold the leaf row; a small fabric keeps the sheet
    // and routes its own uplinks, as the original template did.
    expect(p.viewBox).toBe('0 0 1540 700');
    const small = page(buildTemplate('spine-leaf', { leaves: 5 }));
    expect(small.viewBox).toBe('0 0 1050 700');
    expect(small.links.every((k) => !k.fromPort && !k.toPort)).toBe(true);
  });

  it('hub-spoke: one hub is a ring, two hubs dual-home every site', () => {
    const one = generateTemplate('hub-spoke', { sites: 9 });
    expect(one.stats).toEqual({ nodes: 10, links: 9 });
    expect(page(one.doc).links.map((l) => l.id)).toEqual(
      Array.from({ length: 9 }, (_, i) => `t${i + 1}`),
    );

    const two = generateTemplate('hub-spoke', { hubs: 2, sites: 9 });
    const p = page(two.doc);
    expect(two.stats).toEqual({ nodes: 11, links: 19 });
    expect(p.nodes.filter((n) => n.type === 'overlayCloud')).toMatchObject([
      { id: 'hub1', label: 'Hub 1' },
      { id: 'hub2', label: 'Hub 2' },
    ]);
    expect(p.links.find((l) => l.id === 'hub1-hub2')).toMatchObject({
      type: 'tunnel',
      from: 'hub1',
      to: 'hub2',
    });
    for (let i = 1; i <= 9; i++) {
      expect(p.links.find((l) => l.id === `t${i}-1`)).toMatchObject({
        from: 'hub1',
        to: `site${i}`,
      });
      expect(p.links.find((l) => l.id === `t${i}-2`)).toMatchObject({
        from: 'hub2',
        to: `site${i}`,
      });
    }
  });

  it('hub-spoke: no tunnel runs across the other hub', () => {
    // A hub is drawn as a cloud: an ellipse 62 x 34 around its centre
    // (renderCloud in the vendored engine), far larger than the box inspect
    // measures for an overlayCloud. So this is checked here: every tunnel
    // that does not end at a hub stays clear of its cloud by a quarter of
    // the cloud's size or more.
    const cloud = { rx: 62, ry: 34 };
    const clear = 1.25;
    const sites = (templateInfo('hub-spoke')!.params[1] as IntegerParamSpec)
      .max;
    for (let n = 2; n <= sites; n++) {
      const p = page(buildTemplate('hub-spoke', { hubs: 2, sites: n }));
      const attach = createAttachContext(p);
      for (const hub of p.nodes.filter((x) => x.type === 'overlayCloud'))
        for (const l of p.links) {
          if (l.from === hub.id || l.to === hub.id) continue;
          const ends = attach.endpoints(l)!;
          // In the space where the cloud is the unit circle: how near the
          // segment comes to the centre.
          const ax = (ends.from.x - hub.x) / cloud.rx;
          const ay = (ends.from.y - hub.y) / cloud.ry;
          const bx = (ends.to.x - hub.x) / cloud.rx;
          const by = (ends.to.y - hub.y) / cloud.ry;
          const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
          const t = Math.max(
            0,
            Math.min(1, -(ax * (bx - ax) + ay * (by - ay)) / len2),
          );
          const nearest = Math.hypot(ax + t * (bx - ax), ay + t * (by - ay));
          expect(
            nearest,
            `${n} sites: ${l.id} past ${hub.id}`,
          ).toBeGreaterThanOrEqual(clear);
        }
    }
  });

  it('hub-spoke: the ring grows with the page once the sites fill it', () => {
    expect(page(buildTemplate('hub-spoke', { sites: 12 })).viewBox).toBe(
      '0 0 1050 700',
    );
    const [, , w, h] = page(buildTemplate('hub-spoke', { sites: 24 }))
      .viewBox.split(' ')
      .map(Number);
    expect(w).toBeGreaterThan(1050);
    expect(h).toBeGreaterThan(700);
  });

  it('three-tier: web and app tiers scale, one of a kind keeps its id', () => {
    const { doc, stats } = generateTemplate('three-tier', {
      webServers: 3,
      appServers: 2,
    });
    const p = page(doc);
    // users, fw, 3 web, 2 app, db; users-fw, fw-web x3, web-app x6, app-db x2.
    expect(stats).toEqual({ nodes: 8, links: 12 });
    expect(p.nodes.map((n) => n.id)).toEqual([
      'users',
      'fw',
      'web1',
      'web2',
      'web3',
      'app1',
      'app2',
      'db',
    ]);
    expect(p.links.map((l) => l.id)).toEqual(
      Array.from({ length: 12 }, (_, i) => `l${i + 1}`),
    );
    const single = page(
      buildTemplate('three-tier', { webServers: 1, appServers: 1 }),
    );
    expect(single.nodes.map((n) => [n.id, n.label])).toEqual([
      ['users', 'Users'],
      ['fw', 'Firewall'],
      ['web', 'Web'],
      ['app', 'App'],
      ['db', 'Database'],
    ]);
  });

  it('firewall-dmz: servers by role, optional internal firewall', () => {
    const plain = generateTemplate('firewall-dmz', { dmzServers: 4 });
    expect(plain.params).toEqual({ dmzServers: 4, internalFirewall: false });
    expect(plain.stats).toEqual({ nodes: 8, links: 7 });
    expect(
      page(plain.doc)
        .nodes.filter((n) => n.type === 'server')
        .map((n) => [n.id, n.label]),
    ).toEqual([
      ['web', 'DMZ web'],
      ['mail', 'DMZ mail'],
      ['dns', 'DMZ DNS'],
      ['proxy', 'DMZ proxy'],
    ]);

    const screened = generateTemplate('firewall-dmz', {
      internalFirewall: true,
    });
    const p = page(screened.doc);
    expect(screened.stats).toEqual({ nodes: 7, links: 6 });
    const pairs = p.links.map((l) => `${l.from}>${l.to}`);
    expect(pairs).toEqual([
      'inet>fw',
      'fw>web',
      'fw>mail',
      'fw>ifw',
      'ifw>core',
      'core>lan',
    ]);
    expect(p.nodes.find((n) => n.id === 'ifw')).toMatchObject({
      type: 'firewall',
      label: 'Internal firewall',
    });
  });
});

describe('resolveTemplateParams', () => {
  it('fills defaults for whatever is not given', () => {
    expect(resolveTemplateParams('hub-spoke')).toEqual({ hubs: 1, sites: 6 });
    expect(resolveTemplateParams('hub-spoke', { hubs: 2 })).toEqual({
      hubs: 2,
      sites: 6,
    });
    expect(
      resolveTemplateParams('hub-spoke', { hubs: undefined, sites: 9 }),
    ).toEqual({ hubs: 1, sites: 9 });
    expect(resolveTemplateParams('ztna', {})).toEqual({});
    expect(resolveTemplateParams('ztna', null)).toEqual({});
  });

  it.each([
    [
      'spine-leaf',
      { leaves: 17 },
      /^leaves must be an integer from 2 to 16 \(got 17\)$/,
    ],
    ['spine-leaf', { leaves: 1 }, /^leaves must be an integer from 2 to 16/],
    ['spine-leaf', { spines: 0 }, /^spines must be an integer from 1 to 4/],
    ['spine-leaf', { spines: 2.5 }, /^spines must be an integer.*got 2\.5/],
    ['spine-leaf', { leaves: '12' }, /^leaves must be an integer.*got "12"/],
    ['spine-leaf', { leaves: null }, /^leaves must be an integer.*got null/],
    ['spine-leaf', { leaves: NaN }, /^leaves must be an integer/],
    ['hub-spoke', { sites: 25 }, /^sites must be an integer from 2 to 24/],
    ['hub-spoke', { hubs: 3 }, /^hubs must be an integer from 1 to 2/],
    ['three-tier', { webServers: 7 }, /^webServers must be an integer/],
    ['three-tier', { appServers: true }, /^appServers must be an integer/],
    ['firewall-dmz', { dmzServers: 7 }, /^dmzServers must be an integer/],
    [
      'firewall-dmz',
      { internalFirewall: 1 },
      /^internalFirewall must be true or false \(got 1\)$/,
    ],
    [
      'firewall-dmz',
      { internalFirewall: 'yes' },
      /^internalFirewall must be true or false \(got "yes"\)$/,
    ],
    [
      'spine-leaf',
      { leafs: 4 },
      /^"leafs" is not a parameter of template "spine-leaf" \(it takes spines, leaves\)$/,
    ],
    [
      'ztna',
      { apps: 2 },
      /^template "ztna" takes no parameters \(got "apps"\)$/,
    ],
    ['spine-leaf', [4, 12], /^params must be an object of parameter values/],
    ['spine-leaf', 'big', /^params must be an object of parameter values/],
    ['spine-leaf', 12, /^params must be an object of parameter values/],
  ])('rejects %s %j', (id, params, message) => {
    expect(() => resolveTemplateParams(id, params)).toThrow(message);
    expect(() => generateTemplate(id, params)).toThrow(message);
    expect(() => buildTemplate(id, params)).toThrow(message);
  });

  it('never echoes more than a short piece of a bad value', () => {
    const long = 'x'.repeat(5000);
    for (const params of [{ leaves: long }, { [long]: 1 }]) {
      let message = '';
      try {
        resolveTemplateParams('spine-leaf', params);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toBeTruthy();
      expect(message.length).toBeLessThan(200);
    }
  });

  it('names the field even for a value that cannot be printed', () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    for (const bad of [loop, 12n, Symbol('twelve'), () => 12])
      expect(() =>
        resolveTemplateParams('spine-leaf', { leaves: bad }),
      ).toThrow(/^leaves must be an integer from 2 to 16/);
  });
});
