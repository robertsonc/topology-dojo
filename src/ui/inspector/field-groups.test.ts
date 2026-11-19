import { describe, expect, it } from 'vitest';
import {
  getLinkType,
  getNodeType,
  linkCatalog,
  nodeCatalog,
  type FieldSpec,
} from '../../api/catalog.js';
import {
  HEADER_KEYS,
  LINK_GROUPS,
  NODE_GROUPS,
  planSections,
  typeOptionsTitle,
  type PlannedItem,
  type PlannedSection,
} from './field-groups.js';

/** Every field key a plan shows, in the order it shows them. */
const keysOf = (sections: PlannedSection[]): string[] => {
  const walk = (items: PlannedItem[]): string[] =>
    items.flatMap((it) =>
      it.kind === 'field'
        ? [it.field.key]
        : it.kind === 'pair'
          ? it.fields.map((f) => f.key)
          : walk(it.items),
    );
  return sections.flatMap((s) => walk(s.items));
};

const nodePlan = (type: string): PlannedSection[] => {
  const info = getNodeType(type)!;
  return planSections(info.fields, NODE_GROUPS, info.label);
};

describe('the sections of a node', () => {
  it('come in the order of the panel, open where the panel opens them', () => {
    const plan = nodePlan('host');
    expect(plan.map((s) => [s.title, s.open])).toEqual([
      ['Text', true],
      ['Style', true],
      ['Link attachment', true],
      ['Wiring', false],
      ['Host options', false],
      ['Position and order', false],
      ['Data', false],
    ]);
  });

  it('show every field of every type exactly once', () => {
    for (const { type } of nodeCatalog()) {
      const info = getNodeType(type)!;
      const shown = keysOf(planSections(info.fields, NODE_GROUPS, info.label));
      const inHeader = info.fields
        .map((f) => f.key)
        .filter((k) => HEADER_KEYS.includes(k));
      expect([...shown, ...inHeader].sort(), type).toEqual(
        info.fields.map((f) => f.key).sort(),
      );
    }
  });

  it('put a field no section names under the type, so none is lost', () => {
    const extra: FieldSpec = { key: 'brandNew', label: 'New', kind: 'string' };
    const info = getNodeType('router')!;
    const plan = planSections([...info.fields, extra], NODE_GROUPS, 'Router');
    const options = plan.find((s) => s.title === typeOptionsTitle('Router'));
    expect(options?.fields.map((f) => f.key)).toEqual(['brandNew']);
    // A type with nothing of its own has no options section at all.
    expect(nodePlan('router').map((s) => s.title)).not.toContain(
      'Router options',
    );
  });

  it('draw the label offsets as one row, with the label width, in a nested "Fine tune" section', () => {
    const text = nodePlan('router').find((s) => s.title === 'Text')!;
    expect(
      text.items.map((it) => (it.kind === 'field' ? it.field.key : it.kind)),
    ).toEqual(['label', 'sublabel', 'labelPlacement', 'nested', 'labelColor']);
    const nested = text.items[3]!;
    expect(nested).toMatchObject({ kind: 'nested', title: 'Fine tune' });
    expect(nested.kind === 'nested' && nested.items).toEqual([
      {
        kind: 'pair',
        label: 'Offset',
        fields: [
          expect.objectContaining({ key: 'labelOffsetX' }),
          expect.objectContaining({ key: 'labelOffset' }),
        ],
      },
      { kind: 'field', field: expect.objectContaining({ key: 'labelWidth' }) },
    ]);
  });

  it('draw X and Y as one row', () => {
    const position = nodePlan('router').find(
      (s) => s.title === 'Position and order',
    )!;
    expect(position.items[0]).toMatchObject({
      kind: 'pair',
      label: 'Position',
      fields: [{ key: 'x' }, { key: 'y' }],
    });
  });

  it('keep the link attachment override in its own section', () => {
    const attach = nodePlan('router').find(
      (s) => s.title === 'Link attachment',
    )!;
    expect(attach.fields.map((f) => f.key)).toEqual(['linkAttach']);
  });
});

describe('the sections of a link', () => {
  it('come in the order of the panel', () => {
    const info = getLinkType('line')!;
    const plan = planSections(info.fields, LINK_GROUPS, info.label);
    expect(plan.map((s) => [s.title, s.open])).toEqual([
      ['Label', true],
      ['Style', true],
      ['Routing', true],
      ['Wiring', false],
      ['Animation', false],
      ['Data', false],
    ]);
    const routing = plan.find((s) => s.title === 'Routing')!;
    expect(routing.items).toContainEqual(
      expect.objectContaining({
        kind: 'pair',
        fields: [
          expect.objectContaining({ key: 'fromPortOffset' }),
          expect.objectContaining({ key: 'toPortOffset' }),
        ],
      }),
    );
  });

  it('draw the two ends of a link side by side', () => {
    const info = getLinkType('line')!;
    const plan = planSections(info.fields, LINK_GROUPS, info.label);
    const pairs = plan
      .flatMap((s) => s.items)
      .filter((it) => it.kind === 'pair')
      .map((it) => it.kind === 'pair' && it.fields.map((f) => f.key));
    expect(pairs).toEqual([
      ['fromLabel', 'toLabel'],
      ['labelScale', 'labelWidth'],
      ['strokeWidth', 'opacity'],
      ['lineStyle', 'cornerRadius'],
      ['fromPort', 'toPort'],
      ['fromPortOffset', 'toPortOffset'],
    ]);
  });

  it('stack the two sides under their label, at the row’s full width', () => {
    const info = getLinkType('line')!;
    const plan = planSections(info.fields, LINK_GROUPS, info.label);
    const sides = plan
      .flatMap((s) => s.items)
      .find((it) => it.kind === 'pair' && it.fields[0].key === 'fromPort');
    expect(sides).toEqual(
      expect.objectContaining({
        label: 'Sides',
        stack: true,
        shortOptions: { '': 'Auto (facing)' },
      }),
    );
  });

  it('show every field of every type exactly once', () => {
    for (const { type } of linkCatalog()) {
      const info = getLinkType(type)!;
      const shown = keysOf(planSections(info.fields, LINK_GROUPS, info.label));
      const inHeader = info.fields
        .map((f) => f.key)
        .filter((k) => HEADER_KEYS.includes(k));
      expect([...shown, ...inHeader].sort(), type).toEqual(
        info.fields.map((f) => f.key).sort(),
      );
    }
  });

  it('give a type its own options section for what is only its own', () => {
    const info = getLinkType('blocked')!;
    const plan = planSections(info.fields, LINK_GROUPS, info.label);
    expect(plan.find((s) => s.title === 'Blocked options')?.fields).toEqual([
      expect.objectContaining({ key: 'reason' }),
    ]);
  });
});

describe('the header', () => {
  it('shows the lock, which no section takes', () => {
    const node = nodePlan('router');
    const link = planSections(getLinkType('line')!.fields, LINK_GROUPS, 'Line');
    expect(keysOf(node)).not.toContain('locked');
    expect(keysOf(link)).not.toContain('locked');
    expect(getNodeType('router')!.fields.map((f) => f.key)).toContain('locked');
  });
});
