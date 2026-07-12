import { parseDoc } from '../pages/persist.js';
import type { Page, TopologyDocument } from '../pages/model.js';
import {
  ELEMENT_KINDS,
  type ElementKind,
  type FieldPatch,
  type OperationSummary,
  type WorkspaceOperation,
} from './model.js';

const DOCUMENT_FIELDS = [
  'title',
  'customNodes',
  'layers',
  'legend',
  'stencils',
  'palette',
] as const;
const PAGE_FIELDS = [
  'name',
  'viewBox',
  'duration',
  'transition',
  'caption',
  'emphasis',
] as const;
const BLOCKED_PATCH_FIELDS = new Set([
  'id',
  '__proto__',
  'prototype',
  'constructor',
]);

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${what} must be an object`);
  return value as Record<string, unknown>;
}

function assertId(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${what} must be a non-empty string`);
  return value;
}

function assertPatch(
  patch: FieldPatch,
  allowed: readonly string[] | null,
): void {
  const keys = [...Object.keys(patch.set ?? {}), ...(patch.unset ?? [])];
  if (!keys.length)
    throw new Error('patch must set or unset at least one field');
  for (const key of keys) {
    if (BLOCKED_PATCH_FIELDS.has(key))
      throw new Error(`field "${key}" cannot be patched`);
    if (allowed && !allowed.includes(key))
      throw new Error(`field "${key}" is not patchable here`);
  }
}

function assertKind(value: unknown): asserts value is ElementKind {
  if (!ELEMENT_KINDS.includes(value as ElementKind))
    throw new Error(`unknown element kind "${String(value)}"`);
}

/** Runtime guard at the coordinator trust boundary (RPC types are not enough). */
export function validateOperations(operations: WorkspaceOperation[]): void {
  if (!Array.isArray(operations))
    throw new Error('operations must be an array');
  for (const raw of operations as unknown[]) {
    const operation = record(raw, 'workspace operation') as {
      type?: unknown;
      [key: string]: unknown;
    };
    switch (operation.type) {
      case 'document.patch':
        assertPatch(operation.patch as FieldPatch, DOCUMENT_FIELDS);
        break;
      case 'page.add':
        record(operation.page, 'page');
        assertId((operation.page as { id?: unknown }).id, 'page id');
        break;
      case 'page.patch':
        assertId(operation.pageId, 'pageId');
        assertPatch(operation.patch as FieldPatch, PAGE_FIELDS);
        break;
      case 'page.remove':
        assertId(operation.pageId, 'pageId');
        break;
      case 'page.reorder':
        if (!Array.isArray(operation.pageIds))
          throw new Error('pageIds must be an array');
        operation.pageIds.forEach((id) => assertId(id, 'page id'));
        break;
      case 'element.add':
        assertId(operation.pageId, 'pageId');
        assertKind(operation.kind);
        assertId(record(operation.element, 'element').id, 'element id');
        break;
      case 'element.patch':
        assertId(operation.pageId, 'pageId');
        assertKind(operation.kind);
        assertId(operation.elementId, 'elementId');
        assertPatch(operation.patch as FieldPatch, null);
        break;
      case 'element.remove':
        assertId(operation.pageId, 'pageId');
        assertKind(operation.kind);
        assertId(operation.elementId, 'elementId');
        break;
      case 'element.reorder':
        assertId(operation.pageId, 'pageId');
        assertKind(operation.kind);
        if (!Array.isArray(operation.elementIds))
          throw new Error('elementIds must be an array');
        operation.elementIds.forEach((id) => assertId(id, 'element id'));
        break;
      default:
        throw new Error(
          `unknown workspace operation "${String(operation.type)}"`,
        );
    }
  }
}

function applyPatch(target: Record<string, unknown>, patch: FieldPatch): void {
  for (const [key, value] of Object.entries(patch.set ?? {}))
    target[key] = value;
  for (const key of patch.unset ?? []) delete target[key];
}

function pageById(doc: TopologyDocument, pageId: string): Page {
  const page = doc.pages.find((candidate) => candidate.id === pageId);
  if (!page) throw new Error(`unknown page "${pageId}"`);
  return page;
}

function collection(
  page: Page,
  kind: ElementKind,
): Array<Record<string, unknown>> {
  return page[kind] as unknown as Array<Record<string, unknown>>;
}

function everyElementId(page: Page): Set<string> {
  const ids = new Set<string>();
  for (const kind of ELEMENT_KINDS)
    for (const el of collection(page, kind)) {
      const id = assertId(el.id, `${kind} element id`);
      if (ids.has(id)) throw new Error(`duplicate element id "${id}"`);
      ids.add(id);
    }
  return ids;
}

