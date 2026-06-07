/**
 * Custom-node primitives — base-shape geometry, icons, patterns, and the glow
 * mapping. Ported verbatim (values) from the legacy node designer so custom
 * nodes render identically. Pure data + pure functions, no DOM.
 */

export const SHAPE_KEYS = [
  'circle',
  'square',
  'rectangle',
  'ellipse',
  'triangle',
  'diamond',
  'hexagon',
  'pentagon',
  'star',
  'cross',
  'arrow',
] as const;
export type ShapeKey = (typeof SHAPE_KEYS)[number];

export const PATTERN_KEYS = [
  'none',
  'brick',
  'dots',
  'hlines',
  'vlines',
  'crosshatch',
  'diagonal',
] as const;
export type PatternKey = (typeof PATTERN_KEYS)[number];

export const SWATCHES = [
  '#01a982',
  '#05cc93',
  '#00a4b3',
  '#65aef9',
  '#7764fc',
  '#deb146',
  '#fc6161',
  '#d25f4b',
  '#7d8a92',
  '#b1b9be',
  '#068667',
  '#3b82f6',
  '#ec4899',
  '#f97316',
  '#22c55e',
];

/** Icon glyphs (24×24 viewBox single paths), grouped by category. */
export const ICONS: Record<string, { cat: string; d: string }> = {
  shield: {
    cat: 'Security',
    d: 'M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z',
  },
  lock: {
    cat: 'Security',
    d: 'M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zM12 17a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM9 8V6a3 3 0 0 1 6 0v2H9z',
  },
  key: {
    cat: 'Security',
    d: 'M12.65 10a6 6 0 1 0 0 4H17v4h4v-4h2v-4H12.65zM7 14a2 2 0 1 1 0-4 2 2 0 0 1 0 4z',
  },
  eye: {
    cat: 'Security',
    d: 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  },
  globe: {
    cat: 'Network',
    d: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 17.93A8 8 0 0 1 4.07 13H7v-2H4.07A8 8 0 0 1 11 4.07V7h2V4.07A8 8 0 0 1 19.93 11H17v2h2.93A8 8 0 0 1 13 19.93V17h-2v2.93z',
  },
  wifi: {
    cat: 'Network',
    d: 'M1 9l2 2a12.73 12.73 0 0 1 18 0l2-2A15.57 15.57 0 0 0 1 9zm8 8l3 3 3-3a4.24 4.24 0 0 0-6 0zm-4-4l2 2a8.49 8.49 0 0 1 10 0l2-2a11.38 11.38 0 0 0-14 0z',
  },
  signal: {
    cat: 'Network',
    d: 'M3 18h2v-4H3v4zm4 0h2V8H7v10zm4 0h2V2h-2v16zm4 0h2v-8h-2v8zm4 0h2v-2h-2v2z',
  },
  link: {
    cat: 'Network',
    d: 'M3.9 12a4.1 4.1 0 0 1 4.1-4.1H11V6H8a6 6 0 0 0 0 12h3v-1.9H8A4.1 4.1 0 0 1 3.9 12zM8 13h8v-2H8v2zm8-7h-3v1.9h3a4.1 4.1 0 0 1 0 8.2h-3V18h3a6 6 0 0 0 0-12z',
  },
  server: {
    cat: 'Infra',
    d: 'M4 1h16a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm0 9h16a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1zm13 2.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm0-9a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM4 19h16v2H4v-2z',
  },
  database: {
    cat: 'Infra',
    d: 'M12 2C6.48 2 2 3.79 2 6v12c0 2.21 4.48 4 10 4s10-1.79 10-4V6c0-2.21-4.48-4-10-4zm0 18c-4.42 0-8-1.34-8-3v-2.52c1.81 1.12 4.77 1.82 8 1.82s6.19-.7 8-1.82V17c0 1.66-3.58 3-8 3zm0-7c-4.42 0-8-1.34-8-3V7.48C5.81 8.6 8.77 9.3 12 9.3s6.19-.7 8-1.82V10c0 1.66-3.58 3-8 3zm0-7c-4.42 0-8-1.34-8-3s3.58-3 8-3 8 1.34 8 3-3.58 3-8 3z',
  },
  cloud: {
    cat: 'Infra',
    d: 'M19.35 10.04A7.49 7.49 0 0 0 12 4a7.48 7.48 0 0 0-6.65 4.04A5.99 5.99 0 0 0 0 14a6 6 0 0 0 6 6h13a5 5 0 0 0 .35-9.96z',
  },
  cpu: {
    cat: 'Infra',
    d: 'M9 3V1h2v2h2V1h2v2h2a2 2 0 0 1 2 2v2h2v2h-2v2h2v2h-2v2a2 2 0 0 1-2 2h-2v2h-2v-2h-2v2H9v-2H7a2 2 0 0 1-2-2v-2H3v-2h2V9H3V7h2V5a2 2 0 0 1 2-2h2zm-2 4v10h10V7H7zm2 2h6v6H9V9z',
  },
  terminal: {
    cat: 'Infra',
    d: 'M2 4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4zm5.586 8L5.293 9.707l1.414-1.414L10.414 12l-3.707 3.707-1.414-1.414L7.586 12zM12 15h6v2h-6v-2z',
  },
  lightning: { cat: 'Status', d: 'M13 2L3 14h7v8l10-12h-7V2z' },
  check: {
    cat: 'Status',
    d: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z',
  },
  xmark: {
    cat: 'Status',
    d: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z',
  },
  warning: {
    cat: 'Status',
    d: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
  },
  heart: {
    cat: 'Status',
    d: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5A5.5 5.5 0 0 1 7.5 3c1.74 0 3.41.81 4.5 2.09A5.99 5.99 0 0 1 16.5 3 5.5 5.5 0 0 1 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
  },
  bell: {
    cat: 'Status',
    d: 'M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z',
  },
  user: {
    cat: 'Identity',
    d: 'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-5.33 0-8 2.67-8 4v2h16v-2c0-1.33-2.67-4-8-4z',
  },
  users: {
    cat: 'Identity',
    d: 'M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4zm8 0c-.29 0-.62.02-.97.05A5.22 5.22 0 0 1 18 17v2h6v-2c0-2.66-5.33-4-8-4z',
  },
  fingerprint: {
    cat: 'Identity',
    d: 'M17.81 4.47a11.76 11.76 0 0 0-5.81-1.52c-2.08 0-4.03.52-5.74 1.46l.89 1.55A10.06 10.06 0 0 1 12 4.95c1.76 0 3.4.45 4.84 1.24l.97-1.72zM12 7.05a7.96 7.96 0 0 0-8 7.88c0 .6.06 1.18.17 1.74l1.98-.33a6.3 6.3 0 0 1-.15-1.41 6 6 0 0 1 12 0c0 .73-.14 1.43-.38 2.08l1.88.69c.32-.85.5-1.78.5-2.77a7.96 7.96 0 0 0-8-7.88zm0 4a3.98 3.98 0 0 0-4 3.88c0 .88.16 1.72.46 2.48l1.83-.67a4.73 4.73 0 0 1-.29-1.81 2 2 0 0 1 4 0c0 1.75-.43 3.38-1.16 4.82l1.73.92A13.28 13.28 0 0 0 16 14.93a3.98 3.98 0 0 0-4-3.88z',
  },
  gear: {
    cat: 'Misc',
    d: 'M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.04 7.04 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.49.37 1.03.7 1.62.94l.36 2.54c.05.24.26.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.57 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z',
  },
  layers: {
    cat: 'Misc',
    d: 'M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z',
  },
  code: {
    cat: 'Misc',
    d: 'M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z',
  },
  power: {
    cat: 'Misc',
    d: 'M13 3h-2v10h2V3zm4.83 2.17l-1.42 1.42A6.92 6.92 0 0 1 19 12c0 3.87-3.13 7-7 7s-7-3.13-7-7a6.92 6.92 0 0 1 2.59-5.41L6.17 5.17A8.93 8.93 0 0 0 3 12a9 9 0 0 0 18 0 8.93 8.93 0 0 0-3.17-6.83z',
  },
};

