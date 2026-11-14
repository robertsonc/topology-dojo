import { describe, expect, it } from 'vitest';
import {
  annotationCatalog,
  getNodeType,
  linkCatalog,
  nodeCatalog,
} from '../api/catalog.js';
import {
  boundsAttrs,
  findField,
  numberBounds,
  numberFieldText,
  parseNumberField,
} from './number-field.js';

describe('parseNumberField', () => {
  it('reads a cleared field as "unset", never as 0', () => {
    expect(parseNumberField('')).toEqual({ kind: 'unset' });
    expect(parseNumberField('   ')).toEqual({ kind: 'unset' });
    expect(parseNumberField('', { min: 0, max: 1 })).toEqual({ kind: 'unset' });
  });

  it('keeps the value of a required field when it is cleared', () => {
    expect(parseNumberField('', {}, { required: true })).toEqual({
      kind: 'invalid',
    });
  });

  it('reads a plain number as itself', () => {
    expect(parseNumberField('0.5', { min: 0, max: 1 })).toEqual({
      kind: 'value',
      value: 0.5,
    });
    expect(parseNumberField('-12')).toEqual({ kind: 'value', value: -12 });
    expect(parseNumberField('0')).toEqual({ kind: 'value', value: 0 });
    expect(parseNumberField(' 7 ')).toEqual({ kind: 'value', value: 7 });
  });

  it('stores nothing for text that is not a number', () => {
    expect(parseNumberField('abc')).toEqual({ kind: 'invalid' });
    expect(parseNumberField('-')).toEqual({ kind: 'invalid' });
    expect(parseNumberField('Infinity')).toEqual({ kind: 'invalid' });
    expect(parseNumberField('NaN')).toEqual({ kind: 'invalid' });
  });

  it('does not take text the browser could not read for a blank field', () => {
    // A number input reports "-" or "1e" as an empty value with badInput set.
    expect(parseNumberField('', {}, { badInput: true })).toEqual({
      kind: 'invalid',
    });
  });

  it('brings a value outside the range to its nearest end', () => {
    const opacity = { min: 0, max: 1 };
    expect(parseNumberField('5', opacity)).toEqual({ kind: 'value', value: 1 });
    expect(parseNumberField('-1', opacity)).toEqual({
      kind: 'value',
      value: 0,
    });
    const labelWidth = { min: 40, max: 600 };
    expect(parseNumberField('99999', labelWidth)).toEqual({
      kind: 'value',
      value: 600,
    });
    expect(parseNumberField('-50', labelWidth)).toEqual({
      kind: 'value',
      value: 40,
    });
  });

  it('refuses zero and negatives for a size that must be positive', () => {
    const size = { min: 0, exclusiveMin: true };
    expect(parseNumberField('0', size)).toEqual({ kind: 'invalid' });
    expect(parseNumberField('-50', size)).toEqual({ kind: 'invalid' });
    expect(parseNumberField('0.5', size)).toEqual({
      kind: 'value',
      value: 0.5,
    });
    expect(parseNumberField('99999', size)).toEqual({
      kind: 'value',
      value: 99999,
    });
    // Blank still means "use the default size".
    expect(parseNumberField('', size)).toEqual({ kind: 'unset' });
  });

  it('accepts zero where zero is a real value', () => {
    expect(parseNumberField('0', { min: 0 })).toEqual({
      kind: 'value',
      value: 0,
    });
    expect(parseNumberField('-40', { min: 0 })).toEqual({
      kind: 'value',
      value: 0,
    });
  });
});

describe('numberBounds', () => {
  it('uses the range the catalog declares', () => {
    expect(numberBounds({ key: 'fromPortOffset', range: [-1, 1] })).toEqual({
      min: -1,
      max: 1,
    });
    // A declared range wins over what is known for the key.
    expect(numberBounds({ key: 'opacity', range: [0.2, 0.8] })).toEqual({
      min: 0.2,
      max: 0.8,
    });
  });

  it('knows the bounds the renderer applies where the catalog is silent', () => {
    expect(numberBounds({ key: 'opacity' })).toEqual({ min: 0, max: 1 });
    expect(numberBounds({ key: 'labelWidth' })).toEqual({ min: 40, max: 600 });
    expect(numberBounds({ key: 'labelScale' })).toEqual({ min: 0.25, max: 4 });
    for (const key of ['fontSize', 'shapeWidth', 'shapeHeight', 'strokeWidth'])
      expect(numberBounds({ key })).toEqual({ min: 0, exclusiveMin: true });
    expect(numberBounds({ key: 'padding' })).toEqual({ min: 0 });
  });

  it('leaves positions and offsets unbounded', () => {
    for (const key of ['x', 'y', 'labelOffsetX', 'labelOffset'])
      expect(numberBounds({ key })).toEqual({});
  });

  it('looks a nested field up by its own name', () => {
    expect(numberBounds({ key: 'something.opacity' })).toEqual({
      min: 0,
      max: 1,
    });
  });

  it('covers every number field the real catalog has, by range or by name', () => {
    // Guards the table against the catalog growing a size or an opacity under
    // a key this module has never heard of: position-like fields aside, each
    // numeric field should have at least a lower bound.
    const unbounded = new Set(['x', 'y', 'labelOffsetX', 'labelOffset']);
    const lists = [
      ...nodeCatalog().map((t) => t.fields),
      ...linkCatalog().map((t) => t.fields),
      ...annotationCatalog().map((t) => t.fields),
    ];
    const flat = lists.flatMap((fields) =>
      fields.flatMap((f) => [f, ...(f.fields ?? [])]),
    );
    const numeric = flat.filter((f) => f.kind === 'number');
    expect(numeric.length).toBeGreaterThan(20);
    for (const f of numeric) {
      if (unbounded.has(f.key)) continue;
      expect(numberBounds(f).min, `${f.key} has a lower bound`).toBeTypeOf(
        'number',
      );
    }
  });
});

describe('findField', () => {
  const fields = getNodeType('router')!.fields;

  it('finds a field by key', () => {
    expect(findField(fields, 'opacity')?.label).toBe('Opacity');
    expect(findField(fields, 'nope')).toBeUndefined();
    expect(findField(undefined, 'opacity')).toBeUndefined();
  });

  it('finds a field nested in an object field', () => {
    const pad = findField(fields, 'linkAttach.pad');
    expect(pad?.kind).toBe('number');
    expect(pad?.range).toEqual([0, 200]);
    expect(findField(fields, 'linkAttach.nope')).toBeUndefined();
  });
});

describe('boundsAttrs', () => {
  it('emits min and max for the input', () => {
    expect(boundsAttrs({ min: 0, max: 1 })).toBe(' min="0" max="1" step="any"');
    expect(boundsAttrs({ min: 0 })).toBe(' min="0" step="any"');
  });

  it('emits nothing for an unbounded field', () => {
    expect(boundsAttrs({})).toBe('');
  });
});

describe('numberFieldText', () => {
  it('shows a stored number, and nothing for an unset property', () => {
    expect(numberFieldText(0.5)).toBe('0.5');
    expect(numberFieldText(0)).toBe('0');
    expect(numberFieldText(undefined)).toBe('');
    expect(numberFieldText(null)).toBe('');
    expect(numberFieldText(Number.NaN)).toBe('');
  });
});