function insertAfter<T extends { id?: unknown }>(
  values: T[],
  value: T,
  afterId: string | null | undefined,
  what: string,
): void {
  if (afterId === null) {
    values.unshift(value);
    return;
  }
  if (afterId === undefined) {
    values.push(value);
    return;
  }
  const index = values.findIndex((candidate) => candidate.id === afterId);
  if (index < 0)
    throw new Error(`unknown ${what} insertion anchor "${afterId}"`);
  values.splice(index + 1, 0, value);
}

/** Apply one validated semantic operation to a mutable document clone. */
export function applyOperation(
  doc: TopologyDocument,
  operation: WorkspaceOperation,
): void {
  switch (operation.type) {
    case 'document.patch': {
      assertPatch(operation.patch, DOCUMENT_FIELDS);
      applyPatch(doc as unknown as Record<string, unknown>, operation.patch);
      return;
    }
    case 'page.add': {
      const page = structuredClone(operation.page);
      assertId(page.id, 'page id');
      if (doc.pages.some((candidate) => candidate.id === page.id))
        throw new Error(`page "${page.id}" already exists`);
      everyElementId(page);
      insertAfter(doc.pages, page, operation.afterPageId, 'page');
      return;
    }
    case 'page.patch': {
      assertPatch(operation.patch, PAGE_FIELDS);
      applyPatch(
        pageById(doc, operation.pageId) as unknown as Record<string, unknown>,
        operation.patch,
      );
      return;
    }
    case 'page.remove': {
      if (doc.pages.length === 1)
        throw new Error('a workspace must retain at least one page');
      const index = doc.pages.findIndex((page) => page.id === operation.pageId);
      if (index < 0) throw new Error(`unknown page "${operation.pageId}"`);
      doc.pages.splice(index, 1);
      return;
    }
    case 'page.reorder': {
      if (
        operation.pageIds.length !== doc.pages.length ||
        new Set(operation.pageIds).size !== operation.pageIds.length
      )
        throw new Error('page.reorder must contain every page id exactly once');
      const byId = new Map(doc.pages.map((page) => [page.id, page]));
      doc.pages = operation.pageIds.map((id) => {
        const page = byId.get(id);
        if (!page) throw new Error(`unknown page "${id}" in page.reorder`);
        return page;
      });
      return;
    }
    case 'element.add': {
      const page = pageById(doc, operation.pageId);
      const element = structuredClone(record(operation.element, 'element'));
      const id = assertId(element.id, 'element id');
      if (everyElementId(page).has(id))
        throw new Error(`element "${id}" already exists on page "${page.id}"`);
      insertAfter(
        collection(page, operation.kind),
        element,
        operation.afterElementId,
        'element',
      );
      return;
    }
    case 'element.patch': {
      assertPatch(operation.patch, null);
      const values = collection(
        pageById(doc, operation.pageId),
        operation.kind,
      );
      const element = values.find(
        (candidate) => candidate.id === operation.elementId,
      );
      if (!element)
        throw new Error(
          `unknown ${operation.kind} element "${operation.elementId}"`,
        );
      applyPatch(element, operation.patch);
      return;
    }
    case 'element.remove': {
      const values = collection(
        pageById(doc, operation.pageId),
        operation.kind,
      );
      const index = values.findIndex(
        (candidate) => candidate.id === operation.elementId,
      );
      if (index < 0)
        throw new Error(
          `unknown ${operation.kind} element "${operation.elementId}"`,
        );
      values.splice(index, 1);
      return;
    }
    case 'element.reorder': {
      const values = collection(
        pageById(doc, operation.pageId),
        operation.kind,
      );
      if (
        operation.elementIds.length !== values.length ||
        new Set(operation.elementIds).size !== operation.elementIds.length
      )
        throw new Error(
          'element.reorder must contain every collection id exactly once',
        );
      const byId = new Map(
        values.map((element) => [String(element.id), element]),
      );
      const reordered = operation.elementIds.map((id) => {
        const element = byId.get(id);
        if (!element)
          throw new Error(`unknown element "${id}" in element.reorder`);
        return element;
      });
      (pageById(doc, operation.pageId)[operation.kind] as unknown) = reordered;
      return;
    }
  }
}

/** Apply a batch atomically in memory and normalize it through the document parser. */
export function applyOperations(
  source: TopologyDocument,
  operations: WorkspaceOperation[],
): TopologyDocument {
  validateOperations(operations);
  const next = structuredClone(source);
  for (const operation of operations) applyOperation(next, operation);
  const parsed = parseDoc(next);
  if (!parsed)
    throw new Error('operations produced an invalid topology document');
  return parsed;
}

