/**
 * Build the editor chrome's icon set (`src/ui/icons.generated.ts`).
 *
 *   npm run build:icons              write the generated module
 *   npm run build:icons -- --check   exit 1 if the committed file is stale
 *
 * Every icon in the chrome (toolbar, canvas controls, panel toggles, inspector
 * buttons, dialogs) is drawn from one set, so it looks the same on every OS
 * instead of depending on whichever fallback font has the glyph. This reads
 * the manifest below (the app's icon name -> the Lucide drawing it uses),
 * takes each drawing's inner markup from the pinned `lucide-static` package
 * and writes it as strings; `src/ui/icons.ts` turns those into one inline
 * `<symbol>` sprite and `<use>` references. `src/ui/icons.test.ts` runs the
 * same build in memory, so a stale generated file fails the unit suite.
 *
 * Only the shapes are copied: the outer `<svg>` and its presentation
 * attributes are dropped (the chrome styles stroke and size itself), and the
 * markup is checked against a short allow-list of elements and geometry
 * attributes, so nothing scriptable can reach the page through an icon. The
 * rest of the file is checked as well, though none of it is copied: it must
 * be one `<svg>` with the attributes Lucide ships, after at most a comment,
 * so a file that is not the drawing it should be fails the build instead of
 * having the odd part dropped in silence.
 *
 * Lucide is licensed under the ISC License (Copyright (c) Lucide Icons and
 * Contributors); the icons it derives from Feather are under the MIT License
 * (Copyright (c) 2013-present Cole Bemis). Both licences ask that their
 * notice travels with every copy, so the generated module carries the
 * package's LICENSE file verbatim, in a `/*!` comment that the bundler keeps
 * in the shipped script.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const lucide = path.join(root, 'node_modules/lucide-static');
const OUT = 'src/ui/icons.generated.ts';

/**
 * The app's icon name -> the Lucide file (`icons/<name>.svg`) that draws it.
 *
 * Names say what the icon means in this app where it stands for one command
 * or state (`undo`, `tidy`, `warning`), and are Lucide's own where the shape
 * is used for several things (`x`, `plus`, the arrows and chevrons). A name
 * becomes the symbol id `i-<name>`, so it must not repeat an element id the
 * shell already uses (`i-swap`, `i-path`, `i-type`, …); the unit test checks.
 */
export const ICON_MANIFEST = {
  // History
  undo: 'undo-2',
  redo: 'redo-2',
  // Tools
  'tool-select': 'mouse-pointer-2',
  'tool-link': 'cable',
  anchor: 'anchor',
  hand: 'hand',
  // Canvas view
  grid: 'grid-3x3',
  snap: 'magnet',
  calm: 'circle-pause',
  badges: 'badge-alert',
  settings: 'settings',
  sun: 'sun',
  moon: 'moon',
  'fit-view': 'maximize',
  'zoom-in': 'zoom-in',
  'zoom-out': 'zoom-out',
  present: 'presentation',
  shortcuts: 'keyboard',
  // Arrange
  delete: 'trash-2',
  tidy: 'sparkles',
  balance: 'scale',
  'align-left': 'align-start-vertical',
  'align-center': 'align-center-vertical',
  'align-right': 'align-end-vertical',
  'align-top': 'align-start-horizontal',
  'align-middle': 'align-center-horizontal',
  'align-bottom': 'align-end-horizontal',
  'distribute-h': 'align-horizontal-distribute-center',
  'distribute-v': 'align-vertical-distribute-center',
  'send-to-back': 'arrow-down-to-line',
  'bring-to-front': 'arrow-up-to-line',
  // Arrows: label placement, stacking one step, reordering
  'arrow-up-left': 'arrow-up-left',
  'arrow-up': 'arrow-up',
  'arrow-up-right': 'arrow-up-right',
  'arrow-left': 'arrow-left',
  dot: 'dot',
  'arrow-right': 'arrow-right',
  'arrow-down-left': 'arrow-down-left',
  'arrow-down': 'arrow-down',
  'arrow-down-right': 'arrow-down-right',
  // Carets and panel toggles
  'chevron-down': 'chevron-down',
  'chevron-left': 'chevron-left',
  'chevron-right': 'chevron-right',
  'panel-left-close': 'panel-left-close',
  'panel-left-open': 'panel-left-open',
  'panel-right-close': 'panel-right-close',
  'panel-right-open': 'panel-right-open',
  // Shapes used for several things
  x: 'x',
  plus: 'plus',
  check: 'check',
  eye: 'eye',
  'eye-off': 'eye-off',
  star: 'star',
  pencil: 'pencil',
  play: 'play',
  pause: 'pause',
  slash: 'slash',
  // Inspector and annotations
  account: 'circle-user',
  motion: 'activity',
  nested: 'corner-down-right',
  'fit-page': 'scaling',
  reverse: 'arrow-left-right',
  route: 'route',
  flow: 'waypoints',
  'copy-format': 'pipette',
  'paste-format': 'paintbrush',
  'select-members': 'lasso-select',
  duplicate: 'copy-plus',
  // The properties panel's selection header: what is selected, and its actions
  node: 'server',
  zone: 'square-dashed',
  nodes: 'boxes',
  lock: 'lock',
  unlock: 'lock-open',
  more: 'ellipsis',
  // Frames, presentation, sharing
  restore: 'archive-restore',
  'frame-prev': 'skip-back',
  'frame-next': 'skip-forward',
  publish: 'share',
  checkpoint: 'flag',
  // States
  warning: 'triangle-alert',
  busy: 'loader-circle',
  question: 'circle-help',
  observed: 'circle-dot',
  confirmed: 'circle-check',
  rejected: 'circle-x',
  stale: 'circle-dashed',
} as const satisfies Record<string, string>;

