/**
 * Legacy Topology Studio importer — a pure, DOM-free conversion of the older
 * sibling app's document format ("Topology Studio", `reference/legacy-studio
 * .zip` → `demo-main/`) into a Topology Dojo `TopologyDocument`.
 *
 * This module never touches the DOM, `localStorage`, or `node:fs` — it is
 * importable in the browser, in Node, and inside a Worker (MCP/agent) context
 * alike, exactly like `src/api/validate.ts` and `src/pages/persist.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * FORMAT ARCHAEOLOGY
 * ─────────────────────────────────────────────────────────────────────────
 * The legacy app has *two* related JSON shapes, both handled here:
 *
 *  1. The editor's own save/load format (`editor.html`'s `serializeState()` /
 *     `deserializeState()`) — this is what real saved files (and every
 *     fixture under `fixtures/legacy/`, pulled from
 *     `demo-main/tests-e2e/fixtures/*.json`) actually use. `nodes`, `links`,
 *     `anchors`, `flowPaths`, and `policyMarkers` are each an array of
 *     `[id, cfg]` pairs; `acts`/`steps`/`layers`/`glossary`/`guides` are
 *     plain arrays; a handful of `_next*Num` fields are editor id-counter
 *     bookkeeping with no presentational meaning.
 *  2. The rendering engine's own `TopologyDesigner.prototype.toJSON()` —
 *     used by the "diagram-as-code" / programmatic paths. It stores
 *     `nodes`/`links`/`anchors` as a plain `{ id: cfg }` object map instead
 *     of an array of pairs, and additionally supports a `zones` collection
 *     (array of `[id, cfg]` pairs) that the editor UI in this vintage of the
 *     app never serializes. Since a "legacy document" found in the wild
 *     could plausibly come from either path, both node/link/anchor/zone
 *     shapes are accepted (see `pairs()` below).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MAPPING TABLE (legacy → Topology Dojo)
 * ─────────────────────────────────────────────────────────────────────────
 *   document.title + subtitle   → document.title, joined "title — subtitle"
 *                                  (warning: subtitle has no dedicated field)
 *   document.viewBox             → every page's `viewBox` (legacy has one
 *                                  canvas for the whole presentation; each
 *                                  flipbook page reuses it verbatim)
 *   document.nodes[]              → page.nodes[]      (per resolved page,
 *   document.links[]              → page.links[]       see RESOLUTION below)
 *   document.anchors[]            → page.anchors[]
 *   document.acts[]               → *no destination field* — Topology Dojo
 *                                  pages have no act/grouping axis. Act
 *                                  order is preserved implicitly (steps stay
 *                                  in document order, and acts are declared
 *                                  in the order their steps appear), but
 *                                  `label`/`color`/`intro` are unrepresented.
 *                                  One warning per non-trivial act.
 *   document.steps[]              → document.pages[], one page per step
 *                                  (steps are the legacy "one click/advance"
 *                                  unit — see RESOLUTION below; *phases* are
 *                                  the sub-step stagger and are collapsed
 *                                  into their step's single page)
 *   step.name                     → page.name
 *   step.narration ?? step.goal   → page.caption
 *   step.focus[]                  → page.emphasis[] (id-remapped, filtered
 *                                  to ids visible on that page; dangling or
 *                                  not-yet-visible ids are dropped + warned)
 *   phase.show[]                  → drives cumulative visibility (below);
 *                                  not copied verbatim anywhere
 *   phase.diff                    → *dropped, silently*. This is an
 *                                  editor-only authoring note (a "commit
 *                                  message" for the reveal), not
 *                                  presentation content — every phase in
 *                                  every real fixture has one, so warning on
 *                                  it would drown out every other warning.
 *   phase.blocked                 → *dropped*, with a warning suggesting the
 *                                  nearest expressible equivalent (a
 *                                  `policyMarker` of type `'deny'`)
 *   phase.callout/badge/label/
 *     flowActions (or any other
 *     unrecognized phase key)     → *dropped*, one aggregated warning per
 *                                  step listing the unhandled keys
 *   document.glossary[]           → *no destination field*. One warning
 *                                  listing every term so content is never
 *                                  silently lost (see error philosophy)
 *   document.guides[]             → *dropped, silently* if empty (the
 *                                  common case); one warning if non-empty
 *                                  (editor-only alignment rulers)
 *   document.layers[]             → document.layers[] (`LayerDef[]`), sorted
 *                                  by the legacy `order` field; `id`
 *                                  regenerated; `name`/`color`/`opacity`
 *                                  copied; `visible` → `defaultVisible`;
 *                                  `type` → `kind` via a small dictionary
 *                                  (`physical`→`underlay`, `flow`→`overlay`,
 *                                  `policy`→`policy`; anything else drops
 *                                  `kind` + warns); `locked` is dropped
 *                                  silently (editor-only, same precedent as
 *                                  the retired `src/core/model.ts`
 *                                  `LayerModel.hiddenInEditor`/`locked`)
 *   node.layer / link.layer / …   → same field, id remapped through the
 *                                  layer id map
 *   document.flowPaths[]          → page.flowPaths[] — legacy flow paths are
 *                                  a *document-global* overlay (drawn on
 *                                  every step once any step has begun, per
 *                                  the engine's own `_renderSVG`), so each
 *                                  is placed on every page from the point
 *                                  all of its waypoints are visible onward
 *   document.policyMarkers[]      → page.policyMarkers[] — same "global
 *                                  overlay" placement rule, keyed off the
 *                                  marker's `nodeId` visibility
 *   document.zones[] (engine
 *     `toJSON()` shape only)      → page.zones[], `nodes` filtered to the
 *                                  intersection with each page's visible
 *                                  nodes (mirrors the engine's own
 *                                  `_renderZoneRect`, which auto-shrinks a
 *                                  zone's bounding box to currently-visible
 *                                  members); a zone with zero resolvable
 *                                  members on any page is dropped + warned
 *   node.type / link.type          unknown values fall back to the nearest
 *                                  generic builtin (`'host'` / `'line'` —
 *                                  the same fallback `src/pages/persist.ts`
 *                                  uses for hostile/corrupt `type` values)
 *                                  and a warning is recorded
 *   node.x / node.y                non-finite or missing coordinates default
 *                                  to `(0, 0)` with a warning (never crash)
 *   every element id                regenerated (see ID REGENERATION below)
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RESOLUTION SEMANTICS (how "one Act·Step = one page" is derived)
 * ─────────────────────────────────────────────────────────────────────────
 * The legacy engine's own choreography resolver (`_buildIndex` /
 * `_findShowPhase` in `topology-ds.js`) is a "first show wins, then holds"
 * model: it builds a `_showIndex` mapping every element id to the *first*
 * `{ stepId, phaseNum }` at which some phase's `show` array names it, and an
 * element is drawn at step N iff `N >= stepIndexOf(that first show)`. There
 * is no "hide" — once shown, an element stays visible for the rest of the
 * presentation. This is *exactly* the "set-and-hold" delta model this repo's
 * retired `src/core/resolve.ts` implements for `Beat` overrides (`undefined`
 * fields inherit from the previous resolved state; `applyBeat` never clears
 * an override that isn't explicitly set). That retired module is read here
 * purely for its resolution semantics, not reused at runtime — Topology
 * Dojo's `Page` model has no delta/override machinery; each page is a
 * complete, standalone frame (see `src/pages/model.ts`).
 *
 * So: for each element id (node, link, or anchor), `showStepIndex(id)` is
 * the index of the first step (in document order — *not* re-sorted by act;
 * the legacy resolver never re-sorts either) whose phases reveal it. Page
 * `i` (0-based, one per step) contains every element with
 * `showStepIndex(id) <= i`. An element never named in any `show` array is
 * defaulted to `showStepIndex = steps.length - 1` (it appears only on the
 * final page) with a warning — the legacy engine would never draw it at
 * all, but silently omitting authored node/link data from every single page
 * of the imported document is a worse outcome than showing it late with a
 * clear warning explaining why.
 *
 * *Phases* (the `show` sub-steps inside one step) are intentionally
 * collapsed: `CLAUDE.md`/`USER-MANUAL.md` describe a step as "one
 * click/advance" and a phase as a "timed sub-animation" *within* that single
 * advance — i.e. phases are playback micro-timing, not separate presenter
 * beats, so they map to zero pages of their own.
 *
 * A document with zero steps (a corrupt/truncated save, or one saved before
 * any choreography was authored) has no cumulative timeline to resolve at
 * all; it is converted to a single page containing the complete base
 * topology, with a warning explaining the fallback.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ID REGENERATION
 * ─────────────────────────────────────────────────────────────────────────
 * Every element — pages, nodes, links, anchors, zones, flow paths, policy
 * markers, layers — gets a freshly minted id via the *same* `genId(prefix)`
 * helper `src/api/builder.ts` uses for hand-authored/headless documents
 * (`p`/`n`/`l`/`a`/`z`/`fp`/`pm`/`ly` prefixes), so an imported document's
 * ids can never collide with ids from another import or a hand-built
 * document merged into the same session. All internal references
 * (`link.from`/`to`, `zone.nodes`, `flowPath.waypoints`,
 * `policyMarker.nodeId`, `policyMarker.flowPathId`, `step.focus`,
 * `*.layer`) are rewritten through the old-id → new-id maps built while
 * converting. The generator is injectable (`ConvertOptions.idGenerator`) so
 * tests can seed a deterministic counter and assert full structural
 * equality between two conversions of the same input, not just "modulo
 * some opaque id string".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ERROR PHILOSOPHY
 * ─────────────────────────────────────────────────────────────────────────
 * `src/pages/persist.ts`'s `parseDoc` returns `TopologyDocument | null` on
 * any structural problem — a caller learns *that* something was wrong but
 * never *what*. `convertLegacyStudio` never throws on malformed input and
 * never returns a bare `null`: input that isn't shaped like a document at
 * all (`null`, an array, a non-object, or an object with neither `nodes`
 * nor `links` in a recognizable shape) produces a typed `{ ok: false, error
 * }`; everything else is a best-effort conversion that always succeeds with
 * `{ ok: true, document, warnings }` — corrupt/incomplete legacy content
 * degrades gracefully into an explicit warning rather than a failure,
 * because a legacy document that's 95% readable should still open.
 */