function patchFor(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[],
): FieldPatch | null {
  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  for (const field of fields) {
    if (equal(before[field], after[field])) continue;
    if (after[field] === undefined) unset.push(field);
    else set[field] = structuredClone(after[field]);
  }
  return Object.keys(set).length || unset.length
    ? {
        ...(Object.keys(set).length ? { set } : {}),
        ...(unset.length ? { unset } : {}),
      }
    : null;
}

function diffCollection(
  pageId: string,
  kind: ElementKind,
  before: Array<Record<string, unknown>>,
  after: Array<Record<string, unknown>>,
): WorkspaceOperation[] {
  const operations: WorkspaceOperation[] = [];
  const oldById = new Map(
    before.map((element) => [String(element.id), element]),
  );
  const newById = new Map(
    after.map((element) => [String(element.id), element]),
  );

  for (const element of before) {
    const id = String(element.id);
    if (!newById.has(id))
      operations.push({ type: 'element.remove', pageId, kind, elementId: id });
  }

  let previousId: string | null = null;
  for (const element of after) {
    const id = String(element.id);
    const previous = oldById.get(id);
    if (!previous) {
      operations.push({
        type: 'element.add',
        pageId,
        kind,
        element: structuredClone(element),
        afterElementId: previousId,
      });
    } else {
      const keys = new Set([...Object.keys(previous), ...Object.keys(element)]);
      keys.delete('id');
      const patch = patchFor(previous, element, [...keys]);
      if (patch)
        operations.push({
          type: 'element.patch',
          pageId,
          kind,
          elementId: id,
          patch,
        });
    }
    previousId = id;
  }

  const beforeIds = before.map((element) => String(element.id));
  const afterIds = after.map((element) => String(element.id));
  // Adds/removes already establish the desired order when the surviving items
  // retain relative order. Emit an explicit reorder only when that is not true.
  const survivingBefore = beforeIds.filter((id) => newById.has(id));
  const survivingAfter = afterIds.filter((id) => oldById.has(id));
  if (!equal(survivingBefore, survivingAfter))
    operations.push({
      type: 'element.reorder',
      pageId,
      kind,
      elementIds: afterIds,
    });
  return operations;
}

/**
 * Browser compatibility adapter: compute semantic operations from two snapshots
 * already resident in the browser. No document or diff is sent to an agent.
 */
export function diffDocuments(
  before: TopologyDocument,
  after: TopologyDocument,
): WorkspaceOperation[] {
  const operations: WorkspaceOperation[] = [];
  const docPatch = patchFor(
    before as unknown as Record<string, unknown>,
    after as unknown as Record<string, unknown>,
    DOCUMENT_FIELDS,
  );
  if (docPatch) operations.push({ type: 'document.patch', patch: docPatch });

  const oldPages = new Map(before.pages.map((page) => [page.id, page]));
  const newPages = new Map(after.pages.map((page) => [page.id, page]));
  let previousPageId: string | null = null;
  for (const page of after.pages) {
    const previous = oldPages.get(page.id);
    if (!previous) {
      operations.push({
        type: 'page.add',
        page: structuredClone(page),
        afterPageId: previousPageId,
      });
    } else {
      const pagePatch = patchFor(
        previous as unknown as Record<string, unknown>,
        page as unknown as Record<string, unknown>,
        PAGE_FIELDS,
      );
      if (pagePatch)
        operations.push({
          type: 'page.patch',
          pageId: page.id,
          patch: pagePatch,
        });
      for (const kind of ELEMENT_KINDS)
        operations.push(
          ...diffCollection(
            page.id,
            kind,
            collection(previous, kind),
            collection(page, kind),
          ),
        );
    }
    previousPageId = page.id;
  }

  // Add replacement pages before removing old ones so a whole-document switch
  // never transiently violates the invariant that a document retains one page.
  for (const page of before.pages)
    if (!newPages.has(page.id))
      operations.push({ type: 'page.remove', pageId: page.id });

  const beforeOrder = before.pages.map((page) => page.id);
  const afterOrder = after.pages.map((page) => page.id);
  const survivingBefore = beforeOrder.filter((id) => newPages.has(id));
  const survivingAfter = afterOrder.filter((id) => oldPages.has(id));
  if (!equal(survivingBefore, survivingAfter))
    operations.push({ type: 'page.reorder', pageIds: afterOrder });
  return operations;
}

function patchTargets(prefix: string, patch: FieldPatch): string[] {
  return [...Object.keys(patch.set ?? {}), ...(patch.unset ?? [])].map(
    (field) => `${prefix}/${field}`,
  );
}

