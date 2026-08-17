import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TopologyStore } from './store.js';
import { createTools, type ToolDef, type ToolDeps } from './tools.js';
import { parseToolArgs } from './register.js';
import { renderDocumentToSVG } from '../server/render.js';
import { MockProvider } from '../connect/mock.js';
import type { TopologyDocument } from '../pages/model.js';
import { TEXT_LIMITS } from '../api/text.js';

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
        'balance_topology',
        'create_from_template',
        'create_topology',
        'define_layer',
        'define_node_type',
        'delete_topology',
        'describe_capabilities',
        'edit_topology',
        'export_flipbook',
        'get_topology',
        'import_topology',
        'inspect_render',
        'layout_guidelines',
        'layout_topology',
        'list_templates',
        'list_topologies',
        'render_svg',
        'set_document_title',
        'set_legend',
        'set_palette',
        'remove_element',
        'set_node_metadata',
        'set_page_properties',
        'tidy_topology',
        'update_element',
        'upsert_by_source',
        'validate_topology',
      ].sort(),
    );
  });

  it('documents every tool in the MCP README (keeps docs in sync)', () => {
    const readme = readFileSync(
      fileURLToPath(new URL('./README.md', import.meta.url)),
      'utf8',
    );
    const undocumented = tools
      .map((t) => t.name)
      .filter((n) => !readme.includes(`\`${n}\``));
    expect(undocumented).toEqual([]);
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

  it('balances a topology (tidy + align/centre) in place', () => {
    const { id } = call('create_topology', {}) as { id: string };
    call('add_node', {
      topologyId: id,
      type: 'ec',
      x: 137,
      y: 211,
      nodeId: 'a',
    });
    call('add_node', {
      topologyId: id,
      type: 'ec',
      x: 642,
      y: 218,
      nodeId: 'b',
    });
    const r = call('balance_topology', { topologyId: id }) as {
      movedNodes: number;
      before: number;
      after: number;
    };
    expect(r.movedNodes).toBeGreaterThan(0);
    const doc = call('get_topology', { topologyId: id }) as TopologyDocument;
    // Balance lands the two nodes on a shared row (equal y after alignment).
    expect(doc.pages[0]!.nodes[0]!.y).toBe(doc.pages[0]!.nodes[1]!.y);
  });

  it('sets the legend + brand palette, and render_svg applies both', () => {
    const { id } = call('create_topology', {}) as { id: string };
    call('add_node', {
      topologyId: id,
      type: 'ec',
      x: 200,
      y: 200,
      nodeId: 'a',
    });
    call('set_legend', { topologyId: id, show: true, position: 'br' });
    call('set_palette', { topologyId: id, accent: '#FF8800' });
    const doc = call('get_topology', { topologyId: id }) as TopologyDocument;
    expect(doc.legend).toEqual({ show: true, position: 'br' });
    expect(doc.palette!.accent).toBe('#ff8800'); // lower-cased

    const svg = call('render_svg', { topologyId: id }) as string;
    expect(svg).toContain('#ff8800'); // palette recoloured the canvas
    expect(svg).not.toContain('#01a982'); // engine green remapped away
    expect(svg).toContain('tds-legend'); // legend drawn into the output

    // Clearing restores defaults.
    call('set_palette', { topologyId: id, clear: true });
    expect(
      (call('get_topology', { topologyId: id }) as TopologyDocument).palette,
    ).toBeUndefined();
  });

  it('define_layer accepts plane opacity', () => {
    const { id } = call('create_topology', {}) as { id: string };
    call('define_layer', {
      topologyId: id,
      layerId: 'overlay',
      name: 'Overlay',
      opacity: 0.5,
    });
    const doc = call('get_topology', { topologyId: id }) as TopologyDocument;
    expect(doc.layers!.find((l) => l.id === 'overlay')!.opacity).toBe(0.5);
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

  it('add_link accepts a first-class labelScale that persists on the link', () => {
    const { id } = call('create_topology', {}) as { id: string };
    call('add_node', { topologyId: id, type: 'ec', x: 0, y: 0, nodeId: 'a' });
    call('add_node', { topologyId: id, type: 'ec', x: 200, y: 0, nodeId: 'b' });
    const link = call('add_link', {
      topologyId: id,
      type: 'line',
      from: 'a',
      to: 'b',
      linkId: 'l',
      labelScale: 1.5,
    }) as { labelScale?: number };
    expect(link.labelScale).toBe(1.5);
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

  it('inspect_render returns a compact, bounded visual-quality report', () => {
    const { id } = call('create_topology', {}) as { id: string };
    // Visual defects validate_topology cannot describe: an off-page node, two
    // long labels colliding across narrow columns, and crossing links.
    call('edit_topology', {
      topologyId: id,
      operations: [
        { op: 'add_node', type: 'ec', x: 1200, y: 350, nodeId: 'off' },
        {
          op: 'add_node',
          type: 'ec',
          x: 320,
          y: 200,
          nodeId: 'a',
          label: 'core-aggregation-router-1',
        },
        {
          op: 'add_node',
          type: 'ec',
          x: 440,
          y: 200,
          nodeId: 'b',
          label: 'core-aggregation-router-2',
        },
        { op: 'add_node', type: 'ec', x: 320, y: 400, nodeId: 'c' },
        { op: 'add_node', type: 'ec', x: 440, y: 400, nodeId: 'd' },
        { op: 'add_link', type: 'line', from: 'a', to: 'd', linkId: 'x1' },
        { op: 'add_link', type: 'line', from: 'b', to: 'c', linkId: 'x2' },
      ],
    });
    const r = call('inspect_render', { topologyId: id }) as {
      pageIndex: number;
      pageName: string;
      clean: boolean;
      counts: Record<string, { problems: number; notes: number }>;
      findings: { severity: string; category: string; message: string }[];
      contentBounds: object;
      margins: object;
    };
    expect(r.pageIndex).toBe(0);
    expect(r.clean).toBe(false);
    expect(r.counts.crop!.problems).toBeGreaterThan(0);
    expect(r.counts.text!.problems).toBeGreaterThan(0);
    expect(r.counts.routing!.problems).toBeGreaterThan(0);
    const text = r.findings.map((f) => f.message).join('\n');
    expect(text).toMatch(/node "off".*past the right page edge/);
    expect(text).toMatch(/collide/);
    expect(text).toMatch(/links "x1" and "x2" cross/);
    // Compact: a few KB even for a defective page (vs 20–300KB of SVG).
    expect(JSON.stringify(r).length).toBeLessThan(4096);

    // The findings cap bounds output; true totals survive in counts.
    const capped = call('inspect_render', {
      topologyId: id,
      maxFindingsPerCategory: 1,
    }) as typeof r & { omitted: number };
    for (const cat of ['crop', 'text', 'routing', 'density'])
      expect(
        capped.findings.filter((f) => f.category === cat).length,
      ).toBeLessThanOrEqual(1);
    expect(capped.counts).toEqual(r.counts);

    expect(() =>
      call('inspect_render', { topologyId: id, pageIndex: 9 }),
    ).toThrow(/out of range/);
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

  describe('import_topology legacy Topology Studio support', () => {
    const loadFixture = (name: string): unknown =>
      JSON.parse(
        readFileSync(
          fileURLToPath(
            new URL(`../../fixtures/legacy/${name}`, import.meta.url),
          ),
          'utf8',
        ),
      );

    it('format "auto" detects and converts a legacy fixture, returning warnings', () => {
      const legacy = loadFixture('sdwan-branch.json');
      const result = call('import_topology', { json: legacy }) as {
        id: string;
        pages: number;
        format?: string;
        warnings?: string[];
      };
      expect(result.format).toBe('legacy-studio');
      expect(result.pages).toBe(3);
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBeGreaterThan(0);

      const doc = call('get_topology', {
        topologyId: result.id,
      }) as TopologyDocument;
      expect(doc.pages.length).toBe(3);
    });

    it('format "topology-dojo" rejects a legacy document (no pages array for parseDoc)', () => {
      const legacy = loadFixture('sdwan-branch.json');
      expect(() =>
        call('import_topology', { json: legacy, format: 'topology-dojo' }),
      ).toThrow(/invalid topology document JSON/);
    });

    it('format "legacy-studio" on a native document yields a typed conversion failure', () => {
      const { id } = call('create_topology', {}) as { id: string };
      call('add_node', {
        topologyId: id,
        type: 'host',
        x: 1,
        y: 2,
        nodeId: 'h',
      });
      const nativeDoc = call('get_topology', {
        topologyId: id,
      }) as TopologyDocument;
      expect(() =>
        call('import_topology', { json: nativeDoc, format: 'legacy-studio' }),
      ).toThrow(/legacy Topology Studio conversion failed/);
    });

    it('format "topology-dojo" is unaffected for a native document (unchanged behavior)', () => {
      const { id } = call('create_topology', {}) as { id: string };
      call('add_node', {
        topologyId: id,
        type: 'host',
        x: 1,
        y: 2,
        nodeId: 'h',
      });
      const doc = call('get_topology', { topologyId: id }) as TopologyDocument;
      const back = call('import_topology', {
        json: doc,
        format: 'topology-dojo',
      }) as { id: string; format?: string };
      expect(back.id).not.toBe(id);
      expect(back.format).toBeUndefined();
    });
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

  it('describe_capabilities defaults to a compact index (no fields)', () => {
    const caps = call('describe_capabilities', {}) as {
      nodeTypes: { type: string; fields?: unknown }[];
      linkTypes: unknown[];
      annotationKinds: string[];
      layerKinds: string[];
    };
    expect(caps.nodeTypes.length).toBeGreaterThan(5);
    expect(caps.linkTypes.length).toBeGreaterThan(3);
    expect(caps.nodeTypes.every((n) => n.fields === undefined)).toBe(true);
    expect(caps.annotationKinds.sort()).toEqual([
      'flowPath',
      'policyMarker',
      'zone',
    ]);
    expect(caps.layerKinds).toContain('underlay');
    expect(caps.layerKinds).toContain('overlay');
    // The index is a fraction of the full catalog — the point of the default.
    const index = JSON.stringify(caps).length;
    const full = JSON.stringify(
      call('describe_capabilities', { detail: 'full' }),
    ).length;
    expect(index).toBeLessThan(full / 5);
  });

  it('describe_capabilities detail:"full" returns editable fields + annotations', () => {
    const caps = call('describe_capabilities', { detail: 'full' }) as {
      nodeTypes: { type: string; fields: { key: string }[] }[];
      linkTypes: { fields: unknown[] }[];
      annotations: { kind: string }[];
      layers: { kinds: string[] };
    };
    expect(caps.nodeTypes.every((n) => n.fields.length > 0)).toBe(true);
    expect(caps.annotations.map((a) => a.kind).sort()).toEqual([
      'flowPath',
      'policyMarker',
      'zone',
    ]);
    expect(caps.layers.kinds).toContain('underlay');
  });

  it('describe_capabilities narrows to full fields via types / query', () => {
    const byType = call('describe_capabilities', {
      types: ['ec', 'tunnel'],
    }) as {
      nodeTypes: { type: string; fields: unknown[] }[];
      linkTypes: { type: string; fields: unknown[] }[];
    };
    expect(byType.nodeTypes.map((n) => n.type)).toEqual(['ec']);
    expect(byType.linkTypes.map((l) => l.type)).toEqual(['tunnel']);
    expect(byType.nodeTypes[0]!.fields.length).toBeGreaterThan(0);

    const byQuery = call('describe_capabilities', { query: 'firewall' }) as {
      nodeTypes: { type: string; fields: unknown[] }[];
    };
    expect(byQuery.nodeTypes.some((n) => n.type === 'firewall')).toBe(true);
    expect(byQuery.nodeTypes[0]!.fields.length).toBeGreaterThan(0);
  });

  it('get_topology summary + pageIndex return bounded slices', () => {
    const { id } = call('create_topology', { title: 'Big' }) as { id: string };
    call('add_node', {
      topologyId: id,
      type: 'ec',
      x: 100,
      y: 100,
      nodeId: 'a',
    });
    call('add_node', {
      topologyId: id,
      type: 'ec',
      x: 300,
      y: 100,
      nodeId: 'b',
    });
    call('add_link', { topologyId: id, type: 'line', from: 'a', to: 'b' });

    const summary = call('get_topology', { topologyId: id, summary: true }) as {
      title: string;
      pages: { nodes: number; links: number }[];
    };
    expect(summary.title).toBe('Big');
    expect(summary.pages[0]).toMatchObject({ nodes: 2, links: 1 });

    const page = call('get_topology', { topologyId: id, pageIndex: 0 }) as {
      pageCount: number;
      page: { nodes: unknown[] };
    };
    expect(page.pageCount).toBe(1);
    expect(page.page.nodes.length).toBe(2);
    expect(() =>
      call('get_topology', { topologyId: id, pageIndex: 9 }),
    ).toThrow(/out of range/);
  });

  it('edit_topology applies a batch of operations in one call', () => {
    const { id } = call('create_topology', { title: 'Batch' }) as {
      id: string;
    };
    const result = call('edit_topology', {
      topologyId: id,
      operations: [
        { op: 'add_node', type: 'ec', x: 120, y: 80, nodeId: 'a', label: 'A' },
        { op: 'add_node', type: 'cloud', x: 420, y: 80, nodeId: 'b' },
        { op: 'add_link', type: 'tunnel', from: 'a', to: 'b', linkId: 'l1' },
        { op: 'add_zone', nodes: ['a'], label: 'Site', zoneId: 'z1' },
        { op: 'update_element', elementId: 'a', set: { label: 'A2' } },
      ],
    }) as { applied: number; results: { op: string; id?: string }[] };
    expect(result.applied).toBe(5);
    expect(result.results[0]).toMatchObject({ op: 'add_node', id: 'a' });
    const doc = store.get(id);
    expect(doc.pages[0]!.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(doc.pages[0]!.nodes.find((n) => n.id === 'a')!.label).toBe('A2');
    expect(doc.pages[0]!.links.length).toBe(1);
    expect(doc.pages[0]!.zones?.length).toBe(1);
  });

  it('edit_topology is atomic: a failing op rolls the document back', () => {
    const { id } = call('create_topology', { title: 'Atomic' }) as {
      id: string;
    };
    call('add_node', {
      topologyId: id,
      type: 'ec',
      x: 50,
      y: 50,
      nodeId: 'keep',
    });
    expect(() =>
      call('edit_topology', {
        topologyId: id,
        operations: [
          { op: 'add_node', type: 'ec', x: 200, y: 200, nodeId: 'n1' },
          { op: 'not_a_real_op' },
        ],
      }),
    ).toThrow(/operations\[1\]: unknown op/);
    // The first (successful) op must have been rolled back too.
    expect(store.get(id).pages[0]!.nodes.map((n) => n.id)).toEqual(['keep']);
  });

  it('updates, removes (with cascade), and upserts by source via tools', () => {
    const { id } = call('create_topology', { title: 'Live' }) as { id: string };
    const src = { system: 'edgeconnect', kind: 'appliance', id: 'nePk:7.NE' };

    // First import run: creates.
    const first = call('upsert_by_source', {
      topologyId: id,
      kind: 'node',
      source: { ...src, fetchedAt: '2026-06-11T00:00:00Z' },
      set: { type: 'ec', x: 200, y: 200, label: 'EC-7' },
    }) as { created: boolean; element: { id: string } };
    expect(first.created).toBe(true);

    // Second run: converges (no duplicate), refreshes the source ref.
    const second = call('upsert_by_source', {
      topologyId: id,
      kind: 'node',
      source: { ...src, fetchedAt: '2026-06-11T01:00:00Z' },
      set: { label: 'EC-7 (up)' },
    }) as { created: boolean; element: { id: string } };
    expect(second.created).toBe(false);
    expect(second.element.id).toBe(first.element.id);
    let doc = call('get_topology', { topologyId: id }) as TopologyDocument;
    expect(doc.pages[0]!.nodes).toHaveLength(1);
    expect(doc.pages[0]!.nodes[0]!.label).toBe('EC-7 (up)');
    expect(doc.pages[0]!.nodes[0]!.source?.fetchedAt).toBe(
      '2026-06-11T01:00:00Z',
    );

    // update_element patches in place; null clears.
    call('add_node', { topologyId: id, type: 'host', x: 0, y: 0, nodeId: 'h' });
    call('add_link', {
      topologyId: id,
      type: 'line',
      from: 'h',
      to: first.element.id,
      linkId: 'lan',
    });
    call('update_element', {
      topologyId: id,
      elementId: 'lan',
      set: { label: 'LAN', color: '#65aef9' },
    });
    call('update_element', {
      topologyId: id,
      elementId: 'lan',
      set: { color: null },
    });
    doc = call('get_topology', { topologyId: id }) as TopologyDocument;
    const lan = doc.pages[0]!.links.find((l) => l.id === 'lan')!;
    expect(lan.label).toBe('LAN');
    expect(lan.color).toBeUndefined();

    // remove_element cascades: removing the host takes its link along.
    const removed = call('remove_element', {
      topologyId: id,
      elementId: 'h',
    }) as { removed: string; cascaded: { links: number } };
    expect(removed.removed).toBe('node');
    expect(removed.cascaded.links).toBe(1);
    doc = call('get_topology', { topologyId: id }) as TopologyDocument;
    expect(doc.pages[0]!.links).toHaveLength(0);
    expect(call('validate_topology', { topologyId: id })).toMatchObject({
      valid: true,
    });

    expect(() =>
      call('update_element', { topologyId: id, elementId: 'ghost', set: {} }),
    ).toThrow(/unknown element/);
  });

  it('build_flow_topology compiles the live fabric into a rendered, layered doc', async () => {
    const live = createTools(store, {
      renderDocument: renderDocumentToSVG,
      provider: new MockProvider(),
    });
    const callLive = (name: string, args: Record<string, unknown> = {}) =>
      live.find((t) => t.name === name)!.handler(args);

    const res = (await callLive('build_flow_topology', {
      title: 'Fabric flows',
      includeEnded: true,
    })) as {
      topologyId: string;
      valid: boolean;
      appliances: number;
      tunnels: number;
      flowsCompiled: number;
    };
    expect(res.valid).toBe(true);
    expect(res.appliances).toBe(3);
    expect(res.tunnels).toBe(5);
    expect(res.flowsCompiled).toBe(2);

    // The stored document is the full layered contract…
    const doc = callLive('get_topology', {
      topologyId: res.topologyId,
    }) as TopologyDocument;
    expect(doc.layers?.map((l) => l.id)).toEqual([
      'underlay',
      'overlay',
      'policy',
    ]);
    expect(doc.pages[0]!.flowPaths.length).toBe(2);
    expect(doc.pages[0]!.flowPaths[0]!.hops?.length).toBeGreaterThan(0);
    // …and renders with layer filtering.
    const svg = callLive('render_svg', {
      topologyId: res.topologyId,
      visibleLayers: ['overlay', 'policy'],
    }) as string;
    expect(svg).toContain('data-tds-flowpath=');
    expect(svg).not.toContain('data-tds-link="lk_ut_77_inet"'); // underlay hidden
  });

  it('declares layers, tags elements, and renders a filtered layer view', () => {
    const { id } = call('create_topology', { title: 'Fabric' }) as {
      id: string;
    };
    call('define_layer', {
      topologyId: id,
      layerId: 'under',
      kind: 'underlay',
    });
    call('define_layer', { topologyId: id, layerId: 'over', kind: 'overlay' });
    call('add_node', {
      topologyId: id,
      type: 'ec',
      x: 150,
      y: 200,
      nodeId: 'a',
    });
    call('add_node', {
      topologyId: id,
      type: 'ec',
      x: 650,
      y: 200,
      nodeId: 'b',
    });
    call('add_link', {
      topologyId: id,
      type: 'line',
      from: 'a',
      to: 'b',
      linkId: 'wan',
      layer: 'under',
    });
    call('add_link', {
      topologyId: id,
      type: 'tunnel',
      from: 'a',
      to: 'b',
      linkId: 'tun',
      layer: 'over',
    });

    // Layers + tags land on the document contract.
    const doc = call('get_topology', { topologyId: id }) as TopologyDocument;
    expect(doc.layers?.map((l) => l.id)).toEqual(['under', 'over']);
    expect(doc.pages[0]!.links.find((l) => l.id === 'tun')?.layer).toBe('over');

    // A tagged document still validates clean…
    expect(call('validate_topology', { topologyId: id })).toMatchObject({
      valid: true,
    });
    // …an undeclared layer reference is flagged.
    call('add_node', {
      topologyId: id,
      type: 'host',
      x: 400,
      y: 400,
      nodeId: 'ghosted',
      layer: 'ghost',
    });
    const v = call('validate_topology', { topologyId: id }) as {
      problems: { message: string }[];
    };
    expect(v.problems.some((p) => /not declared/.test(p.message))).toBe(true);

    // render_svg can isolate a plane.
    const underOnly = call('render_svg', {
      topologyId: id,
      visibleLayers: ['under'],
    }) as string;
    expect(underOnly).toContain('data-tds-link="wan"');
    expect(underOnly).not.toContain('data-tds-link="tun"');

    // define_layer updates in place by id (no duplicate).
    call('define_layer', {
      topologyId: id,
      layerId: 'over',
      name: 'Overlay tunnels',
    });
    const doc2 = call('get_topology', { topologyId: id }) as TopologyDocument;
    expect(doc2.layers?.length).toBe(2);
    expect(doc2.layers?.[1]?.name).toBe('Overlay tunnels');
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

  it('validates tool arguments at runtime (parseToolArgs)', () => {
    const addNode = tools.find((t) => t.name === 'add_node')!;
    // Malformed input is rejected with a readable message — NaN can't slip in.
    expect(() =>
      parseToolArgs(addNode, { topologyId: 't', type: 'ec', x: 'abc', y: 0 }),
    ).toThrow(/invalid arguments for add_node — x:/);
    expect(() => parseToolArgs(addNode, { type: 'ec', x: 0, y: 0 })).toThrow(
      /topologyId/,
    );
    // Valid input passes through; unknown keys are stripped.
    const parsed = parseToolArgs(addNode, {
      topologyId: 't',
      type: 'ec',
      x: 1,
      y: 2,
      bogus: true,
    });
    expect(parsed.x).toBe(1);
    expect('bogus' in parsed).toBe(false);
    // Enum-checked tools reject out-of-vocabulary values.
    const upsert = tools.find((t) => t.name === 'upsert_by_source')!;
    expect(() =>
      parseToolArgs(upsert, {
        topologyId: 't',
        kind: 'gizmo',
        source: { system: 's', kind: 'k', id: '1' },
      }),
    ).toThrow(/kind/);
  });

  it('rejects overlong free-text at the Zod boundary and normalizes controls', () => {
    const addNode = tools.find((t) => t.name === 'add_node')!;
    expect(() =>
      parseToolArgs(addNode, {
        topologyId: 't',
        type: 'ec',
        x: 0,
        y: 0,
        label: 'L'.repeat(TEXT_LIMITS.label + 1),
      }),
    ).toThrow(/label.*<=200|label.*at most|label.*exceeds/i);
    const addZone = tools.find((t) => t.name === 'add_zone')!;
    expect(() =>
      parseToolArgs(addZone, {
        topologyId: 't',
        nodes: ['n'],
        description: 'D'.repeat(TEXT_LIMITS.description + 1),
      }),
    ).toThrow(/description/);
    const setMeta = tools.find((t) => t.name === 'set_node_metadata')!;
    expect(() =>
      parseToolArgs(setMeta, {
        topologyId: 't',
        nodeId: 'n',
        meta: { serial: 'M'.repeat(TEXT_LIMITS.metaValue + 1) },
      }),
    ).toThrow(/serial|Too big|at most/i);
    const update = tools.find((t) => t.name === 'update_element')!;
    expect(() =>
      parseToolArgs(update, {
        topologyId: 't',
        elementId: 'n',
        set: { label: 'x'.repeat(TEXT_LIMITS.label + 1) },
      }),
    ).toThrow(/exceeds/);
    const parsed = parseToolArgs(addNode, {
      topologyId: 't',
      type: 'ec',
      x: 0,
      y: 0,
      label: '  Branch\u0000  A  ',
    });
    expect(parsed.label).toBe('Branch A');
  });

  it('omits the live-data tools unless a provider is wired in', () => {
    const liveNames = [
      'describe_data_source',
      'list_appliances',
      'list_tunnels',
      'get_overlay_policies',
      'list_flows',
      'get_flow_details',
      'build_flow_topology',
    ];
    for (const n of liveNames)
      expect(tools.some((t) => t.name === n)).toBe(false);
    const withProvider = createTools(store, {
      renderDocument: renderDocumentToSVG,
      provider: new MockProvider(),
    });
    for (const n of liveNames)
      expect(withProvider.some((t) => t.name === n)).toBe(true);
  });

  it('registers the bounded shared-workspace tools only when wired', () => {
    const unavailable = async (): Promise<never> => {
      throw new Error('not called');
    };
    const workspace: NonNullable<ToolDeps['workspace']> = {
      createEmpty: unavailable,
      list: async () => [],
      manifest: unavailable,
      changes: unavailable,
      elements: unavailable,
      propose: unavailable,
      applyAgent: unavailable,
      createCheckpoint: unavailable,
      listCheckpoints: async () => [],
    };
    const withWorkspace = createTools(store, {
      renderDocument: renderDocumentToSVG,
      workspace,
    });
    const names = [
      'create_workspace',
      'list_workspaces',
      'get_workspace_manifest',
      'describe_workspace_operations',
      'get_workspace_changes',
      'get_workspace_elements',
      'propose_workspace_changes',
      'apply_workspace_changes',
      'create_checkpoint',
      'list_checkpoints',
    ];
    for (const name of names)
      expect(withWorkspace.some((tool) => tool.name === name)).toBe(true);
    for (const name of names)
      expect(tools.some((tool) => tool.name === name)).toBe(false);

    const readme = readFileSync(
      fileURLToPath(new URL('./README.md', import.meta.url)),
      'utf8',
    );
    for (const name of names) expect(readme).toContain(`\`${name}\``);

    const propose = withWorkspace.find(
      (tool) => tool.name === 'propose_workspace_changes',
    )!;
    const parsed = parseToolArgs(propose, {
      workspaceId: 'w1',
      baseRevision: 1,
      operationId: 'op1',
      title: 'Compact operation',
      operations: [{ type: 'element.remove', pageId: 'p1', elementId: 'n1' }],
    });
    expect(parsed.operations).toHaveLength(1);
    expect(() =>
      parseToolArgs(propose, {
        workspaceId: 'w1',
        baseRevision: 1,
        operationId: 'op1',
        title: 'T'.repeat(TEXT_LIMITS.title + 1),
        operations: [{ type: 'element.remove', pageId: 'p1', elementId: 'n1' }],
      }),
    ).toThrow(/title/);
    const checkpoint = withWorkspace.find(
      (tool) => tool.name === 'create_checkpoint',
    )!;
    expect(() =>
      parseToolArgs(checkpoint, {
        workspaceId: 'w1',
        name: 'N'.repeat(TEXT_LIMITS.checkpointName + 1),
      }),
    ).toThrow(/name/);

    const describe = withWorkspace.find(
      (tool) => tool.name === 'describe_workspace_operations',
    )!;
    expect(describe.handler({})).toMatchObject({
      operationSchemaRevision: 1,
      limits: { maxOperations: 250 },
    });
  });

  it('registers the read-only authoring-profile tools only when wired — and no confirm surface', () => {
    const unavailable = async (): Promise<never> => {
      throw new Error('not called');
    };
    const profile: NonNullable<ToolDeps['profile']> = {
      guidance: async () => ({
        profileRevision: 0,
        guidanceRevision: 1,
        rules: [],
        tokenEstimate: 0,
      }),
      list: async () => [],
      explain: unavailable,
    };
    const withProfile = createTools(store, {
      renderDocument: renderDocumentToSVG,
      profile,
    });
    const names = [
      'get_authoring_guidance',
      'list_authoring_preferences',
      'explain_authoring_preference',
    ];
    for (const name of names)
      expect(withProfile.some((tool) => tool.name === name)).toBe(true);
    for (const name of names)
      expect(tools.some((tool) => tool.name === name)).toBe(false);

    const readme = readFileSync(
      fileURLToPath(new URL('./README.md', import.meta.url)),
      'utf8',
    );
    for (const name of names) expect(readme).toContain(`\`${name}\``);

    // Authority boundary (proposal 0003 guardrail #5 / acceptance criterion
    // 7): wiring the profile dep must add ONLY the three read-only tools —
    // nothing named like a confirm/edit/forget surface can exist over MCP.
    const added = withProfile
      .map((tool) => tool.name)
      .filter((name) => !tools.some((tool) => tool.name === name));
    expect(added.sort()).toEqual([...names].sort());
    for (const name of added)
      expect(name).not.toMatch(/confirm|reject|pause|resume|forget|delete/);

    // Argument bounds: the budget escape hatch is capped at the 800 absolute
    // ceiling, so not even a malformed call can request an unbounded reply.
    const guidance = withProfile.find(
      (tool) => tool.name === 'get_authoring_guidance',
    )!;
    expect(() => parseToolArgs(guidance, { maxTokens: 100_000 })).toThrow(
      /maxTokens/,
    );
    const parsed = parseToolArgs(guidance, {
      archetype: 'multi-region-hub-spoke',
      lastProfileRevision: 3,
      lastGuidanceRevision: 1,
    });
    expect(parsed.archetype).toBe('multi-region-hub-spoke');

    const explain = withProfile.find(
      (tool) => tool.name === 'explain_authoring_preference',
    )!;
    expect(() => parseToolArgs(explain, {})).toThrow(/preferenceId/);
  });

  it('queries the fabric and authors a sourced topology end to end', async () => {
    const live = createTools(store, {
      renderDocument: renderDocumentToSVG,
      provider: new MockProvider(),
    });
    const callLive = (name: string, args: Record<string, unknown> = {}) =>
      live.find((t) => t.name === name)!.handler(args);

    const src = (await callLive('describe_data_source')) as {
      system: string;
    };
    expect(src.system).toBe('mock');

    const appliances = (await callLive('list_appliances')) as {
      id: string;
      role?: string;
    }[];
    expect(appliances.length).toBeGreaterThanOrEqual(3);

    const overlay = (await callLive('list_tunnels', {
      scope: 'overlay',
    })) as { id: string; overlay?: string }[];
    expect(overlay.every((t) => t.overlay)).toBe(true);

    const flows = (await callLive('list_flows', {
      application: 'voip',
    })) as { id: string; applianceId: string }[];
    expect(flows.length).toBeGreaterThan(0);

    const detail = (await callLive('get_flow_details', {
      applianceId: flows[0]!.applianceId,
      flowId: flows[0]!.id,
    })) as { flow: { overlay?: string } };
    expect(detail.flow.overlay).toBe('RealTime');

    // The loop closes: fabric records become sourced document elements.
    const { id } = callLive('create_topology', { title: 'Live fabric' }) as {
      id: string;
    };
    for (const a of appliances)
      callLive('upsert_by_source', {
        topologyId: id,
        kind: 'node',
        source: { system: src.system, kind: 'appliance', id: a.id },
        set: { type: 'ec', x: 100, y: 100, label: a.id },
      });
    const doc = callLive('get_topology', {
      topologyId: id,
    }) as TopologyDocument;
    expect(doc.pages[0]!.nodes).toHaveLength(appliances.length);
    expect(doc.pages[0]!.nodes[0]!.source?.system).toBe('mock');
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

  it('sets playback timing and exports a self-playing flipbook', () => {
    const { id } = call('create_topology', { title: 'Story' }) as {
      id: string;
    };
    call('add_node', { topologyId: id, type: 'ec', x: 200, y: 200 });
    call('set_page_properties', {
      topologyId: id,
      pageIndex: 0,
      name: 'Setup',
      duration: 800,
    });
    call('add_page', {
      topologyId: id,
      name: 'Steady',
      duration: 1500,
      transition: 'fade',
    });
    call('add_node', { topologyId: id, type: 'ec', x: 200, y: 200 });

    // Timing lands on the document contract.
    const doc = call('get_topology', { topologyId: id }) as TopologyDocument;
    expect(doc.pages[0]!.duration).toBe(800);
    expect(doc.pages[1]!).toMatchObject({
      duration: 1500,
      transition: 'fade',
    });

    const html = call('export_flipbook', { topologyId: id }) as string;
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('data-name="Setup"');
    expect(html).toContain('"duration":1500');
    expect(html).toContain('"transition":"fade"');
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
