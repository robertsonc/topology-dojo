import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COMPACT_LAYOUT_MAX_PX,
  COMPACT_LAYOUT_MQ,
  PHONE_LAYOUT_MAX_PX,
  defaultPanelCollapsed,
  isCompactAbovePhone,
  isCompactLayoutWidth,
} from './compact-layout.js';

describe('isCompactLayoutWidth', () => {
  it('lays the panels out as drawers below 1,024px, phones included', () => {
    expect(COMPACT_LAYOUT_MAX_PX).toBe(1023);
    for (const width of [390, 640, 641, 720, 768, 900, 1023])
      expect(isCompactLayoutWidth(width), `${width}px`).toBe(true);
  });

  it('docks them from 1,024px up', () => {
    for (const width of [1024, 1280, 1920])
      expect(isCompactLayoutWidth(width), `${width}px`).toBe(false);
  });

  it('names the same width in its media query', () => {
    expect(COMPACT_LAYOUT_MQ).toBe('(max-width: 1023px)');
  });
});

describe('isCompactAbovePhone', () => {
  it('is the compact layout above a phone, 641 to 1,023px', () => {
    expect(PHONE_LAYOUT_MAX_PX).toBe(640);
    for (const width of [641, 720, 900, 1023])
      expect(isCompactAbovePhone(width), `${width}px`).toBe(true);
    for (const width of [360, 390, 640, 1024, 1280])
      expect(isCompactAbovePhone(width), `${width}px`).toBe(false);
  });
});

describe('defaultPanelCollapsed', () => {
  it('starts a drawer closed and a docked panel open when nothing is stored', () => {
    expect(defaultPanelCollapsed(null, true)).toBe(true);
    expect(defaultPanelCollapsed(null, false)).toBe(false);
  });

  it('honours a stored choice at every width', () => {
    for (const compact of [true, false]) {
      expect(defaultPanelCollapsed('0', compact)).toBe(false);
      expect(defaultPanelCollapsed('1', compact)).toBe(true);
    }
  });
});

/** The stylesheet, without its comments. */
const styles = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../styles',
);
const css = (file: string): string =>
  readFileSync(path.join(styles, file), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );

/** Each `@media` block of a stylesheet with a width in its query: the
 * query's `max-width` and `min-width` (null when it has none) and the body. */
function mediaBlocks(
  text: string,
): { max: number | null; min: number | null; body: string }[] {
  const out: { max: number | null; min: number | null; body: string }[] = [];
  for (const m of text.matchAll(/@media\s*([^{]*)\{/g)) {
    const query = m[1]!;
    const width = (name: string): number | null => {
      const w = new RegExp(`\\(${name}:\\s*(\\d+)px\\)`).exec(query);
      return w ? Number(w[1]) : null;
    };
    const max = width('max-width');
    const min = width('min-width');
    if (max === null && min === null) continue;
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (depth > 0 && i < text.length) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
      i++;
    }
    out.push({ max, min, body: text.slice(start, i - 1) });
  }
  return out;
}

/** Each `@media (max-width: Npx)` block, with no lower bound: its width and
 * body. */
function maxWidthBlocks(text: string): { width: number; body: string }[] {
  return mediaBlocks(text)
    .filter((b) => b.max !== null && b.min === null)
    .map((b) => ({ width: b.max!, body: b.body }));
}

/** The widths of the blocks that float `selector` as a drawer: a rule for
 * exactly that selector that positions it absolutely. */
function drawerWidths(file: string, selector: string): number[] {
  const rule = new RegExp(
    `(?:^|[},])\\s*${selector.replace(/[.>]/g, (c) => `\\${c}`)}\\s*\\{[^}]*position:\\s*absolute`,
  );
  return maxWidthBlocks(css(file))
    .filter((b) => rule.test(b.body))
    .map((b) => b.width);
}

describe('the drawers in the stylesheet', () => {
  it('float the node library at the same width the script uses', () => {
    expect(drawerWidths('shell.css', '.palette')).toEqual([
      COMPACT_LAYOUT_MAX_PX,
    ]);
  });

  it('float the properties panel at the same width the script uses', () => {
    expect(drawerWidths('inspector.css', '.inspector-wrap')).toEqual([
      COMPACT_LAYOUT_MAX_PX,
    ]);
  });

  it('take both panels out of their grid columns at that width', () => {
    const block = maxWidthBlocks(css('shell.css')).filter((b) =>
      /\.stage > \.palette,\s*\.stage > \.inspector-wrap\s*\{[^}]*grid-column:\s*1 \/ -1/.test(
        b.body,
      ),
    );
    expect(block.map((b) => b.width)).toEqual([COMPACT_LAYOUT_MAX_PX]);
  });
});

describe('every width the drawers depend on', () => {
  /** What the compact layout places: the drawers, the panel inside the
   * properties drawer, and the corner UI that moves beside it. */
  const drawerish =
    /(?:^|[\s,}>~])\.(?:palette|inspector-wrap|inspector-col|inspector|canvas-ctrls|minimap-dock)(?![\w-])/m;
  const blocks = ['shell.css', 'inspector.css'].flatMap((file) =>
    mediaBlocks(css(file))
      .filter((b) => drawerish.test(b.body))
      .map((b) => ({ ...b, file })),
  );

  it('is the compact breakpoint or the phone one, in an upper bound', () => {
    const allowed = [COMPACT_LAYOUT_MAX_PX, PHONE_LAYOUT_MAX_PX];
    for (const b of blocks.filter((b) => b.max !== null))
      expect(allowed, `${b.file} max-width ${b.max}`).toContain(b.max);
  });

  it('starts just above a phone, in a lower bound', () => {
    for (const b of blocks.filter((b) => b.min !== null))
      expect(b.min, `${b.file} min-width ${b.min}`).toBe(
        PHONE_LAYOUT_MAX_PX + 1,
      );
  });

  it('bounds the rules for the compact layout above a phone on both sides', () => {
    const between = (file: string) =>
      blocks.filter(
        (b) =>
          b.file === file &&
          b.min === PHONE_LAYOUT_MAX_PX + 1 &&
          b.max === COMPACT_LAYOUT_MAX_PX,
      );
    // The properties drawer leaves canvas between it and the library ...
    expect(
      between('inspector.css').some((b) =>
        /\.palette:not\(\.collapsed\) ~ \.inspector-wrap/.test(b.body),
      ),
    ).toBe(true);
    // ... and the zoom control and the minimap move left of it.
    expect(
      between('shell.css').some((b) =>
        /\.canvas-ctrls,\s*\.minimap-dock\s*\{[^}]*--insp-drawer-w/.test(
          b.body,
        ),
      ),
    ).toBe(true);
  });
});
