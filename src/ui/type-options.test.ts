import { describe, expect, it } from 'vitest';
import { linkCatalog, nodeCatalog } from '../api/catalog.js';
import type { CustomNodeSpec } from '../nodes/spec.js';
import { typeOptionGroups } from './type-options.js';

describe('typeOptionGroups', () => {
  it('groups node types under their library categories, by label', () => {
    const groups = typeOptionGroups('firewall', nodeCatalog());
    const names = groups.map((g) => g.group);
    // One group per category, in the order the library shows them.
    expect(names).toEqual([...new Set(nodeCatalog().map((t) => t.category))]);
    expect(names).not.toContain(null);

    const all = groups.flatMap((g) => g.options);
    expect(all).toHaveLength(nodeCatalog().length);
    expect(all.filter((o) => o.selected)).toEqual([
      { value: 'firewall', label: 'Firewall', selected: true },
    ]);
    // Labels, not raw ids.
    expect(all.find((o) => o.value === 'switchEnterprise')?.label).toBe(
      'Switch Enterprise',
    );
  });

  it('keeps types without a category in one unheaded run', () => {
    const groups = typeOptionGroups('line', linkCatalog());
    expect(groups).toHaveLength(1);
    expect(groups[0]!.group).toBeNull();
    expect(groups[0]!.options.find((o) => o.selected)?.value).toBe('line');
  });

  it('lists an unknown current type first, under its own id', () => {
    const groups = typeOptionGroups('retired-type', nodeCatalog());
    expect(groups[0]).toEqual({
      group: null,
      options: [
        { value: 'retired-type', label: 'retired-type', selected: true },
      ],
    });
    expect(
      groups.flatMap((g) => g.options).filter((o) => o.selected),
    ).toHaveLength(1);
  });

  it('includes a document custom type under Custom', () => {
    const catalog = nodeCatalog([{ typeName: 'probe' } as CustomNodeSpec]);
    const groups = typeOptionGroups('probe', catalog);
    const group = groups.find((g) => g.group === 'Custom');
    expect(group?.options).toEqual([
      { value: 'probe', label: 'probe', selected: true },
    ]);
  });
});
