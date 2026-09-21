/**
 * `element.upsert` — a source-keyed converge operation for shared workspaces
 * (proposal 0006). It is an INPUT vocabulary item only: the coordinator
 * normalizes every upsert into the existing `element.add` / `element.patch`
 * against the document it is applied to, so the stored change log, proposal
 * previews, selective acceptance, conflict targets, and the browser never see
 * a tenth operation type. Same idempotent contract as the private-draft tool
 * `upsert_by_source`: re-running never duplicates.
 *
 * Pure (no Worker imports) so it is unit-testable in Node and reusable by any
 * client that wants to pre-normalize.
 */
import type { TopologyDocument } from '../pages/model.js';
import { sameSource, type SourceRef } from '../api/source.js';
import { CREATE_REQUIRED, type SourcedKind } from '../api/edit.js';
import type { ElementKind, WorkspaceOperation } from './model.js';
import { applyOperation } from './operations.js';

/** Collections that can carry a `source` (anchors cannot). */
export const SOURCED_ELEMENT_KINDS = [
  'nodes',
  'links',
  'zones',
  'flowPaths',
  'policyMarkers',
] as const;
export type SourcedElementKind = (typeof SOURCED_ELEMENT_KINDS)[number];

const SINGULAR: Record<SourcedElementKind, SourcedKind> = {
  nodes: 'node',
  links: 'link',
  zones: 'zone',
  flowPaths: 'flowPath',
  policyMarkers: 'policyMarker',
};

export interface ElementUpsertOperation {
  type: 'element.upsert';
  pageId: string;
  kind: SourcedElementKind;
  /** The external identity to match on (system + kind + id; fetchedAt is refreshed, never matched). */
  source: SourceRef;
  /**
   * Fields to apply. When no element carries `source`, this becomes the new
   * element and must include the kind's create-required fields (node:
   * type/x/y; link: type/from/to; flowPath: waypoints; policyMarker:
   * nodeId/type); an `id` here is honoured on create and ignored on patch.
   */
  element?: Record<string, unknown>;
  /** Insert position on create only (same semantics as `element.add`). */
  afterElementId?: string | null;
}

export type WorkspaceOperationInput =
  | WorkspaceOperation
  | ElementUpsertOperation;

export interface UpsertNormalization {
  /** Index into the INPUT batch. */
  index: number;
  created: boolean;
  elementId: string;
}

export interface NormalizedBatch {
  operations: WorkspaceOperation[];
  upserts: UpsertNormalization[];
}

const BLOCKED_KEYS = new Set(['id', '__proto__', 'prototype', 'constructor']);

export function isElementUpsert(
  operation: unknown,
): operation is ElementUpsertOperation {
  return (
    !!operation &&
    typeof operation === 'object' &&
    (operation as { type?: unknown }).type === 'element.upsert'
  );
}

function assertUpsert(op: ElementUpsertOperation, index: number): void {
  const at = `operations[${index}] (element.upsert)`;
  if (typeof op.pageId !== 'string' || !op.pageId.trim())
    throw new Error(`${at}: pageId must be a non-empty string`);
  if (!SOURCED_ELEMENT_KINDS.includes(op.kind))
    throw new Error(
      `${at}: kind must be one of ${SOURCED_ELEMENT_KINDS.join(', ')} (anchors cannot carry a source)`,
    );
  const source = op.source as Partial<SourceRef> | null | undefined;
  if (
    !source ||
    typeof source !== 'object' ||
    typeof source.system !== 'string' ||
    !source.system ||
    typeof source.kind !== 'string' ||
    !source.kind ||
    typeof source.id !== 'string' ||
    !source.id
  )
    throw new Error(`${at}: source needs non-empty system, kind and id`);
  if (
    op.element !== undefined &&
    (op.element === null ||
      typeof op.element !== 'object' ||
      Array.isArray(op.element))
  )
    throw new Error(`${at}: element must be an object when present`);
}

