/**
 * MCP export + inline-view tools.
 *
 * - `export_topology` turns a topology into a file the user's team already
 *   works with: PNG / PDF (print-true raster, server-side), draw.io, Visio
 *   (.vsdx), PowerPoint (.pptx) or Mermaid. Images come back as MCP image
 *   content; files as embedded resources (or, on the local stdio server, an
 *   `outputPath` the server writes).
 * - `view_topology` shows a topology inline in the conversation through an
 *   MCP Apps view (`ui://topology-dojo/viewer.html`, see `./viewer-html.ts`):
 *   pan, zoom, page and layer toggles, and downloads via `export_topology` —
 *   so a file can reach the user without passing through the model.
 *
 * Handlers read the document from the store synchronously, before any await,
 * so a workspace snapshot loaded for one call (`serveWorkspaceRead`) is read
 * before anything else can run.
 */
import { z } from 'zod';
import type { TopologyDocument } from '../pages/model.js';
import type { RenderOptions } from '../render/core.js';
import { SHEET_ORIENTATIONS, SHEET_SIZE_IDS } from '../api/sheet.js';
import { documentToDrawioXML } from '../export/drawio.js';
import { documentToMermaid } from '../export/mermaid.js';
import { documentToVsdx } from '../export/vsdx.js';
import { documentToPptx, pptxSlideCount } from '../export/pptx.js';
import { buildScene, droppedSummary } from '../export/scene.js';
import { exportPdf, exportPng } from '../export/print.js';
import { bytesToBase64 } from '../export/base64.js';
import type { Rasterizer } from '../export/raster.js';
import { ContentResult } from './content.js';
import type { TopologyStore } from './store.js';
import type { ToolDef, ToolDeps } from './tools.js';

/** The MCP Apps view resource. */
export const VIEWER_URI = 'ui://topology-dojo/viewer.html';
/** MCP Apps resource MIME type (SEP-1865). */
export const MCP_APP_MIME = 'text/html;profile=mcp-app';

/** Largest file an export returns inline (bytes, before base64). */
export const MAX_FILE_EXPORT_BYTES = 8 * 1024 * 1024;

export const EXPORT_FORMATS = [
  'png',
  'pdf',
  'drawio',
  'vsdx',
  'pptx',
  'mermaid',
] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

const MIME: Record<ExportFormat, string> = {
  png: 'image/png',
  pdf: 'application/pdf',
  drawio: 'application/vnd.jgraph.mxfile',
  vsdx: 'application/vnd.ms-visio.drawing',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mermaid: 'text/vnd.mermaid',
};
const EXT: Record<ExportFormat, string> = {
  png: 'png',
  pdf: 'pdf',
  drawio: 'drawio',
  vsdx: 'vsdx',
  pptx: 'pptx',
  mermaid: 'mmd',
};

