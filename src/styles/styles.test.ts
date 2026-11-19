import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
});
