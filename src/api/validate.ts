/**
 * Semantic validation of a topology document — DOM-free, so it runs in the
 * browser, in Node, or behind an MCP tool. Catches the authoring errors a
 * programmatic caller must be told about: dangling link endpoints, duplicate
 * ids, unknown node types.
 *
 * `parseDoc` (persist) guarantees structural shape; this checks meaning.
 */
import type { TopologyDocument } from '../pages/model.js';
import { isBuiltinNodeType, isLinkType } from './builtins.js';
import { isStockNodeType } from '../nodes/stock.js';
import { LAYER_KINDS } from './layers.js';
import {
  getAnnotationType,
  getLinkType,
  getNodeType,
  type FieldSpec,
} from './catalog.js';

export interface Problem {
  level: 'error' | 'warning';
  message: string;
  /** Location hint, e.g. "page[1].link 'lan'". */
  where: string;
}

export function validateDocument(doc: TopologyDocument): Problem[] {
  const problems: Problem[] = [];
  const err = (where: string, message: string): void => {
    problems.push({ level: 'error', message, where });
  };
  const warn = (where: string, message: string): void => {
    problems.push({ level: 'warning', message, where });
  };

  if (!doc.pages.length) err('document', 'document has no pages');

  // Custom node type names: unique, and the set of all valid node types.
  const customTypes = new Set<string>();
  doc.customNodes.forEach((spec, i) => {
    if (!spec.typeName) err(`customNodes[${i}]`, 'custom node has no typeName');
    else if (customTypes.has(spec.typeName))
      err(`customNodes[${i}]`, `duplicate custom type "${spec.typeName}"`);
    customTypes.add(spec.typeName);
  });
  const knownNodeType = (t: string): boolean =>
    isBuiltinNodeType(t) || isStockNodeType(t) || customTypes.has(t);

  // Document layers: unique non-empty ids; `kind` from the known vocabulary.
  const layerIds = new Set<string>();
  (doc.layers ?? []).forEach((l, i) => {
    const at = `layers[${i}]`;
    if (!l.id) err(at, 'layer has no id');
    else if (layerIds.has(l.id)) err(at, `duplicate layer id "${l.id}"`);
    layerIds.add(l.id);
    if (
      l.kind !== undefined &&
      !(LAYER_KINDS as readonly string[]).includes(l.kind)
    )
      warn(at, `kind "${String(l.kind)}" not in [${LAYER_KINDS.join(', ')}]`);
  });
  // An element's `layer` must reference a declared layer (warning: it still
  // renders, on the base layer).
  const checkLayer = (cfg: { layer?: unknown }, where: string): void => {
    const ly = cfg.layer;
    if (ly === undefined) return;
    if (typeof ly !== 'string' || !layerIds.has(ly))
      warn(where, `layer "${String(ly)}" is not declared in document layers`);
  };
  // An element's `source` must be a well-formed external identity.
  const checkSource = (cfg: { source?: unknown }, where: string): void => {
    const s = cfg.source;
    if (s === undefined) return;
    if (typeof s !== 'object' || s === null || Array.isArray(s)) {
      err(where, 'source must be an object { system, kind, id }');
      return;
    }
    const r = s as Record<string, unknown>;
    for (const k of ['system', 'kind', 'id'])
      if (typeof r[k] !== 'string' || !r[k])
        err(where, `source.${k} must be a non-empty string`);
    if (r.fetchedAt !== undefined && typeof r.fetchedAt !== 'string')
      warn(where, 'source.fetchedAt should be an ISO 8601 string');
  };

  const pageIds = new Set<string>();
  doc.pages.forEach((page, pi) => {
    const at = `page[${pi}] "${page.name}"`;
    if (pageIds.has(page.id)) err(at, `duplicate page id "${page.id}"`);
    pageIds.add(page.id);

    // Playback metadata: duration must be a positive ms count.
    if (
      page.duration !== undefined &&
      (typeof page.duration !== 'number' ||
        !Number.isFinite(page.duration) ||
        page.duration <= 0)
    )
      warn(
        at,
        `duration ${String(page.duration)} should be a positive ms count`,
      );
    if (
      page.transition !== undefined &&
      page.transition !== 'cut' &&
      page.transition !== 'fade'
    )
      warn(at, `transition "${String(page.transition)}" not in [cut, fade]`);

    // Element ids unique within the page; collect endpoints (nodes + anchors).
    const ids = new Set<string>();
    const endpoints = new Set<string>();
    const claim = (id: string, kind: string): void => {
      if (ids.has(id)) err(at, `duplicate ${kind} id "${id}"`);
      ids.add(id);
    };

    for (const n of page.nodes) {
      claim(n.id, 'node');
      endpoints.add(n.id);
      if (typeof n.x !== 'number' || typeof n.y !== 'number')
        err(`${at} node "${n.id}"`, 'node is missing numeric x/y');
      if (!knownNodeType(n.type))
        err(`${at} node "${n.id}"`, `unknown node type "${n.type}"`);
      else
        checkEnums(
          n as Record<string, unknown>,
          getNodeType(n.type, doc.customNodes)?.fields,
          `${at} node "${n.id}"`,
          warn,
        );
      checkMeta(
        (n as Record<string, unknown>).meta,
        `${at} node "${n.id}"`,
        err,
        warn,
      );
      const op = (n as Record<string, unknown>).opacity;
      if (op !== undefined && (typeof op !== 'number' || op < 0 || op > 1))
        warn(
          `${at} node "${n.id}"`,
          `opacity ${String(op)} should be between 0 and 1`,
        );
      checkLayer(n, `${at} node "${n.id}"`);
      checkSource(n, `${at} node "${n.id}"`);
    }
    for (const a of page.anchors) {
      claim(a.id, 'anchor');
      endpoints.add(a.id);
    }
    for (const l of page.links) {
      claim(l.id, 'link');
      if (!isLinkType(l.type))
        warn(`${at} link "${l.id}"`, `unknown link type "${l.type}"`);
      else
        checkEnums(
          l as Record<string, unknown>,
          getLinkType(l.type)?.fields,
          `${at} link "${l.id}"`,
          warn,
        );
      if (!endpoints.has(l.from))
        err(`${at} link "${l.id}"`, `'from' references missing "${l.from}"`);
      if (!endpoints.has(l.to))
        err(`${at} link "${l.id}"`, `'to' references missing "${l.to}"`);
      checkLayer(l, `${at} link "${l.id}"`);
      checkSource(l, `${at} link "${l.id}"`);
    }

    // ── Annotation layer: zones, flow paths, policy markers ──
    const nodeIds = new Set(page.nodes.map((n) => n.id));
    const zoneIds = new Set<string>();
    for (const z of page.zones ?? []) {
      claim(z.id, 'zone');
      zoneIds.add(z.id);
    }
    for (const z of page.zones ?? []) {
      const where = `${at} zone "${z.id}"`;
      for (const nId of z.nodes ?? [])
        if (!nodeIds.has(nId))
          warn(where, `member references missing node "${nId}"`);
      if (z.parentZone === z.id) err(where, 'zone is its own parent');
      else if (z.parentZone && !zoneIds.has(z.parentZone))
        warn(where, `parentZone references missing zone "${z.parentZone}"`);
      checkLayer(z, where);
      checkSource(z, where);
      checkEnums(
        z as unknown as Record<string, unknown>,
        getAnnotationType('zone')?.fields,
        where,
        warn,
      );
    }

    const flowIds = new Set<string>();
    for (const f of page.flowPaths ?? []) {
      claim(f.id, 'flow path');
      flowIds.add(f.id);
    }
    const linkIds = new Set(page.links.map((l) => l.id));
    for (const f of page.flowPaths ?? []) {
      const where = `${at} flow path "${f.id}"`;
      const wps = f.waypoints ?? [];
      if (wps.length < 2) warn(where, 'flow path needs at least 2 waypoints');
      for (const w of wps)
        if (!endpoints.has(w))
          warn(where, `waypoint references missing "${w}"`);
      // Per-hop annotations must point back into the path and the page.
      for (const h of f.hops ?? []) {
        if (!wps.includes(h.ref))
          warn(where, `hop ref "${h.ref}" is not one of the waypoints`);
        if (h.linkId && !linkIds.has(h.linkId))
          warn(where, `hop linkId references missing link "${h.linkId}"`);
      }
      checkLayer(f, where);
      checkSource(f, where);
      checkEnums(
        f as unknown as Record<string, unknown>,
        getAnnotationType('flowPath')?.fields,
        where,
        warn,
      );
    }

    for (const m of page.policyMarkers ?? []) {
      claim(m.id, 'policy marker');
      const where = `${at} policy marker "${m.id}"`;
      if (!nodeIds.has(m.nodeId))
        err(where, `'nodeId' references missing "${m.nodeId}"`);
      if (m.flowPathId && !flowIds.has(m.flowPathId))
        warn(
          where,
          `flowPathId references missing flow path "${m.flowPathId}"`,
        );
      checkLayer(m, where);
      checkSource(m, where);
      checkEnums(
        m as unknown as Record<string, unknown>,
        getAnnotationType('policyMarker')?.fields,
        where,
        warn,
      );
    }

    // Two elements of one kind claiming the same external identity defeats
    // upsert matching — the importer would update one and orphan the other.
    const sourceSeen = new Map<string, string>();
    const sourced: [string, { id: string; source?: unknown }[]][] = [
      ['node', page.nodes],
      ['link', page.links],
      ['zone', page.zones ?? []],
      ['flow path', page.flowPaths ?? []],
      ['policy marker', page.policyMarkers ?? []],
    ];
    for (const [kindName, elements] of sourced)
      for (const e of elements) {
        const s = e.source as Record<string, unknown> | undefined;
        if (
          !s ||
          typeof s !== 'object' ||
          typeof s.system !== 'string' ||
          typeof s.kind !== 'string' ||
          typeof s.id !== 'string'
        )
          continue;
        const key = `${kindName}|${s.system}|${s.kind}|${s.id}`;
        const prior = sourceSeen.get(key);
        if (prior)
          warn(
            `${at} ${kindName} "${e.id}"`,
            `duplicate source ${s.system}/${s.kind}/${s.id} (also on "${prior}")`,
          );
        else sourceSeen.set(key, e.id);
      }
  });

  return problems;
}

