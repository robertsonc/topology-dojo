/**
 * A minimal PDF 1.4 writer for raster pages — one image per page, fitted and
 * centred on a physical paper size. Used by the server-side PDF export, where
 * jsPDF's browser assumptions (and bundle weight) are unwanted; the browser
 * keeps `pagesToPDFBlob` (src/editor/export.ts).
 *
 * Raster on purpose, like the browser exporter: the engine's SVG leans on
 * filters a vector converter would drop, so each frame is rasterized through
 * the same pipeline as PNG and the PDF always matches the canvas. Pixels are
 * stored losslessly (RGB, FlateDecode).
 */
import { zlibSync } from 'fflate';
import type { RasterImage } from './raster.js';

export interface PdfImagePage {
  image: RasterImage;
  /** Paper size in points (1/72 in). */
  paper: { w: number; h: number };
}

export interface PdfMeta {
  title?: string;
  creator?: string;
}

/** PDF literal string, escaped; non-Latin-1 text becomes UTF-16BE hex. */
function pdfString(s: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\u0000-ÿ]*$/.test(s))
    return `(${s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[\r\n]/g, ' ')})`;
  let hex = 'FEFF';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0');
      hex += (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0');
    } else hex += cp.toString(16).padStart(4, '0');
  }
  return `<${hex.toUpperCase()}>`;
}

/** RGBA → RGB (the export backdrop is opaque, so alpha is dropped). */
function rgb(img: RasterImage): Uint8Array {
  const n = img.width * img.height;
  const out = new Uint8Array(n * 3);
  const px = img.pixels;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    out[i * 3] = px[j]!;
    out[i * 3 + 1] = px[j + 1]!;
    out[i * 3 + 2] = px[j + 2]!;
  }
  return out;
}

const enc = new TextEncoder();
const num = (v: number): string => (Math.round(v * 100) / 100).toString();

/** Build a PDF document from raster pages. */
export function buildRasterPdf(
  pages: PdfImagePage[],
  meta: PdfMeta = {},
): Uint8Array {
  if (!pages.length) throw new Error('nothing to export');
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array): void => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (
    id: number,
    body: string | Uint8Array[],
    dict?: string,
  ): void => {
    offsets[id] = length;
    if (typeof body === 'string') {
      push(`${id} 0 obj\n${body}\nendobj\n`);
      return;
    }
    const total = body.reduce((s, b) => s + b.length, 0);
    push(`${id} 0 obj\n<< ${dict ?? ''} /Length ${total} >>\nstream\n`);
    for (const b of body) push(b);
    push(`\nendstream\nendobj\n`);
  };

  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // binary marker
  // Objects: 1 catalog, 2 pages, 3 info, then per page: page, content, image.
  const kids: number[] = [];
  let next = 4;
  const plan = pages.map(() => {
    const ids = { page: next, content: next + 1, image: next + 2 };
    next += 3;
    kids.push(ids.page);
    return ids;
  });
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(
    2,
    `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`,
  );
  obj(
    3,
    `<< /Producer ${pdfString('Topology Dojo')}` +
      (meta.title ? ` /Title ${pdfString(meta.title)}` : '') +
      (meta.creator ? ` /Creator ${pdfString(meta.creator)}` : '') +
      ' >>',
  );
  pages.forEach((p, i) => {
    const ids = plan[i]!;
    const { w: pw, h: ph } = p.paper;
    const { width: iw, height: ih } = p.image;
    // Fit the frame on the paper, centred, aspect preserved.
    const k = Math.min(pw / iw, ph / ih);
    const dw = iw * k;
    const dh = ih * k;
    const content = `q ${num(dw)} 0 0 ${num(dh)} ${num((pw - dw) / 2)} ${num((ph - dh) / 2)} cm /Im0 Do Q`;
    obj(
      ids.page,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pw)} ${num(ph)}] ` +
        `/Resources << /XObject << /Im0 ${ids.image} 0 R >> >> /Contents ${ids.content} 0 R >>`,
    );
    obj(ids.content, [enc.encode(content)]);
    obj(
      ids.image,
      [zlibSync(rgb(p.image), { level: 6 })],
      `/Type /XObject /Subtype /Image /Width ${iw} /Height ${ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode`,
    );
  });
  const xref = length;
  let table = `xref\n0 ${next}\n0000000000 65535 f \n`;
  for (let id = 1; id < next; id++)
    table += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(
    `trailer\n<< /Size ${next} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );

  const out = new Uint8Array(length);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
