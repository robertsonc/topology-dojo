import { describe, it, expect } from 'vitest';
import {
  createDocument,
  addNode,
  defineNodeType,
  emptyDocument,
  addPage,
} from './builder.js';
import { validateDocument, isValid } from './validate.js';
import { defaultSpec } from '../nodes/spec.js';

describe('builder', () => {
  it('constructs a document fluently', () => {
    const doc = createDocument('Net')
      .page({ name: 'F1' })
      .node({ id: 'a', type: 'ec', x: 100, y: 100, label: 'A' })
      .node({ id: 'b', type: 'firewall', x: 300, y: 100 })
      .link({ id: 'l', type: 'line', from: 'a', to: 'b' })
      .build();
    expect(doc.title).toBe('Net');
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0]!.nodes).toHaveLength(2);
    expect(doc.pages[0]!.links[0]!.from).toBe('a');
  });

  it('auto-generates unique ids when omitted', () => {
    const doc = emptyDocument();
    const page = addPage(doc);
    const n1 = addNode(page, { type: 'host', x: 0, y: 0 });
    const n2 = addNode(page, { type: 'host', x: 1, y: 1 });
    expect(n1.id).not.toBe(n2.id);
  });

  it('defineNodeType replaces by typeName', () => {
    const doc = emptyDocument();
    defineNodeType(doc, { ...defaultSpec(), typeName: 'x', size: 20 });
    defineNodeType(doc, { ...defaultSpec(), typeName: 'x', size: 40 });
    expect(doc.customNodes).toHaveLength(1);
    expect(doc.customNodes[0]!.size).toBe(40);
  });

  it('builds the annotation layer fluently with generated ids', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 0, y: 0 })
      .node({ id: 'b', type: 'cloud', x: 1, y: 1 })
      .zone({ label: 'LAN', nodes: ['a', 'b'] })
      .flowPath({ waypoints: ['a', 'b'] })
      .policyMarker({ nodeId: 'a', type: 'inspect' })
      .build();
    const page = doc.pages[0]!;
    expect(page.zones).toHaveLength(1);
    expect(page.zones[0]!.id).toMatch(/^z/);
    // zone() defaults a missing member list to [].
    expect(page.flowPaths[0]!.waypoints).toEqual(['a', 'b']);
    expect(page.policyMarkers[0]!.nodeId).toBe('a');
  });
});

