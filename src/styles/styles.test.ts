import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../ui/contrast.js';

/**
 * Guards for the editor stylesheet (proposal 0013). They keep the rules the
 * token layer exists for from eroding one "just this once" at a time:
 * colours, layers and radii are named in tokens.css and nowhere else.
 */
const dir = path.dirname(fileURLToPath(import.meta.url));
const TOKENS = 'tokens.css';
const INDEX = 'index.css';

const files = readdirSync(dir)
  .filter((f) => f.endsWith('.css'))
  .sort();
const read = (file: string): string =>
  readFileSync(path.join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `property: value` pair of a stylesheet, with the file for messages. */
function declarations(
  file: string,
): { file: string; prop: string; value: string }[] {
  const out: { file: string; prop: string; value: string }[] = [];
  // Leaf blocks only: a block with no nested block holds declarations.
  for (const block of read(file).matchAll(/\{([^{}]*)\}/g))
    for (const decl of block[1]!.matchAll(/([\w-]+)\s*:\s*([^;]+);/g))
      out.push({ file, prop: decl[1]!, value: decl[2]!.trim() });
  return out;
}

const partials = files.filter((f) => f !== INDEX);
const rules = partials.filter((f) => f !== TOKENS);
const all = rules.flatMap(declarations);

/** Custom properties a script sets on an element, so no stylesheet defines them. */
const SET_FROM_SCRIPT = new Set(['--sw1', '--sw2']);

describe('editor stylesheet', () => {
  it('index.css imports every partial once, tokens first', () => {
    const imports = [...read(INDEX).matchAll(/@import\s+'\.\/([\w-]+\.css)'/g)]
      .map((m) => m[1]!)
      .sort();
    expect(imports).toEqual(partials);
    expect(read(INDEX).trimStart()).toMatch(/^@import '\.\/tokens\.css'/);
  });

  it('names every colour in tokens.css and nowhere else', () => {
    const literal =
      /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i;
    const offenders = all
      .filter((d) => literal.test(d.value))
      .map((d) => `${d.file}: ${d.prop}: ${d.value}`);
    expect(offenders).toEqual([]);
  });

  it('uses only custom properties that something defines', () => {
    const defined = new Set(SET_FROM_SCRIPT);
    for (const file of partials)
      for (const d of declarations(file))
        if (d.prop.startsWith('--')) defined.add(d.prop);
    const missing = new Set<string>();
    for (const file of partials)
      for (const d of declarations(file))
        for (const use of d.value.matchAll(/var\(\s*(--[\w-]+)/g))
          if (!defined.has(use[1]!)) missing.add(`${file}: ${use[1]}`);
    expect([...missing]).toEqual([]);
  });

  it('defines no custom property that nothing uses', () => {
    const used = new Set<string>();
    for (const file of partials)
      for (const d of declarations(file))
        for (const use of d.value.matchAll(/var\(\s*(--[\w-]+)/g))
          used.add(use[1]!);
    // Tokens the scripts read or write, and scale steps kept for the phases
    // of proposal 0013 that have not adopted them yet.
    const reserved = new Set([
      '--accent',
      '--font-ui',
      '--text-xs',
      '--text-sm',
      '--dur',
      '--ease',
      '--status-ok',
      '--status-info',
      '--surface-press',
      '--fg-disabled',
      '--accent-fg',
    ]);
    const unused = declarations(TOKENS)
      .map((d) => d.prop)
      .filter((p) => p.startsWith('--') && !used.has(p) && !reserved.has(p));
    expect([...new Set(unused)]).toEqual([]);
  });

  it('keeps surfaces flat: no backdrop blur', () => {
    // `none` is allowed: it switches the vendored engine's canvas blur off.
    const blur = all
      .filter(
        (d) =>
          d.prop.endsWith('backdrop-filter') && d.value !== 'none !important',
      )
      .map((d) => `${d.file}: ${d.prop}: ${d.value}`);
    expect(blur).toEqual([]);
  });

  it('takes every z-index from the layer scale', () => {
    // A small plain integer is a local order inside one component.
    const ok =
      /^(?:var\(--z-[\w-]+\)|calc\(var\(--z-[\w-]+\) [+-] \d+\)|[0-5])$/;
    const offenders = all
      .filter((d) => d.prop === 'z-index' && !ok.test(d.value))
      .map((d) => `${d.file}: z-index: ${d.value}`);
    expect(offenders).toEqual([]);
  });

  it('takes every corner radius from the radius scale', () => {
    const ok = /^(?:(?:var\(--radius-[\w-]+\)|0|50%)\s*)+$/;
    const offenders = all
      .filter((d) => d.prop === 'border-radius' && !ok.test(d.value))
      .map((d) => `${d.file}: border-radius: ${d.value}`);
    expect(offenders).toEqual([]);
  });

  it('gives the light theme its own value for every theme-dependent colour', () => {
    // Tokens whose dark value is tuned for dark surfaces. Each must be
    // redefined under :root.light, or light chrome inherits a dark-only tint.
    const css = read(TOKENS);
    const light = css.slice(css.indexOf(':root.light'));
    for (const token of [
      '--surface-back',
      '--surface-front',
      '--surface-float',
      '--surface-field',
      '--surface-hover',
      '--surface-press',
      '--surface-scrim',
      '--canvas-bg',
      '--fg-strong',
      '--fg',
      '--fg-weak',
      '--fg-disabled',
      '--line',
      '--line-strong',
      '--accent',
      '--on-accent',
      '--focus',
      '--shadow-raised',
      '--shadow-float',
      '--swatch-edge',
      '--scrollbar-thumb',
      '--scrollbar-thumb-hover',
    ])
      expect(light, token).toMatch(new RegExp(`${token}:`));
    expect(css).toMatch(/:root \{\s*color-scheme: dark;/);
    expect(light).toMatch(/color-scheme: light;/);
  });

  describe('token contrast (WCAG 2.1)', () => {
    type Rgba = [number, number, number, number];
    const block = (selector: string): Map<string, string> => {
      const css = read(TOKENS);
      const start = css.indexOf(`${selector} {`);
      const body = css.slice(start, css.indexOf('\n}', start));
      return new Map(
        [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [
          m[1]!,
          m[2]!.replace(/\s+/g, ' ').trim(),
        ]),
      );
    };
    const dark = block(':root');
    const themes = {
      dark,
      light: new Map([...dark, ...block(':root.light')]),
    };

    /** A token's colour, following var() and the color-mix forms tokens use. */
    function colour(value: string, tokens: Map<string, string>): Rgba {
      const v = value.trim();
      if (v === 'white') return [255, 255, 255, 1];
      if (v === 'black') return [0, 0, 0, 1];
      if (v === 'transparent') return [0, 0, 0, 0];
      const ref = /^var\((--[\w-]+)\)$/.exec(v);
      if (ref) return colour(tokens.get(ref[1]!)!, tokens);
      const hex = /^#([0-9a-f]{6})$/i.exec(v);
      if (hex) {
        const n = parseInt(hex[1]!, 16);
        return [n >> 16, (n >> 8) & 255, n & 255, 1];
      }
      const fn = /^rgba?\(([^)]+)\)$/.exec(v);
      if (fn) {
        const [r, g, b, a = 1] = fn[1]!.split(',').map(Number);
        return [r!, g!, b!, a];
      }
      const mix = /^color-mix\(in srgb, (.+) (\d+)%, (\w+)\)$/.exec(v);
      if (mix) {
        const [r, g, b, a] = colour(mix[1]!, tokens);
        const p = Number(mix[2]) / 100;
        if (mix[3] === 'transparent') return [r, g, b, a * p];
        const [or, og, ob] = colour(mix[3]!, tokens);
        return [
          r * p + or * (1 - p),
          g * p + og * (1 - p),
          b * p + ob * (1 - p),
          a,
        ];
      }
      throw new Error(`cannot read the colour "${value}"`);
    }
    const over = (top: Rgba, under: Rgba): Rgba => [
      top[0] * top[3] + under[0] * (1 - top[3]),
      top[1] * top[3] + under[1] * (1 - top[3]),
      top[2] * top[3] + under[2] * (1 - top[3]),
      1,
    ];
    const hex = (c: Rgba): string =>
      '#' +
      c
        .slice(0, 3)
        .map((n) => Math.round(n).toString(16).padStart(2, '0'))
        .join('');

    const SURFACES = ['--surface-back', '--surface-front', '--surface-float'];
    const QUIET = ['--surface-field', '--surface-hover'];
    const TINTS = [
      ...QUIET,
      '--surface-press',
      '--accent-soft',
      '--accent-soft-strong',
    ];
    /** [foreground, the fills it may sit on besides a bare surface, minimum]. */
    const PAIRS: [string, string[], number][] = [
      ['--fg-strong', TINTS, 4.5],
      ['--fg', TINTS, 4.5],
      // Weak text is for labels and hints on a resting or hovered surface. A
      // pressed or selected row takes --fg or --fg-strong.
      ['--fg-weak', QUIET, 4.5],
      ['--accent-fg', TINTS, 4.5],
      ['--status-error-fg', [], 4.5],
      ['--status-warn-fg', [], 4.5],
      ['--status-ok', [], 4.5],
      ['--status-info', [], 4.5],
      // 1.4.11: an outline that is the only edge of a control.
      ['--line-strong', [], 3],
      ['--focus', TINTS, 3],
    ];

    for (const [name, tokens] of Object.entries(themes)) {
      const get = (token: string): Rgba => colour(tokens.get(token)!, tokens);

      it(`${name}: text, outlines and the focus ring read on every surface`, () => {
        const low: string[] = [];
        for (const surface of SURFACES)
          for (const [fg, fills, min] of PAIRS)
            for (const fill of [null, ...fills]) {
              const ground = fill
                ? over(get(fill), get(surface))
                : get(surface);
              const ratio = contrastRatio(
                hex(over(get(fg), ground)),
                hex(ground),
              )!;
              if (ratio < min)
                low.push(
                  `${fg} on ${surface}${fill ? ` + ${fill}` : ''}: ` +
                    `${ratio.toFixed(2)} < ${min}`,
                );
            }
        expect(low).toEqual([]);
      });

      it(`${name}: ink on the accent and status fills reads`, () => {
        for (const [ink, fill] of [
          ['--on-accent', '--accent'],
          ['--on-status', '--status-warn'],
          ['--on-status', '--status-error'],
        ] as const)
          expect(
            contrastRatio(hex(get(ink)), hex(get(fill)))!,
            `${ink} on ${fill}`,
          ).toBeGreaterThanOrEqual(4.5);
      });
    }
  });
});
