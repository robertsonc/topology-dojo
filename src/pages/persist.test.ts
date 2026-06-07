import { describe, it, expect } from 'vitest';
import { serializeDoc, parseDoc } from './persist.js';
import { sampleDocument, blankPage } from './model.js';

describe('persist', () => {
  it('round-trips a document through serialize → parse', () => {
    const doc = sampleDocument();
    const back = parseDoc(serializeDoc(doc));
    expect(back).not.toBeNull();
    expect(back!.pages).toHaveLength(doc.pages.length);
    expect(back!.pages[0]!.nodes).toHaveLength(doc.pages[0]!.nodes.length);
    expect(back!.pages[0]!.name).toBe(doc.pages[0]!.name);
  });

  it('rejects non-document input', () => {
    expect(parseDoc('not json')).toBeNull();
    expect(parseDoc('{}')).toBeNull();
    expect(parseDoc('{"pages":[]}')).toBeNull();
    expect(parseDoc(null)).toBeNull();
    expect(parseDoc(42)).toBeNull();
  });

  it('fills in missing fields defensively (corrupt/hand-edited)', () => {
    const doc = parseDoc(
      '{"pages":[{"nodes":[{"id":"a","type":"ec","x":1,"y":2}]}]}',
    );
    expect(doc).not.toBeNull();
    const page = doc!.pages[0]!;
    expect(page.id).toBeTypeOf('string');
    expect(page.name).toBeTypeOf('string');
    expect(page.viewBox).toBe('0 0 1050 700');
    expect(page.links).toEqual([]);
    expect(page.anchors).toEqual([]);
    expect(page.nodes).toHaveLength(1);
  });

  it('accepts an already-parsed object', () => {
    const doc = parseDoc({ title: 'X', pages: [blankPage('F1')] });
    expect(doc?.title).toBe('X');
    expect(doc?.pages[0]!.name).toBe('F1');
  });
});
