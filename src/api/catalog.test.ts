import { describe, it, expect } from 'vitest';
import { BUILTIN_NODE_TYPES, LINK_TYPES } from './builtins.js';
import {
  nodeCatalog,
  linkCatalog,
  getNodeType,
  getLinkType,
  customNodeInfo,
} from './catalog.js';
import { defaultSpec } from '../nodes/spec.js';

describe('capability catalog', () => {
  it('covers every built-in node type (no UI-only types)', () => {
    const cataloged = new Set(nodeCatalog().map((n) => n.type));
    for (const t of BUILTIN_NODE_TYPES) expect(cataloged.has(t)).toBe(true);
  });

  it('covers every link type', () => {
    const cataloged = new Set(linkCatalog().map((l) => l.type));
    for (const t of LINK_TYPES) expect(cataloged.has(t)).toBe(true);
  });

  it('every node/link type entry has position/identity-appropriate fields', () => {
    for (const n of nodeCatalog()) {
      expect(n.fields.some((f) => f.key === 'x')).toBe(true);
      expect(n.fields.some((f) => f.key === 'y')).toBe(true);
    }
    for (const l of linkCatalog()) {
      expect(l.fields.length).toBeGreaterThan(0);
    }
  });

  it('exposes link animation as a discoverable field', () => {
    const tunnel = getLinkType('tunnel')!;
    expect(tunnel.animated).toBe(true);
    expect(tunnel.fields.some((f) => f.animation)).toBe(true);
  });

  it('surfaces per-type fields (e.g. ec variant, cloud innerClouds)', () => {
    const ec = getNodeType('ec')!;
    expect(ec.fields.find((f) => f.key === 'variant')?.options).toContain(
      'aws',
    );
    const cloud = getNodeType('cloud')!;
    expect(cloud.fields.some((f) => f.key === 'innerClouds')).toBe(true);
  });

  it('includes custom node types when provided', () => {
    const spec = { ...defaultSpec(), typeName: 'sensor' };
    expect(getNodeType('sensor', [spec])?.custom).toBe(true);
    expect(nodeCatalog([spec]).some((n) => n.type === 'sensor')).toBe(true);
    expect(customNodeInfo(spec).category).toBe('Custom');
  });
});
