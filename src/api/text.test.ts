import { describe, it, expect } from 'vitest';
import {
  TEXT_LIMITS,
  normalizeText,
  boundText,
  sanitizeDisplayFields,
  sanitizeMetaMap,
  overlongDisplayMax,
  overlongMetaMax,
} from './text.js';

describe('normalizeText', () => {
  it('strips C0/C1 control characters', () => {
    expect(normalizeText('hello\u0000world\u0007!')).toBe('helloworld!');
    expect(normalizeText('x\u007F\u009Fy')).toBe('xy');
  });

  it('collapses whitespace and trims on a single line', () => {
    expect(normalizeText('  foo \t\n bar  ')).toBe('foo bar');
  });

  it('keeps newline boundaries in multiline mode', () => {
    expect(normalizeText('a \t b\n\n\nc  d\r\ne', { multiline: true })).toBe(
      'a b\n\nc d\ne',
    );
  });

  it('NFC-normalizes combining marks', () => {
    const decomposed = 'e\u0301'; // e + combining acute
    expect(normalizeText(decomposed)).toBe('é');
  });

  it('turns a control-only string into empty', () => {
    expect(normalizeText('\u0000\u0001\t\n')).toBe('');
  });
});

describe('boundText', () => {
  it('truncates after normalization', () => {
    expect(boundText('  abcdef  ', 4)).toBe('abcd');
    expect(
      boundText('x'.repeat(TEXT_LIMITS.label + 50), TEXT_LIMITS.label),
    ).toBe('x'.repeat(TEXT_LIMITS.label));
  });

  it('does not grow a short string', () => {
    expect(boundText('ok', 200)).toBe('ok');
  });
});

describe('sanitizeDisplayFields / meta', () => {
  it('bounds known display keys and leaves structural fields alone', () => {
    const node = {
      id: 'n1',
      type: 'ec',
      x: 1,
      y: 2,
      label: `  hi\u0000 ${'x'.repeat(TEXT_LIMITS.label)} `,
      color: '#01a982',
    };
    sanitizeDisplayFields(node);
    expect(node.id).toBe('n1');
    expect(node.type).toBe('ec');
    expect(node.color).toBe('#01a982');
    expect(node.label).toBe(`hi ${'x'.repeat(TEXT_LIMITS.label - 3)}`);
    expect(node.label.length).toBe(TEXT_LIMITS.label);
  });

  it('truncates caption / description as multiline and meta values', () => {
    const page = {
      caption: `line1\u0000\n\n\nline2 ${'y'.repeat(TEXT_LIMITS.caption)}`,
      zones: [
        {
          description: 'z'.repeat(TEXT_LIMITS.description + 10),
        },
      ],
      nodes: [
        {
          meta: {
            serial: 'a'.repeat(TEXT_LIMITS.metaValue + 5),
            ports: 48,
          },
        },
      ],
    };
    sanitizeDisplayFields(page);
    expect(page.caption.length).toBe(TEXT_LIMITS.caption);
    expect(page.caption.startsWith('line1\n\nline2 ')).toBe(true);
    expect(page.zones[0]!.description).toBe(
      'z'.repeat(TEXT_LIMITS.description),
    );
    expect(page.nodes[0]!.meta.serial).toBe('a'.repeat(TEXT_LIMITS.metaValue));
    expect(page.nodes[0]!.meta.ports).toBe(48);
  });

  it('normalizes meta keys and drops empty ones', () => {
    const meta: Record<string, unknown> = {
      '  ser\u0000ial  ': 'SN1',
      '\u0000': 'gone',
    };
    sanitizeMetaMap(meta);
    expect(meta).toEqual({ serial: 'SN1' });
  });
});

describe('overlong helpers (Zod reject path)', () => {
  it('reports the cap for an overlong display string, not after normalize', () => {
    expect(
      overlongDisplayMax('label', 'x'.repeat(TEXT_LIMITS.label)),
    ).toBeNull();
    expect(overlongDisplayMax('label', 'x'.repeat(TEXT_LIMITS.label + 1))).toBe(
      TEXT_LIMITS.label,
    );
    expect(
      overlongDisplayMax('caption', 'x'.repeat(TEXT_LIMITS.caption + 1)),
    ).toBe(TEXT_LIMITS.caption);
    expect(overlongDisplayMax('id', 'x'.repeat(500))).toBeNull();
    expect(overlongDisplayMax('label', 12)).toBeNull();
  });

  it('reports overlong meta keys and values', () => {
    expect(overlongMetaMax('serial', 'SN1')).toBeNull();
    expect(overlongMetaMax('k', 'v'.repeat(TEXT_LIMITS.metaValue + 1))).toEqual(
      { path: 'k', max: TEXT_LIMITS.metaValue },
    );
    expect(overlongMetaMax('k'.repeat(TEXT_LIMITS.label + 1), 'v')).toEqual({
      path: 'k'.repeat(TEXT_LIMITS.label + 1),
      max: TEXT_LIMITS.label,
    });
  });
});
