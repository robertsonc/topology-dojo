import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PAGE_DURATION,
  flipbookSchedule,
  pageDuration,
} from './playback.js';
import { exportFlipbookHTML } from '../render/flipbook.js';
import { renderDocumentToSVG } from '../server/render.js';
import { createDocument } from '../api/builder.js';
import { validateDocument } from '../api/validate.js';
import { parseDoc, serializeDoc } from './persist.js';
import type { TopologyDocument } from './model.js';

function story(): TopologyDocument {
  const b = createDocument('Flow story');
  b.page({ name: 'Setup', duration: 800 }).node({
    id: 'a',
    type: 'ec',
    x: 200,
    y: 200,
    label: 'Branch',
  });
  b.page({ name: 'Steady', duration: 1500, transition: 'fade' }).node({
    id: 'a2',
    type: 'ec',
    x: 200,
    y: 200,
    label: 'Branch',
  });
  b.page({ name: 'Teardown' }).node({
    id: 'a3',
    type: 'ec',
    x: 200,
    y: 200,
    label: 'Branch',
  });
  return b.build();
}

describe('flipbook playback timing', () => {
  it('computes the schedule from page durations (default applies)', () => {
    const doc = story();
    expect(pageDuration(doc.pages[0]!)).toBe(800);
    expect(pageDuration(doc.pages[2]!)).toBe(DEFAULT_PAGE_DURATION);
    const s = flipbookSchedule(doc);
    expect(s.frames.map((f) => f.start)).toEqual([0, 800, 2300]);
    expect(s.total).toBe(800 + 1500 + DEFAULT_PAGE_DURATION);
    expect(s.frames[1]!.transition).toBe('fade');
    expect(s.frames[0]!.transition).toBe('cut');
  });

  it('round-trips duration/transition; drops malformed values on parse', () => {
    const doc = story();
    const back = parseDoc(serializeDoc(doc))!;
    expect(back.pages[0]!.duration).toBe(800);
    expect(back.pages[1]!.transition).toBe('fade');
    expect(back.pages[2]!.duration).toBeUndefined();

    const dirty = parseDoc(
      JSON.stringify({
        title: 'X',
        customNodes: [],
        pages: [
          { nodes: [], links: [], duration: -5, transition: 'wipe' },
          { nodes: [], links: [], duration: 1200, transition: 'fade' },
        ],
      }),
    )!;
    expect(dirty.pages[0]!.duration).toBeUndefined();
    expect(dirty.pages[0]!.transition).toBeUndefined();
    expect(dirty.pages[1]!.duration).toBe(1200);
  });

  it('validate warns on bad playback metadata', () => {
    const doc = story();
    (doc.pages[0] as { duration?: unknown }).duration = -10;
    (doc.pages[1] as { transition?: unknown }).transition = 'wipe';
    const problems = validateDocument(doc);
    expect(
      problems.some(
        (p) => p.level === 'warning' && /duration -10/.test(p.message),
      ),
    ).toBe(true);
    expect(
      problems.some(
        (p) => p.level === 'warning' && /transition "wipe"/.test(p.message),
      ),
    ).toBe(true);
  });
});

describe('export_flipbook HTML', () => {
  it('embeds every page SVG + the timing schedule, self-contained', () => {
    const doc = story();
    const html = exportFlipbookHTML(doc, (d, i) => renderDocumentToSVG(d, i));
    expect(html.startsWith('<!doctype html>')).toBe(true);
    // All three frames render inline, named.
    expect(html.match(/class="frame/g)?.length).toBe(3);
    expect(html).toContain('data-name="Setup"');
    expect(html).toContain('data-name="Teardown"');
    expect(html.match(/<svg /g)?.length).toBeGreaterThanOrEqual(3);
    // The schedule is embedded with the declared timings + transitions.
    expect(html).toContain('"duration":800');
    expect(html).toContain('"transition":"fade"');
    // No external assets — the artifact stands alone.
    expect(html).not.toContain('src="http');
    expect(html).not.toContain('href="http');
  });
});
