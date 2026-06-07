import { describe, it, expect } from 'vitest';
import { BUILTIN_NODE_TYPES, LINK_TYPES } from './builtins.js';
import {
  nodeCatalog,
  linkCatalog,
  getNodeType,
  getLinkType,
  customNodeInfo,
  annotationCatalog,
  getAnnotationType,
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

  it('describes every annotation kind (zones / flow paths / markers)', () => {
    const kinds = new Set(annotationCatalog().map((a) => a.kind));
    expect(kinds).toEqual(new Set(['zone', 'flowPath', 'policyMarker']));
    // Each kind names the page array it lives in (the contract surface).
    expect(getAnnotationType('zone')?.collection).toBe('zones');
    expect(getAnnotationType('flowPath')?.collection).toBe('flowPaths');
    expect(getAnnotationType('policyMarker')?.collection).toBe('policyMarkers');
  });

  it('exposes annotation enums + ref fields discoverably', () => {
    const zone = getAnnotationType('zone')!;
    expect(zone.fields.find((f) => f.key === 'nodes')?.kind).toBe('refs');
    expect(zone.fields.find((f) => f.key === 'borderStyle')?.options).toContain(
      'dotted',
    );
    const flow = getAnnotationType('flowPath')!;
    expect(flow.fields.find((f) => f.key === 'waypoints')?.kind).toBe('refs');
    expect(flow.fields.some((f) => f.animation)).toBe(true);
    const marker = getAnnotationType('policyMarker')!;
    expect(marker.fields.find((f) => f.key === 'type')?.options).toContain(
      'deny',
    );
    expect(marker.fields.find((f) => f.key === 'nodeId')?.kind).toBe('ref');
  });

  it('includes custom node types when provided', () => {
    const spec = { ...defaultSpec(), typeName: 'sensor' };
    expect(getNodeType('sensor', [spec])?.custom).toBe(true);
    expect(nodeCatalog([spec]).some((n) => n.type === 'sensor')).toBe(true);
    expect(customNodeInfo(spec).category).toBe('Custom');
  });
});
