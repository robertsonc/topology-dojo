/**
 * draw.io / diagrams.net export (plan Phase 4.6) — a one-way, documented-lossy
 * `.drawio` (mxGraph XML) export so a topology can be handed to draw.io /
 * Confluence users (and round-trip with tools like NetBox that speak the same
 * format). Geometry, labels, waypoints, zones, and basic styling survive;
 * Topology Dojo's animated/annotation vocabulary (flow paths, policy markers,
 * layers, playback) does not — this is an interchange escape hatch, not a
 * second persistence format.
 *
 * DOM-free and pure: every page becomes one <diagram> in a single <mxfile>.
 */
import type { Page, TopologyDocument } from '../pages/model.js';
import { nodeHalf } from '../api/geometry.js';
import { zoneBounds } from './geometry.js';

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Basic-shape style per node type; everything else is a rounded rect. */
function nodeStyle(type: string, color: string | undefined): string {
  const fill = color ? `fillColor=${color};fillOpacity=25;` : '';
  const stroke = color ? `strokeColor=${color};` : 'strokeColor=#7d8a92;';
  const base = `${fill}${stroke}fontColor=#333333;whiteSpace=wrap;html=1;`;
  const shape = type.replace(/^shape:/, '');
  switch (type) {
    case 'text':
      return 'text;html=1;align=center;verticalAlign=middle;';
    case 'callout':
      return `rounded=1;${base}dashed=0;verticalAlign=middle;align=left;spacing=6;`;
    case 'shape:circle':
    case 'shape:ellipse':
      return `ellipse;${base}`;
    case 'shape:diamond':
      return `rhombus;${base}`;
    case 'shape:triangle':
      return `triangle;${base}`;
    case 'shape:hexagon':
      return `shape=hexagon;${base}`;
    case 'shape:square':
    case 'shape:rectangle':
      return `rounded=0;${base}`;
    default:
      // Named network/compute types keep their type visible as a tooltip-ish
      // second line via the style; the shape itself is a rounded rect.
      return shape.startsWith('shape')
        ? `rounded=0;${base}`
        : `rounded=1;${base}`;
  }
}

/** One page → the <root> cell list of an mxGraphModel. */
function pageCells(page: Page): string {
  let out = `<mxCell id="0"/><mxCell id="1" parent="0"/>`;

  // Zones first (they render behind everything, like the engine draws them).
  for (const z of page.zones ?? []) {
    const b = zoneBounds(page, z);
    if (!b) continue;
    const c = z.color ?? '#7d8a92';
    out +=
      `<mxCell id="${esc(z.id)}" value="${esc(z.label ?? z.id)}" ` +
      `style="rounded=1;dashed=1;fillColor=${esc(c)};fillOpacity=10;strokeColor=${esc(c)};verticalAlign=top;align=left;spacingLeft=6;whiteSpace=wrap;html=1;" ` +
      `vertex="1" parent="1">` +
      `<mxGeometry x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" as="geometry"/>` +
      `</mxCell>`;
  }

  for (const n of page.nodes) {
    const h = nodeHalf(n);
    // Give tiny icon glyphs a usable draw.io footprint (min 40×30).
    const w = Math.max(40, Math.round(h.w * 2));
    const ht = Math.max(30, Math.round(h.h * 2));
    const value =
      n.type === 'image'
        ? '' // the image itself carries the meaning; label goes below
        : [n.label, n.sublabel].filter(Boolean).join('&#10;');
    let style = nodeStyle(n.type, n.color as string | undefined);
    if (n.type === 'image') {
      const src = typeof n.imageHref === 'string' ? n.imageHref.trim() : '';
      if (/^https:\/\//i.test(src) || /^data:image\//i.test(src))
        style = `shape=image;imageAspect=1;image=${esc(src)};`;
    }
    out +=
      `<mxCell id="${esc(n.id)}" value="${esc(value)}" style="${style}" vertex="1" parent="1">` +
      `<mxGeometry x="${Math.round(n.x - w / 2)}" y="${Math.round(n.y - ht / 2)}" width="${w}" height="${ht}" as="geometry"/>` +
      `</mxCell>`;
  }

  // Anchors become small ellipse vertices so links keep both endpoints.
  for (const a of page.anchors ?? []) {
    out +=
      `<mxCell id="${esc(a.id)}" value="" style="ellipse;fillColor=#7d8a92;strokeColor=none;" vertex="1" parent="1">` +
      `<mxGeometry x="${Math.round(a.x - 3)}" y="${Math.round(a.y - 3)}" width="6" height="6" as="geometry"/>` +
      `</mxCell>`;
  }

  for (const l of page.links) {
    const color = (l.color as string) ?? '#7d8a92';
    const dashed =
      l.dashed || l.type === 'tunnel' || l.type === 'wireguard'
        ? 'dashed=1;'
        : '';
    const rounded = l.lineStyle === 'curved' ? 'curved=1;' : 'rounded=1;';
    const style = `endArrow=none;html=1;${rounded}${dashed}strokeColor=${esc(color)};strokeWidth=${Number(l.strokeWidth) || 2};`;
    const points = (l.waypoints ?? [])
      .map((w) => `<mxPoint x="${w.x}" y="${w.y}"/>`)
      .join('');
    out +=
      `<mxCell id="${esc(l.id)}" value="${esc(l.label ?? '')}" style="${style}" edge="1" parent="1" source="${esc(l.from)}" target="${esc(l.to)}">` +
      `<mxGeometry relative="1" as="geometry">` +
      (points ? `<Array as="points">${points}</Array>` : '') +
      `</mxGeometry>` +
      `</mxCell>`;
  }

  return out;
}

/** The whole document as one draw.io file (one <diagram> per page). */
export function documentToDrawioXML(doc: TopologyDocument): string {
  const diagrams = doc.pages
    .map((page) => {
      const [, , vw, vh] = page.viewBox.split(/\s+/).map(Number);
      return (
        `<diagram id="${esc(page.id)}" name="${esc(page.name)}">` +
        `<mxGraphModel dx="0" dy="0" grid="1" gridSize="20" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${vw || 1050}" pageHeight="${vh || 700}" math="0" shadow="0">` +
        `<root>${pageCells(page)}</root>` +
        `</mxGraphModel>` +
        `</diagram>`
      );
    })
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<mxfile host="Topology Dojo" agent="topology-dojo-export" version="1">` +
    diagrams +
    `</mxfile>`
  );
}
