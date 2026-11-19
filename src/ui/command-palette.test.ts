import { describe, expect, it } from 'vitest';
import {
  MATCH_SCORE,
  PALETTE_LIMIT,
  firstEnabledIndex,
  mergeRanges,
  moveActive,
  normalise,
  optionLabel,
  pageSize,
  paletteKeyAction,
  rankEntries,
  resultCountText,
  scrollTopToReveal,
  titleSegments,
  type PaletteEntry,
} from './command-palette.js';

const run = (): void => {};

/** An entry named after its title, so results read as a list of titles. */
function entry(
  title: string,
  extra: Partial<Omit<PaletteEntry, 'title' | 'run'>> = {},
): PaletteEntry {
  return { id: title, title, run, ...extra };
}

/** The titles `query` finds, best first. */
function titles(
  query: string,
  entries: readonly PaletteEntry[],
  limit?: number,
): string[] {
  return rankEntries(query, entries, limit).map((r) => r.entry.title);
}

/** The score one entry gets for `query`, null when it does not match. */
function scoreOf(query: string, e: PaletteEntry): number | null {
  return rankEntries(query, [e])[0]?.score ?? null;
}

/** The matched pieces of a title, as text. */
function marked(query: string, title: string): string[] {
  const hit = rankEntries(query, [entry(title)])[0];
  if (!hit) throw new Error(`"${query}" does not match "${title}"`);
  return hit.ranges.map(([start, end]) => title.slice(start, end));
}

describe('normalise', () => {
  it('lower-cases', () => {
    expect(normalise('Tidy Layout')).toBe('tidy layout');
    expect(normalise('SVG')).toBe('svg');
  });

  it('strips diacritics, composed or decomposed', () => {
    expect(normalise('Éclair')).toBe('eclair');
    expect(normalise('Éclair')).toBe('eclair');
    expect(normalise('São Paulo')).toBe('sao paulo');
    expect(normalise('Zürich')).toBe('zurich');
    expect(normalise('Ångström')).toBe('angstrom');
    expect(normalise('İstanbul')).toBe('istanbul');
  });

  it('folds letters that have no accent to strip', () => {
    expect(normalise('Straße')).toBe('strasse');
    expect(normalise('STRAẞE')).toBe('strasse');
    expect(normalise('Ærø')).toBe('aero');
    expect(normalise('Łódź')).toBe('lodz');
    expect(normalise('Œuvre')).toBe('oeuvre');
    // A word-final sigma is the same letter as a medial one.
    expect(normalise('ΟΔΌΣ')).toBe(normalise('οδός'));
  });

  it('folds compatibility forms', () => {
    expect(normalise('ﬁnd')).toBe('find');
    expect(normalise('Ａｂｃ１')).toBe('abc1');
  });

  it('collapses whitespace to single spaces and trims', () => {
    expect(normalise('  go \t to\n\npage  ')).toBe('go to page');
    expect(normalise('a  b')).toBe('a b');
    expect(normalise('   ')).toBe('');
    expect(normalise('')).toBe('');
  });

  it('leaves punctuation and digits alone', () => {
    expect(normalise('MA-co-02 (core) 10.0.0.1/24')).toBe(
      'ma-co-02 (core) 10.0.0.1/24',
    );
  });

  it('agrees with whole-string Unicode normalisation', () => {
    const reference = (s: string): string =>
      s
        .normalize('NFKD')
        .replace(/\p{M}+/gu, '')
        .toLowerCase()
        .replace(/ß/g, 'ss')
        .replace(/\s+/g, ' ')
        .trim();
    for (const s of [
      'Plain ASCII title',
      'Crème brûlée  à la carte',
      'Große Straße',
      'Hà Nội, Việt Nam',
      '한글 topology',
      '東京 データセンター',
      'x̣́ y',
      'Ａ\tＢ',
    ])
      expect(normalise(s), s).toBe(reference(s));
  });

  it('is idempotent', () => {
    for (const s of ['Straße', '  Éclair  au CAFÉ ', 'ﬁnd Ａ', 'Go to page 2'])
      expect(normalise(normalise(s))).toBe(normalise(s));
  });
});