/** Shape elements an icon may contain. */
export const ICON_ELEMENTS: ReadonlySet<string> = new Set([
  'path',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'rect',
  'g',
]);

/** Geometry attributes an icon's elements may carry. */
export const ICON_ATTRIBUTES: ReadonlySet<string> = new Set([
  'd',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'width',
  'height',
  'points',
]);

/**
 * What the outer `<svg>` of a Lucide file may carry, and the value each
 * attribute must have. None of it is copied. The chrome draws every icon on
 * this grid with this stroke (`src/styles/icons.css` states the same), so a
 * file that says otherwise would be drawn wrong; and an attribute that is
 * not here is not Lucide's.
 */
export const ICON_ROOT_ATTRIBUTES: ReadonlyMap<string, RegExp> = new Map([
  ['class', /^lucide(?: lucide-[a-z0-9-]+)*$/],
  ['xmlns', /^http:\/\/www\.w3\.org\/2000\/svg$/],
  ['width', /^24$/],
  ['height', /^24$/],
  ['viewBox', /^0 0 24 24$/],
  ['fill', /^none$/],
  ['stroke', /^currentColor$/],
  ['stroke-width', /^2$/],
  ['stroke-linecap', /^round$/],
  ['stroke-linejoin', /^round$/],
]);

/** The root attributes that say how to draw the shapes: all must be there. */
const ICON_ROOT_REQUIRED: readonly string[] = [
  'viewBox',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
];