import type { TopologyDocument, Page } from '../pages/model.js';
import type {
  AnchorConfig,
  FlowPathConfig,
  LinkConfig,
  NodeConfig,
  PolicyMarkerConfig,
  ZoneConfig,
} from '../vendor/topology-ds.js';
import type { LayerDef, LayerKind } from '../api/layers.js';
import { isBuiltinNodeType, isLinkType } from '../api/builtins.js';
import { genId } from '../api/builder.js';

/** A malformed-beyond-recovery input. Never thrown — always returned. */
export interface LegacyImportError {
  code: 'invalid-input';
  message: string;
}

export interface LegacyConvertOptions {
  /**
   * Id minter, `(prefix) => id`. Defaults to `genId` from `api/builder.ts`
   * (the same helper the headless authoring API uses). Injectable so tests
   * can assert full determinism across two conversions of the same input.
   */
  idGenerator?: (prefix: string) => string;
}

export type LegacyConvertResult =
  | { ok: true; document: TopologyDocument; warnings: string[] }
  | { ok: false; error: LegacyImportError };

/* ── shape sniffing ───────────────────────────────────────────────── */

function isPairish(v: unknown): boolean {
  return Array.isArray(v) || (typeof v === 'object' && v !== null);
}

/**
 * Cheap, cost-bounded shape sniff: does `json` look like a legacy Topology
 * Studio document rather than a native `TopologyDocument` (which always has
 * a `pages` array) or unrelated JSON? Two independent signals are required —
 * an element collection (`nodes`/`links`, array-of-pairs or id-map) *and* a
 * legacy-specific marker (`viewBox`/`acts`/`steps`/`glossary`) — so an
 * arbitrary object that merely happens to have a `links` key isn't
 * misdetected.
 */
