/**
 * The chrome's icon set: what `icon()` and `iconSprite()` emit, that the
 * checked-in drawings are the ones the generator builds from the pinned
 * Lucide package, that they hold shapes and nothing else, and that the
 * chrome's sources draw their icons from the set rather than from glyphs.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildIconsModule,
  iconBody,
  ICON_ATTRIBUTES,
  ICON_ELEMENTS,
  ICON_MANIFEST,
} from '../../scripts/build-icons.js';
import { ICON_BODIES } from './icons.generated.js';
import {
  icon,
  iconNames,
  iconSprite,
  iconSymbolId,
  type IconName,
} from './icons.js';

const source = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('icon', () => {
  it('references the symbol from a decorative 16px svg', () => {
    expect(icon('undo')).toBe(
      '<svg class="icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#i-undo"/></svg>',
    );
  });

  it('takes another size, stated for the stylesheet as well', () => {
    const html = icon('plus', { size: 20 });
    expect(html).toContain('width="20" height="20"');
    // .icon is sized and aligned from this variable, not from the attributes.
    expect(html).toContain('style="--icon-size:20px"');
    expect(html).toContain('<use href="#i-plus"/>');
    // A size that is not a positive number falls back to the default.
    for (const size of [0, -4, Number.NaN, Number.POSITIVE_INFINITY])
      expect(icon('plus', { size })).toBe(icon('plus'));
    expect(icon('plus', { size: 16 })).toBe(icon('plus'));
  });

  it('appends extra class names after "icon"', () => {
    expect(icon('x', { className: 'spin big' })).toContain(
      '<svg class="icon spin big" ',
    );
    // Only class-name characters get through: nothing closes the attribute.
    const html = icon('x', { className: 'a" onload="alert(1)' });
    expect(html).toContain('<svg class="icon a onloadalert1" ');
    expect(html).not.toContain('onload=');
    expect(icon('x', { className: '  ' })).toBe(icon('x'));
  });

  it('is always decorative: the button keeps the accessible name', () => {
    for (const name of iconNames()) {
      const html = icon(name);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('focusable="false"');
      expect(html).not.toMatch(/<title|aria-label|role=/);
    }
  });
});

describe('iconSprite', () => {
  const sprite = iconSprite();
  const ids = [...sprite.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]);

  it('has one symbol for every icon name, each with a unique id', () => {
    expect(ids).toEqual(iconNames().map(iconSymbolId));
    expect(new Set(ids).size).toBe(ids.length);
    for (const name of iconNames()) {
      expect(sprite).toContain(
        `<symbol id="i-${name}" viewBox="0 0 24 24">${ICON_BODIES[name]}</symbol>`,
      );
      // What icon() references is what the sprite defines.
      expect(icon(name)).toContain(`href="#${iconSymbolId(name)}"`);
    }
  });

  it('is symbols only: nothing in it is drawn or styled where it is mounted', () => {
    expect(sprite.replace(/<symbol [^>]*>.*?<\/symbol>/g, '')).toBe('');
    expect(sprite).not.toMatch(/<svg|<style|<script|<use|fill=|stroke=/);
  });

  it('names every icon in the manifest, and no other', () => {
    const names: IconName[] = iconNames();
    expect(names).toEqual(Object.keys(ICON_MANIFEST));
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('uses no symbol id that an element of the shell already has', () => {
    // The inspector's own controls are `i-swap`, `i-path`, `i-type`, … and an
    // icon named the same would put that id in the document twice: the
    // inspector and the e2e suite would then find the symbol, not the control.
    const taken = new Set<string>(['i-from', 'i-to']); // built as `i-${end}`
    const files = [
      '../main.ts',
      '../nodes/designer.ts',
      ...chromeUiFiles().map((file) => `./${file}`),
    ];
    for (const file of files)
      for (const m of source(file).matchAll(/\bid="(i-[^"$]+)"/g))
        taken.add(m[1]!);
    // The scan sees the inspector's ids (it would be vacuous otherwise).
    expect(taken).toContain('i-swap');
    expect(taken).toContain('i-type');
    expect(ids.filter((id) => taken.has(id!))).toEqual([]);
  });
});

describe('the generated drawings', () => {
  it('are what the generator builds from the pinned Lucide package', async () => {
    // Stale after a manifest edit or a lucide-static bump: npm run build:icons.
    expect(source('./icons.generated.ts')).toBe(await buildIconsModule());
  });

  it('record the icon set and its licence', () => {
    const header = source('./icons.generated.ts').split('\n\n')[0];
    expect(header).toMatch(/lucide-static \d+\.\d+\.\d+/);
    expect(header).toContain('ISC License');
    expect(header).toContain('MIT License');
  });

  it('hold only shape elements with plain geometry attributes', () => {
    for (const name of iconNames()) {
      const body = ICON_BODIES[name];
      expect(body, name).not.toBe('');
      const tags = [...body.matchAll(/<\/?([a-zA-Z][\w:-]*)([^>]*)>/g)];
      // Tags and nothing between them.
      expect(tags.map((m) => m[0]).join(''), name).toBe(body);
      for (const tag of tags) {
        expect(ICON_ELEMENTS.has(tag[1]!), `${name}: <${tag[1]}>`).toBe(true);
        for (const attr of tag[2]!.matchAll(/([^\s=/]+)="([^"]*)"/g)) {
          expect(
            ICON_ATTRIBUTES.has(attr[1]!),
            `${name}: ${attr[1]} on <${tag[1]}>`,
          ).toBe(true);
          expect(attr[2], `${name}: ${attr[1]}`).toMatch(/^[0-9A-Za-z .,+-]+$/);
        }
      }
      expect(body, name).not.toMatch(
        /script|href|style|\bon[a-z]+=|url\(|javascript:|<svg|<use|<image|<foreignObject|&/i,
      );
    }
  });
});

describe('iconBody', () => {
  const svg = (inner: string): string =>
    `<!-- @license -->\n<svg class="lucide" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n${inner}\n</svg>\n`;

  it('keeps the shapes and drops the outer svg and its presentation', () => {
    expect(
      iconBody(
        svg('  <path d="M9 14 4 9l5-5" />\n  <circle cx="12" cy="12" r="1" />'),
        'x',
      ),
    ).toBe('<path d="M9 14 4 9l5-5"/><circle cx="12" cy="12" r="1"/>');
    expect(
      iconBody(
        svg('<g><rect width="18" height="18" x="3" y="3" rx="2" /></g>'),
        'x',
      ),
    ).toBe('<g><rect width="18" height="18" x="3" y="3" rx="2"/></g>');
  });

  it('refuses anything that is not a plain shape', () => {
    const refused: [markup: string, reason: RegExp][] = [
      ['<script>alert(1)</script>', /<script> is not an allowed icon element/],
      ['<a href="https://example.com"><path d="M0 0" /></a>', /<a> is not/],
      ['<use href="#other" />', /<use> is not/],
      ['<image href="x.png" />', /<image> is not/],
      ['<style>path{fill:red}</style>', /<style> is not/],
      ['<foreignObject><p>hi</p></foreignObject>', /<foreignObject> is not/],
      ['<path d="M0 0" onclick="alert(1)" />', /attribute "onclick"/],
      ['<path d="M0 0" href="#x" />', /attribute "href"/],
      ['<path d="M0 0" style="fill:red" />', /attribute "style"/],
      ['<path d="M0 0" fill="url(#g)" />', /attribute "fill"/],
      ['<path d="M0 0" transform="scale(2)" />', /attribute "transform"/],
      ['<path d="url(javascript:alert(1))" />', /is not plain geometry/],
      ['<path d="M0 0&#10;" />', /is not plain geometry/],
      ['<path d="M0 0" />text', /unexpected markup/],
      ['<path d="M0 0">', /must be self-closing/],
      ['<g><path d="M0 0" />', /unclosed <g>/],
      ['<path d="M0 0" /></g>', /unbalanced <\/g>/],
      ['', /the icon is empty/],
    ];
    for (const [markup, reason] of refused)
      expect(() => iconBody(svg(markup), 'bad'), markup).toThrow(reason);
    expect(() => iconBody('<p>not an svg</p>', 'bad')).toThrow(
      /not an <svg> document/,
    );
  });

  it('fails the build on a bad drawing or a bad name', async () => {
    await expect(
      buildIconsModule({ ok: 'any' }, () => svg('<script>x</script>'), '0.0.0'),
    ).rejects.toThrow(/ok \(any\): <script> is not an allowed icon element/);
    await expect(
      buildIconsModule({ 'Bad Name': 'any' }, () => svg('<path d="M0 0" />')),
    ).rejects.toThrow(/must be lower-case kebab-case/);
    // A good one builds, bare key or quoted as Prettier writes it.
    const built = await buildIconsModule(
      { dot: 'a', 'two-part': 'b' },
      () => svg('<path d="M0 0" />'),
      '9.9.9',
    );
    expect(built).toContain('lucide-static 9.9.9');
    expect(built).toContain(`  dot: '<path d="M0 0"/>',`);
    expect(built).toContain(`  'two-part': '<path d="M0 0"/>',`);
  });
});

/** The chrome's own modules under src/ui (not their tests). */
function chromeUiFiles(): string[] {
  return readdirSync(fileURLToPath(new URL('.', import.meta.url)))
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .sort();
}

