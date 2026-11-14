/**
 * Double-clicking a label drawn for a link or a flow path edits that label.
 *
 * Labels are matched by their rendered `<text>` (the engine decides where
 * each one sits), so these tests give the fake art layer the boxes a real
 * render would have: a centre label nudged off the wire, a port label at
 * each end, and a flow path's label.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Page, TopologyDocument } from '../pages/model.js';
import { applyOperations, diffDocuments } from '../workspace/operations.js';
import {
  blankPage,
  fakeText,
  harness,
  installEditorGlobals,
  type Harness,
} from './test-harness.js';

beforeAll(installEditorGlobals);

function labelledPage(): Page {
  const page = blankPage();
  page.nodes.push(
    { id: 'a', type: 'ec', x: 100, y: 100, label: 'A' },
    { id: 'b', type: 'ec', x: 300, y: 100, label: 'B' },
  );
  page.links.push({
    id: 'ab',
    type: 'line',
    from: 'a',
    to: 'b',
    label: 'uplink',
    fromLabel: 'ge-0/0/1',
    toLabel: 'xe-1',
  });
  page.flowPaths.push({ id: 'f1', waypoints: ['a', 'b'], label: 'backup' });
  return page;
}

/** The label texts of link ab are drawn inside that link's group. */
const AB = { link: 'ab' };

/** Centre points of the label boxes below, each clear of nodes and the wire. */
const CENTRE = { x: 200, y: 126 };
const FROM = { x: 147, y: 65 };
const TO = { x: 252, y: 65 };
const FLOW = { x: 430, y: 306 };

function labelled(): Harness {
  const h = harness(labelledPage());
  h.art.texts = [
    fakeText('uplink', { x: 180, y: 120, width: 40, height: 12 }, AB),
    fakeText('ge-0/0/1', { x: 125, y: 60, width: 44, height: 10 }, AB),
    fakeText('xe-1', { x: 240, y: 60, width: 24, height: 10 }, AB),
    fakeText(
      'backup',
      { x: 400, y: 300, width: 60, height: 12 },
      { flow: 'f1' },
    ),
    // The node captions are rendered text too; they must not confuse it.
    fakeText('A', { x: 97, y: 114, width: 6, height: 12 }),
  ];
  return h;
}

