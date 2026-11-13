/**
 * Commit-batch limits for a shared workspace, and the splitter the browser
 * uses to stay inside them.
 *
 * The document coordinator (`worker/document.ts`) refuses a commit over
 * either limit. One browser sync can exceed them — generating an SD-WAN
 * fabric, pasting a large selection, or running a layout over a big page all
 * produce hundreds of operations — so the client sends such a change as
 * several consecutive commits instead of one the server can never accept.
 */
import type { WorkspaceOperation } from './model.js';

/** Most operations the coordinator accepts in one commit. */
export const MAX_COMMIT_OPERATIONS = 250;
/** Largest serialized operation list the coordinator accepts in one commit. */
export const MAX_COMMIT_BYTES = 512 * 1024;

/** Serialized size of a value, as the coordinator measures it. */
export function commitBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/** Whether the coordinator would refuse this operation list for its size. */
export function exceedsCommitLimits(
  operations: readonly WorkspaceOperation[],
): boolean {
  return (
    operations.length > MAX_COMMIT_OPERATIONS ||
    commitBytes(operations) > MAX_COMMIT_BYTES
  );
}

/**
 * The longest leading run of `operations` that fits in one commit. Operations
 * apply in order, so a prefix is itself a valid commit and the remainder can
 * follow in later ones. Always returns at least one operation: a single
 * operation over the byte limit cannot be split, and sending it lets the
 * coordinator's refusal reach the user.
 */
export function firstCommitBatch(
  operations: readonly WorkspaceOperation[],
): WorkspaceOperation[] {
  if (!exceedsCommitLimits(operations)) return [...operations];
  const batch: WorkspaceOperation[] = [];
  // `[` + items joined by `,` + `]`, matching JSON.stringify of the array.
  let size = 2;
  for (const operation of operations) {
    if (batch.length === MAX_COMMIT_OPERATIONS) break;
    const next = commitBytes(operation) + (batch.length ? 1 : 0);
    if (batch.length && size + next > MAX_COMMIT_BYTES) break;
    batch.push(operation);
    size += next;
  }
  return batch;
}