export function detectLegacyStudio(json: unknown): boolean {
  if (typeof json !== 'object' || json === null || Array.isArray(json))
    return false;
  const d = json as Record<string, unknown>;
  if (Array.isArray(d.pages)) return false; // already native-shaped
  const hasElements = isPairish(d.nodes) || isPairish(d.links);
  if (!hasElements) return false;
  return (
    typeof d.viewBox === 'string' ||
    Array.isArray(d.acts) ||
    Array.isArray(d.steps) ||
    Array.isArray(d.glossary)
  );
}

/* ── generic helpers ──────────────────────────────────────────────── */

/** Normalize a legacy collection (array-of-`[id,cfg]`-pairs, or an id→cfg
 * object map) into a flat list of `[id, cfg]` tuples. Malformed entries are
 * skipped (never thrown); `skipped` counts how many were dropped so the
 * caller can warn. */
function pairs(raw: unknown): {
  entries: [string, Record<string, unknown>][];
  skipped: number;
} {
  const entries: [string, Record<string, unknown>][] = [];
  let skipped = 0;
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === 'string' &&
        typeof entry[1] === 'object' &&
        entry[1] !== null
      ) {
        entries.push([entry[0], entry[1] as Record<string, unknown>]);
      } else {
        skipped++;
      }
    }
  } else if (typeof raw === 'object' && raw !== null) {
    for (const [id, cfg] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof cfg === 'object' && cfg !== null)
        entries.push([id, cfg as Record<string, unknown>]);
      else skipped++;
    }
  }
  return { entries, skipped };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

