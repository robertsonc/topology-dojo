import { describe, expect, it } from 'vitest';
import {
  MAX_COMMIT_BYTES,
  MAX_COMMIT_OPERATIONS,
  commitBytes,
  exceedsCommitLimits,
  firstCommitBatch,
} from './batch.js';
import { applyOperations, diffDocuments } from './operations.js';
import type { WorkspaceOperation } from './model.js';
import type { TopologyDocument } from '../pages/model.js';

function doc(nodes: number, label = 'n'): TopologyDocument {
  return {
    title: 'T',
    customNodes: [],
    pages: [
      {
        id: 'p1',
        name: 'Frame 1',
        viewBox: '0 0 1050 700',
        nodes: Array.from({ length: nodes }, (_, i) => ({
          id: `n${i}`,
          type: 'ec',
          x: i * 10,
          y: 0,
          label: `${label}${i}`,
        })),
        links: Array.from({ length: Math.max(0, nodes - 1) }, (_, i) => ({
          id: `l${i}`,
          type: 'line',
          from: `n${i}`,
          to: `n${i + 1}`,
        })),
        anchors: [],
        zones: [],
        flowPaths: [],
        policyMarkers: [],
      },
    ],
  };
}

describe('firstCommitBatch', () => {
  it('returns a small change whole', () => {
    const ops = diffDocuments(doc(0), doc(5));
    expect(exceedsCommitLimits(ops)).toBe(false);
    expect(firstCommitBatch(ops)).toEqual(ops);
  });

  it('caps a large change at the operation limit', () => {
    const ops = diffDocuments(doc(0), doc(200)); // 200 nodes + 199 links
    expect(ops.length).toBeGreaterThan(MAX_COMMIT_OPERATIONS);
    const batch = firstCommitBatch(ops);
    expect(batch).toHaveLength(MAX_COMMIT_OPERATIONS);
    expect(batch).toEqual(ops.slice(0, MAX_COMMIT_OPERATIONS));
  });

  it('caps a change at the byte limit', () => {
    const big = 'x'.repeat(20_000);
    const ops = diffDocuments(doc(0), doc(40, big)); // ~40 × 20 KiB of adds
    expect(ops.length).toBeLessThan(MAX_COMMIT_OPERATIONS);
    expect(commitBytes(ops)).toBeGreaterThan(MAX_COMMIT_BYTES);
    const batch = firstCommitBatch(ops);
    expect(batch.length).toBeGreaterThan(0);
    expect(batch.length).toBeLessThan(ops.length);
    expect(commitBytes(batch)).toBeLessThanOrEqual(MAX_COMMIT_BYTES);
    // One more operation would not have fitted.
    expect(commitBytes(ops.slice(0, batch.length + 1))).toBeGreaterThan(
      MAX_COMMIT_BYTES,
    );
  });

  it('sends a single unsplittable oversized operation on its own', () => {
    const ops: WorkspaceOperation[] = [
      {
        type: 'document.patch',
        patch: { set: { title: 'x'.repeat(MAX_COMMIT_BYTES) } },
      },
      { type: 'document.patch', patch: { set: { title: 'small' } } },
    ];
    expect(firstCommitBatch(ops)).toEqual([ops[0]]);
  });

  it('reaches the target document by committing batch after batch', () => {
    // The browser's loop: commit a batch, advance the synced copy by exactly
    // that batch, diff again. Every round must be within limits and the
    // rounds must converge on the intended document.
    const target = doc(400);
    let synced = doc(0);
    let rounds = 0;
    for (;;) {
      const ops = diffDocuments(synced, target);
      if (!ops.length) break;
      const batch = firstCommitBatch(ops);
      expect(exceedsCommitLimits(batch)).toBe(false);
      synced = applyOperations(synced, batch);
      expect(++rounds).toBeLessThan(10);
    }
    expect(rounds).toBe(4); // 799 operations at 250 per commit
    expect(synced).toEqual(target);
  });
});