describe('rankEntries: what matches', () => {
  const entries = [
    entry('Align left', { group: 'Arrange' }),
    entry('Align right', { group: 'Arrange' }),
    entry('Tidy layout', { group: 'Arrange', hint: 'T' }),
    entry('Toggle grid', { group: 'View', keywords: ['dots', 'lines'] }),
    entry('Export: SVG', { group: 'File', keywords: ['download', 'vector'] }),
  ];

  it('excludes an entry no field of which has the token', () => {
    expect(titles('zzz', entries)).toEqual([]);
    expect(titles('grid', entries)).toEqual(['Toggle grid']);
  });

  it('ignores case and diacritics, in the query and in the entry', () => {
    const cafe = [entry('Café Zürich'), entry('Cafe Zurich')];
    expect(titles('CAFE', cafe)).toEqual(['Café Zürich', 'Cafe Zurich']);
    expect(titles('zürich', cafe)).toEqual(['Café Zürich', 'Cafe Zurich']);
    expect(titles('STRASSE', [entry('Große Straße')])).toEqual([
      'Große Straße',
    ]);
    expect(titles('straße', [entry('Strasse 1')])).toEqual(['Strasse 1']);
  });

  it('requires every token of the query (AND)', () => {
    expect(titles('align left', entries)).toEqual(['Align left']);
    expect(titles('align', entries)).toEqual(['Align left', 'Align right']);
    expect(titles('align left right', entries)).toEqual([]);
  });

  it('matches the tokens in any order and across fields', () => {
    expect(titles('left align', entries)).toEqual(['Align left']);
    // One token in the title, the other in the group.
    expect(titles('tidy arrange', entries)).toEqual(['Tidy layout']);
    // One token in the title, the other in a keyword.
    expect(titles('svg download', entries)).toEqual(['Export: SVG']);
    // The group, then a keyword.
    expect(titles('view dots', entries)).toEqual(['Toggle grid']);
  });

  it('finds an entry by a keyword or by its group alone', () => {
    expect(titles('vector', entries)).toEqual(['Export: SVG']);
    expect(titles('file', entries)).toEqual(['Export: SVG']);
    // All three by the group alone: the shortest title, then input order.
    expect(titles('arrange', entries)).toEqual([
      'Align left',
      'Align right',
      'Tidy layout',
    ]);
  });

  it('does not search the shortcut hint or the id', () => {
    const e = [
      { id: 'layout.tidy', title: 'Tidy', hint: 'Ctrl+Shift+Y', run },
    ] satisfies PaletteEntry[];
    expect(titles('ctrl', e)).toEqual([]);
    expect(titles('layout', e)).toEqual([]);
  });

  it('splits the query at any whitespace', () => {
    expect(titles('  align \t left ', entries)).toEqual(['Align left']);
  });

  it('ranks disabled entries like any other, and returns them', () => {
    const list = [
      entry('Paste format'),
      entry('Paste', { disabled: true }),
      entry('Copy', { disabled: true }),
    ];
    const ranked = rankEntries('paste', list);
    expect(ranked.map((r) => r.entry.title)).toEqual(['Paste', 'Paste format']);
    expect(ranked[0]!.entry.disabled).toBe(true);
    expect(ranked[0]!.score).toBe(MATCH_SCORE.exact);
    expect(titles('', list)).toEqual(['Paste format', 'Paste', 'Copy']);
  });
});

