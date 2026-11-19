import { describe, expect, it } from 'vitest';
import type { NodeConfig } from '../../vendor/topology-ds.js';
import { linkAttachSummary, overridesLinkAttach } from './link-attachment.js';

const node = (extra: Partial<NodeConfig> = {}): NodeConfig =>
  ({ id: 'n', type: 'router', x: 0, y: 0, ...extra }) as NodeConfig;

describe('the line the Link attachment section opens with', () => {
  it('says what the page gives a node without an override', () => {
    expect(linkAttachSummary({ pad: 6, distribute: true }, node())).toBe(
      'From page: anchor box on, 6 px padding, ends distributed.',
    );
    expect(linkAttachSummary({}, node())).toBe(
      'From page: anchor box on, 6 px padding, ends not distributed.',
    );
    expect(linkAttachSummary(undefined, node())).toBe(
      'From page: off. Links meet the icon edge.',
    );
  });

  it('says what the node’s own override makes of it', () => {
    // The override's values win; what it leaves out comes from the page.
    expect(
      linkAttachSummary(
        { distribute: true },
        node({ linkAttach: { pad: 12 } }),
      ),
    ).toBe('This node: anchor box on, 12 px padding, ends distributed.');
    // An override turns the box on for a node on a page without it.
    expect(linkAttachSummary(undefined, node({ linkAttach: {} }))).toBe(
      'This node: anchor box on, 6 px padding, ends not distributed.',
    );
    expect(
      linkAttachSummary(undefined, node({ linkAttach: { pad: 2.345 } })),
    ).toBe('This node: anchor box on, 2.35 px padding, ends not distributed.');
  });

  it('tells an override from none', () => {
    expect(overridesLinkAttach(node())).toBe(false);
    expect(overridesLinkAttach(node({ linkAttach: {} }))).toBe(true);
  });
});