/** A filesystem-safe base name from a title. */
export function exportBaseName(title: string): string {
  return (
    (title || 'topology')
      .replace(/[^\w.-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || 'topology'
  );
}

function assertFileSize(bytes: number, format: ExportFormat): void {
  if (bytes > MAX_FILE_EXPORT_BYTES)
    throw new Error(
      `${format} export is ${bytes} bytes, over the ${MAX_FILE_EXPORT_BYTES / 1024 / 1024} MiB limit. ` +
        'Export fewer pages, lower dpi, or hide layers; do not retry the same request.',
    );
}

function renderOpts(a: Record<string, unknown>): RenderOptions {
  return {
    ...(a.theme !== undefined
      ? { theme: a.theme as RenderOptions['theme'] }
      : {}),
    ...(a.visibleLayers !== undefined
      ? { visibleLayers: a.visibleLayers as string[] }
      : {}),
  };
}

const topologyId = z.string().describe('Topology id (or shared workspace id).');

export function exportTools(store: TopologyStore, deps: ToolDeps): ToolDef[] {
  const maxPixels = deps.maxRasterPixels ?? 16_000_000;
  const rasterizer = async (): Promise<Rasterizer> => {
    if (!deps.rasterizer)
      throw new Error(
        'raster export (png / pdf / pptx image mode) is not available on this server',
      );
    return deps.rasterizer();
  };
  const render = (
    doc: TopologyDocument,
    i: number,
    opts: RenderOptions,
  ): string => deps.renderDocument(doc, i, opts);

  const exportShape: Record<string, z.ZodType> = {
    topologyId,
    format: z
      .enum(EXPORT_FORMATS)
      .describe(
        'png: one page, print-true raster (image content). pdf: raster pages on real paper sizes (ANSI / A-series from the document sheet, or `paper`). ' +
          'drawio: editable draw.io file — layers → draw.io layers, zones → containers, metadata as shape data; re-importable with import_topology. ' +
          'vsdx: editable Visio — shapes, glued connectors, page layers, metadata as Shape Data. ' +
          'pptx: one 16:9 slide per page (or per layer) with editable shapes, or the rendered image. ' +
          'mermaid: flowchart text (subgraphs from zones; no coordinates).',
      ),
    pageIndex: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        'png: the page (default 0). pdf / mermaid: export only this page (default all pages).',
      ),
    theme: z
      .enum(['dark', 'light'])
      .optional()
      .describe(
        'png / pdf / pptx image mode: "light" for print and slides, "dark" (default) for the canvas look.',
      ),
    visibleLayers: z
      .array(z.string())
      .optional()
      .describe(
        'png / pdf: draw only these declared layers (base elements always draw).',
      ),
    dpi: z
      .number()
      .min(72)
      .max(600)
      .optional()
      .describe(
        'png / pdf: print resolution. Default 150 on paper; png without a sheet renders 2×.',
      ),
    paper: z
      .enum(['fit', ...SHEET_SIZE_IDS])
      .optional()
      .describe(
        'pdf / png: paper to fit onto. Default: the document sheet size, else the frame at true size ("fit").',
      ),
    orientation: z
      .enum(SHEET_ORIENTATIONS)
      .optional()
      .describe('Paper orientation when `paper` is set.'),
    slides: z
      .enum(['pages', 'layers'])
      .optional()
      .describe(
        'pptx: one slide per page (default) or, per page, the full page then base + each declared layer.',
      ),
    pptxMode: z
      .enum(['shapes', 'image'])
      .optional()
      .describe(
        'pptx: editable native shapes (default) or the pixel-faithful render as a picture.',
      ),
  };
  if (deps.writeExport)
    exportShape.outputPath = z
      .string()
      .min(1)
      .max(1024)
      .optional()
      .describe(
        'Local server only: write the file here (absolute, or relative to the export directory) instead of returning it inline — preferred for large files. Returns the written path.',
      );

  const tools: ToolDef[] = [
    {
      name: 'export_topology',
      description:
        'Export a topology to the formats network teams already use: PNG / PDF (print-true, ANSI and A-series sheets), draw.io, Visio .vsdx, PowerPoint .pptx, or Mermaid. ' +
        'PNG returns an image; Mermaid returns text; other formats return the file as an embedded resource' +
        (deps.writeExport ? ' or write it to `outputPath`' : '') +
        '. Editable formats (draw.io / vsdx / pptx shapes) are documented-lossy: device glyph art, flow paths, policy markers, port pills/tables, the sheet frame and legend do not carry over — the result lists what was dropped. ' +
        'In hosts that support MCP Apps, view_topology shows the diagram inline with download buttons, which keeps large files out of the conversation.',
      inputShape: exportShape,
      handler: async (a) => {
        const doc = store.get(String(a.topologyId)); // read before any await
        const format = a.format as ExportFormat;
        const pageIndex = a.pageIndex as number | undefined;
        const base = exportBaseName(doc.title);
        const filename = `${base}.${EXT[format]}`;
        const summary: Record<string, unknown> = {
          format,
          filename,
          mimeType: MIME[format],
        };
        let bytes: Uint8Array | null = null;
        let text: string | null = null;

        const opts = {
          ...(a.dpi !== undefined ? { dpi: Number(a.dpi) } : {}),
          ...(a.paper !== undefined ? { paper: String(a.paper) } : {}),
          ...(a.orientation !== undefined
            ? { orientation: a.orientation as 'landscape' | 'portrait' }
            : {}),
          render: renderOpts(a),
          maxPixels,
        };
        switch (format) {
          case 'png': {
            const r = exportPng(
              doc,
              pageIndex,
              render,
              await rasterizer(),
              opts,
            );
            bytes = r.png;
            Object.assign(summary, {
              filename: `${base}${doc.pages.length > 1 ? `_p${(pageIndex ?? 0) + 1}` : ''}.png`,
              width: r.width,
              height: r.height,
              dpi: r.dpi,
              ...(r.reduced
                ? { note: 'resolution reduced to stay within the pixel budget' }
                : {}),
            });
            break;
          }
          case 'pdf': {
            const r = exportPdf(
              doc,
              pageIndex ?? 'all',
              render,
              await rasterizer(),
              opts,
            );
            bytes = r.pdf;
            Object.assign(summary, {
              pages: r.pages,
              dpi: r.dpi,
              paperPt: r.paper[0],
              ...(r.reduced
                ? { note: 'resolution reduced to stay within the pixel budget' }
                : {}),
            });
            break;
          }
          case 'drawio':
            text = documentToDrawioXML(doc);
            summary.pages = doc.pages.length;
            break;
          case 'mermaid':
            text = documentToMermaid(doc, pageIndex);
            break;
          case 'vsdx':
            bytes = documentToVsdx(doc);
            summary.pages = doc.pages.length;
            break;
          case 'pptx': {
            const slides =
              (a.slides as 'pages' | 'layers' | undefined) ?? 'pages';
            const mode =
              (a.pptxMode as 'shapes' | 'image' | undefined) ?? 'shapes';
            const r = mode === 'image' ? await rasterizer() : null;
            bytes = documentToPptx(doc, {
              slides,
              mode,
              ...(r
                ? {
                    renderImage: (i: number, only: string[] | undefined) =>
                      exportPng(doc, i, render, r, {
                        dpi: 144,
                        paper: 'fit',
                        render: {
                          theme: (a.theme as RenderOptions['theme']) ?? 'light',
                          ...(only ? { visibleLayers: only } : {}),
                        },
                        maxPixels: Math.min(maxPixels, 8_000_000),
                      }),
                  }
                : {}),
            });
            summary.slides = pptxSlideCount(doc, slides);
            break;
          }
        }
        if (format === 'drawio' || format === 'vsdx' || format === 'pptx') {
          const dropped = droppedSummary(buildScene(doc));
          if (format === 'pptx' && a.pptxMode === 'image') {
            // Image slides keep everything the render draws.
          } else if (dropped.length) summary.dropped = dropped;
        }

        const size = bytes
          ? bytes.length
          : new TextEncoder().encode(text!).length;
        summary.bytes = size;
        assertFileSize(size, format);

        if (deps.writeExport && typeof a.outputPath === 'string') {
          const path = await deps.writeExport(
            a.outputPath,
            bytes ?? new TextEncoder().encode(text!),
          );
          return new ContentResult(
            [{ type: 'text', text: JSON.stringify({ ...summary, path }) }],
            {
              ...summary,
              path,
            },
          );
        }
        const uri = `topology-dojo://export/${encodeURIComponent(String(a.topologyId))}/${encodeURIComponent(String(summary.filename))}`;
        if (format === 'png')
          return new ContentResult(
            [
              {
                type: 'image',
                data: bytesToBase64(bytes!),
                mimeType: MIME.png,
              },
              { type: 'text', text: JSON.stringify(summary) },
            ],
            summary,
          );
        if (format === 'mermaid')
          return new ContentResult([{ type: 'text', text: text! }], {
            ...summary,
            mermaid: text,
          });
        return new ContentResult(
          [
            { type: 'text', text: JSON.stringify(summary) },
            {
              type: 'resource',
              resource: bytes
                ? { uri, mimeType: MIME[format], blob: bytesToBase64(bytes) }
                : { uri, mimeType: MIME[format], text: text! },
            },
          ],
          summary,
        );
      },
    },
    {
      name: 'view_topology',
      description:
        'Show a topology inline in the conversation as an interactive view (pan, zoom, page and layer toggles, light/dark, and download buttons for PNG / PDF / draw.io / Visio / PowerPoint / Mermaid). ' +
        'Needs a host with MCP Apps support (e.g. Claude, ChatGPT, VS Code); elsewhere the call only returns a summary — use render_svg, export_topology or share_topology instead. ' +
        'Cheap for the model: the drawing goes to the view, not into the conversation.',
      inputShape: {
        topologyId,
        pageIndex: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Page to open on (default 0).'),
        theme: z
          .enum(['dark', 'light'])
          .optional()
          .describe('Initial theme (default dark).'),
      },
      meta: { ui: { resourceUri: VIEWER_URI }, 'ui/resourceUri': VIEWER_URI },
      handler: (a) => {
        const id = String(a.topologyId);
        const doc = store.get(id);
        const index = (a.pageIndex as number | undefined) ?? 0;
        if (!doc.pages[index])
          throw new Error(`page index ${index} out of range`);
        const theme = (a.theme as 'dark' | 'light' | undefined) ?? 'dark';
        const svg = deps.renderDocument(doc, index, { theme });
        const data = {
          topologyId: id,
          title: doc.title,
          pageIndex: index,
          theme,
          pages: doc.pages.map((p, i) => ({ index: i, name: p.name })),
          layers: (doc.layers ?? []).map((l) => ({
            id: l.id,
            name: l.name || l.id,
            visible: l.defaultVisible !== false,
          })),
          formats: EXPORT_FORMATS.filter(
            (f) => deps.rasterizer || (f !== 'png' && f !== 'pdf'),
          ),
        };
        return new ContentResult(
          [
            {
              type: 'text',
              text:
                `Showing "${doc.title}" inline — page ${index + 1} of ${doc.pages.length}` +
                (data.layers.length
                  ? `, layers: ${data.layers.map((l) => l.name).join(', ')}`
                  : '') +
                '. The user can pan, zoom, switch pages / layers and download files from the view.',
            },
          ],
          data,
          { 'topology-dojo/svg': svg },
        );
      },
    },
  ];
  return tools;
}