describe('rankEntries: the strength of a match', () => {
  it('orders the tiers as documented', () => {
    const order = [
      MATCH_SCORE.exact,
      MATCH_SCORE.titlePrefix,
      MATCH_SCORE.wordPrefix,
      MATCH_SCORE.titleInside,
      MATCH_SCORE.keywordPrefix,
      MATCH_SCORE.groupPrefix,
      MATCH_SCORE.contains,
    ];
    expect([...order].sort((a, b) => b - a)).toEqual(order);
    expect(new Set(order).size).toBe(order.length);
    expect(MATCH_SCORE.contains).toBeGreaterThan(0);
  });

  it('scores each kind of match', () => {
    expect(scoreOf('tidy', entry('Tidy'))).toBe(MATCH_SCORE.exact);
    expect(scoreOf('tidy', entry('Tidy layout'))).toBe(MATCH_SCORE.titlePrefix);
    expect(scoreOf('lay', entry('Tidy layout'))).toBe(MATCH_SCORE.wordPrefix);
    expect(scoreOf('ayo', entry('Tidy layout'))).toBe(MATCH_SCORE.titleInside);
    expect(scoreOf('lay', entry('Tidy', { keywords: ['layout'] }))).toBe(
      MATCH_SCORE.keywordPrefix,
    );
    expect(scoreOf('lay', entry('Tidy', { group: 'Layout' }))).toBe(
      MATCH_SCORE.groupPrefix,
    );
    expect(scoreOf('ayo', entry('Tidy', { keywords: ['layout'] }))).toBe(
      MATCH_SCORE.contains,
    );
    expect(scoreOf('ayo', entry('Tidy', { group: 'Layout' }))).toBe(
      MATCH_SCORE.contains,
    );
    expect(scoreOf('lay', entry('Tidy'))).toBeNull();
  });

  // Each pair puts the WEAKER match first, with the shorter title, so the
  // stronger one can only come out on top because of its tier: not by the
  // shorter-title rule and not by input order.
  it('title equal to the query beats title starting with it', () => {
    // An exact title is never longer than a prefix match, so the tie-breaks
    // cannot be turned against it: the scores carry this one.
    expect(titles('tidy', [entry('Tidy up'), entry('Tidy')])).toEqual([
      'Tidy',
      'Tidy up',
    ]);
    expect(scoreOf('tidy', entry('Tidy'))!).toBeGreaterThan(
      scoreOf('tidy', entry('Tidy up'))!,
    );
  });

  it('title starting with the token beats a later word starting with it', () => {
    expect(
      titles('lay', [
        entry('Auto layout'),
        entry('Layout options, all of them'),
      ]),
    ).toEqual(['Layout options, all of them', 'Auto layout']);
  });

  it('a word starting with the token beats the token inside a word', () => {
    expect(
      titles('lay', [entry('Relay'), entry('Automatic layout of everything')]),
    ).toEqual(['Automatic layout of everything', 'Relay']);
  });

  it('the token inside the title beats a keyword starting with it', () => {
    expect(
      titles('lay', [
        entry('Tidy', { keywords: ['layout'] }),
        entry('Display settings for the page'),
      ]),
    ).toEqual(['Display settings for the page', 'Tidy']);
  });

  it('a keyword starting with the token beats the group starting with it', () => {
    expect(
      titles('lay', [
        entry('Zoom', { group: 'Layout' }),
        entry('Arrange all the nodes', { keywords: ['x', 'layout'] }),
      ]),
    ).toEqual(['Arrange all the nodes', 'Zoom']);
  });

  it('the group starting with the token beats a keyword or group containing it', () => {
    expect(
      titles('lay', [
        entry('Zoom', { keywords: ['relay'] }),
        entry('Pan', { group: 'Overlay' }),
        entry('Arrange all the nodes', { group: 'Layout' }),
      ]),
    ).toEqual(['Arrange all the nodes', 'Pan', 'Zoom']);
  });

  it('takes the best of several matches for one token', () => {
    // In the title AND a keyword prefix: the title match counts.
    expect(scoreOf('lay', entry('Relay', { keywords: ['layout'] }))).toBe(
      MATCH_SCORE.titleInside,
    );
    // Inside one word and at the start of a later one: the word start.
    expect(scoreOf('lay', entry('Relay layout'))).toBe(MATCH_SCORE.wordPrefix);
    // A keyword prefix and a group prefix: the keyword.
    expect(
      scoreOf('lay', entry('Tidy', { group: 'Layout', keywords: ['layers'] })),
    ).toBe(MATCH_SCORE.keywordPrefix);
    // Contained in one keyword, the prefix of another.
    expect(scoreOf('lay', entry('Tidy', { keywords: ['relay', 'lay'] }))).toBe(
      MATCH_SCORE.keywordPrefix,
    );
  });

  it.each([
    ['space', 'Auto layout'],
    ['hyphen', 'Auto-layout'],
    ['slash', 'Auto/layout'],
    ['colon', 'Auto:layout'],
    ['dot', 'Auto.layout'],
    ['opening parenthesis', 'Auto (layout)'],
    ['closing parenthesis', 'Auto)layout'],
  ])('starts a word after a %s', (_name, title) => {
    expect(scoreOf('lay', entry(title))).toBe(MATCH_SCORE.wordPrefix);
  });

  it.each([['Auto_layout'], ['Autolayout'], ['Auto+layout'], ['Auto2layout']])(
    'does not start a word inside %s',
    (title) => {
      expect(scoreOf('lay', entry(title))).toBe(MATCH_SCORE.titleInside);
    },
  );

  it('counts a title equal to the query only for a single-token query', () => {
    const e = entry('Align left');
    expect(scoreOf('align left', e)).toBe(
      MATCH_SCORE.titlePrefix + MATCH_SCORE.wordPrefix,
    );
    // Equal once normalised is still equal.
    expect(scoreOf('ALIGN', entry('  Align '))).toBe(MATCH_SCORE.exact);
    expect(scoreOf('strasse', entry('Straße'))).toBe(MATCH_SCORE.exact);
  });

  it('sums the scores of the tokens', () => {
    const e = entry('Export: SVG', { group: 'File', keywords: ['download'] });
    expect(scoreOf('exp svg', e)).toBe(
      MATCH_SCORE.titlePrefix + MATCH_SCORE.wordPrefix,
    );
    expect(scoreOf('svg fil', e)).toBe(
      MATCH_SCORE.wordPrefix + MATCH_SCORE.groupPrefix,
    );
    expect(scoreOf('down por', e)).toBe(
      MATCH_SCORE.keywordPrefix + MATCH_SCORE.titleInside,
    );
    expect(scoreOf('own il', e)).toBe(MATCH_SCORE.contains * 2);
  });
});