describe('the chrome sources', () => {
  /**
   * The symbols and emoji the chrome used as icons (each drawn by whatever
   * fallback font the OS had). Punctuation that is also ordinary text (the
   * ellipsis, the middle dot, the arrows of key legends) is not listed.
   */
  const GLYPH_ICONS =
    '↶↷⤓⤧🔗◇▦⌗◓⚠⚙☀⤢▶🗑✦⚖⛶⇤⇔⇥⤒⇕↔↕●▾◂✋▸★👁✓＋↺✕↖↗↙↘⟳↳🚫⇄╱⇢⌖⧉⤹⚓‹›✎⏸↩🌙⤴◎◌◈';

  /**
   * Glyphs that stay, by file: the save chip's text, which the e2e suite
   * reads as its "saved" signal and which the next phase redesigns.
   */
  const KEPT: Readonly<Record<string, string>> = {
    'main.ts': '👁✓', // okText: "👁 shared copy" / "✓ synced"
    'ui/save-status.ts': '⚠✓', // "✓ saved", "⚠ not saved — download JSON", …
    'ui/workspace-panel.ts': '✓', // "✓ synced", written to the same chip
  };

  it('draw icons from the set, not from glyphs', () => {
    const files = [
      'main.ts',
      'nodes/designer.ts',
      ...chromeUiFiles().map((file) => `ui/${file}`),
    ];
    const found: Record<string, string> = {};
    for (const file of files) {
      const text = source(`../${file}`);
      const glyphs = [...new Set(GLYPH_ICONS)].filter((g) => text.includes(g));
      if (glyphs.length) found[file] = glyphs.sort().join('');
    }
    const kept = Object.fromEntries(
      Object.entries(KEPT).map(([file, glyphs]) => [
        file,
        [...glyphs].sort().join(''),
      ]),
    );
    expect(found).toEqual(kept);
  });
});