/** Field-granular targets used for optimistic rebase/conflict detection. */
export function operationTargets(operation: WorkspaceOperation): string[] {
  switch (operation.type) {
    case 'document.patch':
      return patchTargets('document/field', operation.patch);
    case 'page.add':
      return [
        `page/${operation.page.id}/**`,
        `document/pages/order/${operation.page.id}`,
      ];
    case 'page.patch':
      return patchTargets(`page/${operation.pageId}/field`, operation.patch);
    case 'page.remove':
      return [
        `page/${operation.pageId}/**`,
        `document/pages/order/${operation.pageId}`,
      ];
    case 'page.reorder':
      return ['document/pages/order/**'];
    case 'element.add':
      return [
        `page/${operation.pageId}/element/${operation.kind}/${String(operation.element.id)}/**`,
        `page/${operation.pageId}/collection/${operation.kind}/order/${String(operation.element.id)}`,
      ];
    case 'element.patch':
      return patchTargets(
        `page/${operation.pageId}/element/${operation.kind}/${operation.elementId}/field`,
        operation.patch,
      );
    case 'element.remove':
      return [
        `page/${operation.pageId}/element/${operation.kind}/${operation.elementId}/**`,
        `page/${operation.pageId}/collection/${operation.kind}/order/${operation.elementId}`,
      ];
    case 'element.reorder':
      return [`page/${operation.pageId}/collection/${operation.kind}/order/**`];
  }
}

function targetConflict(a: string, b: string): boolean {
  if (a === b) return true;
  const ap = a.endsWith('/**') ? a.slice(0, -3) : null;
  const bp = b.endsWith('/**') ? b.slice(0, -3) : null;
  return (
    (ap !== null && (b === ap || b.startsWith(`${ap}/`))) ||
    (bp !== null && (a === bp || a.startsWith(`${bp}/`)))
  );
}

export function conflictingTargets(
  incoming: WorkspaceOperation[],
  committed: WorkspaceOperation[],
): string[] {
  const a = incoming.flatMap(operationTargets);
  const b = committed.flatMap(operationTargets);
  const conflicts = new Set<string>();
  for (const left of a)
    for (const right of b) if (targetConflict(left, right)) conflicts.add(left);
  return [...conflicts].sort();
}

export function operationPageIds(operation: WorkspaceOperation): string[] {
  switch (operation.type) {
    case 'document.patch':
    case 'page.reorder':
      return [];
    case 'page.add':
      return [operation.page.id];
    default:
      return [operation.pageId];
  }
}

export function describeOperation(operation: WorkspaceOperation): string {
  switch (operation.type) {
    case 'document.patch':
      return `Document: ${operationTargets(operation)
        .map((t) => t.split('/').at(-1))
        .join(', ')}`;
    case 'page.add':
      return `Add page "${operation.page.name}" (${operation.page.id})`;
    case 'page.patch':
      return `Update page ${operation.pageId}: ${operationTargets(operation)
        .map((t) => t.split('/').at(-1))
        .join(', ')}`;
    case 'page.remove':
      return `Remove page ${operation.pageId}`;
    case 'page.reorder':
      return `Reorder ${operation.pageIds.length} pages`;
    case 'element.add':
      return `Add ${operation.kind} element ${String(operation.element.id)} on ${operation.pageId}`;
    case 'element.patch':
      return `Update ${operation.elementId} on ${operation.pageId}: ${operationTargets(
        operation,
      )
        .map((t) => t.split('/').at(-1))
        .join(', ')}`;
    case 'element.remove':
      return `Remove ${operation.elementId} from ${operation.pageId}`;
    case 'element.reorder':
      return `Reorder ${operation.kind} on ${operation.pageId}`;
  }
}

export function summarizeOperations(
  operations: WorkspaceOperation[],
): OperationSummary {
  const byType: Record<string, number> = {};
  const pages = new Set<string>();
  const elements = new Set<string>();
  for (const operation of operations) {
    byType[operation.type] = (byType[operation.type] ?? 0) + 1;
    for (const pageId of operationPageIds(operation)) pages.add(pageId);
    if (operation.type === 'element.add')
      elements.add(String(operation.element.id));
    if (
      operation.type === 'element.patch' ||
      operation.type === 'element.remove'
    )
      elements.add(operation.elementId);
    if (operation.type === 'element.reorder')
      for (const id of operation.elementIds) elements.add(id);
  }
  return {
    count: operations.length,
    byType,
    affectedPageIds: [...pages].sort(),
    affectedElementIds: [...elements].sort().slice(0, 200),
    descriptions: operations.slice(0, 100).map(describeOperation),
  };
}