/** Warn when an enum-typed field carries a value outside its catalog options. */
function checkEnums(
  cfg: Record<string, unknown>,
  fields: FieldSpec[] | undefined,
  where: string,
  warn: (where: string, message: string) => void,
): void {
  if (!fields) return;
  for (const f of fields) {
    if (f.kind !== 'enum' || !f.options) continue;
    const v = cfg[f.key];
    if (v !== undefined && !f.options.includes(String(v)))
      warn(where, `${f.key} "${String(v)}" not in [${f.options.join(', ')}]`);
  }
}

/** Node metadata must be a flat map of string/number/boolean values. */
function checkMeta(
  meta: unknown,
  where: string,
  err: (where: string, message: string) => void,
  warn: (where: string, message: string) => void,
): void {
  if (meta === undefined) return;
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
    err(where, 'meta must be a key/value object');
    return;
  }
  for (const [k, v] of Object.entries(meta)) {
    if (!k) warn(where, 'meta has an empty key');
    const t = typeof v;
    if (t !== 'string' && t !== 'number' && t !== 'boolean')
      warn(where, `meta."${k}" must be a string, number, or boolean`);
  }
}

/** True if the document has no errors (warnings are allowed). */
export function isValid(doc: TopologyDocument): boolean {
  return !validateDocument(doc).some((p) => p.level === 'error');
}
