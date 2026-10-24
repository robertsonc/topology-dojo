/**
 * hw-catalog Phase 2 exit criterion: documents without hardware bindings
 * validate exactly as before. The snapshot was recorded on the pre-Phase-2
 * code (main at 7e951f3) and must not change; the shape check pins that no
 * new keys (warnings / notes / catalogVersion) appear for unbound documents.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TopologyStore } from './store.js';
import { createTools } from './tools.js';
import { renderDocumentToSVG } from '../server/render.js';
import { sampleDocument } from '../pages/model.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const docs: [string, unknown][] = [
  [
    'EdgeHA_after',
    JSON.parse(readFileSync(`${root}fixtures/EdgeHA_after.json`, 'utf8')),
  ],
  [
    'venue-distribution-leaf',
    JSON.parse(
      readFileSync(`${root}fixtures/venue-distribution-leaf.json`, 'utf8'),
    ),
  ],
  ['sampleDocument', sampleDocument()],
  ['sampleDocument-broken', broken()],
];

/** The sample with semantic and layout problems, so the snapshot has rows. */
function broken(): unknown {
  const doc = sampleDocument();
  const page = doc.pages[0]!;
  const [a, b] = page.nodes;
  b!.x = a!.x + 4; // overlap
  b!.y = a!.y;
  page.nodes.push({ ...a!, label: 'dup' }); // duplicate id
  page.links.push({
    id: 'dangling',
    type: 'lan',
    from: a!.id,
    to: 'nowhere',
    fromLabel: 'ge-0/0/0',
    fromBundle: 'ae0',
  });
  page.nodes.push({ id: 'odd', type: 'no-such-type', x: 5000, y: 5000 });
  return doc;
}

describe('validate_topology on unbound documents is unchanged', () => {
  for (const [name, json] of docs)
    it(name, async () => {
      const store = new TopologyStore();
      const tools = createTools(store, { renderDocument: renderDocumentToSVG });
      const { id } = store.import(json);
      const out = tools
        .find((t) => t.name === 'validate_topology')!
        .handler({ topologyId: id });
      // Synchronous, as before: not a promise.
      expect(out).not.toBeInstanceOf(Promise);
      expect(Object.keys(out as object).sort()).toEqual([
        'layoutClean',
        'problems',
        'valid',
      ]);
      expect(out).toMatchSnapshot();
    });
});
