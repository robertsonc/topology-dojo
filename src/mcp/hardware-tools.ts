/**
 * Hardware catalog tools for agents (hw-catalog Phase 3). Registered only
 * where a catalog loader is wired (`ToolDeps.catalog`). Schemas stay tight:
 * agents pay tokens for every field.
 *
 * - `list_hardware` / `describe_hardware`: catalog reads (no document).
 * - `bind_hardware`: bind a node to a model; pins `catalogVersion`.
 * - `assign_interfaces`: plan (and with `apply`, write) interfaces for link
 *   ends on bound nodes.
 * - `catalog_diff`: what moving a document to another catalog version
 *   changes for its models and cabling.
 *
 * Document tools look the document up before awaiting the catalog, so an
 * unknown id fails fast; `catalog_diff` (a read served from shared
 * workspace snapshots) clones it first.
 */
import { z } from 'zod';
import type { TopologyDocument } from '../pages/model.js';
import { bindHardware, CATEGORY_NODE_TYPE } from '../api/hardware.js';
import type { Catalog } from '../catalog/catalog.js';
import type { CatalogLoader } from '../catalog/loader.js';
import { describeHardware, listHardware } from '../catalog/describe.js';
import {
  applyPlan,
  planInterfaces,
  type AssignStrategy,
} from '../catalog/assign.js';
import { catalogDiff } from '../catalog/diff.js';
import { validateWiring } from '../catalog/validate.js';
import type { TopologyStore } from './store.js';
import type { ToolDef } from './tools.js';

const topologyId = z.string().describe('Topology id.');
const modelId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{1,63}$/)
  .describe('Catalog model id (from list_hardware).');
const CATEGORIES = Object.keys(CATEGORY_NODE_TYPE) as [string, ...string[]];

