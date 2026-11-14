/**
 * Type-check an element's fields against the catalog.
 *
 * `parseDoc` is the one gate every document passes (an opened file, a share
 * link, an import, a workspace commit), and nothing behind it checks types
 * again: the renderer does arithmetic on numbers and writes colours and sizes
 * straight into markup. So a field the catalog declares as a number must BE a
 * finite number once it is through the gate, a colour a safe colour, a
 * reference a string. Anything else is dropped, and the default applies.
 *
 * Fields the catalog does not list are left alone: they may belong to a newer
 * build, and the renderer neutralises unknown strings on its own.
 */
import {
  annotationCatalog,
  linkCatalog,
  nodeCatalog,
  type AnnotationKind,
  type FieldSpec,
} from '../api/catalog.js';

export type ElementScope = 'node' | 'link' | AnnotationKind;

type Fields = Map<string, FieldSpec>;

let scopes: Record<ElementScope, Fields> | null = null;

/**
 * Every catalog field of a scope, by key. A key has ONE kind across all the
 * types of a scope (pinned by a test), so the union is enough and an element
 * of an unknown or custom type is still checked.
 */
function fieldsOf(scope: ElementScope): Fields {
  if (!scopes) {
    const union = (lists: readonly (readonly FieldSpec[])[]): Fields => {
      const out: Fields = new Map();
      for (const fields of lists)
        for (const f of fields) if (!out.has(f.key)) out.set(f.key, f);
      return out;
    };
    const annotation = (kind: AnnotationKind): Fields =>
      union(
        annotationCatalog()
          .filter((a) => a.kind === kind)
          .map((a) => a.fields),
      );
    scopes = {
      node: union(nodeCatalog().map((t) => t.fields)),
      link: union(linkCatalog().map((t) => t.fields)),
      zone: annotation('zone'),
      flowPath: annotation('flowPath'),
      policyMarker: annotation('policyMarker'),
    };
  }
  return scopes[scope];
}

/** For tests: the kinds a key is declared with across a scope's types. */
export function declaredKinds(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const see = (scope: string, fields: readonly FieldSpec[]): void => {
    for (const f of fields) {
      const key = `${scope}.${f.key}`;
      (out.get(key) ?? out.set(key, new Set()).get(key)!).add(f.kind);
    }
  };
  for (const t of nodeCatalog()) see('node', t.fields);
  for (const t of linkCatalog()) see('link', t.fields);
  for (const a of annotationCatalog()) see(a.kind, a.fields);
  return out;
}

const NUMERIC = /^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i;

/** A finite number, also from a numeric string (a hand-edited `"x": "300"`). */
export function finiteNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && NUMERIC.test(v)) {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** An id or id reference: a string, or a finite number written as one. */
export function idString(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Only plain objects are elements; a null or scalar member is dropped. */
export function objectsOnly<T>(raw: unknown): T[] {
  if (!Array.isArray(raw)) return [];
  return raw.every(isPlainObject)
    ? (raw as T[])
    : (raw.filter(isPlainObject) as T[]);
}

function point(v: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(v)) return undefined;
  const x = finiteNumber(v.x);
  const y = finiteNumber(v.y);
  if (x === undefined || y === undefined) return undefined;
  if (v.x !== x) v.x = x;
  if (v.y !== y) v.y = y;
  return v;
}

/** An enum value is an identifier: a string with no markup characters. */
function token(v: unknown): string | undefined {
  return typeof v === 'string' && !/["'<>&]/.test(v) ? v : undefined;
}

const DROP = Symbol('drop');

/** `v` as the kind `spec` declares, or DROP when it cannot be that kind. */
function typed(
  spec: FieldSpec,
  v: unknown,
  safeColor: (v: unknown) => string | undefined,
): unknown {
  switch (spec.kind) {
    case 'number':
      return finiteNumber(v) ?? DROP;
    case 'boolean':
      return typeof v === 'boolean' ? v : DROP;
    case 'color':
      return safeColor(v) ?? DROP;
    case 'enum':
      return token(v) ?? DROP;
    case 'string':
      return typeof v === 'string'
        ? v
        : typeof v === 'number' && Number.isFinite(v)
          ? String(v)
          : DROP;
    case 'ref':
      return idString(v) ?? DROP;
    case 'refs': {
      if (!Array.isArray(v)) return DROP;
      const ids = v.map(idString);
      if (ids.every((id, i) => id === v[i])) return v;
      return ids.filter((id): id is string => id !== undefined);
    }
    case 'point':
      return point(v) ?? DROP;
    case 'points': {
      if (!Array.isArray(v)) return DROP;
      const pts = v.map(point);
      return pts.every((p) => p !== undefined)
        ? v
        : pts.filter((p) => p !== undefined);
    }
    case 'record':
      return isPlainObject(v) ? v : DROP;
    case 'object': {
      if (!isPlainObject(v)) return DROP;
      for (const f of spec.fields ?? []) applyField(v, f, safeColor);
      return v;
    }
    default:
      return v;
  }
}

function applyField(
  el: Record<string, unknown>,
  spec: FieldSpec,
  safeColor: (v: unknown) => string | undefined,
): void {
  if (!(spec.key in el)) return;
  const before = el[spec.key];
  // An absent value is "use the default" in every kind; leave it be.
  if (before === undefined || before === null) return;
  const after = typed(spec, before, safeColor);
  if (after === DROP) delete el[spec.key];
  else if (after !== before) el[spec.key] = after;
}

/**
 * Make every catalog field of `el` the kind the catalog declares, in place.
 * `safeColor` is the document gate's own colour check (kept there so the two
 * cannot drift).
 */
export function typeElementFields(
  el: Record<string, unknown>,
  scope: ElementScope,
  safeColor: (v: unknown) => string | undefined,
): void {
  for (const spec of fieldsOf(scope).values()) applyField(el, spec, safeColor);
}
