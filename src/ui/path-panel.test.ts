import { describe, expect, it } from 'vitest';
import { analyzePath, type PathPage } from '../api/path.js';
import { pathPanelView } from './path-panel.js';

const node = (id: string, label?: string) => ({
  id,
  type: 'router',
  x: 0,
  y: 0,
  ...(label ? { label } : {}),
});
const link = (id: string, from: string, to: string, extra = {}) => ({
  id,
  type: 'line',
  from,
  to,
  ...extra,
});

/** A - B - D and A - C - D, plus a longer way round through E. */
const diamond: PathPage = {
  nodes: [
    node('a', 'Branch'),
    node('b', 'Edge 1'),
    node('c', 'Edge 2'),
    node('d', 'Hub'),
    node('e', 'Spare'),
  ],
  links: [
    link('ab', 'a', 'b'),
    link('bd', 'b', 'd'),
    link('ac', 'a', 'c'),
    link('cd', 'c', 'd'),
    link('be', 'b', 'e'),
    link('ed', 'e', 'd'),
  ],
} as PathPage;

describe('pathPanelView', () => {
  it('words the shortest route the way a new frame is captioned', () => {
    const view = pathPanelView(diamond, analyzePath(diamond, 'a', 'd'));
    expect(view.found).toBe(true);
    expect(view.title).toBe('Path: Branch -> Hub · 2 hops via Edge 1');
    expect(view.index).toBe(0);
    expect(view.count).toBe(3);
    expect(view.notes).toEqual([]);
    expect(view.route?.links).toEqual(['ab', 'bd']);
  });

  it('steps to an alternative and says how much longer it is', () => {
    const analysis = analyzePath(diamond, 'a', 'd');
    expect(pathPanelView(diamond, analysis, 1).title).toBe(
      'Path: Branch -> Hub · 2 hops via Edge 2',
    );
    const long = pathPanelView(diamond, analysis, 2);
    expect(long.title).toBe('Path: Branch -> Hub · 3 hops via Edge 1, Spare');
    expect(long.notes).toEqual(['1 hop longer than the shortest route.']);
  });

  it('clamps the route number to the routes there are', () => {
    const analysis = analyzePath(diamond, 'a', 'd');
    expect(pathPanelView(diamond, analysis, 99).index).toBe(2);
    expect(pathPanelView(diamond, analysis, -4).index).toBe(0);
    expect(pathPanelView(diamond, analysis, Number.NaN).index).toBe(0);
  });

  it('says when every route crosses something blocked or down', () => {
    const page = {
      nodes: [node('a', 'A'), node('b', 'B')],
      links: [link('ab', 'a', 'b', { type: 'blocked' })],
    } as PathPage;
    const view = pathPanelView(page, analyzePath(page, 'a', 'b'));
    expect(view.found).toBe(true);
    expect(view.notes[0]).toBe(
      'Every route crosses a blocked or down element.',
    );
  });

  it('says when the list of routes was cut short', () => {
    const analysis = analyzePath(diamond, 'a', 'd', { maxPaths: 1 });
    const view = pathPanelView(diamond, analysis);
    expect(view.count).toBe(1);
    expect(view.notes).toContain(
      'More routes exist; the 1 shortest are listed.',
    );
  });

  it('explains two ends that sit in separate groups', () => {
    const page = {
      nodes: [node('a', 'A'), node('b', 'B'), node('c', 'C'), node('d', 'D')],
      links: [link('ab', 'a', 'b'), link('cd', 'c', 'd')],
    } as PathPage;
    const view = pathPanelView(page, analyzePath(page, 'a', 'c'));
    expect(view.found).toBe(false);
    expect(view.route).toBeNull();
    expect(view.title).toBe('No drawn path joins A and C.');
    expect(view.notes).toEqual([
      'They sit in separate groups of linked elements: A reaches 1 other element, C reaches 1.',
    ]);
  });

  it('names an end that has no link at all', () => {
    const page = {
      nodes: [node('a', 'A'), node('b', 'B'), node('c', 'C')],
      links: [link('ab', 'a', 'b')],
    } as PathPage;
    const view = pathPanelView(page, analyzePath(page, 'a', 'c'));
    expect(view.notes).toEqual(['C has no usable link on this frame.']);
  });

  it('points at the hidden layer that would join the two ends', () => {
    const page = {
      nodes: [node('a', 'A'), node('b', 'B')],
      links: [link('ab', 'a', 'b', { layer: 'overlay' })],
    } as PathPage;
    const analysis = analyzePath(page, 'a', 'b', {
      layers: [{ id: 'overlay', defaultVisible: false }],
    });
    const view = pathPanelView(page, analysis);
    expect(view.title).toBe('No drawn path joins A and B.');
    expect(view.notes).toEqual([
      'They are joined only through a hidden layer: overlay. Show it to trace the path.',
    ]);
  });

  it('falls back to ids and keeps a long label on one short line', () => {
    const page = {
      nodes: [node('n1'), node('n2', `Core\n${'x'.repeat(60)}`)],
      links: [],
    } as PathPage;
    const view = pathPanelView(page, analyzePath(page, 'n1', 'n2'));
    expect(view.title.startsWith('No drawn path joins n1 and Core x')).toBe(
      true,
    );
    expect(view.title).not.toContain('\n');
    expect(view.title.length).toBeLessThan(80);
  });

  it('has nothing to trace when both ends are the same element', () => {
    const view = pathPanelView(diamond, analyzePath(diamond, 'a', 'a'));
    expect(view.found).toBe(false);
    expect(view.title).toBe('Branch is both ends: there is nothing to trace.');
  });
});