describe('double-click on a link label (LNK-07)', () => {
  it('the centre label opens the link label editor, anchored on the label', () => {
    const h = labelled();
    expect(h.editor.requestInlineEditAt(CENTRE.x, CENTRE.y)).toBe('link');
    expect(h.requests).toEqual([
      {
        kind: 'link',
        id: 'ab',
        current: 'uplink',
        clientX: 200,
        clientY: 126,
        pageX: CENTRE.x,
        pageY: CENTRE.y,
      },
    ]);
    expect(h.editor.getSelectedLink()?.id).toBe('ab');
  });

  it('a label dragged away from its wire is still the link’s label', () => {
    const h = labelled();
    h.editor.page.links[0]!.labelOffset = { x: 60, y: 140 };
    h.art.texts[0] = fakeText(
      'uplink',
      { x: 240, y: 260, width: 40, height: 12 },
      AB,
    );
    expect(h.editor.requestInlineEditAt(260, 266)).toBe('link');
    expect(h.requests[0]).toMatchObject({ kind: 'link', id: 'ab' });
  });

  it('a port label opens an editor for that end, never the add-node picker', () => {
    const h = labelled();
    expect(h.editor.requestInlineEditAt(FROM.x, FROM.y)).toBe('link-from');
    expect(h.editor.requestInlineEditAt(TO.x, TO.y)).toBe('link-to');
    expect(h.requests.map((r) => [r.kind, r.id, r.current])).toEqual([
      ['link-from', 'ab', 'ge-0/0/1'],
      ['link-to', 'ab', 'xe-1'],
    ]);
    // The owner is selected, so the inspector shows the link being edited.
    expect(h.editor.getSelectedLink()?.id).toBe('ab');
  });

  it('a flow path label opens an editor for the flow', () => {
    const h = labelled();
    expect(h.editor.requestInlineEditAt(FLOW.x, FLOW.y)).toBe('flow');
    expect(h.requests).toMatchObject([
      { kind: 'flow', id: 'f1', current: 'backup', clientX: 430, clientY: 306 },
    ]);
  });

  it('two clicks on a label are a double-click, not a label drag', () => {
    for (const [at, kind] of [
      [CENTRE, 'link'],
      [FROM, 'link-from'],
      [FLOW, 'flow'],
    ] as const) {
      const h = labelled();
      h.click(at.x, at.y);
      h.click(at.x, at.y);
      expect(h.requests.map((r) => r.kind)).toEqual([kind]);
      expect(h.editor.canUndo()).toBe(false);
    }
  });

  it('a node caption that reads like a link label is still the node’s', () => {
    // Node a is called "uplink" too, and the link's own label has been
    // dragged far away: the caption is the "uplink" text nearest the link.
    const h = labelled();
    h.editor.page.nodes[0]!.label = 'uplink';
    h.editor.page.links[0]!.labelOffset = { x: 200, y: 300 };
    h.art.texts = [
      fakeText('uplink', { x: 380, y: 420, width: 40, height: 12 }, AB),
      fakeText('uplink', { x: 82, y: 114, width: 36, height: 12 }), // caption
    ];
    expect(h.editor.requestInlineEditAt(100, 120)).toBe('node');
    expect(h.requests[0]).toMatchObject({ kind: 'node', id: 'a' });
    // And a press on the caption drags the node, not the link's label.
    h.drag({ x: 100, y: 120 }, { x: 100, y: 220 });
    expect(h.editor.page.nodes[0]).toMatchObject({ x: 100, y: 200 });
    expect(h.editor.page.links[0]!.labelOffset).toEqual({ x: 200, y: 300 });
  });

  it('two links with the same label text: each label is its own link’s', () => {
    const h = labelled();
    h.editor.page.nodes.push({
      id: 'c',
      type: 'ec',
      x: 300,
      y: 400,
      label: 'C',
    });
    h.editor.page.links.push({
      id: 'bc',
      type: 'line',
      from: 'b',
      to: 'c',
      label: 'uplink',
    });
    // bc's label has been dragged to sit right next to ab's middle; ab's
    // own label was dragged away.
    h.art.texts = [
      fakeText('uplink', { x: 600, y: 500, width: 40, height: 12 }, AB),
      fakeText(
        'uplink',
        { x: 180, y: 130, width: 40, height: 12 },
        { link: 'bc' },
      ),
    ];
    expect(h.editor.requestInlineEditAt(200, 136)).toBe('link');
    expect(h.requests[0]).toMatchObject({ kind: 'link', id: 'bc' });
    expect(h.editor.requestInlineEditAt(620, 506)).toBe('link');
    expect(h.requests[1]).toMatchObject({ kind: 'link', id: 'ab' });
  });

  it('empty canvas still asks for the add-node picker', () => {
    const h = labelled();
    expect(h.editor.requestInlineEditAt(700, 500)).toBe('empty');
  });
});

describe('renameElement commits what the label editor edited', () => {
  it('sets a port label by link id, as one undo step', () => {
    const h = labelled();
    expect(h.editor.renameElement('link-from', 'ab', 'et-0/0/0')).toBe(true);
    expect(h.editor.renameElement('link-to', 'ab', 'et-0/0/1')).toBe(true);
    expect(h.editor.page.links[0]).toMatchObject({
      label: 'uplink',
      fromLabel: 'et-0/0/0',
      toLabel: 'et-0/0/1',
    });
    h.editor.undo();
    expect(h.editor.page.links[0]!.toLabel).toBe('xe-1');
    h.editor.undo();
    expect(h.editor.page.links[0]!.fromLabel).toBe('ge-0/0/1');
  });

  it('clearing a port label removes the field', () => {
    const h = labelled();
    h.editor.renameElement('link-from', 'ab', '');
    expect('fromLabel' in h.editor.page.links[0]!).toBe(false);
  });

  it('sets a flow path label', () => {
    const h = labelled();
    expect(h.editor.renameElement('flow', 'f1', 'primary')).toBe(true);
    expect(h.editor.page.flowPaths[0]!.label).toBe('primary');
    expect(h.editor.renameElement('flow', 'gone', 'x')).toBe(false);
  });

  it('emits operations that reproduce the snapshot diff', () => {
    const wrap = (page: Page): TopologyDocument => ({
      title: 'T',
      customNodes: [],
      pages: [structuredClone(page)],
    });
    for (const run of [
      (h: Harness) => h.editor.renameElement('link-from', 'ab', 'et-0/0/0'),
      (h: Harness) => h.editor.renameElement('link-to', 'ab', ''),
      (h: Harness) => h.editor.renameElement('flow', 'f1', 'primary'),
    ]) {
      const h = labelled();
      h.editor.takePendingOperations();
      const before = wrap(h.editor.page);
      run(h);
      const after = wrap(h.editor.page);
      const emitted = h.editor.takePendingOperations();
      expect(emitted.length).toBeGreaterThan(0);
      expect(applyOperations(before, emitted)).toEqual(
        applyOperations(before, diffDocuments(before, after)),
      );
    }
  });
});