const LAYER_KIND_MAP: Record<string, LayerKind> = {
  physical: 'underlay',
  flow: 'overlay',
  policy: 'policy',
};

/* ── main entry point ─────────────────────────────────────────────── */

export function convertLegacyStudio(
  json: unknown,
  opts: LegacyConvertOptions = {},
): LegacyConvertResult {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return {
      ok: false,
      error: {
        code: 'invalid-input',
        message: `expected a legacy Topology Studio document object, got ${
          json === null
            ? 'null'
            : Array.isArray(json)
              ? 'an array'
              : typeof json
        }`,
      },
    };
  }
  const d = json as Record<string, unknown>;
  const rawNodes = pairs(d.nodes);
  const rawLinks = pairs(d.links);
  if (rawNodes.entries.length === 0 && rawLinks.entries.length === 0) {
    return {
      ok: false,
      error: {
        code: 'invalid-input',
        message:
          'input has no recognizable "nodes" or "links" collection — not a legacy Topology Studio document',
      },
    };
  }

  const gen = opts.idGenerator ?? genId;
  const warnings: string[] = [];

  /* ── title ── */
  const title = str(d.title) ?? 'Untitled';
  const subtitle = str(d.subtitle);
  if (subtitle) {
    warnings.push(
      `document subtitle "${subtitle}" has no dedicated field in the flipbook document; appended to the title`,
    );
  }
  const docTitle = subtitle ? `${title} — ${subtitle}` : title;

  if (rawNodes.skipped > 0)
    warnings.push(
      `${rawNodes.skipped} malformed node entr${rawNodes.skipped === 1 ? 'y was' : 'ies were'} skipped`,
    );
  if (rawLinks.skipped > 0)
    warnings.push(
      `${rawLinks.skipped} malformed link entr${rawLinks.skipped === 1 ? 'y was' : 'ies were'} skipped`,
    );

  /* ── layers (build the id map first: nodes/links reference layer ids) ── */
  const rawLayers = Array.isArray(d.layers) ? d.layers : [];
  const layerIdMap = new Map<string, string>();
  const layerDefs: (LayerDef & { _order: number })[] = [];
  rawLayers.forEach((raw, i) => {
    if (typeof raw !== 'object' || raw === null) return;
    const l = raw as Record<string, unknown>;
    const oldId = str(l.id);
    if (!oldId) return;
    const newId = gen('ly');
    layerIdMap.set(oldId, newId);
    const legacyType = str(l.type);
    const kind = legacyType ? LAYER_KIND_MAP[legacyType] : undefined;
    if (legacyType && !kind)
      warnings.push(
        `layer "${l.name ?? oldId}" has legacy type "${legacyType}" with no equivalent layer kind; left undeclared`,
      );
    layerDefs.push({
      id: newId,
      ...(str(l.name) ? { name: str(l.name) } : {}),
      ...(kind ? { kind } : {}),
      ...(str(l.color) ? { color: str(l.color) } : {}),
      ...(l.visible === false ? { defaultVisible: false } : {}),
      ...(isFiniteNumber(l.opacity) ? { opacity: l.opacity } : {}),
      _order: isFiniteNumber(l.order) ? l.order : i,
    });
  });
  layerDefs.sort((a, b) => a._order - b._order);
  const layers: LayerDef[] = layerDefs.map(({ _order: _o, ...rest }) => rest);
  const mapLayer = (v: unknown): string | undefined => {
    const s = str(v);
    return s ? layerIdMap.get(s) : undefined;
  };
  /** `{ layer: <new id> }` when `cfg.layer` resolves, else `{}` — spreadable. */
  const layerField = (
    v: unknown,
  ): { layer: string } | Record<string, never> => {
    const mapped = mapLayer(v);
    return mapped ? { layer: mapped } : {};
  };

  /* ── nodes ── */
  const nodeIdMap = new Map<string, string>();
  const nodes: NodeConfig[] = [];
  for (const [oldId, cfg] of rawNodes.entries) {
    const newId = gen('n');
    nodeIdMap.set(oldId, newId);
    const rawType = str(cfg.type) ?? '';
    const type = isBuiltinNodeType(rawType) ? rawType : 'host';
    if (type !== rawType)
      warnings.push(
        `node "${oldId}" has unknown type "${rawType || '(none)'}"; fell back to "host"`,
      );
    let x = cfg.x;
    let y = cfg.y;
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
      warnings.push(
        `node "${oldId}" is missing valid x/y coordinates; defaulted to (0, 0)`,
      );
      x = isFiniteNumber(x) ? x : 0;
      y = isFiniteNumber(y) ? y : 0;
    }
    const node: NodeConfig = {
      id: newId,
      type,
      x: x as number,
      y: y as number,
      ...(str(cfg.label) ? { label: str(cfg.label) } : {}),
      ...(str(cfg.sublabel) ? { sublabel: str(cfg.sublabel) } : {}),
      ...(str(cfg.sub1) ? { sub1: cfg.sub1 } : {}),
      ...(str(cfg.sub2) ? { sub2: cfg.sub2 } : {}),
      ...(str(cfg.color) ? { color: str(cfg.color) } : {}),
      ...(isFiniteNumber(cfg.opacity) ? { opacity: cfg.opacity } : {}),
      ...(str(cfg.labelColor) ? { labelColor: str(cfg.labelColor) } : {}),
      ...(isFiniteNumber(cfg.labelOffset)
        ? { labelOffset: cfg.labelOffset }
        : {}),
      ...(cfg.locked === true ? { locked: true } : {}),
      ...(typeof cfg.meta === 'object' && cfg.meta !== null
        ? { meta: cfg.meta as NodeConfig['meta'] }
        : {}),
      ...layerField(cfg.layer),
    };
    nodes.push(node);
  }

  /* ── anchors ── */
  const rawAnchors = pairs(d.anchors);
  const anchorIdMap = new Map<string, string>();
  const anchors: AnchorConfig[] = [];
  for (const [oldId, cfg] of rawAnchors.entries) {
    const newId = gen('a');
    anchorIdMap.set(oldId, newId);
    const x = isFiniteNumber(cfg.x) ? cfg.x : 0;
    const y = isFiniteNumber(cfg.y) ? cfg.y : 0;
    if (!isFiniteNumber(cfg.x) || !isFiniteNumber(cfg.y))
      warnings.push(
        `anchor "${oldId}" is missing valid x/y coordinates; defaulted to (0, 0)`,
      );
    anchors.push({ id: newId, x, y });
  }

  /** Any node or anchor id (the union link/flow-path endpoints resolve against). */
  const resolveEndpoint = (oldId: string): string | undefined =>
    nodeIdMap.get(oldId) ?? anchorIdMap.get(oldId);

  /* ── links ── */
  const linkIdMap = new Map<string, string>();
  const links: LinkConfig[] = [];
  for (const [oldId, cfg] of rawLinks.entries) {
    const newFrom = resolveEndpoint(str(cfg.from) ?? '');
    const newTo = resolveEndpoint(str(cfg.to) ?? '');
    if (!newFrom || !newTo) {
      warnings.push(
        `link "${oldId}" references a missing endpoint ("${String(cfg.from)}" → "${String(cfg.to)}"); dropped`,
      );
      continue;
    }
    const newId = gen('l');
    linkIdMap.set(oldId, newId);
    const rawType = str(cfg.type) ?? '';
    const type = isLinkType(rawType) ? rawType : 'line';
    if (type !== rawType)
      warnings.push(
        `link "${oldId}" has unknown type "${rawType || '(none)'}"; fell back to "line"`,
      );
    const link: LinkConfig = {
      id: newId,
      type,
      from: newFrom,
      to: newTo,
      ...(str(cfg.color) ? { color: str(cfg.color) } : {}),
      ...(str(cfg.label) ? { label: str(cfg.label) } : {}),
      ...(cfg.dashed === true ? { dashed: true } : {}),
      ...(str(cfg.fromLabel) ? { fromLabel: str(cfg.fromLabel) } : {}),
      ...(str(cfg.toLabel) ? { toLabel: str(cfg.toLabel) } : {}),
      ...(cfg.lineStyle === 'orthogonal' || cfg.lineStyle === 'curved'
        ? { lineStyle: cfg.lineStyle }
        : {}),
      ...(cfg.locked === true ? { locked: true } : {}),
      ...layerField(cfg.layer),
    };
    links.push(link);
  }

  /* ── cumulative reveal: showStepIndex(id) for every node/link/anchor ── */
  const rawSteps = Array.isArray(d.steps) ? d.steps : [];
  const showStepIndex = new Map<string, number>();
  rawSteps.forEach((raw, stepIndex) => {
    if (typeof raw !== 'object' || raw === null) return;
    const step = raw as Record<string, unknown>;
    const phases = Array.isArray(step.phases) ? step.phases : [];
    for (const rawPhase of phases) {
      if (typeof rawPhase !== 'object' || rawPhase === null) continue;
      const phase = rawPhase as Record<string, unknown>;
      const show = Array.isArray(phase.show) ? phase.show : [];
      for (const id of show) {
        if (typeof id !== 'string') continue;
        if (!showStepIndex.has(id)) showStepIndex.set(id, stepIndex);
      }
    }
  });

  const lastStepIndex = Math.max(rawSteps.length - 1, 0);
  const allElementOldIds = [
    ...nodeIdMap.keys(),
    ...linkIdMap.keys(),
    ...anchorIdMap.keys(),
  ];
  const neverShown = new Set<string>();
  if (rawSteps.length > 0) {
    for (const oldId of allElementOldIds) {
      if (!showStepIndex.has(oldId)) {
        showStepIndex.set(oldId, lastStepIndex);
        neverShown.add(oldId);
      }
    }
    if (neverShown.size > 0)
      warnings.push(
        `${neverShown.size} element(s) are never referenced by any step's reveal list (${[...neverShown].join(', ')}); placed on the final page only`,
      );
  }

  /** `showStepIndex` for the *new* (regenerated) id of a node/link/anchor. */
  const stepIndexForNewId = new Map<string, number>();
  for (const [oldId, newId] of [...nodeIdMap, ...linkIdMap, ...anchorIdMap] as [
    string,
    string,
  ][]) {
    const idx = showStepIndex.get(oldId);
    if (idx !== undefined) stepIndexForNewId.set(newId, idx);
  }

  /* ── zones (engine-native `toJSON()` shape only; the editor UI in this
     vintage never serializes them, but a hand-authored/engine-exported
     legacy document may) ── */
  const rawZones = pairs(d.zones);
  interface ZoneWork {
    id: string;
    def: Omit<ZoneConfig, 'nodes'>;
    memberNewIds: string[];
  }
  const zoneWork: ZoneWork[] = [];
  const zoneIdMap = new Map<string, string>();
  for (const [oldId, cfg] of rawZones.entries) {
    const memberOld = Array.isArray(cfg.nodes)
      ? (cfg.nodes as unknown[]).filter(
          (n): n is string => typeof n === 'string',
        )
      : [];
    const memberNewIds = memberOld
      .map((n) => nodeIdMap.get(n))
      .filter((n): n is string => n !== undefined);
    if (memberOld.length > 0 && memberNewIds.length === 0) {
      warnings.push(
        `zone "${oldId}" references no resolvable member nodes; dropped`,
      );
      continue;
    }
    const newId = gen('z');
    zoneIdMap.set(oldId, newId);
    zoneWork.push({
      id: newId,
      memberNewIds,
      def: {
        id: newId,
        ...(str(cfg.label) ? { label: str(cfg.label) } : {}),
        ...(str(cfg.description) ? { description: str(cfg.description) } : {}),
        ...(str(cfg.color) ? { color: str(cfg.color) } : {}),
        ...(cfg.borderStyle === 'dashed' ||
        cfg.borderStyle === 'solid' ||
        cfg.borderStyle === 'dotted'
          ? { borderStyle: cfg.borderStyle }
          : {}),
        ...(isFiniteNumber(cfg.padding) ? { padding: cfg.padding } : {}),
        ...layerField(cfg.layer),
      },
    });
  }
  // parentZone references another zone id; wire up after all ids are minted.
  rawZones.entries.forEach(([oldId, cfg]) => {
    const newId = zoneIdMap.get(oldId);
    const parentOld = str(cfg.parentZone);
    if (!newId || !parentOld) return;
    const parentNew = zoneIdMap.get(parentOld);
    const work = zoneWork.find((w) => w.id === newId);
    if (work && parentNew) work.def.parentZone = parentNew;
  });

  /* ── flow paths (document-global overlay) ── */
  const rawFlowPaths = pairs(d.flowPaths);
  interface FlowPathWork {
    id: string;
    def: FlowPathConfig;
    fromStepIndex: number;
  }
  const flowPathWork: FlowPathWork[] = [];
  const flowPathIdMap = new Map<string, string>();
  for (const [oldId, cfg] of rawFlowPaths.entries) {
    const waypointsOld = Array.isArray(cfg.waypoints)
      ? (cfg.waypoints as unknown[]).filter(
          (w): w is string => typeof w === 'string',
        )
      : [];
    const waypointsNew = waypointsOld.map(resolveEndpoint);
    if (waypointsOld.length < 2 || waypointsNew.some((w) => w === undefined)) {
      warnings.push(
        `flow path "${oldId}" references a missing waypoint; dropped`,
      );
      continue;
    }
    const resolvedWaypoints = waypointsNew as string[];
    const newId = gen('fp');
    flowPathIdMap.set(oldId, newId);
    const fromStepIndex = Math.max(
      0,
      ...resolvedWaypoints.map((w) => stepIndexForNewId.get(w) ?? 0),
    );
    flowPathWork.push({
      id: newId,
      fromStepIndex,
      def: {
        id: newId,
        waypoints: resolvedWaypoints,
        ...(str(cfg.label) ? { label: str(cfg.label) } : {}),
        ...(str(cfg.name) ? { name: str(cfg.name) } : {}),
        ...(str(cfg.color) ? { color: str(cfg.color) } : {}),
        ...(cfg.animation === 'particles' ||
        cfg.animation === 'dashed' ||
        cfg.animation === 'pulse'
          ? { animation: cfg.animation }
          : {}),
        ...(typeof cfg.speed === 'string' || isFiniteNumber(cfg.speed)
          ? { speed: cfg.speed as FlowPathConfig['speed'] }
          : {}),
        ...(cfg.direction === 'forward' ||
        cfg.direction === 'reverse' ||
        cfg.direction === 'bidirectional'
          ? { direction: cfg.direction }
          : {}),
        ...(isFiniteNumber(cfg.width) ? { width: cfg.width } : {}),
        ...(isFiniteNumber(cfg.opacity) ? { opacity: cfg.opacity } : {}),
        ...layerField(cfg.layer),
      },
    });
  }

  /* ── policy markers (document-global overlay) ── */
  const rawMarkers = pairs(d.policyMarkers);
  interface MarkerWork {
    id: string;
    def: PolicyMarkerConfig;
    fromStepIndex: number;
  }
  const markerWork: MarkerWork[] = [];
  for (const [oldId, cfg] of rawMarkers.entries) {
    const newNodeId = nodeIdMap.get(str(cfg.nodeId) ?? '');
    if (!newNodeId) {
      warnings.push(
        `policy marker "${oldId}" references a missing node "${String(cfg.nodeId)}"; dropped`,
      );
      continue;
    }
    const newId = gen('pm');
    const type = str(cfg.type) ?? 'inspect';
    const mappedFlowPathId = flowPathIdMap.get(str(cfg.flowPathId) ?? '');
    markerWork.push({
      id: newId,
      fromStepIndex: stepIndexForNewId.get(newNodeId) ?? 0,
      def: {
        id: newId,
        nodeId: newNodeId,
        type: type as PolicyMarkerConfig['type'],
        ...(str(cfg.color) ? { color: str(cfg.color) } : {}),
        ...(str(cfg.label) ? { label: str(cfg.label) } : {}),
        ...(mappedFlowPathId ? { flowPathId: mappedFlowPathId } : {}),
        ...layerField(cfg.layer),
      },
    });
  }

  /* ── acts: no destination field — warn once per act with real content ── */
  const rawActs = Array.isArray(d.acts) ? d.acts : [];
  for (const raw of rawActs) {
    if (typeof raw !== 'object' || raw === null) continue;
    const act = raw as Record<string, unknown>;
    const label = str(act.label);
    const intro = Array.isArray(act.intro)
      ? (act.intro as unknown[]).filter(
          (s): s is string => typeof s === 'string',
        )
      : [];
    if (!label && intro.length === 0) continue;
    warnings.push(
      `act "${label ?? String(act.id)}" has no destination field in the flipbook document (grouping is preserved only via page order)` +
        (intro.length > 0
          ? `; its ${intro.length}-paragraph intro text is dropped`
          : ''),
    );
  }

  /* ── glossary: no destination field — one warning, terms inlined ── */
  const rawGlossary = Array.isArray(d.glossary) ? d.glossary : [];
  if (rawGlossary.length > 0) {
    const terms = rawGlossary
      .filter(
        (g): g is Record<string, unknown> =>
          typeof g === 'object' && g !== null,
      )
      .map((g) => str(g.t))
      .filter((t): t is string => t !== undefined);
    warnings.push(
      `glossary (${rawGlossary.length} term${rawGlossary.length === 1 ? '' : 's'}) has no destination field in the flipbook document: ${terms.join(', ')}`,
    );
  }

  /* ── guides: editor-only alignment rulers, dropped ── */
  const rawGuides = Array.isArray(d.guides) ? d.guides : [];
  if (rawGuides.length > 0)
    warnings.push(
      `${rawGuides.length} alignment guide(s) discarded (editor-only, no flipbook equivalent)`,
    );

  /* ── build pages ── */
  const pages: Page[] = [];
  const viewBox = str(d.viewBox) ?? '0 0 1050 700';

  const visibleAt = (newId: string, pageIndex: number): boolean =>
    (stepIndexForNewId.get(newId) ?? 0) <= pageIndex;

  const buildPage = (
    pageIndex: number,
    name: string,
    caption: string | undefined,
    focusOld: string[] | undefined,
    stepLabel: string,
  ): Page => {
    const pageNodes = nodes.filter((n) => visibleAt(n.id, pageIndex));
    const pageLinks = links.filter((l) => visibleAt(l.id, pageIndex));
    const pageAnchors = anchors.filter((a) => visibleAt(a.id, pageIndex));
    const visibleIds = new Set([
      ...pageNodes.map((n) => n.id),
      ...pageLinks.map((l) => l.id),
    ]);

    const emphasis: string[] = [];
    for (const oldId of focusOld ?? []) {
      const newId = nodeIdMap.get(oldId) ?? linkIdMap.get(oldId);
      if (!newId) {
        warnings.push(
          `${stepLabel} focus references unknown element "${oldId}"; dropped from emphasis`,
        );
        continue;
      }
      if (!visibleIds.has(newId)) {
        warnings.push(
          `${stepLabel} focus references "${oldId}", which is not yet visible on this page; dropped from emphasis`,
        );
        continue;
      }
      emphasis.push(newId);
    }

    // `memberNewIds` is already filtered to resolvable node ids (see zone
    // construction above); only the per-page visibility check applies here.
    const pageZones: ZoneConfig[] = [];
    for (const work of zoneWork) {
      const members = work.memberNewIds.filter((id) =>
        visibleAt(id, pageIndex),
      );
      if (members.length === 0) continue;
      pageZones.push({ ...work.def, nodes: members } as ZoneConfig);
    }

    const pageFlowPaths: FlowPathConfig[] = flowPathWork
      .filter((w) => w.fromStepIndex <= pageIndex)
      .map((w) => w.def);

    const pageMarkers: PolicyMarkerConfig[] = markerWork
      .filter((w) => w.fromStepIndex <= pageIndex)
      .map((w) => w.def);

    return {
      id: gen('p'),
      name,
      viewBox,
      ...(caption ? { caption } : {}),
      ...(emphasis.length ? { emphasis } : {}),
      nodes: pageNodes,
      links: pageLinks,
      anchors: pageAnchors,
      zones: pageZones,
      flowPaths: pageFlowPaths,
      policyMarkers: pageMarkers,
    };
  };

  if (rawSteps.length === 0) {
    warnings.push(
      'no steps found in the legacy document; synthesized a single page containing the complete topology',
    );
    pages.push({
      id: gen('p'),
      name: title,
      viewBox,
      nodes,
      links,
      anchors,
      zones: zoneWork.map(
        (w) => ({ ...w.def, nodes: w.memberNewIds }) as ZoneConfig,
      ),
      flowPaths: flowPathWork.map((w) => w.def),
      policyMarkers: markerWork.map((w) => w.def),
    });
  } else {
    rawSteps.forEach((raw, i) => {
      const step =
        typeof raw === 'object' && raw !== null
          ? (raw as Record<string, unknown>)
          : {};
      const name = str(step.name) ?? `Step ${i + 1}`;
      const caption = str(step.narration) ?? str(step.goal);
      const focus = Array.isArray(step.focus)
        ? (step.focus as unknown[]).filter(
            (f): f is string => typeof f === 'string',
          )
        : [];
      const stepLabel = `step "${str(step.id) ?? name}"`;

      // Aggregate any unrecognized phase fields into one warning per step.
      const phases = Array.isArray(step.phases) ? step.phases : [];
      const unexpectedKeys = new Set<string>();
      let sawBlocked = false;
      for (const rawPhase of phases) {
        if (typeof rawPhase !== 'object' || rawPhase === null) continue;
        const phase = rawPhase as Record<string, unknown>;
        if (phase.blocked === true) sawBlocked = true;
        for (const key of Object.keys(phase)) {
          if (key === 'show' || key === 'diff' || key === 'blocked') continue;
          if (phase[key] !== undefined) unexpectedKeys.add(key);
        }
      }
      if (sawBlocked)
        warnings.push(
          `${stepLabel} has a phase flagged "blocked" (cinematic deny animation) with no flipbook equivalent; consider a policyMarker of type "deny" on the relevant node`,
        );
      if (unexpectedKeys.size > 0)
        warnings.push(
          `${stepLabel} has phase field(s) [${[...unexpectedKeys].join(', ')}] with no flipbook equivalent; dropped`,
        );

      pages.push(buildPage(i, name, caption, focus, stepLabel));
    });
  }

  const document: TopologyDocument = {
    title: docTitle,
    pages,
    customNodes: [],
    ...(layers.length ? { layers } : {}),
  };

  return { ok: true, document, warnings };
}
