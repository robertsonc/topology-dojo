/**
 * The chrome's icon set: what `icon()` and `iconSprite()` emit, that the
 * checked-in drawings are the ones the generator builds from the pinned
 * Lucide package, that they hold shapes and nothing else, and that the
 * chrome's sources draw their icons from the set rather than from glyphs.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  ICON_ATTRIBUTES,
  ICON_ELEMENTS,
  ICON_MANIFEST,
  ICON_ROOT_ATTRIBUTES,
  buildIconsModule,
  iconBody,
  licenseComment,
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

  it('carry the licence text of the icon set, in a comment the bundler keeps', () => {
    const text = source('./icons.generated.ts');
    // `/*!` marks a legal comment: minifiers leave it in the shipped script.
    const notice = /\/\*!([\s\S]*?)\*\//.exec(text)?.[1] ?? '';
    expect(notice).toMatch(/lucide-static \d+\.\d+\.\d+/);
    // Both licences ask for their copyright line and permission notice to
    // travel with every copy: the full text, not a pointer to node_modules.
    expect(notice).toContain('ISC License');
    expect(notice).toContain('Lucide Icons and Contributors');
    expect(notice).toContain('appear in all copies');
    expect(notice).toContain('The MIT License (MIT)');
    expect(notice).toContain('Cole Bemis');
    expect(notice).toContain('shall be included in all');
    // The notice comes before the drawings it covers.
    expect(text.indexOf('/*!')).toBeLessThan(text.indexOf('ICON_BODIES'));
  });

  it('keep a licence text from ending the comment it is quoted in', () => {
    expect(licenseComment('a */ b\n\nc')).toBe(' * a * / b\n *\n * c\n');
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
  /** The outer `<svg>` of a Lucide file, as the package ships it. */
  const ROOT =
    'class="lucide lucide-x" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const svg = (inner: string, root: string = ROOT): string =>
    `<!-- @license lucide-static v0.0.0 - ISC -->\n<svg ${root}>\n${inner}\n</svg>\n`;
  const shape = '<path d="M0 0" />';

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

  it('refuses a file that is more than the one svg Lucide ships', () => {
    // Nothing around the shapes is copied, so none of this could reach the
    // page; it fails all the same, as a file that is not what it should be.
    const good = svg(shape);
    expect(iconBody(good, 'ok')).toBe('<path d="M0 0"/>');
    // The comment is optional, and so are the attributes that draw nothing.
    expect(iconBody(good.replace(/<!--.*-->\n/, ''), 'ok')).toBe(
      '<path d="M0 0"/>',
    );
    expect(iconBody(svg(shape, ROOT.replace(/class="[^"]*" /, '')), 'ok')).toBe(
      '<path d="M0 0"/>',
    );

    const notOneSvg = /not an <svg> document/;
    const refused: [file: string, reason: RegExp][] = [
      [`<script>alert(1)</script>${good}`, notOneSvg],
      [`<?xml version="1.0"?>${good}`, notOneSvg],
      [`<!-- one --><!-- two -->${good}`, notOneSvg],
      [`text${good}`, notOneSvg],
      [`${good}<script>alert(1)</script>`, notOneSvg],
      [`${good}${good}`, /<svg> is not an allowed icon element/],
      [svg(shape, `${ROOT} onload='alert(1)'`), notOneSvg],
      [svg(shape, `${ROOT} hidden`), notOneSvg],
      [svg(shape, `${ROOT} onload="alert(1)"`), /attribute "onload" on <svg>/],
      [svg(shape, `${ROOT} style="display:none"`), /attribute "style" on/],
      [svg(shape, `${ROOT} data-x=">"`), /attribute "data-x" on <svg>/],
      [
        svg(shape, ROOT.replace('0 0 24 24', '0 0 48 48')),
        /<svg viewBox="0 0 48 48"> is not how the chrome draws an icon/,
      ],
      [
        svg(shape, ROOT.replace('fill="none"', 'fill="currentColor"')),
        /<svg fill="currentColor"> is not how/,
      ],
      [
        svg(shape, ROOT.replace('stroke-width="2"', 'stroke-width="1.5"')),
        /<svg stroke-width="1.5"> is not how/,
      ],
      [
        svg(shape, ROOT.replace('lucide lucide-x', 'lucide" onload="x')),
        /attribute "onload" on <svg>/,
      ],
      [svg(shape, ROOT.replace('lucide lucide-x', 'x y')), /<svg class="x y">/],
      [svg(shape, ROOT.replace(' viewBox="0 0 24 24"', '')), /no viewBox/],
      [svg(shape, ROOT.replace(' fill="none"', '')), /<svg> has no fill/],
      [
        svg(shape, ROOT.replace(' stroke-linecap="round"', '')),
        /<svg> has no stroke-linecap/,
      ],
    ];
    for (const [file, reason] of refused)
      expect(() => iconBody(file, 'bad'), file).toThrow(reason);
  });

  it('allows on the root the attributes Lucide writes, and no more', () => {
    // Every attribute of the allow-list is on a real file: a list that named
    // more would let more through. (That every drawing of the manifest
    // passes is the build itself, in "the generated drawings" above.)
    const lucide = source(
      `../../node_modules/lucide-static/icons/${ICON_MANIFEST.undo}.svg`,
    );
    const root = /<svg\b([^>]*)>/.exec(lucide)?.[1] ?? '';
    const names = [...root.matchAll(/([^\s=]+)="/g)].map((m) => m[1]);
    expect(names.sort()).toEqual([...ICON_ROOT_ATTRIBUTES.keys()].sort());
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

/** One string of a source file: a literal, or one part of a template. */
interface SourceString {
  text: string;
  /** A whole literal, as opposed to a part of a template with `${…}` in it. */
  whole: boolean;
}

/**
 * The strings of a TypeScript source: its string literals, the parts of its
 * templates and its regular expressions. A literal or template part is the
 * value it evaluates to, so a glyph written as a `\u` escape is the glyph
 * here. Comments are not strings: what one says about a glyph is not in the
 * result.
 */
function sourceStrings(code: string): SourceString[] {
  const strings: SourceString[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node))
      strings.push({ text: node.text, whole: true });
    else if (
      ts.isTemplateLiteralToken(node) ||
      ts.isRegularExpressionLiteral(node)
    )
      strings.push({ text: node.text, whole: false });
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('source.ts', code, ts.ScriptTarget.Latest));
  return strings;
}

/**
 * Characters above ASCII that the chrome writes as text: dashes, quotes, the
 * ellipsis, the dot and bullet between words, the times sign and the arrows
 * of a key legend. A letter of any script is text too (the command palette
 * folds `ß` and `æ` when it matches). Any other one is a glyph, and a glyph
 * in the chrome was an icon drawn by whatever fallback font the OS had.
 */
const TYPOGRAPHY = '—–…·•×“”’←↑→↓';

/** Markup's own escapes. Any other reference names a glyph (`&times;`). */
const ESCAPES: ReadonlySet<string> = new Set([
  '&amp;',
  '&lt;',
  '&gt;',
  '&quot;',
  '&#39;',
]);

/** A string as a failure shows it: whole when short, else around `at`. */
function excerpt(text: string, at: number): string {
  if (text.length <= 48) return text;
  return `…${text.slice(Math.max(0, at - 16), at + 16).replace(/\s+/g, ' ')}…`;
}

/**
 * Where a source draws an icon with a character instead of the set:
 *
 * - `glyphs`: every string with a character outside ASCII and `TYPOGRAPHY`,
 *   or with a character reference that is not one of markup's escapes;
 * - `symbols`: every label that is a symbol and no words, which is how a
 *   glyph icon stood in a button (`>×</button>`, `text: '…'`, a compass
 *   cell's `'↑'`): a markup text node with no letter or digit, or a whole
 *   literal that has a character above ASCII and no letter or digit. A
 *   symbol between two spaces (`' · '`) joins words and is not one.
 *
 * Each string is listed once per place it is written, in source order.
 */
function glyphIcons(code: string): { glyphs: string[]; symbols: string[] } {
  const glyphs: string[] = [];
  const symbols: string[] = [];
  const words = /[\p{L}\p{N}]/u;
  for (const { text, whole } of sourceStrings(code)) {
    const glyph =
      [...text.matchAll(/[^\0-\x7f]/gu)].find(
        (m) => !TYPOGRAPHY.includes(m[0]) && !/[\p{L}\p{M}]/u.test(m[0]),
      ) ??
      [...text.matchAll(/&#?[A-Za-z0-9]+;/g)].find((m) => !ESCAPES.has(m[0]));
    if (glyph) glyphs.push(excerpt(text, glyph.index));
    if (
      whole &&
      /[^\0-\x7f]/.test(text) &&
      !words.test(text) &&
      !/^\s+\S+\s+$/.test(text)
    )
      symbols.push(text);
    for (const node of text.matchAll(/>([^<>]+)</g)) {
      const label = (node[1] ?? '').trim();
      if (label && !words.test(label)) symbols.push(label);
    }
  }
  return { glyphs, symbols };
}

describe('the chrome sources', () => {
  /**
   * Strings with a glyph that stay, each one whole, once per place it is
   * written: the save chip's text, which the e2e suite reads as its "saved"
   * signal and which the next phase redesigns.
   */
  const KEPT_GLYPHS: Readonly<Record<string, string[]>> = {
    'main.ts': ['👁 shared copy', '✓ synced'],
    // Each warning with the shorter forms the chip shows in a short bar.
    'ui/save-status.ts': [
      '⚠ not saved — download JSON',
      '⚠ not saved',
      '⚠',
      '⚠ changed in another tab — load it',
      '⚠ newer copy',
      '⚠',
      '✓ saved · shared copy',
      '✓ saved',
    ],
    'ui/workspace-panel.ts': ['✓ synced'],
  };

  /** Labels that are a symbol and no words, and are text all the same. */
  const KEPT_SYMBOLS: Readonly<Record<string, string[]>> = {
    'main.ts': [
      '…', // the save chip while a change waits to be saved (kept, as above)
      '–', // the status bar's pointer position while there is none
    ],
    // The arrow keys as the shortcut sheet prints them, one each.
    'ui/commands.ts': ['←', '→', '↑', '↓'],
    // A warning's mark alone, where the top bar is shortest (kept, as above).
    'ui/save-status.ts': ['⚠', '⚠'],
  };

  it('finds a glyph in a string, and nothing in a comment', () => {
    expect(
      glyphIcons(
        "// ✕ closes it\nconst a = 'close'; /* ⚙ */\n" +
          'const b = `<b title="a — b">${a} · ${a}…</b>`;\n' +
          "const c = [a, 'x'].join(' · ') + '&amp;&lt;&gt;&quot;&#39;';",
      ),
    ).toEqual({ glyphs: [], symbols: [] });

    const found = (code: string): string[] => {
      const { glyphs, symbols } = glyphIcons(code);
      return [...glyphs.map((g) => `glyph ${g}`), ...symbols];
    };
    // A glyph anywhere in a string, written out, escaped or as a reference.
    expect(found('x = `${n} copied ✓`')).toEqual(['glyph  copied ✓']);
    expect(found("x = '\\u2716 exit'")).toEqual(['glyph ✖ exit']);
    expect(found("x = '<b>&times;</b>'")).toEqual(['glyph <b>&times;</b>']);
    expect(found("x = '<b>&#10003; done</b>'")).toEqual([
      'glyph <b>&#10003; done</b>',
    ]);
    expect(found('x = /^✓/')).toEqual(['glyph /^✓/']);
    // A long string is shown around its glyph.
    expect(found(`x = '${'a'.repeat(60)}☰${'b'.repeat(60)}'`)).toEqual([
      `glyph …${'a'.repeat(16)}☰${'b'.repeat(15)}…`,
    ]);
    // Typography alone as a label: in markup, or as the text handed to it.
    expect(found('x = `<button id="z">−</button>`')).toEqual([
      'glyph <button id="z">−</button>',
      '−',
    ]);
    expect(found('x = `<button>${i}</button><button>×</button>`')).toEqual([
      '×',
    ]);
    expect(found("x = { key: 'close', text: '×' }")).toEqual(['×']);
    expect(found("x = [['n', '↑'], ['', '·'], ['s', '↓']]")).toEqual([
      '↑',
      '·',
      '↓',
    ]);
    expect(found("revoke.textContent = '…'")).toEqual(['…']);
    // A letter is text in any script; a symbol that looks like one is not.
    expect(found("x = { ß: 'ss', ς: 'σ' }; y = /[æœø]/g; z = 'Zoë'")).toEqual(
      [],
    );
    expect(found("x = 'Ⓐ'")).toEqual(['glyph Ⓐ', 'Ⓐ']);
    // A character that is not a letter is a label of that kind in ASCII too.
    expect(found("x = '<button>+</button> <button>add</button>'")).toEqual([
      '+',
    ]);
  });

  it('draw icons from the set, not from glyphs', () => {
    const files = [
      'main.ts',
      'nodes/designer.ts',
      ...chromeUiFiles().map((file) => `ui/${file}`),
    ];
    const glyphs: Record<string, string[]> = {};
    const symbols: Record<string, string[]> = {};
    for (const file of files) {
      const found = glyphIcons(source(`../${file}`));
      if (found.glyphs.length) glyphs[file] = found.glyphs;
      if (found.symbols.length) symbols[file] = found.symbols;
    }
    // A new entry here is an icon drawn as a character: use icon(name).
    expect(glyphs).toEqual(KEPT_GLYPHS);
    expect(symbols).toEqual(KEPT_SYMBOLS);
  });
});
