/**
 * The custom-node interpreter: one pure function that renders a CustomNodeSpec
 * to an SVG fragment, reproducing the legacy designer's render pipeline at
 * scale 1, center-origin (the engine's node-render contract). This is the single
 * source of truth — the designer preview, the engine, and exports all use it.
 *
 * `registerCustomNode` wires a spec into the vendored engine via its
 * `registerNodeType` plugin API, so nodes of `spec.typeName` render through it.
 */
import { glowForColor, patternDef, shapeGeom } from './data.js';
import type { CustomNodeSpec } from './spec.js';

function esc(s: string): string {
  return String(s).replace(/[<>&"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;',
  );
}

/** Render a custom node centered at (x, y); `cfg.color` overrides the accent. */
export function renderCustomNode(
  spec: CustomNodeSpec,
  x: number,
  y: number,
  cfg: { color?: string } = {},
): string {
  // Escape colour values before they reach unescaped SVG attribute sinks below.
  // Imports are already sanitized in persist, but the live designer preview
  // renders an in-progress spec straight from the inputs, so escape here too.
  const c = esc(cfg.color || spec.colorStroke);
  const f = esc(spec.colorFill);
  const sz = spec.size;
  const sw = spec.strokeW;
  const rx = spec.radius;
  const halo = glowForColor(spec.colorStroke);
  const b = shapeGeom(spec.shape, 0, 0, sz, rx); // half-bounds at origin
  let s = '';

  // 1. Outer glow
  if (spec.glow) {
    s += `<ellipse cx="${x}" cy="${y}" rx="${b.bx + 5}" ry="${b.by + 4}" fill="${c}" opacity=".06" filter="url(#${halo})"/>`;
  }

  // 2. Main shape (with optional pattern fill)
  let fill = f;
  if (spec.pattern && spec.patternType !== 'none') {
    const pid = `${esc(spec.typeName)}-pat`;
    s += `<defs>${patternDef(spec.patternType, pid, c)}</defs>`;
    fill = `url(#${pid})`;
  }
  const main = shapeGeom(spec.shape, x, y, sz, rx);
  s += `<${main.tag} ${main.attrs} fill="${fill}" stroke="${c}" stroke-width="${sw}"/>`;

  // 3. Highlight bar
  if (spec.highlight) {
    const hw = round1(b.bx * 0.9);
    s += `<rect x="${x - hw}" y="${y - (b.by - 1)}" width="${hw * 2}" height="1" rx=".5" fill="rgba(255,255,255,.04)"/>`;
  }

  // 4. Inner ring
  if (spec.innerRing) {
    const r = shapeGeom(spec.shape, x, y, round1(sz * 0.7), round1(rx * 0.7));
    s += `<${r.tag} ${r.attrs} fill="none" stroke="${c}" stroke-width="${round1(sw * 0.6)}" stroke-dasharray="4 3" opacity=".3"/>`;
  }

  // 5. Icon overlay
  if (spec.icon) {
    const icon = ICON_PATHS[spec.icon];
    if (icon) {
      const sc = round3(sz * 0.04);
      const t = round1(12 * sc);
      s += `<g transform="translate(${x - t},${y - t}) scale(${sc})"><path d="${icon}" fill="${c}" opacity=".85"/></g>`;
    }
  }

  // 6. Status LEDs
  if (spec.leds) {
    const cnt = spec.ledCount;
    const spread = (cnt - 1) * 4;
    for (let i = 0; i < cnt; i++) {
      const off = -spread / 2 + i * 4;
      let cx = x;
      let cy = y;
      if (spec.ledPos === 'bottom') {
        cx = x + off;
        cy = y + (b.by - 3);
      } else if (spec.ledPos === 'top') {
        cx = x + off;
        cy = y - (b.by - 3);
      } else if (spec.ledPos === 'left') {
        cx = x - (b.bx - 3);
        cy = y + off;
      } else {
        cx = x + (b.bx - 3);
        cy = y + off;
      }
      s += `<circle cx="${cx}" cy="${cy}" r="1.5" fill="${esc(spec.ledColor)}" filter="url(#tds-bloom)"/>`;
    }
  }

  // 7. Badge
  if (spec.badge && spec.badgeText) {
    const tw = spec.badgeText.length * 3 + 6;
    s += `<rect x="${x + round1(b.bx - tw / 2 + 2)}" y="${y - round1(b.by + 4)}" width="${tw}" height="10" rx="5" fill="${esc(spec.badgeColor)}" opacity=".9"/>`;
    s += `<text x="${x + round1(b.bx + 2)}" y="${y - round1(b.by - 3)}" text-anchor="middle" fill="#fff" font-size="6" font-family="'JetBrains Mono',monospace" font-weight="600">${esc(spec.badgeText)}</text>`;
  }

  // 8. Antenna waves
  if (spec.antenna) {
    s += `<line x1="${x}" y1="${y - b.by}" x2="${x}" y2="${y - (b.by + 12)}" stroke="${c}" stroke-width="1.2"/>`;
    s += `<circle cx="${x}" cy="${y - (b.by + 14)}" r="2.5" fill="${f}" stroke="${c}" stroke-width="1"/>`;
    s += `<circle cx="${x}" cy="${y - (b.by + 14)}" r="1" fill="${c}" opacity=".8" filter="url(#tds-bloom)"/>`;
    s += `<path d="M${x - 8},${y - (b.by + 20)} A10,10 0 0,1 ${x + 8},${y - (b.by + 20)}" fill="none" stroke="${c}" stroke-width=".8" opacity=".5"/>`;
    s += `<path d="M${x - 13},${y - (b.by + 24)} A16,16 0 0,1 ${x + 13},${y - (b.by + 24)}" fill="none" stroke="${c}" stroke-width=".6" opacity=".3"/>`;
    s += `<path d="M${x - 18},${y - (b.by + 28)} A22,22 0 0,1 ${x + 18},${y - (b.by + 28)}" fill="none" stroke="${c}" stroke-width=".5" opacity=".15"/>`;
  }

  // 9. Ports
  if (spec.ports) {
    const cnt = spec.portCount;
    const pw = 3;
    const ph = 2;
    const totalW = cnt * (pw + 1.5) - 1.5;
    for (let i = 0; i < cnt; i++) {
      const off = round1(-totalW / 2 + i * (pw + 1.5));
      const py =
        spec.portPos === 'bottom'
          ? y + round1(b.by - ph / 2)
          : y - round1(b.by + ph / 2);
      s += `<rect x="${x + off}" y="${py}" width="${pw}" height="${ph}" rx=".6" fill="${c}" opacity=".45"/>`;
    }
  }

  return s;
}

/** hitBox half-extents for a spec (used by the engine for routing/collision). */
export function customHitBox(spec: CustomNodeSpec): { rx: number; ry: number } {
  const b = shapeGeom(spec.shape, 0, 0, spec.size, spec.radius);
  return { rx: Math.round(b.bx), ry: Math.round(b.by) };
}

/** Register a custom node type with the vendored engine (idempotent overwrite). */
export function registerCustomNode(spec: CustomNodeSpec): void {
  const engine = window.TopologyDesigner;
  if (!engine) return;
  engine.registerNodeType(spec.typeName, {
    render: (x: number, y: number, cfg: { color?: string }) =>
      renderCustomNode(spec, x, y, cfg),
    defaults: { color: spec.colorStroke },
    hitBox: customHitBox(spec),
    haloColor: glowForColor(spec.colorStroke),
  });
}

/** Register all of a document's custom node types. */
export function registerCustomNodes(specs: CustomNodeSpec[]): void {
  for (const spec of specs) registerCustomNode(spec);
}

// Lazily-built id → path map (avoids importing the full ICONS object shape here).
import { ICONS } from './data.js';
const ICON_PATHS: Record<string, string> = Object.fromEntries(
  Object.entries(ICONS).map(([k, v]) => [k, v.d]),
);

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
