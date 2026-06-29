import { describe, it, expect } from 'vitest';
import { BUILTIN_NODE_TYPES, LINK_TYPES } from './builtins.js';
import {
  nodeCatalog,
  filterNodeCatalog,
  linkCatalog,
  getNodeType,
  getLinkType,
  customNodeInfo,
  annotationCatalog,
  getAnnotationType,
  layerCatalog,
} from './catalog.js';
import { LAYER_KINDS } from './layers.js';
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

  it('exposes per-link flow controls (speed / particles / reverse)', () => {
    const keys = getLinkType('tunnel')!.fields.map((f) => f.key);
    for (const k of ['flowSpeed', 'flowParticles', 'reverseFlow'])
      expect(keys).toContain(k);
    expect(
      getLinkType('tunnel')!.fields.find((f) => f.key === 'reverseFlow')
        ?.animation,
    ).toBe(true);
  });

  it('surfaces per-type fields (e.g. ec variant, cloud innerClouds)', () => {
    const ec = getNodeType('ec')!;
    expect(ec.fields.find((f) => f.key === 'variant')?.options).toContain(
      'aws',
    );
    // §5: the EC-hosts-Axis-connector container form is a selectable variant.
    expect(ec.fields.find((f) => f.key === 'variant')?.options).toContain(
      'axis',
    );
    const cloud = getNodeType('cloud')!;
    expect(cloud.fields.some((f) => f.key === 'innerClouds')).toBe(true);
  });

  it('searches the node library by type, label, category, and aliases (Phase 4)', () => {
    const types = (q: string): string[] =>
      filterNodeCatalog(q).map((n) => n.type);
    // Empty query → the whole catalog, unchanged.
    expect(filterNodeCatalog('').length).toBe(nodeCatalog().length);
    // By type / label substring.
    expect(types('firewall')).toContain('firewall');
    // By alias ("fw" is not in the type/label — it's a keyword).
    expect(types('fw')).toContain('firewall');
    // By category ("Security" groups firewall + idcard).
    const sec = types('security');
    expect(sec).toContain('firewall');
    expect(sec).toContain('idcard');
    // Multi-term AND narrows the result.
    expect(types('cloud aws')).toContain('cloud');
    // Case-insensitive; a nonsense query yields nothing.
    expect(types('ROUTER')).toContain('router');
    expect(filterNodeCatalog('zzzznotathing')).toEqual([]);
  });

  it('includes custom node types in search results', () => {
    const custom = [{ ...defaultSpec(), typeName: 'sensor' }];
    expect(filterNodeCatalog('sensor', custom).map((n) => n.type)).toContain(
      'sensor',
    );
  });

  it('exposes link endpoint ports with friendly side labels (A.5)', () => {
    const fromSide = getLinkType('line')!.fields.find(
      (f) => f.key === 'fromPort',
    )!;
    expect(fromSide.label).toBe('From side');
    // The stored values stay compass codes (engine + persistence depend on it)…
    expect(fromSide.options).toContain('n');
    expect(fromSide.options).toContain('s');
    // …but the dropdown shows human labels.
    expect(fromSide.optionLabels?.n).toBe('Top');
    expect(fromSide.optionLabels?.s).toBe('Bottom');
    expect(fromSide.optionLabels?.e).toBe('Right');
    expect(fromSide.optionLabels?.w).toBe('Left');
    expect(fromSide.optionLabels?.['']).toMatch(/auto/i);
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
    const markerTypes = marker.fields.find((f) => f.key === 'type')?.options;
    expect(markerTypes).toContain('deny'); // enforcement
    expect(markerTypes).toContain('windows'); // host OS (SASE)
    expect(markerTypes).toContain('agentless'); // SSE posture (SASE)
    expect(markerTypes).toContain('dns-proxy'); // network service (SASE)
    expect(markerTypes).toContain('captive-portal');
    expect(markerTypes).toHaveLength(29);
    expect(marker.fields.find((f) => f.key === 'nodeId')?.kind).toBe('ref');
    expect(marker.fields.some((f) => f.key === 'icon')).toBe(true); // glyph override
  });

  it('exposes node metadata as a record field', () => {
    const ec = getNodeType('ec')!;
    expect(ec.fields.some((f) => f.key === 'meta' && f.kind === 'record')).toBe(
      true,
    );
  });

  it('exposes common node opacity + label controls', () => {
    const keys = getNodeType('ec')!.fields.map((f) => f.key);
    for (const k of ['opacity', 'labelColor', 'labelOffset'])
      expect(keys).toContain(k);
    const labelColor = getNodeType('ec')!.fields.find(
      (f) => f.key === 'labelColor',
    );
    expect(labelColor?.kind).toBe('color');
  });

  it('exposes the layer field on every node, link, and annotation type', () => {
    const hasLayer = (fields: { key: string; kind: string }[]): boolean =>
      fields.some((f) => f.key === 'layer' && f.kind === 'ref');
    for (const n of nodeCatalog()) expect(hasLayer(n.fields)).toBe(true);
    for (const l of linkCatalog()) expect(hasLayer(l.fields)).toBe(true);
    for (const a of annotationCatalog()) expect(hasLayer(a.fields)).toBe(true);
  });

  it('exposes the source-ref field on every node, link, and annotation type', () => {
    const hasSource = (fields: { key: string }[]): boolean =>
      fields.some((f) => f.key === 'source');
    for (const n of nodeCatalog()) expect(hasSource(n.fields)).toBe(true);
    for (const l of linkCatalog()) expect(hasSource(l.fields)).toBe(true);
    for (const a of annotationCatalog()) expect(hasSource(a.fields)).toBe(true);
  });

  it('describes the layer vocabulary (kinds + LayerDef fields)', () => {
    const layers = layerCatalog();
    expect(layers.kinds).toEqual(LAYER_KINDS);
    expect(layers.kinds).toContain('underlay');
    expect(layers.kinds).toContain('overlay');
    expect(layers.kinds).toContain('policy');
    const keys = layers.fields.map((f) => f.key);
    for (const k of ['name', 'kind', 'color', 'defaultVisible'])
      expect(keys).toContain(k);
  });

  it('includes custom node types when provided', () => {
    const spec = { ...defaultSpec(), typeName: 'sensor' };
    expect(getNodeType('sensor', [spec])?.custom).toBe(true);
    expect(nodeCatalog([spec]).some((n) => n.type === 'sensor')).toBe(true);
    expect(customNodeInfo(spec).category).toBe('Custom');
  });
});
