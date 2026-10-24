/**
 * Test helpers for the Visio export (hw-catalog Phase 5): a catalog sheet
 * (one wire-sheet page per model, so every master renders), and LibreOffice
 * headless conversion. LibreOffice reads .vsdx through libvisio — the
 * container check the brief asks for. Commands run with a list argv, no
 * shell, and a timeout.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Catalog } from '../catalog/catalog.js';
import type { TopologyDocument } from '../pages/model.js';

/** One page per model: the model's panel, one cable on its first data port. */
export function catalogSheetDoc(catalog: Catalog): TopologyDocument {
  return {
    title: 'Catalog sheet',
    customNodes: [],
    pages: [...catalog.models.keys()].sort().map((id) => {
      const model = catalog.model(id);
      const port = model.interfaces.find((i) =>
        ['data', 'lan', 'wan'].includes(i.role),
      )!;
      return {
        id,
        name: model.name.slice(0, 40),
        viewBox: '0 0 1100 500',
        view: 'wiresheet' as const,
        panelScale: 1,
        nodes: [
          {
            id: 'dev',
            type: 'router',
            x: 550,
            y: 300,
            label: 'DEV-01',
            hw: { model: id },
          },
          { id: 'peer', type: 'host', x: 150, y: 80, label: 'peer' },
        ],
        links: [
          {
            id: 'l',
            type: 'line',
            from: 'dev',
            to: 'peer',
            fromInterface: port.name.replace('{member}', '1'),
            lineStyle: 'orthogonal' as const,
          },
        ],
        anchors: [],
        zones: [],
        flowPaths: [],
        policyMarkers: [],
      };
    }),
  };
}

export function hasCommand(cmd: string): boolean {
  return spawnSync('which', [cmd], { encoding: 'utf8' }).status === 0;
}

/** Convert a .vsdx / .vssx to PDF with LibreOffice headless; returns the PDF. */
export function sofficeToPdf(bytes: Uint8Array, ext: 'vsdx' | 'vssx'): Buffer {
  const dir = mkdtempSync(path.join(tmpdir(), 'tds-visio-'));
  try {
    const src = path.join(dir, `in.${ext}`);
    writeFileSync(src, bytes);
    const r = spawnSync(
      'soffice',
      [
        `-env:UserInstallation=file://${dir}/profile`,
        '--headless',
        '--convert-to',
        'pdf',
        '--outdir',
        dir,
        src,
      ],
      { encoding: 'utf8', timeout: 180_000 },
    );
    if (r.status !== 0)
      throw new Error(`soffice failed (${r.status}): ${r.stderr || r.error}`);
    return readFileSync(path.join(dir, 'in.pdf'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `pdfinfo` page count and first-page size in points. */
export function pdfInfo(pdf: Buffer): {
  pages: number;
  size: [number, number];
} {
  const dir = mkdtempSync(path.join(tmpdir(), 'tds-pdf-'));
  try {
    const f = path.join(dir, 'a.pdf');
    writeFileSync(f, pdf);
    const r = spawnSync('pdfinfo', [f], { encoding: 'utf8', timeout: 30_000 });
    const pages = Number(/Pages:\s+(\d+)/.exec(r.stdout)?.[1]);
    const m = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(r.stdout);
    return { pages, size: [Number(m?.[1]), Number(m?.[2])] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Rasterize page 1 of a PDF at `dpi` with pdftoppm; returns PNG bytes. */
export function pdfPagePng(pdf: Buffer, dpi: number, page = 1): Buffer {
  const dir = mkdtempSync(path.join(tmpdir(), 'tds-ppm-'));
  try {
    const f = path.join(dir, 'a.pdf');
    writeFileSync(f, pdf);
    const r = spawnSync(
      'pdftoppm',
      [
        '-r',
        String(dpi),
        '-f',
        String(page),
        '-l',
        String(page),
        '-png',
        '-singlefile',
        f,
        path.join(dir, 'p'),
      ],
      { encoding: 'utf8', timeout: 60_000 },
    );
    if (r.status !== 0) throw new Error(`pdftoppm failed: ${r.stderr}`);
    return readFileSync(path.join(dir, 'p.png'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
