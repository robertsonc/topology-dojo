/**
 * Document persistence — autosave to localStorage + JSON import/export.
 *
 * Pages are already plain JSON, so persistence is just (de)serialization with
 * defensive normalization on the way in (a corrupt or hand-edited file must
 * never crash the editor — it falls back to a valid shape or null).
 */
import type { TopologyDocument, Page, Stencil, BrandPalette } from './model.js';
import { newPageId } from './model.js';
import { sanitizeDisplayFields } from '../api/text.js';

/** A valid CSS hex colour (`#rgb` or `#rrggbb`), else undefined. */
function hexColor(v: unknown): string | undefined {
  return typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim())
    ? v.trim().toLowerCase()
    : undefined;
}

/**
 * A colour string safe to interpolate verbatim into an SVG/HTML attribute:
 * strict hex, an `rgb()/rgba()/hsl()/hsla()` form with numeric content only, or
 * a bare CSS colour keyword. Anything else — in particular anything carrying a
 * quote or angle bracket — is rejected, so a document from an untrusted source
 * (an imported file or a shared `/v/<id>` snapshot) cannot break out of an
 * attribute and inject markup. Returns undefined when the value is unsafe.
 */
function safeColor(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return s;
  if (/^(rgb|rgba|hsl|hsla)\([\d.,%\s/]*\)$/i.test(s)) return s;
  if (/^[a-z]{1,32}$/i.test(s)) return s; // named colour / keyword
  return undefined;
}

/**
 * An element `type` token reduced to markup-safe characters. Types are
 * interpolated into SVG/HTML in sinks the renderer does not escape (e.g. the
 * inspector's type row and the custom-node pattern id), so a hostile `type`
 * from an imported/shared document must never carry quotes or angle brackets.
 */
function safeType(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const cleaned = v.replace(/[^\w:.-]/g, '');
  return cleaned || fallback;
}

/** Drop any colour-typed field of `el` that isn't a safe colour (in place). */
function scrubColors(el: Record<string, unknown>): void {
  for (const k of ['color', 'labelColor']) {
    if (!(k in el)) continue;
    const c = safeColor(el[k]);
    if (c === undefined) delete el[k];
    else el[k] = c;
  }
}

/** Sanitize a page's elements against markup injection (in place). */
function sanitizeElements(pg: Page): void {
  for (const n of pg.nodes as unknown as Record<string, unknown>[]) {
    n.type = safeType(n.type, 'host');
    scrubColors(n);
  }
  for (const l of pg.links as unknown as Record<string, unknown>[]) {
    l.type = safeType(l.type, 'line');
    scrubColors(l);
  }
  for (const coll of [pg.zones, pg.flowPaths, pg.policyMarkers])
    for (const el of coll as unknown as Record<string, unknown>[])
      scrubColors(el);
}

/** Sanitize a custom node spec; returns null if it has no markup-safe name. */
function sanitizeCustomNode(raw: unknown): CustomNodeSpec | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Record<string, unknown>;
  const typeName = safeType(s.typeName, '');
  if (!typeName) return null;
  const def = defaultSpec();
  return {
    ...(s as unknown as CustomNodeSpec),
    typeName,
    colorStroke: safeColor(s.colorStroke) ?? def.colorStroke,
    colorFill: safeColor(s.colorFill) ?? def.colorFill,
    ledColor: safeColor(s.ledColor) ?? def.ledColor,
    badgeColor: safeColor(s.badgeColor) ?? def.badgeColor,
  };
}

/** Parse a brand palette, keeping only valid hex colours; undefined if no accent. */
function parsePalette(raw: unknown): BrandPalette | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const accent = hexColor(r.accent);
  if (!accent) return undefined; // accent is the one required colour
  const secondary = hexColor(r.secondary);
  const chrome = hexColor(r.chrome);
  return {
    accent,
    ...(secondary ? { secondary } : {}),
    ...(chrome ? { chrome } : {}),
    ...(typeof r.id === 'string' ? { id: r.id } : {}),
    ...(typeof r.name === 'string' ? { name: r.name } : {}),
  };
}
import { defaultSpec, type CustomNodeSpec } from '../nodes/spec.js';
import type { LayerDef } from '../api/layers.js';

