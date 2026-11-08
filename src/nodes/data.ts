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
  /** A wide, low rack-unit front panel (W7): ~5.2 : 0.9 of `size`. */
  'chassis',
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
    // Window with a `>_` prompt. The window's inside is cut out by reverse
    // winding (the renderer fills nonzero); the earlier path relied on an
    // even-odd fill and drew as a solid block.
    d: 'M2 4L22 4L22 20L2 20ZM3.5 18.5L20.5 18.5L20.5 7L3.5 7ZM6.5 9L8.3 9L11.8 12.5L8.3 16L6.5 16L10 12.5ZM12.5 14.5L17.5 14.5L17.5 16.1L12.5 16.1Z',
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
  // Places (proposal 0011, tier 1): original glyphs. Each is one path drawn
  // clockwise, with windows and doors counter-clockwise so the default
  // nonzero fill rule cuts them out as holes.
  building: {
    cat: 'Places',
    d: 'M5 3h14v18h-5v-4h-4v4H5ZM7.5 6v2h2v-2ZM11 6v2h2v-2ZM14.5 6v2h2v-2ZM7.5 9.5v2h2v-2ZM11 9.5v2h2v-2ZM14.5 9.5v2h2v-2ZM7.5 13v2h2v-2ZM11 13v2h2v-2ZM14.5 13v2h2v-2Z',
  },
  campus: {
    cat: 'Places',
    d: 'M2 10h5V4h10v6h5v11H2ZM9 6.5v2h2v-2ZM13 6.5v2h2v-2ZM9 10v2h2v-2ZM13 10v2h2v-2ZM3.5 12.5v2h2v-2ZM18.5 12.5v2h2v-2ZM3.5 16v2h2v-2ZM18.5 16v2h2v-2ZM10.5 21h3v-4h-3Z',
  },
  datacenter: {
    cat: 'Places',
    d: 'M3 4h5v17h-5ZM9.5 4h5v17h-5ZM16 4h5v17h-5ZM4 6.5v1.5h3v-1.5ZM10.5 6.5v1.5h3v-1.5ZM17 6.5v1.5h3v-1.5ZM4 10v1.5h3v-1.5ZM10.5 10v1.5h3v-1.5ZM17 10v1.5h3v-1.5ZM4 13.5v1.5h3v-1.5ZM10.5 13.5v1.5h3v-1.5ZM17 13.5v1.5h3v-1.5Z',
  },
  home: {
    cat: 'Places',
    d: 'M12 3l10 8.5h-2.5V21h-15v-9.5H2ZM10.5 21h3v-5h-3ZM6.5 13.5v3h2.5v-3ZM15 13.5v3h2.5v-3Z',
  },
  // Tier 1 (proposal 0011): original glyphs, same winding convention as
  // Places — outlines clockwise, cut-outs counter-clockwise.
  l3switch: {
    cat: 'Network',
    d: 'M14.2 11.25L18.6 11.25L18.6 12.75L14.2 12.75ZM18.2 9.8L22 12L18.2 14.2ZM14.09 13.03L17.2 16.14L16.14 17.2L13.03 14.09ZM17.94 14.83L19.07 19.07L14.83 17.94ZM12.75 14.2L12.75 18.6L11.25 18.6L11.25 14.2ZM14.2 18.2L12 22L9.8 18.2ZM10.97 14.09L7.86 17.2L6.8 16.14L9.91 13.03ZM9.17 17.94L4.93 19.07L6.06 14.83ZM9.8 12.75L5.4 12.75L5.4 11.25L9.8 11.25ZM5.8 14.2L2 12L5.8 9.8ZM9.91 10.97L6.8 7.86L7.86 6.8L10.97 9.91ZM6.06 9.17L4.93 4.93L9.17 6.06ZM11.25 9.8L11.25 5.4L12.75 5.4L12.75 9.8ZM9.8 5.8L12 2L14.2 5.8ZM13.03 9.91L16.14 6.8L17.2 7.86L14.09 10.97ZM14.83 6.06L19.07 4.93L17.94 9.17Z',
  },
  mobile: {
    cat: 'Endpoints',
    d: 'M7 2L17 2L17 22L7 22ZM8.5 17.5L15.5 17.5L15.5 4.5L8.5 4.5ZM11 20.5L13 20.5L13 19L11 19Z',
  },
  laptopcheck: {
    cat: 'Endpoints',
    d: 'M4 3.5L20 3.5L20 15L4 15ZM5.5 13.5L18.5 13.5L18.5 5L5.5 5ZM8 9.6L9.3 8.3L11 10L14.7 6.3L16 7.6L11 12.6ZM2 16L22 16L22 18.5L2 18.5Z',
  },
  directory: {
    cat: 'Identity',
    d: 'M9 3L15 3L15 7.5L9 7.5ZM11.25 7.5L12.75 7.5L12.75 10.5L11.25 10.5ZM4.75 10.5L19.25 10.5L19.25 12L4.75 12ZM4.75 12L6.25 12L6.25 14.5L4.75 14.5ZM11.25 12L12.75 12L12.75 14.5L11.25 14.5ZM17.75 12L19.25 12L19.25 14.5L17.75 14.5ZM3 14.5L8 14.5L8 19L3 19ZM9.5 14.5L14.5 14.5L14.5 19L9.5 19ZM16 14.5L21 14.5L21 19L16 19Z',
  },
  chart: {
    cat: 'Infra',
    d: 'M4 13L7 13L7 19L4 19ZM9.5 9L12.5 9L12.5 19L9.5 19ZM15 5L18 5L18 19L15 19ZM2 20L22 20L22 21.5L2 21.5Z',
  },
  dashboard: {
    cat: 'Infra',
    d: 'M3 4L21 4L21 20L3 20ZM4.5 18.5L19.5 18.5L19.5 7.5L4.5 7.5ZM6 9L11 9L11 13L6 13ZM12.5 9L18 9L18 13L12.5 13ZM6 14.5L18 14.5L18 17L6 17ZM4.5 6.5L5.75 6.5L5.75 5.25L4.5 5.25ZM6.5 6.5L7.75 6.5L7.75 5.25L6.5 5.25Z',
  },
  // Tier 2 (proposal 0011): original glyphs, same winding convention.
  dish: {
    cat: 'Network',
    d: 'M15.75 15.82L15.25 16.26L14.63 16.58L13.89 16.76L13.06 16.79L12.15 16.68L11.19 16.44L10.2 16.06L9.21 15.55L8.23 14.93L7.3 14.22L6.43 13.42L5.66 12.57L4.99 11.68L4.44 10.77L4.03 9.87L3.77 8.99L3.66 8.17L3.7 7.41L3.9 6.74L4.25 6.18ZM9.5 10.58L13.68 5.6L14.68 6.44L10.5 11.42ZM15.68 6.02L15.56 6.59L15.24 7.08L14.75 7.41L14.18 7.52L13.6 7.41L13.12 7.08L12.79 6.59L12.68 6.02L12.79 5.45L13.12 4.96L13.6 4.63L14.18 4.52L14.75 4.63L15.24 4.96L15.56 5.45ZM6.1 14.22L8.5 14.22L10.8 21L3.8 21ZM3 21L19 21L19 22.5L3 22.5Z',
  },
  tower: {
    cat: 'Network',
    d: 'M12 6L16.5 22L7.5 22ZM10 19L14 19L12 11ZM13.6 6L13.39 6.8L12.8 7.39L12 7.6L11.2 7.39L10.61 6.8L10.4 6L10.61 5.2L11.2 4.61L12 4.4L12.8 4.61L13.39 5.2ZM15.77 3.36L16.02 3.76L16.22 4.18L16.39 4.62L16.5 5.07L16.58 5.53L16.6 6L16.58 6.47L16.5 6.93L16.39 7.38L16.22 7.82L16.02 8.24L15.77 8.64L14.62 7.84L14.79 7.56L14.94 7.27L15.05 6.96L15.13 6.65L15.18 6.33L15.2 6L15.18 5.67L15.13 5.35L15.05 5.04L14.94 4.73L14.79 4.44L14.62 4.16ZM8.23 8.64L7.98 8.24L7.78 7.82L7.61 7.38L7.5 6.93L7.42 6.47L7.4 6L7.42 5.53L7.5 5.07L7.61 4.62L7.78 4.18L7.98 3.76L8.23 3.36L9.38 4.16L9.21 4.44L9.06 4.73L8.95 5.04L8.87 5.35L8.82 5.67L8.8 6L8.82 6.33L8.87 6.65L8.95 6.96L9.06 7.27L9.21 7.56L9.38 7.84ZM18.06 1.76L18.46 2.39L18.79 3.07L19.06 3.77L19.25 4.5L19.36 5.25L19.4 6L19.36 6.75L19.25 7.5L19.06 8.23L18.79 8.93L18.46 9.61L18.06 10.24L16.91 9.44L17.24 8.92L17.51 8.38L17.72 7.8L17.88 7.21L17.97 6.61L18 6L17.97 5.39L17.88 4.79L17.72 4.2L17.51 3.62L17.24 3.08L16.91 2.56ZM5.94 10.24L5.54 9.61L5.21 8.93L4.94 8.23L4.75 7.5L4.64 6.75L4.6 6L4.64 5.25L4.75 4.5L4.94 3.77L5.21 3.07L5.54 2.39L5.94 1.76L7.09 2.56L6.76 3.08L6.49 3.62L6.28 4.2L6.12 4.79L6.03 5.39L6 6L6.03 6.61L6.12 7.21L6.28 7.8L6.49 8.38L6.76 8.92L7.09 9.44Z',
  },
  bug: {
    cat: 'Security',
    d: 'M16.6 14L16.48 15.34L16.14 16.6L15.6 17.74L14.87 18.69L14 19.41L13.02 19.85L12 20L10.98 19.85L10 19.41L9.13 18.69L8.4 17.74L7.86 16.6L7.52 15.34L7.4 14L7.52 12.66L7.86 11.4L8.4 10.26L9.13 9.31L10 8.59L10.98 8.15L12 8L13.02 8.15L14 8.59L14.87 9.31L15.6 10.26L16.14 11.4L16.48 12.66ZM14.6 6.6L14.47 7.31L14.1 7.95L13.53 8.46L12.8 8.79L12 8.9L11.2 8.79L10.47 8.46L9.9 7.95L9.53 7.31L9.4 6.6L9.53 5.89L9.9 5.25L10.47 4.74L11.2 4.41L12 4.3L12.8 4.41L13.53 4.74L14.1 5.25L14.47 5.89ZM11.88 11.14L3.88 9.64L4.12 8.36L12.12 9.86ZM11.88 9.86L19.88 8.36L20.12 9.64L12.12 11.14ZM11.89 14.64L3.39 13.14L3.61 11.86L12.11 13.36ZM11.89 13.36L20.39 11.86L20.61 13.14L12.11 14.64ZM11.88 18.14L3.88 16.64L4.12 15.36L12.12 16.86ZM11.88 16.86L19.88 15.36L20.12 16.64L12.12 18.14ZM10.58 5.35L8.08 2.35L8.92 1.65L11.42 4.65ZM12.58 4.65L15.08 1.65L15.92 2.35L13.42 5.35Z',
  },
  file: {
    cat: 'Misc',
    d: 'M5 2L14 2L19 7L19 22L5 22ZM14 2.6L14 7L18.4 7ZM8 12.5L16 12.5L16 11L8 11ZM8 16L16 16L16 14.5L8 14.5ZM8 19.5L13 19.5L13 18L8 18Z',
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
    case 'chassis': {
      // A 1RU front panel: wide and low, so a port row reads along its
      // bottom edge and links fan in along a long side (W7).
      const w = hs * 2.6;
      const h = hs * 0.45;
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