function cleanFields(
  element: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(element ?? {}))
    if (!BLOCKED_KEYS.has(key)) out[key] = value;
  return out;
}

function sourceRef(source: SourceRef): SourceRef {
  return {
    system: source.system,
    kind: source.kind,
    id: source.id,
    ...(typeof source.fetchedAt === 'string'
      ? { fetchedAt: source.fetchedAt }
      : {}),
  };
}

function allIds(doc: TopologyDocument, pageId: string): Set<string> {
  const page = doc.pages.find((p) => p.id === pageId);
  const ids = new Set<string>();
  if (!page) return ids;
  for (const kind of [
    'nodes',
    'links',
    'anchors',
    'zones',
    'flowPaths',
    'policyMarkers',
  ] as const)
    for (const el of page[kind] as unknown as { id?: unknown }[])
      if (typeof el.id === 'string') ids.add(el.id);
  return ids;
}

function newId(kind: SourcedElementKind, taken: Set<string>): string {
  for (let i = 0; i < 16; i++) {
    const id = `${SINGULAR[kind]}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
    if (!taken.has(id)) return id;
  }
  throw new Error('could not allocate an element id');
}

/**
 * Resolve every `element.upsert` in `operations` against `document` (a
 * working copy is advanced op by op, so a later upsert sees an element an
 * earlier op in the same batch created). Non-upsert operations pass through
 * untouched; their validation stays where it was (`validateOperations`,
 * applied by the caller to the returned batch).
 */
export function normalizeOperations(
  document: TopologyDocument,
  operations: WorkspaceOperationInput[],
): NormalizedBatch {
  const working = structuredClone(document);
  const out: WorkspaceOperation[] = [];
  const upserts: UpsertNormalization[] = [];
  operations.forEach((raw, index) => {
    if (!isElementUpsert(raw)) {
      out.push(raw);
      try {
        applyOperation(working, raw);
      } catch {
        // Invalid ordinary ops are reported by validateOperations/apply later;
        // the working copy simply does not advance for them.
      }
      return;
    }
    assertUpsert(raw, index);
    const page = working.pages.find((p) => p.id === raw.pageId);
    if (!page)
      throw new Error(
        `operations[${index}] (element.upsert): unknown page "${raw.pageId}"`,
      );
    const source = sourceRef(raw.source);
    const collection = page[raw.kind] as unknown as {
      id: string;
      source?: SourceRef;
    }[];
    const existing = collection.find(
      (el) => el.source && sameSource(el.source, source),
    );
    const fields = cleanFields(raw.element);
    let normalized: WorkspaceOperation;
    if (existing) {
      normalized = {
        type: 'element.patch',
        pageId: raw.pageId,
        kind: raw.kind as ElementKind,
        elementId: existing.id,
        patch: { set: { ...fields, source } },
      };
      upserts.push({ index, created: false, elementId: existing.id });
    } else {
      const missing = CREATE_REQUIRED[SINGULAR[raw.kind]].filter(
        (key) => fields[key] === undefined || fields[key] === null,
      );
      if (missing.length)
        throw new Error(
          `operations[${index}] (element.upsert): creating a ${SINGULAR[raw.kind]} requires: ${missing.join(', ')}`,
        );
      const taken = allIds(working, raw.pageId);
      const requested = raw.element?.id;
      let id: string;
      if (typeof requested === 'string' && requested.trim()) {
        if (taken.has(requested))
          throw new Error(
            `operations[${index}] (element.upsert): element "${requested}" already exists on page "${raw.pageId}" without this source`,
          );
        id = requested;
      } else {
        id = newId(raw.kind, taken);
      }
      normalized = {
        type: 'element.add',
        pageId: raw.pageId,
        kind: raw.kind as ElementKind,
        element: { ...fields, id, source },
        ...(raw.afterElementId !== undefined
          ? { afterElementId: raw.afterElementId }
          : {}),
      };
      upserts.push({ index, created: true, elementId: id });
    }
    out.push(normalized);
    applyOperation(working, normalized);
  });
  return { operations: out, upserts };
}
