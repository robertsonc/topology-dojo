/**
 * Open Packaging Conventions helpers — the ZIP + [Content_Types].xml +
 * relationship-part plumbing shared by the Visio (.vsdx) and PowerPoint
 * (.pptx) writers. Pure; the archive is built with fflate (no streams), so it
 * runs the same in the browser, Node and the Worker.
 */
import { zipSync, strToU8 } from 'fflate';

export const XML_HEADER =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Escape text for XML element content / attribute values. */
export function xmlEsc(s: unknown): string {
  return (
    String(s ?? '')
      // XML 1.0 forbids most C0 controls even as references.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  );
}

export interface Relationship {
  id: string;
  type: string;
  target: string;
  /** 'External' for hyperlinks (target is a URL, not a part). */
  targetMode?: 'External';
}

/** A `.rels` part. */
export function relsXml(rels: Relationship[]): string {
  return (
    XML_HEADER +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    rels
      .map(
        (r) =>
          `<Relationship Id="${xmlEsc(r.id)}" Type="${xmlEsc(r.type)}" Target="${xmlEsc(r.target)}"` +
          (r.targetMode ? ` TargetMode="${r.targetMode}"` : '') +
          '/>',
      )
      .join('') +
    '</Relationships>'
  );
}

/** `[Content_Types].xml` from extension defaults + per-part overrides. */
export function contentTypesXml(
  defaults: Record<string, string>,
  overrides: Record<string, string>,
): string {
  return (
    XML_HEADER +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    Object.entries(defaults)
      .map(
        ([ext, type]) => `<Default Extension="${ext}" ContentType="${type}"/>`,
      )
      .join('') +
    Object.entries(overrides)
      .map(
        ([part, type]) =>
          `<Override PartName="${part}" ContentType="${type}"/>`,
      )
      .join('') +
    '</Types>'
  );
}

/** docProps/core.xml with a title and fixed creator. */
export function corePropsXml(
  title: string,
  created: Date = new Date(),
): string {
  const iso = created.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return (
    XML_HEADER +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${xmlEsc(title)}</dc:title><dc:creator>Topology Dojo</dc:creator>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified>` +
    '</cp:coreProperties>'
  );
}

export const REL = {
  officeDocument:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  coreProps:
    'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  extendedProps:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
  image:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  hyperlink:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
} as const;

export const CT = {
  rels: 'application/vnd.openxmlformats-package.relationships+xml',
  xml: 'application/xml',
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  core: 'application/vnd.openxmlformats-package.core-properties+xml',
  app: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
} as const;

/** Zip parts into a package. Text parts are UTF-8 encoded. */
export function zipPackage(
  parts: Record<string, string | Uint8Array>,
): Uint8Array<ArrayBuffer> {
  const files: Record<string, Uint8Array> = {};
  for (const [path, body] of Object.entries(parts))
    files[path] = typeof body === 'string' ? strToU8(body) : body;
  // A fixed mtime keeps output deterministic (tests, caching).
  // fflate allocates a fresh ArrayBuffer (never shared), so the narrower
  // type is sound — and lets callers hand the bytes straight to a Blob.
  return zipSync(files, {
    level: 6,
    mtime: new Date('2026-01-01T00:00:00Z'),
  }) as Uint8Array<ArrayBuffer>;
}

/** Decode a `data:image/png|jpeg|gif;base64,…` URI, or null. */
export function decodeDataImage(
  href: string | undefined,
): { ext: 'png' | 'jpeg' | 'gif'; bytes: Uint8Array } | null {
  if (!href) return null;
  const m = /^data:image\/(png|jpe?g|gif);base64,([A-Za-z0-9+/=\s]+)$/i.exec(
    href,
  );
  if (!m) return null;
  try {
    const bin = atob(m[2]!.replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const t = m[1]!.toLowerCase();
    return {
      ext: t === 'jpg' || t === 'jpeg' ? 'jpeg' : (t as 'png' | 'gif'),
      bytes,
    };
  } catch {
    return null;
  }
}