describe('rankEntries: ties and stability', () => {
  it('breaks a tie on score with the shorter title', () => {
    expect(
      titles('align', [
        entry('Align vertical centres'),
        entry('Align top'),
        entry('Align bottom'),
      ]),
    ).toEqual(['Align top', 'Align bottom', 'Align vertical centres']);
  });

  it('measures the title as it is compared, not as it is stored', () => {
    // Padding and a decomposed accent do not make a title "longer".
    expect(
      titles('caf', [entry('  Café   au  lait  '), entry('Cafe au laits')]),
    ).toEqual(['  Café   au  lait  ', 'Cafe au laits']);
  });

  it('keeps input order when score and length are equal', () => {
    const list = ['Node C', 'Node A', 'Node D', 'Node B'].map((t) => entry(t));
    expect(titles('node', list)).toEqual([
      'Node C',
      'Node A',
      'Node D',
      'Node B',
    ]);
    expect(titles('node', [...list].reverse())).toEqual([
      'Node B',
      'Node D',
      'Node A',
      'Node C',
    ]);
  });

  it('keeps shuffled equal-score entries in the order given', () => {
    // 200 entries that all score the same and are equally long. A seeded
    // shuffle (so the test is repeatable) must come back unchanged.
    const list = Array.from({ length: 200 }, (_, i) =>
      entry(`Item ${String(i).padStart(3, '0')}`),
    );
    let seed = 42;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [list[i], list[j]] = [list[j]!, list[i]!];
    }
    expect(titles('item', list, 200)).toEqual(list.map((e) => e.title));
    // Cut off at the limit, it is the FIRST fifty given, not any fifty.
    expect(titles('item', list)).toEqual(
      list.slice(0, PALETTE_LIMIT).map((e) => e.title),
    );
  });

  it('gives the same order for the same input, every time', () => {
    const list = [
      entry('Go to page 2', { group: 'Pages' }),
      entry('Page: anchor box', { group: 'Page setting' }),
      entry('Fit page to content', { group: 'Arrange' }),
      entry('Add page', { group: 'Pages' }),
      entry('Duplicate page', { group: 'Pages' }),
      entry('PDF (this page)', { group: 'Export' }),
      entry('Zoom in', { group: 'View', keywords: ['page'] }),
    ];
    const first = titles('page', list);
    for (let i = 0; i < 5; i++) expect(titles('page', list)).toEqual(first);
    expect(first).toEqual([
      'Page: anchor box',
      'Add page',
      'Go to page 2',
      'Duplicate page',
      'PDF (this page)',
      'Fit page to content',
      'Zoom in',
    ]);
  });

  it('does not reorder or change the entries it is given', () => {
    const list = [entry('B item'), entry('A item'), entry('Item')];
    const before = list.map((e) => e.title);
    const ranked = rankEntries('item', list);
    expect(list.map((e) => e.title)).toEqual(before);
    expect(ranked[0]!.entry).toBe(list[2]);
  });
});

