/**
 * Emphasis set as a whole (`setEmphasis`) and emphasis shown without being
 * stored (`previewEmphasis`) — what "Analyze path" uses to spotlight a route
 * before the user decides to keep it.
 *
 * Drawn by the real engine rather than the harness's stub, so a test can see
 * WHICH elements are spotlit, not only that something is.
 */
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Page } from '../pages/model.js';
import { ensureShim } from '../render/core.js';
import {
  blankPage,
  harness,
  installEditorGlobals,
  type Harness,
} from './test-harness.js';

beforeAll(() => {
  installEditorGlobals();
  ensureShim();
  const w = (globalThis as unknown as { window: Record<string, unknown> })
    .window;
  w.matchMedia = () => ({ matches: false });
  const require = createRequire(import.meta.url);
  const mod = require('../../public/vendor/topology-ds.js') as {
    default?: unknown;
  };
  w.TopologyDesigner = mod.default ?? mod;
});

/** Ids the art draws with the emphasis glow, in document order. */
function spotlit(h: Harness): string[] {
  return [
    ...h.art.innerHTML.matchAll(
      /<g filter="url\(#tds-emphasis\)" data-tds-(?:node|link)="([^"]+)"/g,
    ),
  ].map((m) => m[1]!);
}

function page(): Page {
  const p = blankPage();
  p.nodes.push(
    { id: 'a', type: 'router', x: 200, y: 300, label: 'A' },
    { id: 'b', type: 'router', x: 500, y: 300, label: 'B' },
    { id: 'c', type: 'router', x: 800, y: 300, label: 'C' },
  );
  p.links.push(
    { id: 'ab', type: 'line', from: 'a', to: 'b' },
    { id: 'bc', type: 'line', from: 'b', to: 'c' },
  );
  p.anchors.push({ id: 'k', x: 500, y: 500 });
  return p;
}

describe('previewEmphasis', () => {
  it('draws the frame as emphasized without changing the document', () => {
    const h = harness(page());
    const plain = h.art.innerHTML;
    const before = JSON.stringify(h.editor.page);

    expect(spotlit(h)).toEqual([]);

    h.editor.previewEmphasis(['a', 'ab', 'b']);
    expect(h.art.innerHTML).not.toBe(plain);
    expect(spotlit(h).sort()).toEqual(['a', 'ab', 'b']);
    expect(h.editor.emphasisPreviewIds()).toEqual(['a', 'ab', 'b']);

    // Nothing stored, nothing reported, nothing to undo.
    expect(JSON.stringify(h.editor.page)).toBe(before);
    expect(h.editor.page.emphasis).toBeUndefined();
    expect(h.changes.count).toBe(0);
    expect(h.editor.canUndo()).toBe(false);
    expect(h.editor.takePendingOperations()).toEqual([]);

    h.editor.previewEmphasis(null);
    expect(h.art.innerHTML).toBe(plain);
    expect(h.editor.emphasisPreviewIds()).toBeNull();
  });

  it('is drawn exactly as stored emphasis of the same ids would be', () => {
    const stored = page();
    stored.emphasis = ['a', 'ab', 'b'];
    const want = harness(stored).art.innerHTML;

    const h = harness(page());
    h.editor.previewEmphasis(['a', 'ab', 'b']);
    expect(h.art.innerHTML).toBe(want);
  });

  it("is drawn in place of the frame's own emphasis, which comes back", () => {
    const p = page();
    p.emphasis = ['c'];
    const h = harness(p);
    const own = h.art.innerHTML;
    expect(spotlit(h)).toEqual(['c']);

    h.editor.previewEmphasis(['a']);
    expect(spotlit(h)).toEqual(['a']);
    expect(h.editor.page.emphasis).toEqual(['c']);

    h.editor.previewEmphasis(null);
    expect(spotlit(h)).toEqual(['c']);
    expect(h.art.innerHTML).toBe(own);
  });

  it('survives an edit and a re-render while it is set', () => {
    const h = harness(page());
    h.editor.previewEmphasis(['a', 'ab', 'b']);
    const previewed = h.art.innerHTML;
    h.editor.rerender();
    expect(h.art.innerHTML).toBe(previewed);
    expect(h.editor.emphasisPreviewIds()).toEqual(['a', 'ab', 'b']);
  });

  it('drops ids that are not a node or a link of the page', () => {
    const h = harness(page());
    h.editor.previewEmphasis(['a', 'k', 'gone', 'ab']);
    expect(h.editor.emphasisPreviewIds()).toEqual(['a', 'ab']);
  });

  it('ends when another page is shown', () => {
    const h = harness(page());
    h.editor.previewEmphasis(['a']);
    h.editor.setPage(blankPage('p2'));
    expect(h.editor.emphasisPreviewIds()).toBeNull();
  });
});

describe('setEmphasis', () => {
  it('replaces the emphasis as one undo step', () => {
    const p = page();
    p.emphasis = ['c'];
    const h = harness(p);

    h.editor.setEmphasis(['a', 'ab', 'b']);
    expect(h.editor.page.emphasis).toEqual(['a', 'ab', 'b']);
    expect(spotlit(h).sort()).toEqual(['a', 'ab', 'b']);
    expect(h.changes.count).toBe(1);
    expect(h.editor.historyDepth()).toBe(1);

    h.editor.undo();
    expect(h.editor.page.emphasis).toEqual(['c']);
    h.editor.redo();
    expect(h.editor.page.emphasis).toEqual(['a', 'ab', 'b']);
  });

  it('leaves history alone when the frame already has that emphasis', () => {
    const p = page();
    p.emphasis = ['a', 'ab'];
    const h = harness(p);
    h.editor.setEmphasis(['a', 'ab']);
    expect(h.changes.count).toBe(0);
    expect(h.editor.canUndo()).toBe(false);
  });

  it('drops unknown ids, anchors and repeats', () => {
    const h = harness(page());
    h.editor.setEmphasis(['a', 'a', 'k', 'gone', 'bc']);
    expect(h.editor.page.emphasis).toEqual(['a', 'bc']);
  });

  it('clears the emphasis when given nothing to emphasize', () => {
    const p = page();
    p.emphasis = ['a'];
    const h = harness(p);
    h.editor.setEmphasis([]);
    // Not an empty list, which is stored and compared as a change for ever.
    expect(h.editor.page.emphasis).toBeUndefined();
    expect(h.editor.historyDepth()).toBe(1);
  });

  it('keeps showing a preview that was set before it', () => {
    const h = harness(page());
    h.editor.previewEmphasis(['c']);
    h.editor.setEmphasis(['a']);
    expect(h.editor.emphasisPreviewIds()).toEqual(['c']);
    expect(spotlit(h)).toEqual(['c']);
    expect(h.editor.page.emphasis).toEqual(['a']);
    h.editor.previewEmphasis(null);
    expect(spotlit(h)).toEqual(['a']);
  });
});
