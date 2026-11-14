import { describe, expect, it } from 'vitest';
import { importConfirmText } from './replace-document.js';

const page = (nodes: number, links: number) => ({
  nodes: Array.from({ length: nodes }),
  links: Array.from({ length: links }),
});

describe('importConfirmText', () => {
  it('says plainly that the current diagram is replaced', () => {
    const text = importConfirmText(
      'Mermaid flowchart',
      { pages: [page(4, 3)] },
      [],
    );
    expect(text.split('\n')[0]).toBe(
      'Replace the current diagram with this Mermaid flowchart?',
    );
    expect(text).toContain('It has 4 nodes and 3 links.');
    expect(text).not.toMatch(/Load it\?/);
  });

  it('counts every page, not only the first', () => {
    const text = importConfirmText(
      'draw.io diagram',
      { pages: [page(2, 1), page(5, 4), page(1, 0)] },
      [],
    );
    expect(text).toContain('It has 3 pages, 8 nodes and 5 links in total.');
  });

  it('does not mention pages for a one-page import', () => {
    const text = importConfirmText('CSV data', { pages: [page(2, 1)] }, []);
    expect(text).not.toMatch(/page/);
    expect(text).not.toMatch(/in total/);
  });

  it('uses the singular for one of something', () => {
    expect(
      importConfirmText('CSV data', { pages: [page(1, 1)] }, ['odd row']),
    ).toBe(
      'Replace the current diagram with this CSV data?\n\n' +
        'It has 1 node and 1 link.\n\n' +
        '1 warning from the import:\n- odd row',
    );
    expect(
      importConfirmText('CSV data', { pages: [page(2, 0)] }, []),
    ).toContain('2 nodes and 0 links');
  });

  it('lists up to eight warnings and counts the rest', () => {
    const warnings = Array.from({ length: 11 }, (_, i) => `warning ${i + 1}`);
    const text = importConfirmText(
      'draw.io diagram',
      { pages: [page(1, 0)] },
      warnings,
    );
    expect(text).toContain('11 warnings from the import:');
    expect(text).toContain('- warning 8');
    expect(text).not.toContain('- warning 9');
    expect(text.endsWith('+ 3 more')).toBe(true);
  });
});
