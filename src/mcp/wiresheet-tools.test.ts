/**
 * hw-catalog Phase 4: wire-sheet pages through the MCP render tools —
 * render_svg, inspect_render, export_topology (PNG / PDF), view_topology,
 * export_flipbook — and set_page_properties view / panelScale; Phase 5:
 * export_topology vsdx with model masters.
 */
import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { TopologyStore } from './store.js';
import { createTools, type ToolDeps } from './tools.js';
import { ContentResult } from './content.js';
import { renderDocumentToSVG } from '../server/render.js';
import { nodeCatalogLoader } from '../server/catalog.js';
import { nodeRasterizer } from '../server/raster.js';
import { serializeDoc } from '../pages/persist.js';
import { branchWiresheetDoc } from '../render/wiresheet-fixtures.js';
import { sampleDocument } from '../pages/model.js';

function setup(catalog: ToolDeps['catalog'] | null = nodeCatalogLoader()) {
  const store = new TopologyStore();
  const tools = createTools(store, {
    renderDocument: renderDocumentToSVG,
    rasterizer: nodeRasterizer,
    ...(catalog ? { catalog } : {}),
  });
  const call = (name: string, args: Record<string, unknown>) =>
    tools.find((t) => t.name === name)!.handler(args);
  const id = store.import(serializeDoc(branchWiresheetDoc())).id;
  return { store, call, id };
}

describe('wire sheets through the MCP render tools', () => {
  it('render_svg draws panels (async), and stays synchronous elsewhere', async () => {
    const { store, call, id } = setup();
    const svg = (await call('render_svg', { topologyId: id })) as string;
    expect(svg).toContain('class="tds-panel"');
    expect(svg).toContain('>SCHEMATIC</text>');
    const plain = store.import(serializeDoc(sampleDocument())).id;
    expect(call('render_svg', { topologyId: plain })).not.toBeInstanceOf(
      Promise,
    );
  });

  it('renders logical without a catalog', async () => {
    const { call, id } = setup(null);
    const svg = (await call('render_svg', { topologyId: id })) as string;
    expect(svg).not.toContain('tds-panel');
    const r = (await call('inspect_render', { topologyId: id })) as Record<
      string,
      unknown
    >;
    expect(r.note).toMatch(
      /inspected as logical: this server has no hardware catalog/,
    );
  });

  it('inspect_render inspects the sheet as drawn', async () => {
    const { call, id } = setup();
    const r = (await call('inspect_render', { topologyId: id })) as {
      wiresheet: { scale: string; panels: number; cables: number };
      findings: { message: string }[];
    };
    expect(r.wiresheet).toMatchObject({
      scale: '1:2.5',
      panels: 3,
      cables: 12,
    });
    expect(
      r.findings.filter((f) => f.message.startsWith('wire sheet')),
    ).toEqual([]);
  });

  it('export_topology renders the sheet to PNG and PDF', async () => {
    const { call, id } = setup();
    const png = (await call('export_topology', {
      topologyId: id,
      format: 'png',
      dpi: 72,
    })) as ContentResult;
    expect(png.content[0]).toMatchObject({
      type: 'image',
      mimeType: 'image/png',
    });
    const pdf = (await call('export_topology', {
      topologyId: id,
      format: 'pdf',
      dpi: 72,
    })) as ContentResult;
    expect(pdf.structuredContent).toMatchObject({ pages: 1 });
    const blob = (pdf.content[1] as { resource: { blob: string } }).resource
      .blob;
    expect(Buffer.from(blob, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('export_topology vsdx uses model masters (logical without a catalog)', async () => {
    const parts = async (catalog?: null) => {
      const { call, id } = catalog === null ? setup(null) : setup();
      const r = (await call('export_topology', {
        topologyId: id,
        format: 'vsdx',
      })) as ContentResult;
      const blob = (r.content[1] as { resource: { blob: string } }).resource
        .blob;
      return unzipSync(Buffer.from(blob, 'base64'));
    };
    const withMasters = await parts();
    expect(withMasters['visio/masters/masters.xml']).toBeDefined();
    expect(strFromU8(withMasters['visio/pages/page1.xml']!)).toContain(
      'ToCell="Connections.X',
    );
    expect((await parts(null))['visio/masters/masters.xml']).toBeUndefined();
  });

  it('view_topology hands the inline view the wire sheet', async () => {
    const { call, id } = setup();
    const r = (await call('view_topology', {
      topologyId: id,
    })) as ContentResult;
    expect(String(r.meta!['topology-dojo/svg'])).toContain('class="tds-panel"');
  });

  it('export_flipbook renders the sheet', async () => {
    const { call, id } = setup();
    expect(await call('export_flipbook', { topologyId: id })).toContain(
      'tds-panel',
    );
  });

  it('set_page_properties sets and clears view and panelScale', () => {
    const { store, call, id } = setup();
    const page = store.get(id).pages[0]!;
    expect(
      call('set_page_properties', { topologyId: id, panelScale: 4 }),
    ).toMatchObject({
      view: 'wiresheet',
      panelScale: 4,
    });
    call('set_page_properties', {
      topologyId: id,
      view: 'logical',
      panelScale: null,
    });
    expect(page.view).toBeUndefined();
    expect(page.panelScale).toBeUndefined();
  });
});