describe('rankEntries: ranges', () => {
  it('marks where each token matched, in title order', () => {
    expect(rankEntries('tidy', [entry('Tidy layout')])[0]!.ranges).toEqual([
      [0, 4],
    ]);
    expect(rankEntries('lay', [entry('Tidy layout')])[0]!.ranges).toEqual([
      [5, 8],
    ]);
    expect(rankEntries('left ali', [entry('Align left')])[0]!.ranges).toEqual([
      [0, 3],
      [6, 10],
    ]);
  });

  it('marks the occurrence the score is for', () => {
    // "lay" is inside "Relay" first, but the word "layout" is what counted.
    expect(marked('lay', 'Relay layout')).toEqual(['lay']);
    expect(rankEntries('lay', [entry('Relay layout')])[0]!.ranges).toEqual([
      [6, 9],
    ]);
  });

  it('merges ranges that overlap', () => {
    expect(rankEntries('al align', [entry('Align left')])[0]!.ranges).toEqual([
      [0, 5],
    ]);
    expect(rankEntries('lign ign', [entry('Align left')])[0]!.ranges).toEqual([
      [1, 5],
    ]);
    // The same token twice is one range.
    expect(rankEntries('left left', [entry('Align left')])[0]!.ranges).toEqual([
      [6, 10],
    ]);
  });

  it('merges ranges that touch', () => {
    expect(rankEntries('ali gn', [entry('Align left')])[0]!.ranges).toEqual([
      [0, 5],
    ]);
  });

  it('has no range for a token matched outside the title', () => {
    const hit = rankEntries('grid dots view', [
      entry('Toggle grid', { group: 'View', keywords: ['dots'] }),
    ])[0]!;
    expect(hit.ranges).toEqual([[7, 11]]);
    expect(
      rankEntries('view', [entry('Toggle grid', { group: 'View' })])[0]!.ranges,
    ).toEqual([]);
  });

  it('points into the original title when an accent is stripped', () => {
    expect(marked('ecl', 'Éclair')).toEqual(['Écl']);
    expect(marked('cafe', 'Un café noir')).toEqual(['café']);
    expect(marked('noir', 'Un café noir')).toEqual(['noir']);
    expect(rankEntries('noir', [entry('Un café noir')])[0]!.ranges).toEqual([
      [8, 12],
    ]);
  });

  it('takes a decomposed accent with its letter', () => {
    // "é" as e + U+0301: two code units for one matched character.
    const title = 'Un café noir';
    expect(rankEntries('cafe', [entry(title)])[0]!.ranges).toEqual([[3, 8]]);
    expect(rankEntries('noir', [entry(title)])[0]!.ranges).toEqual([[9, 13]]);
    expect(marked('caf', title)).toEqual(['caf']);
  });

  it('points into the original title when a character expands (ß → ss)', () => {
    expect(marked('strasse', 'Straße')).toEqual(['Straße']);
    expect(rankEntries('strasse', [entry('Straße')])[0]!.ranges).toEqual([
      [0, 6],
    ]);
    // Text after the ß is one position earlier than in the normal form.
    expect(marked('str', 'Große Straße')).toEqual(['Str']);
    expect(rankEntries('str', [entry('Große Straße')])[0]!.ranges).toEqual([
      [6, 9],
    ]);
    expect(marked('nord', 'Große Straße Nord')).toEqual(['Nord']);
  });

  it('marks the whole character when the match covers part of what it became', () => {
    expect(marked('ss', 'Straße')).toEqual(['ß']);
    expect(marked('gros', 'Große')).toEqual(['Groß']);
    expect(marked('se', 'Große')).toEqual(['ße']);
    expect(marked('i', 'ﬁnd')).toEqual(['ﬁ']);
    // Two tokens on the two halves of one ß: still one range.
    expect(rankEntries('gros se', [entry('Große')])[0]!.ranges).toEqual([
      [0, 5],
    ]);
  });

  it('accounts for whitespace the normal form collapsed', () => {
    const title = '  Go   to \t page  ';
    expect(marked('page', title)).toEqual(['page']);
    expect(marked('go to', title)).toEqual(['Go', 'to']);
    expect(rankEntries('page', [entry(title)])[0]!.ranges).toEqual([[12, 16]]);
  });

  it('counts in UTF-16 code units past an astral character', () => {
    const title = '🚀 Launch pad';
    expect(marked('launch', title)).toEqual(['Launch']);
    expect(rankEntries('pad', [entry(title)])[0]!.ranges).toEqual([[10, 13]]);
  });

  it('always marks text that normalises to something holding the token', () => {
    const cases: [string, string][] = [
      ['strasse', 'Hauptstraße 12'],
      ['uber', 'Über uns'],
      ['sao', 'Go to São Paulo'],
      ['zur', 'ZÜRICH-core-01'],
      ['01', 'ZÜRICH-core-01'],
      ['東京', 'Go to 東京 DC'],
      ['dc', 'Go to 東京 DC'],
      ['oeu', 'Chef-d’œuvre'],
      ['abc', 'x Ａｂｃ y'],
    ];
    for (const [query, title] of cases) {
      const pieces = marked(query, title);
      expect(pieces.length, `${query} in ${title}`).toBe(1);
      expect(normalise(pieces[0]!), `${query} in ${title}`).toContain(
        normalise(query),
      );
    }
  });
});