export interface ShapeGeom {
  tag: string;
  attrs: string;
  /** Half-bounds (extent from center) — used for hitBox + embellishment placement. */
  bx: number;
  by: number;
}

/** Base-shape geometry centered at (x, y) with half-size s and corner radius rx. */
export function shapeGeom(
  shape: string,
  x: number,
  y: number,
  s: number,
  rx: number,
): ShapeGeom {
  const hs = s;
  switch (shape) {
    case 'square':
      return {
        tag: 'rect',
        attrs: `x="${x - hs}" y="${y - hs}" width="${hs * 2}" height="${hs * 2}" rx="${rx}"`,
        bx: hs,
        by: hs,
      };
    case 'rectangle': {
      const w = hs * 1.6;
      const h = hs;
      return {
        tag: 'rect',
        attrs: `x="${x - w}" y="${y - h}" width="${w * 2}" height="${h * 2}" rx="${rx}"`,
        bx: w,
        by: h,
      };
    }
    case 'ellipse': {
      const rx2 = hs * 1.3;
      const ry = hs * 0.8;
      return {
        tag: 'ellipse',
        attrs: `cx="${x}" cy="${y}" rx="${rx2}" ry="${ry}"`,
        bx: rx2,
        by: ry,
      };
    }
    case 'triangle':
      return {
        tag: 'polygon',
        attrs: `points="${x},${y - hs} ${x + hs},${y + hs * 0.7} ${x - hs},${y + hs * 0.7}"`,
        bx: hs,
        by: hs,
      };
    case 'diamond':
      return {
        tag: 'polygon',
        attrs: `points="${x},${y - hs} ${x + hs},${y} ${x},${y + hs} ${x - hs},${y}"`,
        bx: hs,
        by: hs,
      };
    case 'hexagon':
    case 'pentagon':
    case 'star': {
      const n = shape === 'hexagon' ? 6 : shape === 'pentagon' ? 5 : 10;
      const step = 360 / n;
      const inner = hs * 0.4;
      let p = '';
      for (let i = 0; i < n; i++) {
        const r = shape === 'star' ? (i % 2 === 0 ? hs : inner) : hs;
        const a = ((i * step - 90) * Math.PI) / 180;
        p += `${x + r * Math.cos(a)},${y + r * Math.sin(a)} `;
      }
      return { tag: 'polygon', attrs: `points="${p.trim()}"`, bx: hs, by: hs };
    }
    case 'cross': {
      const t = hs * 0.3;
      return {
        tag: 'polygon',
        attrs: `points="${x - t},${y - hs} ${x + t},${y - hs} ${x + t},${y - t} ${x + hs},${y - t} ${x + hs},${y + t} ${x + t},${y + t} ${x + t},${y + hs} ${x - t},${y + hs} ${x - t},${y + t} ${x - hs},${y + t} ${x - hs},${y - t} ${x - t},${y - t}"`,
        bx: hs,
        by: hs,
      };
    }
    case 'arrow':
      return {
        tag: 'polygon',
        attrs: `points="${x - hs},${y - hs * 0.5} ${x + hs * 0.3},${y - hs * 0.5} ${x + hs},${y} ${x + hs * 0.3},${y + hs * 0.5} ${x - hs},${y + hs * 0.5}"`,
        bx: hs,
        by: hs * 0.5,
      };
    case 'circle':
    default:
      return {
        tag: 'circle',
        attrs: `cx="${x}" cy="${y}" r="${hs}"`,
        bx: hs,
        by: hs,
      };
  }
}

