import { describe, it, expect } from 'vitest';
import { isFollowableHref, pageLinkHref, pageLinkTarget } from './page-link.js';
import { createDocument } from './builder.js';
import { validateDocument } from './validate.js';
import { documentToDrawioXML } from '../export/drawio.js';
import { convertDrawio } from '../import/drawio.js';

describe('page links', () => {
  it('round-trips a page id through href', () => {
    expect(pageLinkHref('detail')).toBe('#page=detail');
    expect(pageLinkTarget('#page=detail')).toBe('detail');
    expect(pageLinkTarget(' #page=detail ')).toBe('detail');
    expect(pageLinkTarget('#page=')).toBeNull();
    expect(pageLinkTarget('https://example.com')).toBeNull();
    expect(pageLinkTarget(undefined)).toBeNull();
  });

  it('follows http(s) and page links only', () => {
    expect(isFollowableHref('#page=a')).toBe(true);
    expect(isFollowableHref('https://example.com')).toBe(true);
    expect(isFollowableHref('javascript:alert(1)')).toBe(false);
    expect(isFollowableHref('#elsewhere')).toBe(false);
  });

  const twoPages = (href: string) =>
    createDocument('Links')
      .page({ id: 'ov', name: 'Overview' })
      .node({ id: 'a', type: 'ec', x: 200, y: 200, label: 'A', href })
      .nextPage({ id: 'detail', name: 'Detail' })
      .node({ id: 'b', type: 'ec', x: 200, y: 200, label: 'B' })
      .build();

  it('validates a link to an existing page and warns on a dangling one', () => {
    const ok = validateDocument(twoPages('#page=detail'));
    expect(ok.filter((p) => /href|page link/.test(p.message))).toEqual([]);
    const dangling = validateDocument(twoPages('#page=gone'));
    expect(
      dangling.some(
        (p) => p.level === 'warning' && /points at no page/.test(p.message),
      ),
    ).toBe(true);
  });

  it('exports as a draw.io page link and imports back to the new page id', () => {
    const xml = documentToDrawioXML(twoPages('#page=detail'));
    expect(xml).toContain('link="data:page/id,detail"');
    const back = convertDrawio(xml);
    expect(back.ok).toBe(true);
    const pages = back.document!.pages;
    const a = pages[0]!.nodes.find((n) => n.id === 'a')!;
    // Imported pages are renumbered; the link follows its target.
    expect(pageLinkTarget(a.href)).toBe(pages[1]!.id);
  });
});