describe('rankEntries: empty query and limit', () => {
  const many = Array.from({ length: 120 }, (_, i) => entry(`Entry ${i}`));

  it('returns the entries as given for an empty query', () => {
    const list = [entry('Zoom'), entry('Align'), entry('Mirror')];
    const ranked = rankEntries('', list);
    expect(ranked.map((r) => r.entry)).toEqual(list);
    expect(ranked.every((r) => r.score === 0)).toBe(true);
    expect(ranked.every((r) => r.ranges.length === 0)).toBe(true);
  });

  it('treats a query of only whitespace or accents as empty', () => {
    const list = [entry('Zoom'), entry('Align')];
    expect(titles('   \t ', list)).toEqual(['Zoom', 'Align']);
    expect(titles('́', list)).toEqual(['Zoom', 'Align']);
  });

  it('returns at most fifty by default', () => {
    expect(PALETTE_LIMIT).toBe(50);
    expect(rankEntries('', many)).toHaveLength(50);
    expect(rankEntries('entry', many)).toHaveLength(50);
    expect(titles('', many)[49]).toBe('Entry 49');
  });

  it('honours a given limit, for an empty query and for a ranked one', () => {
    expect(titles('', many, 3)).toEqual(['Entry 0', 'Entry 1', 'Entry 2']);
    expect(titles('entry 11', many, 2)).toEqual(['Entry 11', 'Entry 110']);
    expect(rankEntries('entry', many, 500)).toHaveLength(120);
    expect(rankEntries('entry', many, Infinity)).toHaveLength(120);
  });

  it('returns nothing for a limit that is zero, negative or not a number', () => {
    expect(rankEntries('entry', many, 0)).toEqual([]);
    expect(rankEntries('', many, -1)).toEqual([]);
    expect(rankEntries('entry', many, NaN)).toEqual([]);
  });

  it('keeps the best, not the first, when it cuts off', () => {
    const list = [
      ...Array.from({ length: 60 }, (_, i) => entry(`Relay ${i}`)),
      entry('Layout'),
    ];
    expect(titles('lay', list, 1)).toEqual(['Layout']);
  });

  it('copes with no entries', () => {
    expect(rankEntries('', [])).toEqual([]);
    expect(rankEntries('x', [])).toEqual([]);
  });
});

describe('rankEntries: speed', () => {
  it('ranks 5,000 entries well inside a keystroke', () => {
    const words = [
      'Align',
      'left',
      'Tidy',
      'layout',
      'Export',
      'PowerPoint',
      'Go to',
      'page',
      'Switch',
      'EdgeConnect',
      'MA-co',
      'Zürich',
      'Straße',
      'São Paulo',
      'node',
      'zone',
    ];
    const entries: PaletteEntry[] = Array.from({ length: 5000 }, (_, i) => ({
      id: `e${i}`,
      title: `${words[i % 16]} ${words[(i * 7 + 3) % 16]} ${words[(i * 13 + 5) % 16]}-${String(i).padStart(4, '0')}`,
      group: i % 3 ? `Element on page ${i % 9}` : 'Arrange',
      ...(i % 4 === 0 ? { keywords: ['network', `düsseldorf ${i}`] } : {}),
      run,
    }));

    // The best of several runs: a timing that one garbage collection or a
    // busy machine cannot fail. Measured at about 4 ms per query here, so
    // the 50 ms budget is the bound with an order of magnitude to spare.
    for (const query of ['a', 'go to', 'strasse zur', 'network 4', 'zzzz']) {
      let best = Infinity;
      let count = -1;
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        count = rankEntries(query, entries).length;
        best = Math.min(best, performance.now() - start);
      }
      expect(count, query).toBeGreaterThanOrEqual(0);
      expect(best, `"${query}" took ${best.toFixed(1)} ms`).toBeLessThan(50);
    }
    expect(rankEntries('go to', entries)).toHaveLength(50);
    expect(rankEntries('zzzz', entries)).toHaveLength(0);
  });
});

describe('mergeRanges', () => {
  it('sorts, joins overlapping and touching ranges, and drops empty ones', () => {
    expect(mergeRanges([])).toEqual([]);
    expect(
      mergeRanges([
        [6, 9],
        [0, 2],
        [1, 4],
        [4, 5],
        [7, 8],
        [12, 12],
      ]),
    ).toEqual([
      [0, 5],
      [6, 9],
    ]);
  });

  it('returns new ranges', () => {
    const input: [number, number][] = [
      [0, 2],
      [1, 3],
    ];
    mergeRanges(input);
    expect(input).toEqual([
      [0, 2],
      [1, 3],
    ]);
  });
});

describe('titleSegments', () => {
  it('cuts a title into plain and matched pieces', () => {
    expect(
      titleSegments('Align left', [
        [0, 2],
        [6, 10],
      ]),
    ).toEqual([
      { text: 'Al', match: true },
      { text: 'ign ', match: false },
      { text: 'left', match: true },
    ]);
    expect(titleSegments('Tidy', [])).toEqual([{ text: 'Tidy', match: false }]);
    expect(titleSegments('Tidy', [[0, 4]])).toEqual([
      { text: 'Tidy', match: true },
    ]);
    expect(titleSegments('', [])).toEqual([]);
  });

  it('puts every character of the title in exactly one piece', () => {
    const title = 'Große Straße Nord';
    for (const query of ['str', 'gros se', 'nord gro', 'ss']) {
      const { ranges } = rankEntries(query, [entry(title)])[0]!;
      const pieces = titleSegments(title, ranges);
      expect(pieces.map((p) => p.text).join('')).toBe(title);
      expect(pieces.every((p) => p.text.length > 0)).toBe(true);
    }
  });

  it('tolerates ranges that are unsorted, overlapping or out of bounds', () => {
    expect(
      titleSegments('Tidy', [
        [2, 9],
        [0, 1],
        [-3, 1],
      ]),
    ).toEqual([
      { text: 'T', match: true },
      { text: 'i', match: false },
      { text: 'dy', match: true },
    ]);
    expect(titleSegments('Tidy', [[7, 9]])).toEqual([
      { text: 'Tidy', match: false },
    ]);
  });
});

