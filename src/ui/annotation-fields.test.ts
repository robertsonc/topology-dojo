import { describe, expect, it } from 'vitest';
import { getAnnotationType } from '../api/catalog.js';
import {
  booleanFieldChecked,
  enumFieldOptions,
  enumFieldValue,
  recordFieldText,
} from './annotation-fields.js';

const zoneField = (key: string) =>
  getAnnotationType('zone')!.fields.find((f) => f.key === key)!;

describe('booleanFieldChecked', () => {
  it('ticks an ordinary boolean only when it is set', () => {
    expect(booleanFieldChecked('locked', true)).toBe(true);
    expect(booleanFieldChecked('locked', false)).toBe(false);
    expect(booleanFieldChecked('locked', undefined)).toBe(false);
  });

  it('ticks "follow link geometry" unless it was switched off', () => {
    // The renderer follows links unless followLinks is exactly false.
    expect(booleanFieldChecked('followLinks', undefined)).toBe(true);
    expect(booleanFieldChecked('followLinks', true)).toBe(true);
    expect(booleanFieldChecked('followLinks', false)).toBe(false);
    // The string the old text box stored still follows links, so it shows on.
    expect(booleanFieldChecked('followLinks', 'false')).toBe(true);
  });
});

describe('enumFieldOptions', () => {
  it('offers "None" for the zone map backdrop, selected while unset', () => {
    const options = enumFieldOptions(zoneField('backdrop'), undefined);
    expect(options[0]).toEqual({ value: '', label: 'None', selected: true });
    expect(options.filter((o) => o.selected)).toHaveLength(1);
    expect(options.find((o) => o.value === 'world')).toEqual({
      value: 'world',
      label: 'World',
      selected: false,
    });
  });

  it('selects the stored backdrop', () => {
    const options = enumFieldOptions(zoneField('backdrop'), 'emea');
    expect(options.filter((o) => o.selected).map((o) => o.value)).toEqual([
      'emea',
    ]);
  });

  it('offers "Default" for any other optional choice', () => {
    const options = enumFieldOptions(zoneField('borderStyle'), undefined);
    expect(options[0]).toEqual({ value: '', label: 'Default', selected: true });
    expect(options.map((o) => o.value)).toEqual([
      '',
      'dashed',
      'solid',
      'dotted',
    ]);
  });

  it('adds no empty option to a required field', () => {
    const type = getAnnotationType('policyMarker')!.fields.find(
      (f) => f.key === 'type',
    )!;
    const options = enumFieldOptions(type, 'inspect');
    expect(options.some((o) => o.value === '')).toBe(false);
    expect(options.find((o) => o.selected)?.value).toBe('inspect');
  });

  it('adds no second empty option when the field has its own', () => {
    const options = enumFieldOptions(
      { key: 'status', options: ['', 'ok'], optionLabels: { '': 'None' } },
      undefined,
    );
    expect(options).toEqual([
      { value: '', label: 'None', selected: true },
      { value: 'ok', label: 'ok', selected: false },
    ]);
  });

  it('shows a stored value that is not among the options', () => {
    const options = enumFieldOptions(zoneField('borderStyle'), 'wavy');
    expect(options.at(-1)).toEqual({
      value: 'wavy',
      label: 'wavy (not an option)',
      selected: true,
    });
    expect(options.filter((o) => o.selected)).toHaveLength(1);
  });
});

describe('enumFieldValue', () => {
  it('clears the field for the empty choice', () => {
    expect(enumFieldValue('')).toBeUndefined();
    expect(enumFieldValue('world')).toBe('world');
  });
});

describe('recordFieldText', () => {
  it('draws nothing for an unset field', () => {
    expect(recordFieldText(undefined)).toBeNull();
    expect(recordFieldText(null)).toBeNull();
  });

  it('reads a source reference as system, kind and id', () => {
    expect(
      recordFieldText({
        system: 'edgeconnect',
        kind: 'site',
        id: '42',
        fetchedAt: '2026-01-01T00:00:00Z',
      }),
    ).toBe('edgeconnect · site · 42');
  });

  it('never yields "[object Object]"', () => {
    const texts = [
      recordFieldText({ provider: 'x', ref: 'y' }),
      recordFieldText({ nested: { deep: true } }),
      recordFieldText([{ a: 1 }]),
    ];
    expect(texts[0]).toBe('provider: x · ref: y');
    expect(texts[1]).toBe('nested: {"deep":true}');
    expect(texts[2]).toBe('{"a":1}');
    for (const text of texts) expect(text).not.toContain('[object');
  });

  it('shows a plain value as it is', () => {
    // What the old text box left behind when it overwrote a reference.
    expect(recordFieldText('edgeconnect')).toBe('edgeconnect');
  });
});
