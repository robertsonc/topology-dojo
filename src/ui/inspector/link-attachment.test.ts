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
    ).toBe(
      'This node: anchor box on, 12 px padding, ends distributed (from page).',
    );
    // An override turns the box on for a node on a page without it.
    expect(linkAttachSummary(undefined, node({ linkAttach: {} }))).toBe(
      'This node: anchor box on, 6 px padding, ends not distributed.',
    );
    expect(
      linkAttachSummary(undefined, node({ linkAttach: { pad: 2.345 } })),
    ).toBe('This node: anchor box on, 2.35 px padding, ends not distributed.');
  });

  it('names the page as the source of what a partial override leaves out', () => {
    // The node sets only distribute: the padding is the page's.
    expect(
      linkAttachSummary(
        { pad: 9 },
        node({ linkAttach: { distribute: false } }),
      ),
    ).toBe(
      'This node: anchor box on, 9 px padding (from page), ends not distributed.',
    );
    // Both left out, both from the page.
    expect(
      linkAttachSummary({ pad: 8, distribute: true }, node({ linkAttach: {} })),
    ).toBe(
      'This node: anchor box on, 8 px padding (from page), ends distributed (from page).',
    );
    // Both set on the node: nothing comes from the page.
    expect(
      linkAttachSummary(
        { pad: 8, distribute: true },
        node({ linkAttach: { pad: 3, distribute: false } }),
      ),
    ).toBe('This node: anchor box on, 3 px padding, ends not distributed.');
    // A page box without a padding gives the default, which is no page value.
    expect(
      linkAttachSummary({ distribute: true }, node({ linkAttach: {} })),
    ).toBe(
      'This node: anchor box on, 6 px padding, ends distributed (from page).',
    );
  });

  it('tells an override from none', () => {
    expect(overridesLinkAttach(node())).toBe(false);
    expect(overridesLinkAttach(node({ linkAttach: {} }))).toBe(true);
  });
});
