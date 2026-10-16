/**
 * Bundles (proposal 0008, W3) — LAG / ECMP groupings of link ends.
 *
 * A LAG is a per-DEVICE object: on the reference sheet `ae0` on SW-VENUE-01
 * is one member while `0/0/4 + 0/0/5` on GW-WLAN-01 is a two-member MC-LAG
 * to two different switches. So a bundle is named PER LINK END
 * (`fromBundle` / `toBundle`), and its identity is (node, name). The
 * document may declare a bundle NAME's kind (`doc.bundles`); an undeclared
 * name is a LAG. In pill mode (W4) the renderer outlines the pills of each
 * (node, bundle) group — solid for a LAG, dashed for ECMP, nothing for an
 * ICL — and the legend keys the kinds in use.
 */
import type { LinkConfig } from '../vendor/topology-ds.js';

export const BUNDLE_KINDS = ['lag', 'ecmp', 'icl'] as const;
export type BundleKind = (typeof BUNDLE_KINDS)[number];

/** The Key row text per kind. */
export const BUNDLE_KIND_LABELS: Readonly<Record<BundleKind, string>> = {
  lag: 'LACP LAG',
  ecmp: 'ECMP',
  icl: 'ICL',
};

/** A declared bundle name. */
export interface BundleDef {
  /** The name links use in fromBundle / toBundle (e.g. "ae0"). */
  id: string;
  kind?: BundleKind;
  /** Port-table text (defaults to the id). */
  label?: string;
}

export function defineBundle(
  doc: { bundles?: BundleDef[] },
  def: BundleDef,
): BundleDef[] {
  const bundles = (doc.bundles ??= []);
  const next: BundleDef = {
    id: def.id,
    ...(def.kind !== undefined && def.kind !== 'lag' ? { kind: def.kind } : {}),
    ...(def.label !== undefined ? { label: def.label } : {}),
  };
  const i = bundles.findIndex((b) => b.id === def.id);
  if (i >= 0) bundles[i] = next;
  else bundles.push(next);
  return bundles;
}

/** The kind of a bundle name (undeclared = 'lag'). */
export function bundleKind(
  bundles: readonly BundleDef[] | undefined,
  name: string,
): BundleKind {
  return bundles?.find((b) => b.id === name)?.kind ?? 'lag';
}

/** The bundle name on one end of a link, or undefined. */
export function endBundle(
  link: LinkConfig,
  end: 'from' | 'to',
): string | undefined {
  const v = end === 'from' ? link.fromBundle : link.toBundle;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** The bundle kinds used by any link end on a page, in BUNDLE_KINDS order. */
export function usedBundleKinds(
  bundles: readonly BundleDef[] | undefined,
  links: readonly LinkConfig[],
): BundleKind[] {
  const used = new Set<BundleKind>();
  for (const l of links)
    for (const end of ['from', 'to'] as const) {
      const b = endBundle(l, end);
      if (b) used.add(bundleKind(bundles, b));
    }
  return BUNDLE_KINDS.filter((k) => used.has(k));
}
