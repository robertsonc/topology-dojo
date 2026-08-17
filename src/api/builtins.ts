/**
 * The built-in visual vocabulary — the node and link types the vendored engine
 * draws out of the box. This is the shared SASE diagram language; custom types
 * (Node Designer) extend it. Kept DOM-free so validation/builder can run
 * anywhere (browser, Node, an MCP server).
 */

export const BUILTIN_NODE_TYPES = [
  'ec',
  'switch',
  'switchEnterprise',
  'cloud',
  'host',
  'connector',
  'apps',
  'saas',
  'server',
  'router',
  'firewall',
  'database',
  'idcard',
  'ap',
  'overlayCloud',
  'text',
  'image',
  'shape:arrow',
  'shape:square',
  'shape:rectangle',
  'shape:triangle',
  'shape:circle',
  'shape:ellipse',
  'shape:diamond',
  'shape:pentagon',
  'shape:hexagon',
  'shape:star',
  'shape:cross',
] as const;

export const LINK_TYPES = [
  'line',
  'tunnel',
  'wireguard',
  'flow',
  'packet',
  'blocked',
  'wifi',
  'poe',
  'optical',
] as const;

export type BuiltinNodeType = (typeof BUILTIN_NODE_TYPES)[number];
export type LinkType = (typeof LINK_TYPES)[number];

const NODE_SET = new Set<string>(BUILTIN_NODE_TYPES);
const LINK_SET = new Set<string>(LINK_TYPES);

export function isBuiltinNodeType(t: string): boolean {
  return NODE_SET.has(t);
}
export function isLinkType(t: string): boolean {
  return LINK_SET.has(t);
}