describe('moveActive', () => {
  it('moves to the next and the previous option', () => {
    expect(moveActive(0, 5, 'next')).toBe(1);
    expect(moveActive(3, 5, 'previous')).toBe(2);
  });

  it('wraps at both ends', () => {
    expect(moveActive(4, 5, 'next')).toBe(0);
    expect(moveActive(0, 5, 'previous')).toBe(4);
    expect(moveActive(0, 1, 'next')).toBe(0);
    expect(moveActive(0, 1, 'previous')).toBe(0);
  });

  it('goes to the first and the last option', () => {
    expect(moveActive(2, 5, 'first')).toBe(0);
    expect(moveActive(2, 5, 'last')).toBe(4);
  });

  it('moves by a page and stops at the ends', () => {
    expect(moveActive(0, 30, 'pageDown', 9)).toBe(9);
    expect(moveActive(25, 30, 'pageDown', 9)).toBe(29);
    expect(moveActive(29, 30, 'pageDown', 9)).toBe(29);
    expect(moveActive(20, 30, 'pageUp', 9)).toBe(11);
    expect(moveActive(4, 30, 'pageUp', 9)).toBe(0);
    expect(moveActive(0, 30, 'pageUp', 9)).toBe(0);
    // A page is never less than one option.
    expect(moveActive(3, 30, 'pageDown', 0)).toBe(4);
    expect(moveActive(3, 30, 'pageUp', 0.4)).toBe(2);
  });

  it('starts from the ends when nothing is active', () => {
    expect(moveActive(-1, 5, 'next')).toBe(0);
    expect(moveActive(-1, 5, 'previous')).toBe(4);
    expect(moveActive(-1, 5, 'pageDown', 3)).toBe(3);
    expect(moveActive(-1, 5, 'pageUp', 3)).toBe(0);
  });

  it('has nothing to move to in an empty list', () => {
    for (const move of [
      'next',
      'previous',
      'first',
      'last',
      'pageDown',
      'pageUp',
    ] as const)
      expect(moveActive(0, 0, move, 5)).toBe(-1);
  });

  it('recovers from an index past the end', () => {
    expect(moveActive(9, 5, 'next')).toBe(0);
    expect(moveActive(9, 5, 'previous')).toBe(3);
  });
});

describe('firstEnabledIndex', () => {
  const of = (...disabled: boolean[]): { entry: { disabled?: boolean } }[] =>
    disabled.map((d) => ({ entry: d ? { disabled: true } : {} }));

  it('is the first option that can be run', () => {
    expect(firstEnabledIndex(of(false, false))).toBe(0);
    expect(firstEnabledIndex(of(true, true, false, false))).toBe(2);
  });

  it('is the first option when all are disabled, -1 when there are none', () => {
    expect(firstEnabledIndex(of(true, true))).toBe(0);
    expect(firstEnabledIndex([])).toBe(-1);
  });
});

