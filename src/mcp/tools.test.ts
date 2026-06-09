import { describe, it, expect, beforeEach } from 'vitest';
import { TopologyStore } from './store.js';
import { createTools, type ToolDef } from './tools.js';
import { renderDocumentToSVG } from '../server/render.js';
import type { TopologyDocument } from '../pages/model.js';

describe('MCP tools', () => {
  let store: TopologyStore;
  let tools: ToolDef[];
  const call = (name: string, args: Record<string, unknown> = {}): unknown =>
    tools.find((t) => t.name === name)!.handler(args);

  beforeEach(() => {
    store = new TopologyStore();
    tools = createTools(store, { renderDocument: renderDocumentToSVG });
  });

  it('exposes the full authoring + render + discovery surface', () => {
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'add_anchor',
        'add_flow_path',
        'add_link',
        'add_node',
        'add_page',
        'add_policy_marker',
        'add_zone',
        'create_from_template',
        'create_topology',
        'define_node_type',
        'delete_topology',
        'describe_capabilities',
        'get_topology',
        'import_topology',
        'layout_guidelines',
        'layout_topology',
        'list_templates',
        'list_topologies',
        'render_svg',
        'set_document_title',
        'set_node_metadata',
        'set_page_properties',
        'tidy_topology',
        'validate_topology',
      ].sort(),
    );
  });

  it('exposes layout guidelines and folds layout checks into validation', () => {
    const g = call('layout_guidelines') as {
      rules: { minNodeGap: number };
      guidance: string[];
    };
    expect(g.rules.minNodeGap).toBeGreaterThan(0);
    expect(g.guidance.length).toBeGreaterThan(0);

    const { id } = call('create_topology', {}) as { id: string };
    call('add_node', {
      topologyId: id,
      type: 'ec',
      x: 200,
      y: 200,
      nodeId: 'a',
    });
    call('add_node', {
      topologyId: id,
      type: 'ec',
      x: 203,
      y: 201,
      nodeId: 'b',
    });
    const v = call('validate_topology', { topologyId: id }) as {
      valid: boolean;
      layoutClean: boolean;
      problems: { message: string }[];
    };
    expect(v.valid).toBe(true); // overlaps are warnings, not errors
    expect(v.layoutClean).toBe(false);
    expect(v.problems.some((p) => /overlap/.test(p.message))).toBe(true);
  });

  it('edits document title and page properties (name / viewBox)', () => {
    const { id } = call('create_topology', { title: 'Old' }) as { id: string };
    const t = call('set_document_title', { topologyId: id, title: 'New' }) as {
      title: string;
    };
    expect(t.title).toBe('New');

    call('add_page', { topologyId: id, name: 'Page 2' });
    const p = call('set_page_properties', {
      topologyId: id,
      pageIndex: 1,
      name: 'Renamed',
      viewBox: '0 0 1600 900',
    }) as { name: string; viewBox: string };
    expect(p.name).toBe('Renamed');
    expect(p.viewBox).toBe('0 0 1600 900');

    // The edits persist on the stored document (the contract surface).
    const doc = call('get_topology', { topologyId: id }) as TopologyDocument;
    expect(doc.title).toBe('New');
    expect(doc.pages[1]!.name).toBe('Renamed');
    expect(doc.pages[1]!.viewBox).toBe('0 0 1600 900');
  });

  it('node common fields include opacity + label controls (catalog-driven)', () => {
    const { id } = call('create_topology', {}) as { id: string };
    const node = call('add_node', {
      topologyId: id,
      type: 'ec',
      x: 100,
      y: 100,
      nodeId: 'a',
      extra: { opacity: 0.5, labelColor: '#fc6161', labelOffset: 30 },
    }) as { opacity?: number; labelColor?: string; labelOffset?: number };
    expect(node.opacity).toBe(0.5);
    expect(node.labelColor).toBe('#fc6161');
    expect(node.labelOffset).toBe(30);
  });

  it('tidy_topology resolves overlaps the layout checker flagged', () => {
    const { id } = call('create_topology', {}) as { id: string };
    call('add_node', {
      topologyId: id,
      type: 'ec',
      x: 200,
      y: 200,
      nodeId: 'a',
    });
    call('add_node', {
      topologyId: id,
      type: 'ec',
      x: 206,
      y: 202,
      nodeId: 'b',
    });
    const res = call('tidy_topology', { topologyId: id }) as {
      movedNodes: number;
      before: number;
      after: number;
    };
    expect(res.before).toBeGreaterThan(0);
    expect(res.after).toBe(0);
    expect(res.movedNodes).toBeGreaterThan(0);
    // the mutation persisted on the stored doc
    const v = call('validate_topology', { topologyId: id }) as {
      layoutClean: boolean;
    };
    expect(v.layoutClean).toBe(true);
  });

  it('layout_topology arranges piled-up nodes into a clean layout', () => {
    const { id } = call('create_topology', {}) as { id: string };
    for (const nid of ['a', 'b', 'c', 'd', 'e', 'f'])
      call('add_node', {
        topologyId: id,
        type: 'ec',
        x: 200,
        y: 200,
        nodeId: nid,
      });
    const res = call('layout_topology', {
      topologyId: id,
      algorithm: 'grid',
    }) as { movedNodes: number };
    expect(res.movedNodes).toBeGreaterThan(0);
    const v = call('validate_topology', { topologyId: id }) as {
      layoutClean: boolean;
    };
    expect(v.layoutClean).toBe(true);
  });

  it('create_from_template instantiates a valid, clean template', () => {
    const list = call('list_templates') as { id: string }[];
    expect(list.length).toBeGreaterThanOrEqual(5);
    const { id } = call('create_from_template', {
      template: list[0]!.id,
      title: 'My net',
    }) as { id: string };
    const v = call('validate_topology', { topologyId: id }) as {
      valid: boolean;
      layoutClean: boolean;
    };
    expect(v.valid).toBe(true);
    expect(v.layoutClean).toBe(true);
  });

  it('sets node metadata (replace + merge) reachable via the document', () => {
    const { id } = call('create_topology', {}) as { id: string };
    call('add_node', {
      topologyId: id,
      type: 'ec',
      x: 0,
      y: 0,
      nodeId: 'n',
      meta: { serial: 'SN1' },
    });
    call('set_node_metadata', {
      topologyId: id,
      nodeId: 'n',
      meta: { hostname: 'edge-01', version: '2.3' },
      merge: true,
    });
    const doc = call('get_topology', { topologyId: id }) as TopologyDocument;
    expect(doc.pages[0]!.nodes[0]!.meta).toMatchObject({
      serial: 'SN1',
      hostname: 'edge-01',
      version: '2.3',
    });
    // replace (no merge) drops prior keys
    call('set_node_metadata', {
      topologyId: id,
      nodeId: 'n',
      meta: { site: 'HQ' },
    });
    const doc2 = call('get_topology', { topologyId: id }) as TopologyDocument;
    expect(doc2.pages[0]!.nodes[0]!.meta).toEqual({ site: 'HQ' });
    expect(() =>
      call('set_node_metadata', { topologyId: id, nodeId: 'ghost', meta: {} }),
    ).toThrow(/unknown node/);
  });

  it('builds, validates, and renders a topology end to end', () => {
    const { id } = call('create_topology', { title: 'Net' }) as { id: string };
    call('add_node', {
      topologyId: id,
      type: 'ec',
      x: 200,
      y: 200,
      label: 'EC',
    });
    call('add_node', {
      topologyId: id,
      type: 'cloud',
      x: 600,
      y: 200,
      nodeId: 'inet',
      label: 'Internet',
    });
    call('add_link', {
      topologyId: id,
      type: 'tunnel',
      from: 'inet',
      to: 'inet',
    });

    const v = call('validate_topology', { topologyId: id }) as {
      valid: boolean;
    };
    expect(v.valid).toBe(true);

    const svg = call('render_svg', { topologyId: id }) as string;
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('Internet');
  });

  it('round-trips through get_topology → import_topology', () => {
    const { id } = call('create_topology', {}) as { id: string };
    call('add_node', { topologyId: id, type: 'host', x: 1, y: 2, nodeId: 'h' });
    const doc = call('get_topology', { topologyId: id }) as TopologyDocument;
    const back = call('import_topology', { json: doc }) as { id: string };
    expect(back.id).not.toBe(id);
    const doc2 = call('get_topology', {
      topologyId: back.id,
    }) as TopologyDocument;
    expect(doc2.pages[0]!.nodes[0]!.id).toBe('h');
  });

  it('renders the full annotation layer via tools', () => {
    const { id } = call('create_topology', {}) as { id: string };
    call('add_node', {
      topologyId: id,
      type: 'ec',
      x: 200,
      y: 200,
      nodeId: 'a',
    });
    call('add_node', {
      topologyId: id,
      type: 'cloud',
      x: 600,
      y: 200,
      nodeId: 'b',
    });
    call('add_zone', {
      topologyId: id,
      nodes: ['a', 'b'],
      label: 'Edge',
      zoneId: 'z',
    });
    call('add_flow_path', {
      topologyId: id,
      waypoints: ['a', 'b'],
      flowPathId: 'f',
    });
    call('add_policy_marker', {
      topologyId: id,
      nodeId: 'a',
      type: 'inspect',
      markerId: 'm',
    });
    const svg = call('render_svg', { topologyId: id }) as string;
    expect(svg).toContain('data-zone-id="z"');
    expect(svg).toContain('data-tds-flowpath="f"');
    expect(svg).toContain('data-tds-marker="m"');
  });

  it('defines a custom node type and renders it', () => {
    const { id } = call('create_topology', {}) as { id: string };
    call('define_node_type', {
      topologyId: id,
      spec: { typeName: 'sensor', colorStroke: '#65aef9' },
    });
    call('add_node', {
      topologyId: id,
      type: 'sensor',
      x: 100,
      y: 100,
      nodeId: 's',
    });
    expect(call('validate_topology', { topologyId: id })).toMatchObject({
      valid: true,
    });
    const svg = call('render_svg', { topologyId: id }) as string;
    expect(svg).toContain('#65aef9');
    // custom type is discoverable through the capability surface
    const caps = call('describe_capabilities', { topologyId: id }) as {
      nodeTypes: { type: string; custom: boolean }[];
    };
    expect(caps.nodeTypes.some((n) => n.type === 'sensor' && n.custom)).toBe(
      true,
    );
  });

  it('describe_capabilities lists built-in vocabulary + annotations', () => {
    const caps = call('describe_capabilities', {}) as {
      nodeTypes: unknown[];
      linkTypes: unknown[];
      annotations: { kind: string }[];
    };
    expect(caps.nodeTypes.length).toBeGreaterThan(5);
    expect(caps.linkTypes.length).toBeGreaterThan(3);
    expect(caps.annotations.map((a) => a.kind).sort()).toEqual([
      'flowPath',
      'policyMarker',
      'zone',
    ]);
  });

  it('surfaces errors as thrown Errors (adapter turns these into isError)', () => {
    expect(() => call('get_topology', { topologyId: 'nope' })).toThrow(
      /unknown topology/,
    );
    const { id } = call('create_topology', {}) as { id: string };
    expect(() =>
      call('add_node', {
        topologyId: id,
        pageIndex: 9,
        type: 'ec',
        x: 0,
        y: 0,
      }),
    ).toThrow(/out of range/);
    expect(() =>
      call('define_node_type', { topologyId: id, spec: { size: 30 } }),
    ).toThrow(/typeName is required/);
  });

  it('omits share_topology unless a publish dep is provided', () => {
    expect(tools.some((t) => t.name === 'share_topology')).toBe(false);
  });

  it('share_topology publishes the stored doc and returns the link', async () => {
    let published: TopologyDocument | undefined;
    const withShare = createTools(store, {
      renderDocument: renderDocumentToSVG,
      publishTopology: async (doc) => {
        published = doc;
        return { id: 'abc123', url: 'https://example.com/v/abc123' };
      },
    });
    const share = withShare.find((t) => t.name === 'share_topology')!;
    const { id } = call('create_topology', { title: 'Shared' }) as {
      id: string;
    };
    call('add_node', { topologyId: id, type: 'ec', x: 10, y: 10, nodeId: 'a' });

    const res = (await share.handler({ topologyId: id })) as {
      id: string;
      url: string;
    };
    expect(res.url).toBe('https://example.com/v/abc123');
    // It snapshots the live stored document (with the node just added).
    expect(published?.title).toBe('Shared');
    expect(published?.pages[0]!.nodes[0]!.id).toBe('a');
  });

  it('add_page targets the new page by default; pageIndex overrides', () => {
    const { id } = call('create_topology', {}) as { id: string };
    call('add_page', { topologyId: id, name: 'Frame 2' });
    // default → last page (index 1)
    call('add_node', {
      topologyId: id,
      type: 'host',
      x: 0,
      y: 0,
      nodeId: 'n2',
    });
    // explicit → first page
    call('add_node', {
      topologyId: id,
      pageIndex: 0,
      type: 'host',
      x: 0,
      y: 0,
      nodeId: 'n1',
    });
    const doc = call('get_topology', { topologyId: id }) as TopologyDocument;
    expect(doc.pages[1]!.nodes.map((n) => n.id)).toEqual(['n2']);
    expect(doc.pages[0]!.nodes.map((n) => n.id)).toEqual(['n1']);
  });
});
