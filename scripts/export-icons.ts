/**
 * Export the icon library as standalone, light/dark-aware SVG files.
 *
 *   npx tsx scripts/export-icons.ts [outDir]     (default: icons/)
 *   npm run export:icons
 *
 * Output:
 *   <outDir>/nodes/<id>.svg    engine built-ins + variants (themed)
 *   <outDir>/stock/<id>.svg    stock cloud / IT pack nodes (themed)
 *   <outDir>/glyphs/<key>.svg  24×24 glyph paths (themed)
 *   <outDir>/manifest.json     id → file, label, group, category
 *
 * Icon art comes straight from the renderers (not canvas snapshots). Bounding
 * boxes are measured in headless Chromium (Playwright) so overflowing details —
 * badges, antennas, agent chips — are never clipped.
 */
import { createRequire } from 'node:module';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { ensureShim } from '../src/render/core.js';
import {
  collectIcons,
  glyphArts,
  glyphSvg,
  nodeIconSvg,
  themeMarkup,
  type IconBox,
  type IconEngine,
} from '../src/nodes/icon-export.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(process.argv[2] ?? path.join(here, '..', 'icons'));

function loadEngine(): IconEngine {
  ensureShim();
  const require = createRequire(import.meta.url);
  const mod = require('../public/vendor/topology-ds.js') as {
    default?: IconEngine;
  } & IconEngine;
  return mod.default ?? mod;
}

async function main(): Promise<void> {
  const arts = collectIcons(loadEngine());

  // CHROMIUM_PATH overrides Playwright's bundled browser (e.g. a system Chromium).
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const boxes = new Map<string, IconBox>();
  try {
    const page = await browser.newPage();
    for (const art of arts) {
      const { markup } = themeMarkup(art.markup);
      await page.setContent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="-200 -200 400 400"><g id="g">${markup}</g></svg>`,
      );
      const b = await page.evaluate(() => {
        const r = (
          document.getElementById('g') as unknown as SVGGraphicsElement
        ).getBBox();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      if (b.w > 0 && b.h > 0) boxes.set(art.id, b);
    }
  } finally {
    await browser.close();
  }

  rmSync(outDir, { recursive: true, force: true });
  const manifest: {
    id: string;
    file: string;
    label: string;
    group: string;
    source: string;
    category?: string;
  }[] = [];
  const write = (rel: string, body: string): void => {
    const file = path.join(outDir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
  };

  for (const art of arts) {
    const dir = art.group === 'node' ? 'nodes' : 'stock';
    const rel = `${dir}/${art.id}.svg`;
    write(rel, nodeIconSvg(art, boxes.get(art.id) ?? art.box));
    manifest.push({
      id: art.id,
      file: rel,
      label: art.label,
      group: art.group,
      source: art.source,
    });
  }
  for (const g of glyphArts()) {
    const rel = `glyphs/${g.source}.svg`;
    write(rel, glyphSvg(g.source));
    manifest.push({
      id: g.id,
      file: rel,
      label: g.label,
      group: 'glyph',
      source: g.source,
      ...(g.category ? { category: g.category } : {}),
    });
  }
  write('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote ${manifest.length} icons to ${outDir}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