describe('paletteKeyAction', () => {
  it('moves with the arrow and page keys, and runs with Enter', () => {
    expect(paletteKeyAction({ key: 'ArrowDown' })).toBe('next');
    expect(paletteKeyAction({ key: 'ArrowUp' })).toBe('previous');
    expect(paletteKeyAction({ key: 'PageDown' })).toBe('pageDown');
    expect(paletteKeyAction({ key: 'PageUp' })).toBe('pageUp');
    expect(paletteKeyAction({ key: 'Enter' })).toBe('run');
  });

  it('leaves plain Home and End to the text field', () => {
    expect(paletteKeyAction({ key: 'Home' })).toBeNull();
    expect(paletteKeyAction({ key: 'End' })).toBeNull();
    expect(paletteKeyAction({ key: 'Home', shiftKey: true })).toBeNull();
  });

  it('goes to the first and last option with Ctrl or Cmd + Home / End', () => {
    expect(paletteKeyAction({ key: 'Home', ctrlKey: true })).toBe('first');
    expect(paletteKeyAction({ key: 'End', ctrlKey: true })).toBe('last');
    expect(paletteKeyAction({ key: 'Home', metaKey: true })).toBe('first');
    expect(paletteKeyAction({ key: 'End', metaKey: true })).toBe('last');
    // With Shift it selects text in the field.
    expect(
      paletteKeyAction({ key: 'End', ctrlKey: true, shiftKey: true }),
    ).toBeNull();
  });

  it('toggles on Ctrl or Cmd + K', () => {
    expect(paletteKeyAction({ key: 'k', ctrlKey: true })).toBe('toggle');
    expect(paletteKeyAction({ key: 'K', metaKey: true })).toBe('toggle');
    expect(paletteKeyAction({ key: 'k' })).toBeNull();
    expect(
      paletteKeyAction({ key: 'k', ctrlKey: true, altKey: true }),
    ).toBeNull();
    expect(
      paletteKeyAction({ key: 'k', ctrlKey: true, shiftKey: true }),
    ).toBeNull();
  });

  it('leaves typing, caret keys and selection to the text field', () => {
    for (const key of ['a', 'l', ' ', 'ArrowLeft', 'ArrowRight', 'Backspace'])
      expect(paletteKeyAction({ key }), key).toBeNull();
    // Shift + arrow selects; Alt and Ctrl + arrow are the platform's.
    expect(paletteKeyAction({ key: 'ArrowDown', shiftKey: true })).toBeNull();
    expect(paletteKeyAction({ key: 'ArrowDown', altKey: true })).toBeNull();
    expect(paletteKeyAction({ key: 'ArrowUp', ctrlKey: true })).toBeNull();
    expect(paletteKeyAction({ key: 'Enter', ctrlKey: true })).toBeNull();
    expect(paletteKeyAction({ key: 'Enter', shiftKey: true })).toBeNull();
  });

  it('leaves Escape and Tab to the overlay primitive', () => {
    expect(paletteKeyAction({ key: 'Escape' })).toBeNull();
    expect(paletteKeyAction({ key: 'Tab' })).toBeNull();
  });
});

describe('pageSize', () => {
  it('is the number of whole rows that fit', () => {
    expect(pageSize(320, 32)).toBe(10);
    expect(pageSize(312, 32)).toBe(9);
  });

  it('is at least one, whatever was measured', () => {
    expect(pageSize(20, 32)).toBe(1);
    expect(pageSize(320, 0)).toBe(1);
    expect(pageSize(0, 32)).toBe(1);
    expect(pageSize(NaN, 32)).toBe(1);
  });
});

describe('scrollTopToReveal', () => {
  const view = { top: 100, height: 320 };

  it('does not move when the row is already inside', () => {
    expect(scrollTopToReveal({ top: 100, height: 32 }, view)).toBe(100);
    expect(scrollTopToReveal({ top: 388, height: 32 }, view)).toBe(100);
    expect(scrollTopToReveal({ top: 200, height: 32 }, view, 4)).toBe(100);
  });

  it('scrolls up just far enough for a row above', () => {
    expect(scrollTopToReveal({ top: 68, height: 32 }, view)).toBe(68);
    expect(scrollTopToReveal({ top: 90, height: 32 }, view)).toBe(90);
  });

  it('scrolls down just far enough for a row below', () => {
    expect(scrollTopToReveal({ top: 420, height: 32 }, view)).toBe(132);
    expect(scrollTopToReveal({ top: 400, height: 32 }, view)).toBe(112);
  });

  it('leaves the padding between the row and the edge', () => {
    expect(scrollTopToReveal({ top: 68, height: 32 }, view, 4)).toBe(64);
    expect(scrollTopToReveal({ top: 420, height: 32 }, view, 4)).toBe(136);
    // The first row brings the list's top padding into view, never less.
    expect(scrollTopToReveal({ top: 4, height: 32 }, view, 4)).toBe(0);
    expect(scrollTopToReveal({ top: 2, height: 32 }, view, 4)).toBe(0);
  });

  it('shows the top of a row taller than the view', () => {
    expect(scrollTopToReveal({ top: 50, height: 400 }, view)).toBe(50);
  });
});

describe('resultCountText', () => {
  it('counts the results in words a screen reader can say', () => {
    expect(resultCountText(0)).toBe('No results');
    expect(resultCountText(1)).toBe('1 result');
    expect(resultCountText(12)).toBe('12 results');
  });

  it('says when the list was cut off at the limit', () => {
    expect(resultCountText(50, true)).toBe('First 50 results shown');
    expect(resultCountText(0, true)).toBe('No results');
  });
});

describe('optionLabel', () => {
  it('names an option by its title, group and shortcut', () => {
    expect(
      optionLabel({ title: 'Tidy layout', group: 'Arrange', hint: 'T' }),
    ).toBe('Tidy layout, Arrange, T');
    expect(optionLabel({ title: 'Go to core-01', group: 'Page 2' })).toBe(
      'Go to core-01, Page 2',
    );
    expect(optionLabel({ title: 'Tidy layout' })).toBe('Tidy layout');
    expect(optionLabel({ title: 'Tidy', group: '', hint: 'T' })).toBe(
      'Tidy, T',
    );
  });
});
