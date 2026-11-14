import { describe, expect, it } from 'vitest';
import { nodeCatalog } from '../api/catalog.js';
import {
  DEFAULT_TYPE_NAME,
  checkCustomTypeName,
  replaceTypeQuestion,
  uniqueTypeName,
} from './custom-type-name.js';

/** Built-in and stock type names, as the app shell passes them. */
const reserved = nodeCatalog().map((t) => t.type);

describe('checkCustomTypeName', () => {
  it('refuses the name of a built-in type', () => {
    const check = checkCustomTypeName({
      name: 'router',
      editing: null,
      reserved,
      custom: [],
    });
    expect(check).toEqual({
      ok: false,
      message: '“router” is a built-in node type. Choose another name.',
    });
  });

  it('refuses every built-in and stock type name', () => {
    expect(reserved.length).toBeGreaterThan(40);
    for (const name of reserved)
      expect(
        checkCustomTypeName({ name, editing: null, reserved, custom: [] }).ok,
      ).toBe(false);
  });

  it('ignores surrounding space when comparing', () => {
    expect(
      checkCustomTypeName({
        name: '  firewall ',
        editing: null,
        reserved,
        custom: [],
      }).ok,
    ).toBe(false);
  });

  it('accepts a new name', () => {
    expect(
      checkCustomTypeName({
        name: ' edge-router ',
        editing: null,
        reserved,
        custom: ['myNode'],
      }),
    ).toEqual({ ok: true, name: 'edge-router', replaces: false });
  });

  it('flags a name another custom type already has', () => {
    expect(
      checkCustomTypeName({
        name: 'myNode',
        editing: null,
        reserved,
        custom: ['myNode'],
      }),
    ).toEqual({ ok: true, name: 'myNode', replaces: true });
    // Renaming the type being edited onto a different custom type, too.
    expect(
      checkCustomTypeName({
        name: 'probe',
        editing: 'myNode',
        reserved,
        custom: ['myNode', 'probe'],
      }),
    ).toEqual({ ok: true, name: 'probe', replaces: true });
  });

  it('lets a type be saved back under its own name', () => {
    expect(
      checkCustomTypeName({
        name: 'myNode',
        editing: 'myNode',
        reserved,
        custom: ['myNode'],
      }),
    ).toEqual({ ok: true, name: 'myNode', replaces: false });
  });

  it('falls back to the default name for a blank one', () => {
    expect(
      checkCustomTypeName({ name: '   ', editing: null, reserved, custom: [] }),
    ).toEqual({ ok: true, name: DEFAULT_TYPE_NAME, replaces: false });
    // …which is checked like any other name.
    expect(
      checkCustomTypeName({
        name: '',
        editing: null,
        reserved,
        custom: [DEFAULT_TYPE_NAME],
      }),
    ).toEqual({ ok: true, name: DEFAULT_TYPE_NAME, replaces: true });
  });
});

describe('uniqueTypeName', () => {
  it('keeps a free name', () => {
    expect(uniqueTypeName('myNode', ['router', 'other'])).toBe('myNode');
  });

  it('numbers a taken one', () => {
    expect(uniqueTypeName('myNode', ['myNode'])).toBe('myNode2');
    expect(uniqueTypeName('myNode', ['myNode', 'myNode2', 'myNode3'])).toBe(
      'myNode4',
    );
  });
});

describe('replaceTypeQuestion', () => {
  it('names the type that would be replaced', () => {
    expect(replaceTypeQuestion('probe')).toBe(
      'A custom node type named “probe” already exists. Replace it with this design?',
    );
  });
});