/** Numbers and path commands only: no quotes, brackets, urls or entities. */
const GEOMETRY_VALUE = /^[0-9A-Za-z .,+-]+$/;
const ICON_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const TAG =
  /^<(\/?)([A-Za-z][A-Za-z0-9:-]*)((?:\s+[^\s"'<>/=]+="[^"]*")*)\s*(\/?)>/;
const ATTRIBUTE = /([^\s"'<>/=]+)="([^"]*)"/g;
/** What may come before the `<svg>`: one comment (Lucide's licence line). */
const PROLOGUE = /^\s*(?:<!--(?:(?!-->)[\s\S])*-->\s*)?/;
/** The outer tag, its attributes written as `TAG` requires of any tag. */
const ROOT_OPEN = /^<svg((?:\s+[^\s"'<>/=]+="[^"]*")*)\s*>/;
const ROOT_CLOSE = /<\/svg>\s*$/;

/**
 * The inner markup of one Lucide SVG file, once the file around it has been
 * checked: one `<svg>` and nothing else but a leading comment, carrying only
 * the root attributes above with the values the chrome draws by.
 */
function iconDocumentBody(svg: string, label: string): string {
  const start = PROLOGUE.exec(svg)?.[0].length ?? 0;
  const open = ROOT_OPEN.exec(svg.slice(start));
  const close = ROOT_CLOSE.exec(svg);
  if (!open || !close || close.index < start + open[0].length)
    throw new Error(
      `${label}: not an <svg> document (one <svg> with double-quoted attributes, after at most one comment)`,
    );
  const seen = new Set<string>();
  for (const match of (open[1] ?? '').matchAll(ATTRIBUTE)) {
    const attr = match[1] ?? '';
    const value = match[2] ?? '';
    const expected = ICON_ROOT_ATTRIBUTES.get(attr);
    if (!expected)
      throw new Error(`${label}: attribute "${attr}" on <svg> is not allowed`);
    if (!expected.test(value))
      throw new Error(
        `${label}: <svg ${attr}="${value}"> is not how the chrome draws an icon`,
      );
    seen.add(attr);
  }
  for (const attr of ICON_ROOT_REQUIRED)
    if (!seen.has(attr)) throw new Error(`${label}: <svg> has no ${attr}`);
  return svg.slice(start + open[0].length, close.index);
}

/**
 * The shapes of one Lucide SVG file as compact markup, without the outer
 * `<svg>`. Throws on anything outside the allow-lists above, in the shapes
 * or around them (`label` names the icon in the message).
 */
export function iconBody(svg: string, label: string): string {
  let rest = iconDocumentBody(svg, label).trim();
  let out = '';
  const open: string[] = [];
  while (rest) {
    const tag = TAG.exec(rest);
    if (!tag)
      throw new Error(`${label}: unexpected markup at "${rest.slice(0, 40)}"`);
    const whole = tag[0];
    const closing = tag[1] ?? '';
    const name = tag[2] ?? '';
    const attrs = tag[3] ?? '';
    const selfClosing = tag[4] ?? '';
    rest = rest.slice(whole.length).trimStart();
    if (!ICON_ELEMENTS.has(name))
      throw new Error(`${label}: <${name}> is not an allowed icon element`);
    if (closing) {
      if (attrs || selfClosing || open.pop() !== name)
        throw new Error(`${label}: unbalanced </${name}>`);
      out += `</${name}>`;
      continue;
    }
    let attrOut = '';
    for (const match of attrs.matchAll(ATTRIBUTE)) {
      const attr = match[1] ?? '';
      const value = match[2] ?? '';
      if (!ICON_ATTRIBUTES.has(attr))
        throw new Error(
          `${label}: attribute "${attr}" on <${name}> is not allowed`,
        );
      if (!GEOMETRY_VALUE.test(value))
        throw new Error(`${label}: ${attr}="${value}" is not plain geometry`);
      attrOut += ` ${attr}="${value}"`;
    }
    if (selfClosing) out += `<${name}${attrOut}/>`;
    else if (name === 'g') {
      open.push(name);
      out += `<g${attrOut}>`;
    } else throw new Error(`${label}: <${name}> must be self-closing`);
  }
  if (open.length) throw new Error(`${label}: unclosed <${open.at(-1)}>`);
  if (!out) throw new Error(`${label}: the icon is empty`);
  return out;
}

function readLucideIcon(lucideName: string): string {
  return readFileSync(path.join(lucide, 'icons', `${lucideName}.svg`), 'utf8');
}

/** The package's LICENSE file, as shipped. */
function lucideLicense(): string {
  return readFileSync(path.join(lucide, 'LICENSE'), 'utf8');
}

function lucideVersion(): string {
  const pkg = JSON.parse(
    readFileSync(path.join(lucide, 'package.json'), 'utf8'),
  ) as { version: string };
  return pkg.version;
}

/**
 * The text of the generated module, formatted with the repository's Prettier
 * config so the committed file passes `prettier --check` as written. `read`
 * returns a Lucide SVG file by name, `version` is the package version and
 * `license` its LICENSE text; all default to the installed `lucide-static`.
 */
export async function buildIconsModule(
  manifest: Readonly<Record<string, string>> = ICON_MANIFEST,
  read: (lucideName: string) => string = readLucideIcon,
  version: string = lucideVersion(),
  license: string = lucideLicense(),
): Promise<string> {
  const entries = Object.entries(manifest).map(([name, lucideName]) => {
    if (!ICON_NAME.test(name))
      throw new Error(`icon name "${name}" must be lower-case kebab-case`);
    const body = iconBody(read(lucideName), `${name} (${lucideName})`);
    return `  '${name}': '${body}',`;
  });
  const raw =
    `// GENERATED by scripts/build-icons.ts — do not edit. To change an icon,\n` +
    `// edit the manifest in that script and run \`npm run build:icons\`.\n` +
    `\n` +
    `/*!\n` +
    ` * The icon drawings in this module are from Lucide (lucide-static ${version}).\n` +
    ` * Their licence, reproduced from that package as it asks:\n` +
    ` *\n` +
    licenseComment(license) +
    ` */\n` +
    `\n` +
    `/** Each chrome icon's shapes, on a 24 x 24 grid, drawn by stroke. */\n` +
    `export const ICON_BODIES = {\n` +
    entries.join('\n') +
    `\n} as const;\n`;
  const target = path.join(root, OUT);
  const config = (await prettier.resolveConfig(target)) ?? {};
  return prettier.format(raw, { ...config, filepath: target });
}

/** A licence text as the body lines of a block comment. */
export function licenseComment(text: string): string {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      // Nothing in the text may end the comment it sits in.
      const safe = line.replace(/\*\//g, '* /').trimEnd();
      return safe ? ` * ${safe}\n` : ` *\n`;
    })
    .join('');
}

async function main(): Promise<number> {
  const next = await buildIconsModule();
  const out = path.join(root, OUT);
  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(out, 'utf8');
    } catch {
      // A missing file is as stale as a different one.
    }
    if (current !== next) {
      console.error(`${OUT} is stale — run npm run build:icons`);
      return 1;
    }
    return 0;
  }
  writeFileSync(out, next);
  console.log(`wrote ${OUT} (${Object.keys(ICON_MANIFEST).length} icons)`);
  return 0;
}

// Run only as a script: the unit test imports the functions above.
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = await main();