describe('validateDocument', () => {
  it('passes a well-formed document', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 0, y: 0 })
      .node({ id: 'b', type: 'cloud', x: 1, y: 1 })
      .link({ id: 'l', type: 'tunnel', from: 'a', to: 'b' })
      .build();
    expect(validateDocument(doc)).toEqual([]);
    expect(isValid(doc)).toBe(true);
  });

  it('flags dangling link endpoints', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 0, y: 0 })
      .link({ id: 'l', type: 'line', from: 'a', to: 'ghost' })
      .build();
    const probs = validateDocument(doc);
    expect(
      probs.some((p) => p.level === 'error' && /ghost/.test(p.message)),
    ).toBe(true);
    expect(isValid(doc)).toBe(false);
  });

  it('flags duplicate ids and unknown node types', () => {
    const doc = emptyDocument();
    const page = addPage(doc);
    addNode(page, { id: 'dup', type: 'ec', x: 0, y: 0 });
    addNode(page, { id: 'dup', type: 'bogus', x: 1, y: 1 });
    const probs = validateDocument(doc);
    expect(probs.some((p) => /duplicate node id/.test(p.message))).toBe(true);
    expect(probs.some((p) => /unknown node type "bogus"/.test(p.message))).toBe(
      true,
    );
  });

  it('recognizes custom node types as valid', () => {
    const doc = createDocument()
      .defineNodeType({ ...defaultSpec(), typeName: 'sensor' })
      .page()
      .node({ id: 'n', type: 'sensor', x: 0, y: 0 })
      .build();
    expect(isValid(doc)).toBe(true);
  });

  it('warns (not errors) on unknown link type', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 0, y: 0 })
      .node({ id: 'b', type: 'ec', x: 1, y: 1 })
      .link({ id: 'l', type: 'weird', from: 'a', to: 'b' })
      .build();
    const probs = validateDocument(doc);
    expect(probs.every((p) => p.level === 'warning')).toBe(true);
    expect(isValid(doc)).toBe(true);
  });

  it('passes a document with a well-formed annotation layer', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 0, y: 0 })
      .node({ id: 'b', type: 'cloud', x: 1, y: 1 })
      .zone({ id: 'z', label: 'LAN', nodes: ['a', 'b'] })
      .flowPath({ id: 'f', waypoints: ['a', 'b'] })
      .policyMarker({ id: 'm', nodeId: 'a', type: 'inspect' })
      .build();
    expect(validateDocument(doc)).toEqual([]);
  });

  it('warns on stacked and orphan anchors (anchor lint)', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'n', type: 'ec', x: 280, y: 240 })
      .anchor(280, 140, 'a-used')
      .anchor(280, 140, 'a-stacked')
      .anchor(900, 900, 'a-orphan')
      .link({ id: 'l', type: 'line', from: 'a-used', to: 'n' })
      .build();
    const probs = validateDocument(doc);
    // a-stacked sits on a-used → stacked warning.
    expect(
      probs.some((p) => p.level === 'warning' && /stacked/.test(p.message)),
    ).toBe(true);
    // a-stacked and a-orphan are referenced by no link → orphan warnings.
    expect(
      probs.filter((p) => /orphan anchor/.test(p.message)).length,
    ).toBeGreaterThanOrEqual(2);
    // a-used is referenced, so it is not flagged orphan.
    expect(probs.some((p) => /a-used.*orphan/.test(p.message))).toBe(false);
    // All anchor lint is advisory — it never blocks rendering.
    expect(isValid(doc)).toBe(true);
  });

  it('does not flag an anchor used only by a flow path as orphan', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'n', type: 'ec', x: 0, y: 0 })
      .anchor(100, 100, 'wp')
      .flowPath({ id: 'f', waypoints: ['n', 'wp'] })
      .build();
    const probs = validateDocument(doc);
    expect(probs.some((p) => /orphan anchor/.test(p.message))).toBe(false);
  });

  it('warns on an unconnected node when the frame has links (C.1)', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 0, y: 0 })
      .node({ id: 'b', type: 'ec', x: 200, y: 0 })
      .node({ id: 'lonely', type: 'ec', x: 400, y: 0 })
      .link({ id: 'l', type: 'line', from: 'a', to: 'b' })
      .build();
    const probs = validateDocument(doc);
    expect(
      probs.some(
        (p) =>
          p.level === 'warning' &&
          /unconnected node.*"lonely"|"lonely".*unconnected/.test(
            `${p.where} ${p.message}`,
          ),
      ),
    ).toBe(true);
    // The connected nodes are not flagged.
    expect(
      probs.some((p) =>
        /"a".*unconnected|unconnected.*"a"/.test(`${p.where} ${p.message}`),
      ),
    ).toBe(false);
    expect(isValid(doc)).toBe(true); // advisory only
  });

  it('does not flag unconnected nodes on a link-less inventory frame', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 0, y: 0 })
      .node({ id: 'b', type: 'ec', x: 200, y: 0 })
      .build();
    expect(
      validateDocument(doc).some((p) => /unconnected node/.test(p.message)),
    ).toBe(false);
  });

  it('errors when a policy marker targets a missing node', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 0, y: 0 })
      .policyMarker({ id: 'm', nodeId: 'ghost', type: 'deny' })
      .build();
    const probs = validateDocument(doc);
    expect(
      probs.some((p) => p.level === 'error' && /ghost/.test(p.message)),
    ).toBe(true);
  });

  it('warns on zone members / flow waypoints that do not exist', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 0, y: 0 })
      .zone({ id: 'z', nodes: ['a', 'nope'] })
      .flowPath({ id: 'f', waypoints: ['a', 'gone'] })
      .build();
    const probs = validateDocument(doc);
    expect(probs.some((p) => /missing node "nope"/.test(p.message))).toBe(true);
    expect(probs.some((p) => /missing "gone"/.test(p.message))).toBe(true);
    // Both are warnings — a dangling annotation ref shouldn't block rendering.
    expect(isValid(doc)).toBe(true);
  });

  it('carries node metadata and validates a well-formed map', () => {
    const doc = createDocument()
      .page()
      .node({
        id: 'a',
        type: 'ec',
        x: 0,
        y: 0,
        meta: { serial: 'SN-001', version: '2.3.1', haActive: true, ports: 48 },
      })
      .build();
    expect(validateDocument(doc)).toEqual([]);
    expect(doc.pages[0]!.nodes[0]!.meta).toMatchObject({ serial: 'SN-001' });
  });

  it('flags malformed node metadata', () => {
    const doc = emptyDocument();
    const page = addPage(doc);
    addNode(page, { id: 'a', type: 'ec', x: 0, y: 0, meta: 'nope' });
    addNode(page, {
      id: 'b',
      type: 'ec',
      x: 1,
      y: 1,
      meta: { good: 'x', bad: { nested: 1 } },
    });
    const probs = validateDocument(doc);
    expect(
      probs.some((p) => p.level === 'error' && /meta must be/.test(p.message)),
    ).toBe(true);
    expect(probs.some((p) => /meta\."bad"/.test(p.message))).toBe(true);
  });

  it('warns when node opacity is out of the 0–1 range', () => {
    const doc = emptyDocument();
    const page = addPage(doc);
    addNode(page, { id: 'a', type: 'ec', x: 0, y: 0, opacity: 1.5 });
    const probs = validateDocument(doc);
    expect(
      probs.some((p) => p.level === 'warning' && /opacity/.test(p.message)),
    ).toBe(true);
    // A valid opacity produces no opacity warning.
    const ok = emptyDocument();
    const p2 = addPage(ok);
    addNode(p2, { id: 'b', type: 'ec', x: 0, y: 0, opacity: 0.5 });
    expect(validateDocument(ok).some((p) => /opacity/.test(p.message))).toBe(
      false,
    );
  });

  it('warns when a flow path has fewer than two waypoints', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 0, y: 0 })
      .flowPath({ id: 'f', waypoints: ['a'] })
      .build();
    expect(
      validateDocument(doc).some((p) => /at least 2 waypoints/.test(p.message)),
    ).toBe(true);
  });
});
