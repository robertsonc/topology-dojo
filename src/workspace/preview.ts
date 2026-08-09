/**
 * Rendered before/after proposal preview (Packet R1) — pure, DOM-free
 * computation of the data `src/ui/workspace-panel.ts` renders through the
 * browser's already-loaded SVG engine (`src/editor/export.ts`'s `pageToSVG`).
 * This module never touches the DOM or the engine; it only figures out,
 * per affected page, what the page looked like before the proposal's
 * operations and what it would look like after, plus which elements changed
 * and how (for the geometry-aware highlight overlays the panel draws on the
 * before/after frames — removals on "before", additions on "after",
 * modifications on both).
 *
 * `document.patch` operations touch no page (`operationPageIds` returns `[]`
 * for them per `src/workspace/operations.ts`), so they never produce an
 * entry here — the proposal's existing operation-description list already
 * summarizes them; this is the "summary-only, no page to render" case the
 * implementation plan calls out.
 */
import type { Page, TopologyDocument } from '../pages/model.js';
import {
  applyOperations,
  operationPageIds,
  operationTargets,
} from './operations.js';
import {
  ELEMENT_KINDS,
  type ElementKind,
  type WorkspaceOperation,
} from './model.js';

/** How a proposal changes one element, relative to the page's before state. */
export type ElementChangeType = 'added' | 'removed' | 'modified';

/**
 * One changed element with enough identity for the panel to draw
 * geometry-aware highlights: which collection it lives in (`kind`) and
 * whether it was added / removed / modified. Removed elements resolve
 * against `before`, added against `after`, modified against both.
 */
export interface ElementChange {
  elementId: string;
  kind: ElementKind;
  change: ElementChangeType;
}

export interface ProposalPreviewPage {
  pageId: string;
  pageName: string;
  /** The page before the proposal — null when the proposal creates this page. */
  before: Page | null;
  /** The page after the proposal — null when the proposal removes this page. */
  after: Page | null;
  /** Element ids changed on this page (every kind, including ids that no
   * longer resolve to an element — e.g. a bare reorder target). */
  changedElementIds: string[];
  /** The subset of `changedElementIds` that resolves to a real element in
   * `before` and/or `after`, classified for highlight overlays. */
  changes: ElementChange[];
}

/** Every page id touched by the batch, in first-appearance order. */
function affectedPageIds(operations: WorkspaceOperation[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const operation of operations)
    for (const id of operationPageIds(operation))
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
  return ids;
}

/**
 * The element id a single target string names, or null. Targets are the same
 * field-granular strings the coordinator uses for conflict detection — a
 * `page/<id>/element/<kind>/<elementId>/...` or
 * `page/<id>/collection/<kind>/order/<elementId>` target names one element;
 * a bare `.../order/**` (a full `element.reorder`) names none.
 */
function targetElementId(parts: string[]): string | null {
  if (parts[0] !== 'page') return null;
  if (parts[2] === 'element' && parts[4] && parts[4] !== '**') return parts[4];
  if (
    parts[2] === 'collection' &&
    parts[4] === 'order' &&
    parts[5] &&
    parts[5] !== '**'
  )
    return parts[5];
  return null;
}

/** Element ids this page's relevant operations touch, via `operationTargets`
 * rather than re-deriving them ad hoc. */
function elementIdsForPage(
  pageId: string,
  relevant: WorkspaceOperation[],
): string[] {
  const ids = new Set<string>();
  for (const operation of relevant)
    for (const target of operationTargets(operation)) {
      const parts = target.split('/');
      if (parts[1] !== pageId) continue;
      const id = targetElementId(parts);
      if (id) ids.add(id);
    }
  return [...ids].sort();
}

/**
 * Pure: every element id one operation touches, across all pages — the
 * panel's operation-list → preview-geometry link (click an operation, flash
 * its elements). Same target parse as `elementIdsForPage`, unfiltered.
 */
export function operationElementIds(operation: WorkspaceOperation): string[] {
  const ids = new Set<string>();
  for (const target of operationTargets(operation)) {
    const id = targetElementId(target.split('/'));
    if (id) ids.add(id);
  }
  return [...ids].sort();
}

/** The collection an element id lives in on `page`, or null when absent. */
function elementKindOn(page: Page, elementId: string): ElementKind | null {
  for (const kind of ELEMENT_KINDS)
    if ((page[kind] as Array<{ id: string }>).some((el) => el.id === elementId))
      return kind;
  return null;
}

/** Classify each changed id against the before/after pages. Ids that resolve
 * to no element on either side (nothing to draw) are dropped. */
function classifyChanges(
  before: Page | null,
  after: Page | null,
  changedElementIds: string[],
): ElementChange[] {
  const changes: ElementChange[] = [];
  for (const elementId of changedElementIds) {
    const beforeKind = before ? elementKindOn(before, elementId) : null;
    const afterKind = after ? elementKindOn(after, elementId) : null;
    const kind = afterKind ?? beforeKind;
    if (!kind) continue;
    changes.push({
      elementId,
      kind,
      change: !beforeKind ? 'added' : !afterKind ? 'removed' : 'modified',
    });
  }
  return changes;
}

/**
 * A `page.add`'s insertion anchor may name a sibling page this isolated
 * single-page replay never loads (see `computeProposalPreview`). Position
 * doesn't affect the previewed page's own content, so strip it for replay.
 */
function forIsolatedReplay(operation: WorkspaceOperation): WorkspaceOperation {
  return operation.type === 'page.add'
    ? { ...operation, afterPageId: undefined }
    : operation;
}

/**
 * Pure: the before/after page and changed-element ids for every page an
 * operation batch touches. Operates entirely on clones — `pages` and
 * `operations` are never mutated.
 *
 * Each affected page is replayed in isolation (a synthetic single-page
 * document) rather than against the full document, so an unrelated
 * `page.remove` elsewhere in the same batch can't trip `applyOperations`'s
 * "a workspace must retain at least one page" invariant, and a `page.add`
 * elsewhere can't collide with this page's own id. `computeProposalPreview`
 * applied to a real document's full page list agrees with `applyOperations`
 * run once over the whole batch — see the "agreement" tests.
 */
export function computeProposalPreview(
  pages: Page[],
  operations: WorkspaceOperation[],
): ProposalPreviewPage[] {
  return affectedPageIds(operations).map((pageId) => {
    const relevant = operations.filter((operation) =>
      operationPageIds(operation).includes(pageId),
    );
    const existing = pages.find((page) => page.id === pageId) ?? null;
    const before = existing ? structuredClone(existing) : null;
    const removed = relevant.some(
      (operation) => operation.type === 'page.remove',
    );

    let after: Page | null = null;
    if (!removed) {
      const isolated: TopologyDocument = {
        title: '',
        customNodes: [],
        pages: existing ? [structuredClone(existing)] : [],
      };
      const replay = relevant
        .filter((operation) => operation.type !== 'page.remove')
        .map(forIsolatedReplay);
      const applied = applyOperations(isolated, replay);
      after = applied.pages.find((page) => page.id === pageId) ?? null;
    }

    const changedElementIds = elementIdsForPage(pageId, relevant);
    return {
      pageId,
      pageName: before?.name ?? after?.name ?? pageId,
      before,
      after,
      changedElementIds,
      changes: classifyChanges(before, after, changedElementIds),
    };
  });
}