/** The catalog a document is judged against: its pin, else the latest. */
async function catalogFor(
  loader: CatalogLoader,
  doc: TopologyDocument,
): Promise<Catalog> {
  try {
    return await loader.get(doc.catalogVersion);
  } catch (err) {
    throw new Error(
      `hardware catalog ${doc.catalogVersion ?? '(latest)'} could not be loaded: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/** The page holding a node (first match), or throws. */
function findNode(doc: TopologyDocument, nodeId: string, pageIndex?: number) {
  const pages =
    pageIndex === undefined
      ? doc.pages.map((p, i) => [p, i] as const)
      : doc.pages[pageIndex]
        ? [[doc.pages[pageIndex]!, pageIndex] as const]
        : [];
  if (pageIndex !== undefined && !pages.length)
    throw new Error(`page index ${pageIndex} out of range`);
  for (const [page, i] of pages) {
    const node = page.nodes.find((n) => n.id === nodeId);
    if (node) return { node, pageIndex: i };
  }
  throw new Error(`unknown node "${nodeId}"`);
}

export function hardwareTools(
  store: TopologyStore,
  catalog: CatalogLoader,
): ToolDef[] {
  return [
    {
      name: 'list_hardware',
      description:
        'Search the hardware catalog (real models with OS-native interface names). Returns per model: id, name, category, SKUs, a port summary ("24x RJ45 1G + 4x SFP56 1-50G"), panel confidence (traced / schematic) and gaEligible (false = reseller-only or inferred data; do not present it as confirmed). Then describe_hardware for interfaces, bind_hardware to use one.',
      inputShape: {
        query: z
          .string()
          .max(64)
          .optional()
          .describe('Substring of id, name, family or SKU.'),
        vendor: z.enum(['hpe-aruba', 'juniper', 'hpe']).optional(),
        family: z
          .string()
          .max(64)
          .optional()
          .describe('e.g. aos-cx, edgeconnect, srx.'),
        category: z.enum(CATEGORIES).optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Default 20.'),
      },
      handler: async (a) => {
        const c = await catalog.get();
        return {
          catalogVersion: c.version,
          ...listHardware(c, {
            ...(a.query !== undefined ? { query: String(a.query) } : {}),
            ...(a.vendor !== undefined ? { vendor: String(a.vendor) } : {}),
            ...(a.family !== undefined ? { family: String(a.family) } : {}),
            ...(a.category !== undefined
              ? { category: String(a.category) }
              : {}),
            ...(a.limit !== undefined ? { limit: Number(a.limit) } : {}),
          }),
        };
      },
    },
    {
      name: 'describe_hardware',
      description:
        'One catalog model in detail: interfaces grouped by role, kind and speed with ranges collapsed ("1/1/1-24"; `{member}` = stack member number), bond groups with LACP support, SKUs, stacking, provenance tiers per group, open todo items, and panel confidence. No panel geometry.',
      inputShape: { model: modelId },
      handler: async (a) =>
        describeHardware(await catalog.get(), String(a.model)),
    },
    {
      name: 'bind_hardware',
      description:
        'Bind a node to a catalog model (hw = { model, sku?, stackMembers?, face? }). Validates the model, SKU and stack size; pins the document to the catalog version on first use (later catalog releases never silently re-judge it — see catalog_diff); sets the node type from the model category unless the node uses a custom type. Then name interfaces on its links (add_link fromInterface / toInterface, or assign_interfaces) and run validate_topology. Clear a binding with update_element set { hw: null }.',
      inputShape: {
        topologyId,
        nodeId: z.string(),
        pageIndex: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            'Page holding the node (default: the first page that has it).',
          ),
        model: modelId,
        sku: z.string().max(32).optional(),
        stackMembers: z
          .number()
          .int()
          .min(1)
          .max(64)
          .optional()
          .describe('VSF / VC members in the stack (stackable models).'),
        face: z
          .enum(['front', 'rear'])
          .optional()
          .describe('Panel face for wire sheets (default front).'),
      },
      handler: async (a) => {
        const id = String(a.topologyId);
        const doc = store.get(id);
        const found = findNode(
          doc,
          String(a.nodeId),
          a.pageIndex as number | undefined,
        );
        const c = await catalogFor(catalog, doc);
        const r = bindHardware(
          doc,
          found.node,
          {
            model: String(a.model),
            ...(a.sku !== undefined ? { sku: String(a.sku) } : {}),
            ...(a.stackMembers !== undefined
              ? { stackMembers: Number(a.stackMembers) }
              : {}),
            ...(a.face !== undefined
              ? { face: a.face as 'front' | 'rear' }
              : {}),
          },
          c,
        );
        const nodeId = found.node.id;
        const mine = validateWiring(doc, c).filter(
          (f) =>
            f.level === 'error' &&
            f.where.startsWith(`page[${found.pageIndex}].`) &&
            (f.where.endsWith(` end ${nodeId}`) ||
              f.where.includes(`node '${nodeId}'`)),
        );
        return {
          nodeId,
          pageIndex: found.pageIndex,
          hw: found.node.hw,
          type: found.node.type,
          ...(r.previousType ? { previousType: r.previousType } : {}),
          catalogVersion: doc.catalogVersion,
          pinned: r.pinned,
          ...(mine.length
            ? {
                problems: mine.map((f) => ({ code: f.code, where: f.where })),
              }
            : {}),
        };
      },
    },
    {
      name: 'assign_interfaces',
      description:
        'Pick free, compatible interfaces for link ends on hardware-bound nodes (page by page). by-role (default) prefers wan toward ISPs / clouds / modems, lan toward the inside, ha toward a same-category peer, bond-group members for a bundle named like the group, uplink (cage) ports on switches toward network gear and copper access ports toward endpoints; first-free takes the first free compatible port. Both also re-plan ends whose interface cannot work (unknown, console/usb, outside the stack, cabled twice); keep only fills empty ends. Never picks optics. Returns the plan and the catalog errors left afterwards; writes it only with apply:true.',
      inputShape: {
        topologyId,
        linkIds: z
          .array(z.string())
          .max(500)
          .optional()
          .describe('Only these links (default: every link on every page).'),
        strategy: z.enum(['by-role', 'first-free', 'keep']).optional(),
        apply: z
          .boolean()
          .optional()
          .describe('Write the plan (default false: propose only).'),
      },
      handler: async (a) => {
        const doc = store.get(String(a.topologyId));
        const c = await catalogFor(catalog, doc);
        const strategy =
          (a.strategy as AssignStrategy | undefined) ?? 'by-role';
        const linkIds = a.linkIds as string[] | undefined;
        const plan = planInterfaces(doc, c, strategy, linkIds);
        const target = a.apply ? doc : structuredClone(doc);
        applyPlan(target, plan);
        let pinned = false;
        if (a.apply && plan.assignments.length && !doc.catalogVersion) {
          doc.catalogVersion = c.version;
          pinned = true;
        }
        const scope = linkIds?.length ? new Set(linkIds) : null;
        const remaining = validateWiring(target, c).filter((f) => {
          if (f.level !== 'error') return false;
          if (!scope) return true;
          const m = /\.link '([^']*)'/.exec(f.where);
          return !m || scope.has(m[1]!);
        });
        return {
          applied: !!a.apply,
          strategy,
          catalogVersion: c.version,
          ...(pinned ? { pinned } : {}),
          assignments: plan.assignments,
          ...(plan.unassigned.length ? { unassigned: plan.unassigned } : {}),
          remainingErrors: remaining.map((f) => ({
            code: f.code,
            where: f.where,
          })),
        };
      },
    },
    {
      name: 'catalog_diff',
      description:
        'What moving a document from its pinned catalog version to another (default: the latest) changes: per bound model, unchanged / changed (fields, interfaces added / removed) / removed, plus the cabling findings that appear or clear and the links that would newly fail. Read-only; the pin only moves by re-binding.',
      inputShape: {
        topologyId,
        toVersion: z
          .string()
          .regex(/^[0-9a-f]{12}$/)
          .optional()
          .describe('Catalog version (12-hex bundle hash); default latest.'),
      },
      handler: async (a) => {
        const doc = structuredClone(store.get(String(a.topologyId)));
        if (!doc.catalogVersion)
          throw new Error(
            'document has no pinned catalog version (bind_hardware pins it on first use); nothing to diff',
          );
        const from = await catalogFor(catalog, doc);
        let to: Catalog;
        try {
          to = await catalog.get(a.toVersion as string | undefined);
        } catch (err) {
          throw new Error(
            `catalog ${String(a.toVersion ?? '(latest)')} could not be loaded: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        return catalogDiff(doc, from, to);
      },
    },
  ];
}
