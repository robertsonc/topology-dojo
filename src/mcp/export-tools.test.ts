/**
 * `export_topology` and `view_topology` — every format through the MCP tool
 * surface, the stdio-only `outputPath`, the MCP Apps wiring (tool `_meta`,
 * the `ui://` resource, `_meta` SVG on the result) and the pass-through of
 * rich content by `registerTopologyTools`.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { TopologyStore } from './store.js';
import { createTools, type ToolDef, type ToolDeps } from './tools.js';
import { ContentResult } from './content.js';
import { MCP_APP_MIME, VIEWER_URI } from './export-tools.js';
import { registerTopologyTools } from './register.js';
import { renderDocumentToSVG } from '../server/render.js';
import { NODE_MAX_PIXELS, nodeRasterizer } from '../server/raster.js';
import { writeExportFile } from '../server/export-file.js';
import { sampleDocument } from '../pages/model.js';
import { VIEWER_HTML } from './viewer-html.js';

const b64 = (s: string): Uint8Array =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

describe('export_topology', () => {
  let store: TopologyStore;
  let tools: ToolDef[];
  let id: string;
  let dir: string;
  const deps = (extra: Partial<ToolDeps> = {}): ToolDeps => ({
    renderDocument: renderDocumentToSVG,
    rasterizer: nodeRasterizer,
    maxRasterPixels: NODE_MAX_PIXELS,
    ...extra,
  });
  const call = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<ContentResult> =>
    (await tools.find((t) => t.name === name)!.handler(args)) as ContentResult;

  beforeEach(async () => {
    store = new TopologyStore();
    dir ??= await mkdtemp(path.join(tmpdir(), 'dojo-export-'));
    tools = createTools(
      store,
      deps({ writeExport: (p, bytes) => writeExportFile(dir, p, bytes) }),
    );
    id = store.import(
      sampleDocument() as unknown as Record<string, unknown>,
    ).id;
  });
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('png returns an image block and a summary', async () => {
    const r = await call('export_topology', { topologyId: id, format: 'png' });
    const img = r.content.find((c) => c.type === 'image') as {
      data: string;
      mimeType: string;
    };
    expect(img.mimeType).toBe('image/png');
    expect(b64(img.data).slice(1, 4)).toEqual(new Uint8Array([80, 78, 71]));
    expect(r.structuredContent).toMatchObject({
      format: 'png',
      width: 2100,
      height: 1400,
      dpi: 192,
    });
  });

  it('pdf returns an embedded file', async () => {
    const r = await call('export_topology', {
      topologyId: id,
      format: 'pdf',
      paper: 'a4',
      dpi: 72,
    });
    const res = r.content.find((c) => c.type === 'resource') as {
      resource: { uri: string; mimeType: string; blob: string };
    };
    expect(res.resource.mimeType).toBe('application/pdf');
    expect(strFromU8(b64(res.resource.blob).slice(0, 8))).toBe('%PDF-1.4');
    expect(res.resource.uri).toMatch(
      /^topology-dojo:\/\/export\/.+\/Untitled\.pdf$/,
    );
    expect(r.structuredContent).toMatchObject({
      pages: 1,
      paperPt: { w: 842, h: 595 },
    });
  });

  it('vsdx / pptx are zip packages and report what they dropped', async () => {
    for (const format of ['vsdx', 'pptx'] as const) {
      const r = await call('export_topology', { topologyId: id, format });
      const res = r.content.find((c) => c.type === 'resource') as {
        resource: { blob: string };
      };
      const parts = unzipSync(b64(res.resource.blob));
      expect(parts['[Content_Types].xml'], format).toBeDefined();
      expect(r.structuredContent!.dropped).toEqual([
        'Frame 1: 1 flow path(s), 1 policy marker(s) not exported',
      ]);
    }
  });

  it('pptx image mode renders each slide', async () => {
    const r = await call('export_topology', {
      topologyId: id,
      format: 'pptx',
      pptxMode: 'image',
    });
    const res = r.content.find((c) => c.type === 'resource') as {
      resource: { blob: string };
    };
    const parts = unzipSync(b64(res.resource.blob));
    expect(parts['ppt/media/image1.png']).toBeDefined();
    expect(r.structuredContent!.dropped).toBeUndefined();
  });

  it('drawio returns XML text; mermaid returns plain text', async () => {
    const d = await call('export_topology', {
      topologyId: id,
      format: 'drawio',
    });
    const res = d.content.find((c) => c.type === 'resource') as {
      resource: { text: string };
    };
    expect(res.resource.text.startsWith('<?xml')).toBe(true);
    const m = await call('export_topology', {
      topologyId: id,
      format: 'mermaid',
    });
    expect(m.text.startsWith('flowchart')).toBe(true);
  });

  it('writes to outputPath on the local server, confined to the export root', async () => {
    const r = await call('export_topology', {
      topologyId: id,
      format: 'vsdx',
      outputPath: 'out/net.vsdx',
    });
    const written = r.structuredContent!.path as string;
    expect(written).toBe(path.join(dir, 'out', 'net.vsdx'));
    expect((await readFile(written)).subarray(0, 2).toString()).toBe('PK');
    await expect(
      call('export_topology', {
        topologyId: id,
        format: 'mermaid',
        outputPath: '../escape.mmd',
      }),
    ).rejects.toThrow(/inside the export directory/);
  });

  it('offers outputPath only when the server can write files', () => {
    const hosted = createTools(new TopologyStore(), deps());
    const t = hosted.find((x) => x.name === 'export_topology')!;
    expect(Object.keys(t.inputShape)).not.toContain('outputPath');
  });

  it('reports raster formats as unavailable without a rasterizer', async () => {
    const bare = createTools(store, { renderDocument: renderDocumentToSVG });
    await expect(
      bare
        .find((t) => t.name === 'export_topology')!
        .handler({ topologyId: id, format: 'png' }),
    ).rejects.toThrow(/not available/);
  });

  it('imports its own draw.io export back', async () => {
    const d = await call('export_topology', {
      topologyId: id,
      format: 'drawio',
    });
    const xml = (
      d.content.find((c) => c.type === 'resource') as {
        resource: { text: string };
      }
    ).resource.text;
    const imported = (await tools
      .find((t) => t.name === 'import_topology')!
      .handler({ json: xml })) as {
      id: string;
      converted: { from: string };
    };
    expect(imported.converted.from).toBe('drawio');
    expect(store.get(imported.id).pages[0]!.nodes).toHaveLength(7);
  });
});

describe('view_topology', () => {
  it('links the MCP Apps view and keeps the SVG out of the model-facing content', () => {
    const store = new TopologyStore();
    const tools = createTools(store, { renderDocument: renderDocumentToSVG });
    const id = store.import(
      sampleDocument() as unknown as Record<string, unknown>,
    ).id;
    const view = tools.find((t) => t.name === 'view_topology')!;
    expect(view.meta).toEqual({
      ui: { resourceUri: VIEWER_URI },
      'ui/resourceUri': VIEWER_URI,
    });
    const r = view.handler({ topologyId: id }) as ContentResult;
    expect(r.text).toContain('Showing "Untitled" inline');
    expect(r.text).not.toContain('<svg');
    expect(r.structuredContent).toMatchObject({
      topologyId: id,
      pageIndex: 0,
      pages: [{ index: 0, name: 'Frame 1' }],
      formats: ['drawio', 'vsdx', 'pptx', 'mermaid', 'cable-schedule'],
    });
    expect(String(r.meta!['topology-dojo/svg'])).toMatch(/^<svg/);
  });
});

describe('registerTopologyTools (rich results + view resource)', () => {
  it('passes content, structuredContent and _meta through and registers the view', async () => {
    const handlers = new Map<
      string,
      (a: Record<string, unknown>) => Promise<unknown>
    >();
    const metas = new Map<string, unknown>();
    const resources: {
      uri: string;
      meta: { mimeType: string };
      read: () => unknown;
    }[] = [];
    const server = {
      registerTool(
        name: string,
        cfg: { _meta?: unknown },
        h: (a: Record<string, unknown>) => Promise<unknown>,
      ) {
        handlers.set(name, h);
        metas.set(name, cfg._meta);
      },
      registerResource(
        _name: string,
        uri: string,
        meta: { mimeType: string },
        read: () => unknown,
      ) {
        resources.push({ uri, meta, read });
      },
    };
    const store = registerTopologyTools(server as never, {
      renderDocument: renderDocumentToSVG,
    });
    const id = store.import(
      sampleDocument() as unknown as Record<string, unknown>,
    ).id;

    expect(resources).toHaveLength(1);
    expect(resources[0]!.uri).toBe(VIEWER_URI);
    expect(resources[0]!.meta.mimeType).toBe(MCP_APP_MIME);
    const read = resources[0]!.read() as {
      contents: { text: string; mimeType: string }[];
    };
    expect(read.contents[0]!.text).toBe(VIEWER_HTML);
    expect(metas.get('view_topology')).toMatchObject({
      ui: { resourceUri: VIEWER_URI },
    });

    const out = (await handlers.get('view_topology')!({ topologyId: id })) as {
      content: { type: string }[];
      structuredContent: Record<string, unknown>;
      _meta: Record<string, unknown>;
    };
    expect(out.content[0]!.type).toBe('text');
    expect(out.structuredContent.topologyId).toBe(id);
    expect(typeof out._meta['topology-dojo/svg']).toBe('string');
  });
});

describe('viewer HTML', () => {
  it('is self-contained (no external origins)', () => {
    expect(VIEWER_HTML).not.toMatch(/<script[^>]+src=/i);
    expect(VIEWER_HTML).not.toMatch(/<link[^>]+href=/i);
    expect(VIEWER_HTML).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(VIEWER_HTML).toContain("'ui/initialize'");
    expect(VIEWER_HTML).toContain("'ui/download-file'");
  });
});
