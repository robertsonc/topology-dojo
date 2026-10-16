import { describe, it, expect } from 'vitest';
import {
  ETHERNET_MEDIA_STYLES,
  defineLinkStyle,
  resolveLinkStyle,
  usedLinkStyles,
} from './link-styles.js';
import { createDocument } from './builder.js';
import { validateDocument } from './validate.js';
import { parseDoc, serializeDoc } from '../pages/persist.js';
import { buildLegendItems, legendSVG } from '../editor/legend.js';
import { linkCatalog, linkStyleCatalog } from './catalog.js';
import type { LinkConfig } from '../vendor/topology-ds.js';

describe('link styles (W1)', () => {
  it('resolves a style into colour / width / dash unless the link overrides', () => {
    const styles = [
      { id: 'c', color: '#123456', width: 3, dash: 'dashed' as const },
    ];
    const plain: LinkConfig = {
      id: 'l',
      type: 'line',
      from: 'a',
      to: 'b',
      style: 'c',
    };
    const r = resolveLinkStyle(plain, styles);
    expect(r.color).toBe('#123456');
    expect(r.strokeWidth).toBe(3);
    expect(r.dashed).toBe(true);
    const own = { ...plain, color: '#ffffff', strokeWidth: 1, dashed: false };
    const o = resolveLinkStyle(own, styles);
    expect(o.color).toBe('#ffffff');
    expect(o.strokeWidth).toBe(1);
    expect(o.dashed).toBe(false);
  });

  it('returns the same object when no style applies (classic path)', () => {
    const l = { id: 'l', type: 'line', from: 'a', to: 'b' };
    expect(resolveLinkStyle(l, undefined)).toBe(l);
    expect(resolveLinkStyle({ ...l, style: 'nope' }, [])).toEqual({
      ...l,
      style: 'nope',
    });
  });

  it('defineLinkStyle upserts by id and the starter set has eleven classes', () => {
    const doc: { linkStyles?: (typeof ETHERNET_MEDIA_STYLES)[number][] } = {};
    defineLinkStyle(doc, { id: 'x', color: '#000000' });
    defineLinkStyle(doc, { id: 'x', color: '#111111', label: 'X' });
    expect(doc.linkStyles).toEqual([{ id: 'x', color: '#111111', label: 'X' }]);
    expect(ETHERNET_MEDIA_STYLES).toHaveLength(11);
    expect(new Set(ETHERNET_MEDIA_STYLES.map((s) => s.id)).size).toBe(11);
  });

  it('is a catalog field on every link type and has its own catalog entry', () => {
    for (const l of linkCatalog())
      expect(l.fields.some((f) => f.key === 'style' && f.kind === 'ref')).toBe(
        true,
      );
    const c = linkStyleCatalog();
    expect(c.fields.map((f) => f.key)).toEqual([
      'id',
      'label',
      'color',
      'width',
      'dash',
    ]);
    expect(c.presets).toContain('ethernet-media');
  });

  it('validates declared styles and dangling references', () => {
    const doc = createDocument('S')
      .page()
      .node({ id: 'a', type: 'ec', x: 0, y: 0 })
      .node({ id: 'b', type: 'ec', x: 200, y: 0 })
      .link({ id: 'l', type: 'line', from: 'a', to: 'b', style: 'ghost' })
      .build();
    doc.linkStyles = [
      { id: 'd', color: '#e01b24' },
      { id: 'd', color: '#e01b24' },
      { id: 'w', color: '#e01b24', width: 99 },
    ];
    const p = validateDocument(doc);
    expect(p.some((x) => /duplicate link style id "d"/.test(x.message))).toBe(
      true,
    );
    expect(p.some((x) => /width 99/.test(x.message))).toBe(true);
    expect(p.some((x) => /style "ghost" is not declared/.test(x.message))).toBe(
      true,
    );
  });

  it('round-trips through persist and drops malformed entries', () => {
    const doc = createDocument('S').page().build();
    doc.linkStyles = [
      { id: '100g-dac', color: '#e01b24', label: '100GBASE-DA (DAC)' },
    ];
    const back = parseDoc(serializeDoc(doc))!;
    expect(back.linkStyles).toEqual(doc.linkStyles);
    const dirty = parseDoc({
      pages: [{ nodes: [], links: [] }],
      linkStyles: [
        { id: 'ok', color: '#111111', width: 500, dash: 'dotted' },
        { id: 'bad"><script>', color: '#111111' },
        { id: 'nocolor' },
        { id: 'ok', color: '#222222' },
      ],
    })!;
    expect(dirty.linkStyles).toEqual([
      { id: 'ok', color: '#111111', width: 12, dash: 'dotted' },
      { id: 'badscript', color: '#111111' },
    ]);
  });

  it('keys the legend with one line sample per style in use', () => {
    const doc = createDocument('K')
      .page()
      .node({ id: 'a', type: 'ec', x: 0, y: 0 })
      .node({ id: 'b', type: 'ec', x: 200, y: 0 })
      .link({ id: 'l1', type: 'line', from: 'a', to: 'b', style: '100g-dac' })
      .link({ id: 'l2', type: 'line', from: 'a', to: 'b', style: '100g-dac' })
      .build();
    doc.linkStyles = [...ETHERNET_MEDIA_STYLES];
    expect(usedLinkStyles(doc.linkStyles, doc.pages[0]!.links)).toHaveLength(1);
    const items = buildLegendItems(doc, doc.pages[0]!);
    const lines = items.filter((i) => i.shape === 'line');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.label).toBe('100GBASE-DA (DAC)');
    doc.legend = { show: true, position: 'bl', columns: 3, title: 'Key' };
    const svg = legendSVG(doc, doc.pages[0]!);
    expect(svg).toContain('<line ');
    expect(svg).toContain('>Key<');
  });
});