const KEY = 'topology-dojo:doc';

export function serializeDoc(doc: TopologyDocument): string {
  return JSON.stringify(
    {
      title: doc.title,
      pages: doc.pages,
      customNodes: doc.customNodes,
      ...(doc.layers?.length ? { layers: doc.layers } : {}),
      ...(doc.legend ? { legend: doc.legend } : {}),
      ...(doc.stencils?.length ? { stencils: doc.stencils } : {}),
      ...(doc.palette ? { palette: doc.palette } : {}),
    },
    null,
    2,
  );
}

/** Parse + normalize an unknown value into a valid document, or null if hopeless. */
export function parseDoc(input: unknown): TopologyDocument | null {
  let data: unknown = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.pages) || d.pages.length === 0) return null;

  const pages: Page[] = [];
  for (const raw of d.pages) {
    if (typeof raw !== 'object' || raw === null) continue;
    const p = raw as Record<string, unknown>;
    pages.push({
      id: typeof p.id === 'string' ? p.id : newPageId(),
      name: typeof p.name === 'string' ? p.name : `Frame ${pages.length + 1}`,
      viewBox: typeof p.viewBox === 'string' ? p.viewBox : '0 0 1050 700',
      ...(typeof p.duration === 'number' &&
      Number.isFinite(p.duration) &&
      p.duration > 0
        ? { duration: p.duration }
        : {}),
      ...(p.transition === 'cut' || p.transition === 'fade'
        ? { transition: p.transition }
        : {}),
      ...(typeof p.caption === 'string' && p.caption
        ? { caption: p.caption }
        : {}),
      ...(p.lineJumps === 'arc' || p.lineJumps === 'gap'
        ? { lineJumps: p.lineJumps }
        : {}),
      ...(Array.isArray(p.emphasis)
        ? {
            emphasis: (p.emphasis as unknown[]).filter(
              (e) => typeof e === 'string',
            ) as string[],
          }
        : {}),
      nodes: Array.isArray(p.nodes) ? (p.nodes as Page['nodes']) : [],
      links: Array.isArray(p.links) ? (p.links as Page['links']) : [],
      anchors: Array.isArray(p.anchors) ? (p.anchors as Page['anchors']) : [],
      zones: Array.isArray(p.zones) ? (p.zones as Page['zones']) : [],
      flowPaths: Array.isArray(p.flowPaths)
        ? (p.flowPaths as Page['flowPaths'])
        : [],
      policyMarkers: Array.isArray(p.policyMarkers)
        ? (p.policyMarkers as Page['policyMarkers'])
        : [],
    });
  }
  if (pages.length === 0) return null;
  // Sanitize untrusted element data (colours / types) so an imported or shared
  // document cannot inject markup, then self-heal stale zone membership: drop
  // member ids that no longer match a node on the page (e.g. the node was
  // deleted in an older build that didn't prune) — otherwise they linger as
  // "member references missing node" warnings forever. `z.nodes` is normalized
  // to an array first so a corrupt (e.g. null-patched) membership can't throw.
  for (const pg of pages) {
    sanitizeElements(pg);
    const nodeIds = new Set(pg.nodes.map((n) => n.id));
    for (const z of pg.zones) {
      if (!Array.isArray(z.nodes)) z.nodes = [];
      if (z.nodes.some((id) => !nodeIds.has(id)))
        z.nodes = z.nodes.filter((id) => nodeIds.has(id));
    }
  }
  const customNodes = Array.isArray(d.customNodes)
    ? (d.customNodes as unknown[])
        .map(sanitizeCustomNode)
        .filter((s): s is CustomNodeSpec => s !== null)
    : [];
  // Layers: keep only well-formed entries (a string id); drop the rest.
  const layers = Array.isArray(d.layers)
    ? (d.layers as unknown[]).filter(
        (l): l is LayerDef =>
          typeof l === 'object' &&
          l !== null &&
          typeof (l as { id?: unknown }).id === 'string',
      )
    : [];
  // Legend: a small opt-in settings object. Keep only recognised fields.
  const rawLegend = d.legend as Record<string, unknown> | undefined;
  const legend =
    rawLegend && typeof rawLegend === 'object'
      ? {
          ...(rawLegend.show === true ? { show: true } : {}),
          ...(['tl', 'tr', 'bl', 'br'].includes(String(rawLegend.position))
            ? { position: rawLegend.position as 'tl' | 'tr' | 'bl' | 'br' }
            : {}),
        }
      : undefined;
  // Stencils (C.3): keep only well-formed entries — an id + name + a non-empty
  // node array. Links default to [] so a malformed link list can't crash a stamp.
  const stencils = Array.isArray(d.stencils)
    ? (d.stencils as unknown[])
        .filter(
          (s): s is Record<string, unknown> =>
            typeof s === 'object' && s !== null,
        )
        .filter(
          (s) =>
            typeof s.id === 'string' &&
            typeof s.name === 'string' &&
            Array.isArray(s.nodes) &&
            s.nodes.length > 0,
        )
        .map((s): Stencil => {
          const nodes = s.nodes as Stencil['nodes'];
          const links = Array.isArray(s.links)
            ? (s.links as Stencil['links'])
            : [];
          // A stencil's members are stamped onto a page verbatim, so its element
          // data is as untrusted as a page's — sanitize colours / types the same.
          for (const n of nodes as unknown as Record<string, unknown>[]) {
            n.type = safeType(n.type, 'host');
            scrubColors(n);
          }
          for (const l of links as unknown as Record<string, unknown>[]) {
            l.type = safeType(l.type, 'line');
            scrubColors(l);
          }
          return { id: s.id as string, name: s.name as string, nodes, links };
        })
    : [];
  const palette = parsePalette(d.palette);
  const doc: TopologyDocument = {
    title: typeof d.title === 'string' ? d.title : 'Untitled',
    pages,
    customNodes,
    ...(layers.length ? { layers } : {}),
    ...(legend && Object.keys(legend).length ? { legend } : {}),
    ...(stencils.length ? { stencils } : {}),
    ...(palette ? { palette } : {}),
  };
  // Bound and normalize free-text so overlong / control-character strings
  // cannot enter the document (import, share, workspace apply, autosave).
  sanitizeDisplayFields(doc);
  if (!doc.title) doc.title = 'Untitled';
  pages.forEach((pg, i) => {
    if (!pg.name) pg.name = `Frame ${i + 1}`;
  });
  return doc;
}

/**
 * Autosave slots. `local` is the user's own document. `shared` holds edits
 * made while viewing a `/v/<id>` share-link snapshot, so opening a colleague's
 * link can never clobber the primary autosave (#202).
 */
export type DocSlot = 'local' | 'shared';

function slotKey(slot: DocSlot): string {
  return slot === 'shared' ? `${KEY}:shared` : KEY;
}

/**
 * Persist to localStorage. Returns whether the write actually succeeded —
 * storage can be unavailable (private browsing, policy) or full (quota), and
 * the UI must not claim "saved" when it wasn't (#203).
 */
export function saveLocal(
  doc: TopologyDocument,
  slot: DocSlot = 'local',
): boolean {
  try {
    localStorage.setItem(slotKey(slot), serializeDoc(doc));
    return true;
  } catch {
    return false;
  }
}

export function loadLocal(slot: DocSlot = 'local'): TopologyDocument | null {
  try {
    const s = localStorage.getItem(slotKey(slot));
    return s ? parseDoc(s) : null;
  } catch {
    return null;
  }
}

export function clearLocal(slot: DocSlot = 'local'): void {
  try {
    localStorage.removeItem(slotKey(slot));
  } catch {
    // ignore
  }
}
