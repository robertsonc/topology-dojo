/**
 * hw-catalog Phase 2: `validate_topology` on hardware-bound documents —
 * E_* rule codes join `problems` (and make the document invalid), W_* come
 * back in `warnings`, I_* in `notes`, with the catalog version used.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TopologyStore } from './store.js';
import { createTools, type ToolDeps } from './tools.js';
import { renderDocumentToSVG } from '../server/render.js';
import { nodeCatalogLoader } from '../server/catalog.js';
import { serializeDoc } from '../pages/persist.js';
import {
  fixtureToDocument,
  loadWiringFixtures,
} from '../catalog/wiring-fixtures.js';
import type { TopologyDocument } from '../pages/model.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixtures = loadWiringFixtures(`${root}catalog/fixtures/wiring`);
const fixture = (prefix: string): TopologyDocument =>
  fixtureToDocument(fixtures.find((f) => f.file.startsWith(prefix))!);
const latest = (
  JSON.parse(readFileSync(`${root}public/catalog/manifest.json`, 'utf8')) as {
    latest: string;
  }
).latest;

interface Result {
  valid: boolean;
  problems: { level: string; code?: string; where: string }[];
  layoutClean: boolean;
  warnings?: { code: string }[];
  notes?: { code: string }[];
  catalogVersion?: string;
}

function setup(deps: Partial<ToolDeps> = { catalog: nodeCatalogLoader() }) {
  const store = new TopologyStore();
  const tools = createTools(store, {
    renderDocument: renderDocumentToSVG,
    ...deps,
  });
  const call = (name: string, args: Record<string, unknown>): unknown =>
    tools.find((t) => t.name === name)!.handler(args);
  // Through the persistence round-trip, as a saved document would arrive.
  const load = (doc: TopologyDocument): string =>
    store.import(serializeDoc(doc)).id;
  return { store, call, load };
}

const validate = async (
  call: (n: string, a: Record<string, unknown>) => unknown,
  id: string,
): Promise<Result> =>
  (await call('validate_topology', { topologyId: id })) as Result;

describe('validate_topology with hardware bindings', () => {
  it('reports E_* as errors with codes, I_* as notes, and the version', async () => {
    const { call, load } = setup();
    const v = await validate(call, load(fixture('04_')));
    expect(v.valid).toBe(false);
    const hw = v.problems.filter((p) => p.code);
    expect(hw.map((p) => p.code).sort()).toEqual([
      'E_MEDIA_MISMATCH',
      'E_SPEED_NO_OVERLAP',
    ]);
    expect(hw.every((p) => p.level === 'error')).toBe(true);
    expect(hw[0]!.where).toMatch(/^page\[0\]\.link 'l1'/);
    expect(v.warnings).toEqual([]);
    expect(v.notes!.map((n) => n.code)).toEqual(['I_SCHEMATIC_PANEL']);
    expect(v.catalogVersion).toBe(latest);
  });

  it('warnings and notes never make a document invalid', async () => {
    const { call, load } = setup();
    const v = await validate(call, load(fixture('03_')));
    expect(v.problems.filter((p) => p.code)).toEqual([]);
    expect(v.warnings!.map((w) => w.code)).toEqual(['W_OPTIC_UNDECLARED']);
    expect(v.valid).toBe(!v.problems.some((p) => p.level === 'error'));
  });

  it('every golden fixture survives persistence with the same codes', async () => {
    const { call, load } = setup();
    for (const fx of fixtures) {
      const v = await validate(call, load(fixtureToDocument(fx)));
      const codes = [
        ...v.problems.flatMap((p) => (p.code ? [p.code] : [])),
        ...v.warnings!.map((w) => w.code),
        ...v.notes!.map((n) => n.code),
      ].sort();
      expect(codes, fx.file).toEqual([...fx.expect].sort());
    }
  });

  it('judges against the pinned catalog version', async () => {
    const { call, load } = setup();
    const doc = fixture('02_');
    doc.catalogVersion = latest;
    expect((await validate(call, load(doc))).catalogVersion).toBe(latest);
  });

  it('an unavailable pinned version is a warning, not a crash', async () => {
    const { call, load } = setup();
    const doc = fixture('02_');
    doc.catalogVersion = '000000000000';
    const v = await validate(call, load(doc));
    expect(v.warnings!.map((w) => w.code)).toEqual(['W_CATALOG_UNAVAILABLE']);
    expect(v.problems.filter((p) => p.code)).toEqual([]);
    expect(v.catalogVersion).toBeUndefined();
  });

  it('a server without a catalog says the bindings were not checked', async () => {
    const { call, load } = setup({});
    const v = await validate(call, load(fixture('02_')));
    expect(v.warnings!.map((w) => w.code)).toEqual(['W_CATALOG_UNAVAILABLE']);
  });

  it('checks a snapshot: edits during the catalog load do not leak in', async () => {
    const { store, call, load } = setup();
    const id = load(fixture('10_')); // E_PORT_REUSED
    const pending = call('validate_topology', { topologyId: id });
    store.get(id).pages[0]!.links.pop();
    const v = (await pending) as Result;
    expect(v.problems.map((p) => p.code)).toContain('E_PORT_REUSED');
  });

  it('shape problems in hw fields are plain semantic errors', async () => {
    const { call, load } = setup();
    const doc = fixture('02_');
    (doc.pages[0]!.nodes[0]!.hw as unknown as Record<string, unknown>).face =
      'top';
    const v = await validate(call, load(doc));
    expect(
      v.problems.some(
        (p) =>
          !p.code &&
          p.level === 'error' &&
          /hw\.face/.test(String((p as { message?: string }).message)),
      ),
    ).toBe(true);
  });
});

describe('authoring the Phase 2 fields over MCP', () => {
  it('add_link carries interfaces + optics; define_bundle carries lacp', async () => {
    const { store, call } = setup();
    const { id: topologyId } = call('create_topology', { title: 't' }) as {
      id: string;
    };
    const page = store.page(topologyId);
    page.nodes.push(
      {
        id: 'sw',
        type: 'switch',
        x: 100,
        y: 100,
        hw: { model: 'aruba-cx-6300m-jl664a', stackMembers: 2 },
      },
      {
        id: 'fw',
        type: 'firewall',
        x: 400,
        y: 100,
        hw: { model: 'juniper-srx300' },
      },
    );
    call('add_link', {
      topologyId,
      type: 'lan',
      from: 'sw',
      to: 'fw',
      fromInterface: '1/1/1',
      toInterface: 'ge-0/0/1',
      fromBundle: 'lag1',
    });
    call('define_bundle', { topologyId, bundleId: 'lag1', lacp: { sw: true } });
    const link = page.links[0]!;
    expect(link).toMatchObject({
      fromInterface: '1/1/1',
      toInterface: 'ge-0/0/1',
    });
    expect(store.get(topologyId).bundles).toEqual([
      { id: 'lag1', lacp: { sw: true } },
    ]);
    const v = await validate(call, topologyId);
    expect(v.problems.filter((p) => p.code)).toEqual([]);
    expect(v.catalogVersion).toBe(latest);
  });
});