/** Map an accent color to the engine's preset glow filter id. */
export function glowForColor(c: string): string {
  const map: Record<string, string> = {
    '#01a982': 'tds-glow-green',
    '#068667': 'tds-glow-green',
    '#05cc93': 'tds-glow-green',
    '#22c55e': 'tds-glow-green',
    '#65aef9': 'tds-glow-blue',
    '#3b82f6': 'tds-glow-blue',
    '#00a4b3': 'tds-glow-blue',
    '#7764fc': 'tds-glow-purple',
    '#ec4899': 'tds-glow-purple',
    '#deb146': 'tds-glow-gold',
    '#f97316': 'tds-glow-gold',
    '#fc6161': 'tds-glow-red',
    '#d25f4b': 'tds-glow-red',
  };
  return map[c] ?? 'tds-glow-green';
}

/** A `<pattern>` definition (color substituted in, unlike the legacy code-gen). */
export function patternDef(type: string, id: string, c: string): string {
  switch (type) {
    case 'brick':
      return `<pattern id="${id}" width="12" height="8" patternUnits="userSpaceOnUse"><line x1="0" y1="4" x2="12" y2="4" stroke="${c}" stroke-width=".5" opacity=".3"/><line x1="0" y1="8" x2="12" y2="8" stroke="${c}" stroke-width=".5" opacity=".3"/><line x1="6" y1="0" x2="6" y2="4" stroke="${c}" stroke-width=".5" opacity=".2"/><line x1="0" y1="4" x2="0" y2="8" stroke="${c}" stroke-width=".5" opacity=".2"/><line x1="12" y1="4" x2="12" y2="8" stroke="${c}" stroke-width=".5" opacity=".2"/></pattern>`;
    case 'dots':
      return `<pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r=".8" fill="${c}" opacity=".3"/></pattern>`;
    case 'hlines':
      return `<pattern id="${id}" width="4" height="4" patternUnits="userSpaceOnUse"><line x1="0" y1="2" x2="4" y2="2" stroke="${c}" stroke-width=".5" opacity=".3"/></pattern>`;
    case 'vlines':
      return `<pattern id="${id}" width="4" height="4" patternUnits="userSpaceOnUse"><line x1="2" y1="0" x2="2" y2="4" stroke="${c}" stroke-width=".5" opacity=".3"/></pattern>`;
    case 'crosshatch':
      return `<pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse"><line x1="0" y1="3" x2="6" y2="3" stroke="${c}" stroke-width=".4" opacity=".25"/><line x1="3" y1="0" x2="3" y2="6" stroke="${c}" stroke-width=".4" opacity=".25"/></pattern>`;
    case 'diagonal':
      return `<pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse"><line x1="0" y1="6" x2="6" y2="0" stroke="${c}" stroke-width=".5" opacity=".3"/></pattern>`;
    default:
      return '';
  }
}
