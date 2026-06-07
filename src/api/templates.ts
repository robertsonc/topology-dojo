/**
 * Starter templates — common topologies an author (human or agent) can start
 * from instead of a blank page. Each template is just a document built with the
 * headless builder, so it doubles as an MCP scaffold and as a few-shot example.
 *
 * Most are defined as structure (nodes + links) and positioned by an auto-layout
 * algorithm, so they're deterministic and land overlap-free.
 */
import { createDocument } from './builder.js';
import { layoutDocument, type LayoutAlgorithm } from './autolayout.js';
import type { TopologyDocument } from '../pages/model.js';

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
}

interface TemplateDef extends TemplateInfo {
  build: () => TopologyDocument;
}

/** Build a document then position it with a layout algorithm. */
function arranged(
  b: { build: () => TopologyDocument },
  algorithm: LayoutAlgorithm,
  direction?: 'TB' | 'LR',
): TopologyDocument {
  const doc = b.build();
  layoutDocument(doc, {
    algorithm,
    ...(direction ? { direction } : {}),
  });
  return doc;
}

const TEMPLATES: TemplateDef[] = [
  {
    id: 'three-tier',
    name: 'Three-tier web app',
    description: 'Users → firewall → web / app / database tiers.',
    build: () =>
      arranged(
        createDocument('Three-tier web app')
          .page({ name: 'Three-tier' })
          .node({ id: 'users', type: 'host', x: 0, y: 0, label: 'Users' })
          .node({ id: 'fw', type: 'firewall', x: 0, y: 0, label: 'Firewall' })
          .node({ id: 'web1', type: 'server', x: 0, y: 0, label: 'Web 1' })
          .node({ id: 'web2', type: 'server', x: 0, y: 0, label: 'Web 2' })
          .node({ id: 'app', type: 'apps', x: 0, y: 0, label: 'App' })
          .node({ id: 'db', type: 'database', x: 0, y: 0, label: 'Database' })
          .link({ id: 'l1', type: 'line', from: 'users', to: 'fw' })
          .link({ id: 'l2', type: 'line', from: 'fw', to: 'web1' })
          .link({ id: 'l3', type: 'line', from: 'fw', to: 'web2' })
          .link({ id: 'l4', type: 'line', from: 'web1', to: 'app' })
          .link({ id: 'l5', type: 'line', from: 'web2', to: 'app' })
          .link({ id: 'l6', type: 'line', from: 'app', to: 'db' }),
        'hierarchical',
        'TB',
      ),
  },
  {
    id: 'sdwan-branch',
    name: 'SD-WAN branch',
    description: 'Branch user + Edge Connector → SASE PoP → Internet & SaaS.',
    build: () =>
      arranged(
        createDocument('SD-WAN branch')
          .page({ name: 'Branch' })
          .node({ id: 'user', type: 'host', x: 0, y: 0, label: 'Branch user' })
          .node({ id: 'ec', type: 'ec', x: 0, y: 0, label: 'Edge Connector' })
          .node({
            id: 'pop',
            type: 'overlayCloud',
            x: 0,
            y: 0,
            label: 'SASE PoP',
          })
          .node({ id: 'inet', type: 'cloud', x: 0, y: 0, label: 'Internet' })
          .node({ id: 'saas', type: 'saas', x: 0, y: 0, label: 'SaaS' })
          .link({ id: 'l1', type: 'line', from: 'user', to: 'ec' })
          .link({ id: 'l2', type: 'tunnel', from: 'ec', to: 'pop' })
          .link({ id: 'l3', type: 'line', from: 'pop', to: 'inet' })
          .link({ id: 'l4', type: 'line', from: 'pop', to: 'saas' }),
        'hierarchical',
        'LR',
      ),
  },
  {
    id: 'ztna',
    name: 'ZTNA user-to-app',
    description: 'User + identity → connector (private edge) → private app.',
    build: () =>
      arranged(
        createDocument('ZTNA user-to-app')
          .page({ name: 'ZTNA' })
          .node({ id: 'user', type: 'host', x: 0, y: 0, label: 'User' })
          .node({ id: 'id', type: 'idcard', x: 0, y: 0, label: 'Identity' })
          .node({
            id: 'pop',
            type: 'overlayCloud',
            x: 0,
            y: 0,
            label: 'ZTNA service',
          })
          .node({
            id: 'conn',
            type: 'connector',
            x: 0,
            y: 0,
            label: 'Connector',
            pe: true,
          })
          .node({ id: 'app', type: 'apps', x: 0, y: 0, label: 'Private app' })
          .link({ id: 'l1', type: 'line', from: 'user', to: 'id' })
          .link({ id: 'l2', type: 'tunnel', from: 'id', to: 'pop' })
          .link({ id: 'l3', type: 'tunnel', from: 'pop', to: 'conn' })
          .link({ id: 'l4', type: 'line', from: 'conn', to: 'app' }),
        'hierarchical',
        'LR',
      ),
  },
  {
    id: 'firewall-dmz',
    name: 'Firewall + DMZ',
    description: 'Internet → edge firewall → DMZ servers and internal network.',
    build: () =>
      arranged(
        createDocument('Firewall + DMZ')
          .page({ name: 'DMZ' })
          .node({ id: 'inet', type: 'cloud', x: 0, y: 0, label: 'Internet' })
          .node({
            id: 'fw',
            type: 'firewall',
            x: 0,
            y: 0,
            label: 'Edge firewall',
          })
          .node({ id: 'web', type: 'server', x: 0, y: 0, label: 'DMZ web' })
          .node({ id: 'mail', type: 'server', x: 0, y: 0, label: 'DMZ mail' })
          .node({
            id: 'core',
            type: 'switchEnterprise',
            x: 0,
            y: 0,
            label: 'Core',
          })
          .node({ id: 'lan', type: 'host', x: 0, y: 0, label: 'Internal' })
          .link({ id: 'l1', type: 'line', from: 'inet', to: 'fw' })
          .link({ id: 'l2', type: 'line', from: 'fw', to: 'web' })
          .link({ id: 'l3', type: 'line', from: 'fw', to: 'mail' })
          .link({ id: 'l4', type: 'line', from: 'fw', to: 'core' })
          .link({ id: 'l5', type: 'line', from: 'core', to: 'lan' }),
        'hierarchical',
        'LR',
      ),
  },
  {
    id: 'spine-leaf',
    name: 'Spine-leaf fabric',
    description: 'Two spines, four leaves (full mesh) — a data-center fabric.',
    build: () => {
      const b = createDocument('Spine-leaf fabric').page({ name: 'Fabric' });
      b.node({
        id: 's1',
        type: 'switchEnterprise',
        x: 0,
        y: 0,
        label: 'Spine 1',
      });
      b.node({
        id: 's2',
        type: 'switchEnterprise',
        x: 0,
        y: 0,
        label: 'Spine 2',
      });
      for (const leaf of ['l1', 'l2', 'l3', 'l4']) {
        b.node({
          id: leaf,
          type: 'switch',
          x: 0,
          y: 0,
          label: leaf.toUpperCase(),
        });
        b.link({ id: `${leaf}-s1`, type: 'line', from: 's1', to: leaf });
        b.link({ id: `${leaf}-s2`, type: 'line', from: 's2', to: leaf });
      }
      return arranged(b, 'hierarchical', 'TB');
    },
  },
  {
    id: 'hub-spoke',
    name: 'Hub and spoke',
    description: 'A central hub with six branch sites over tunnels.',
    build: () => {
      const b = createDocument('Hub and spoke').page({ name: 'Hub & spoke' });
      const cx = 525;
      const cy = 350;
      b.node({ id: 'hub', type: 'overlayCloud', x: cx, y: cy, label: 'Hub' });
      const spokes = 6;
      for (let i = 0; i < spokes; i++) {
        const a = (i / spokes) * 2 * Math.PI - Math.PI / 2;
        b.node({
          id: `site${i + 1}`,
          type: 'ec',
          x: Math.round(cx + 250 * Math.cos(a)),
          y: Math.round(cy + 230 * Math.sin(a)),
          label: `Site ${i + 1}`,
        });
        b.link({
          id: `t${i + 1}`,
          type: 'tunnel',
          from: 'hub',
          to: `site${i + 1}`,
        });
      }
      return b.build(); // hand-placed star — no auto-layout
    },
  },
];

const BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

/** List available templates (id + name + description). */
export function listTemplates(): TemplateInfo[] {
  return TEMPLATES.map(({ id, name, description }) => ({
    id,
    name,
    description,
  }));
}

/** Build a fresh document from a template id (throws if unknown). */
export function buildTemplate(id: string): TopologyDocument {
  const t = BY_ID.get(id);
  if (!t) throw new Error(`unknown template "${id}"`);
  return t.build();
}
