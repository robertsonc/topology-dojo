/**
 * hw-catalog Phase 4: one golden image per seed platform — a bound panel
 * with one cable, rendered to PNG through the real rasterizer. Goldens live
 * in __goldens__/; regenerate deliberately with UPDATE_GOLDENS=1 and look
 * at every changed image before committing.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildBundle, loadCatalogDir } from '../catalog/build.js';
import { Catalog } from '../catalog/catalog.js';
import { renderDocumentToSVG } from '../server/render.js';
import { nodeRasterizer } from '../server/raster.js';
import { decodePng } from '../testing/png-decode.js';
import type { TopologyDocument } from '../pages/model.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const catalog = new Catalog(buildBundle(loadCatalogDir(`${root}catalog/data`)));
const goldenDir = fileURLToPath(new URL('./__goldens__/', import.meta.url));

/** One model per seed platform, with a data port to cable. */
const CASES = [
  { platform: 'aruba-9004-class', model: 'aruba-9004', port: 'GE0/0/1' },
  {
    platform: 'cx-6300m-24g-4sfp56',
    model: 'aruba-cx-6300m-jl664a',
    port: '1/1/26',
  },
  { platform: 'ec-xs', model: 'edgeconnect-ec-xs', port: 'lan1' },
  { platform: 'srx300', model: 'juniper-srx300', port: 'ge-0/0/6' },
] as const;

function doc(model: string, port: string): TopologyDocument {
  return {
    title: model,
    customNodes: [],
    pages: [
      {
        id: 'p',
        name: model,
        viewBox: '0 0 900 320',
        view: 'wiresheet',
        panelScale: 2,
        nodes: [
          {
            id: 'dev',
            type: 'router',
            x: 450,
            y: 210,
            label: 'DEV-01',
            hw: { model },
          },
          { id: 'peer', type: 'host', x: 150, y: 60, label: 'peer' },
        ],
        links: [
          {
            id: 'l',
            type: 'line',
            from: 'dev',
            to: 'peer',
            fromInterface: port,
            lineStyle: 'orthogonal',
            cornerRadius: 6,
          },
        ],
        anchors: [],
        zones: [],
        flowPaths: [],
        policyMarkers: [],
      },
    ],
  };
}

describe('wire-sheet golden images (one per seed platform)', () => {
  it('covers every platform in the catalog', () => {
    expect(CASES.map((c) => c.platform).sort()).toEqual(
      [...catalog.platforms.keys()].sort(),
    );
  });

  for (const c of CASES)
    it(
      c.platform,
      async () => {
        expect(catalog.platformFor(c.model).id).toBe(c.platform);
        expect(catalog.resolveInterface(c.model, c.port)).not.toBeNull();
        const svg = renderDocumentToSVG(doc(c.model, c.port), 0, {
          hardware: { catalog },
          calm: true,
        });
        const png = (await nodeRasterizer()).rasterizePng(svg, 1).png;
        const file = `${goldenDir}wiresheet-${c.platform}.png`;
        if (process.env.UPDATE_GOLDENS === '1') writeFileSync(file, png);
        if (!existsSync(file))
          throw new Error(
            `missing golden ${file} — run with UPDATE_GOLDENS=1 and review it`,
          );
        const want = decodePng(readFileSync(file));
        const got = decodePng(png);
        expect([got.width, got.height]).toEqual([want.width, want.height]);
        let diff = 0;
        let off = 0;
        for (let i = 0; i < got.pixels.length; i += 4) {
          const d = Math.max(
            Math.abs(got.pixels[i]! - want.pixels[i]!),
            Math.abs(got.pixels[i + 1]! - want.pixels[i + 1]!),
            Math.abs(got.pixels[i + 2]! - want.pixels[i + 2]!),
          );
          diff += d;
          if (d > 24) off++;
        }
        const n = got.pixels.length / 4;
        // Anti-aliasing noise only: tiny mean difference, few changed pixels.
        expect(diff / n).toBeLessThan(0.5);
        expect(off / n).toBeLessThan(0.002);
      },
      30000,
    );
});
