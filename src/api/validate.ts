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
    isBuiltinNodeType(t) || customTypes.has(t);

  const pageIds = new Set<string>();
  doc.pages.forEach((page, pi) => {
    const at = `page[${pi}] "${page.name}"`;
    if (pageIds.has(page.id)) err(at, `duplicate page id "${page.id}"`);
    pageIds.add(page.id);

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
    }
    for (const a of page.anchors) {
      claim(a.id, 'anchor');
      endpoints.add(a.id);
    }
    for (const l of page.links) {
      claim(l.id, 'link');
      if (!isLinkType(l.type))
        warn(`${at} link "${l.id}"`, `unknown link type "${l.type}"`);
      if (!endpoints.has(l.from))
        err(`${at} link "${l.id}"`, `'from' references missing "${l.from}"`);
      if (!endpoints.has(l.to))
        err(`${at} link "${l.id}"`, `'to' references missing "${l.to}"`);
    }
  });

  return problems;
}

/** True if the document has no errors (warnings are allowed). */
export function isValid(doc: TopologyDocument): boolean {
  return !validateDocument(doc).some((p) => p.level === 'error');
}
