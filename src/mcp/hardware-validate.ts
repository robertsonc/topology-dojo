/**
 * The catalog half of `validate_topology` (hw-catalog Phase 2). Runs only
 * when the document binds hardware; unbound documents get nothing from
 * here, so their validation output is unchanged.
 *
 * E_* findings join `problems` as errors (so they make the document
 * invalid) with their rule `code`; W_* go to `warnings` and I_* to `notes`,
 * new arrays that never affect `valid`.
 */
import type { Problem } from '../api/validate.js';
import { docHasBindings } from '../api/hardware.js';
import type { CatalogLoader } from '../catalog/loader.js';
import { validateWiring } from '../catalog/validate.js';
import type { TopologyDocument } from '../pages/model.js';

export interface CatalogFinding {
  code: string;
  where: string;
  message: string;
}

export interface CatalogValidation {
  /** E_* findings, shaped as `validate_topology` problems. */
  errors: Problem[];
  warnings: CatalogFinding[];
  notes: CatalogFinding[];
  /** The catalog version judged against; absent when none could load. */
  catalogVersion?: string;
}

/**
 * Catalog findings for a document, or null when it binds no hardware. The
 * caller must pass a document it owns for the duration (a snapshot): this
 * awaits the catalog before reading it.
 */
export async function catalogValidation(
  doc: TopologyDocument,
  loader: CatalogLoader | undefined,
): Promise<CatalogValidation | null> {
  if (!docHasBindings(doc)) return null;
  const out: CatalogValidation = { errors: [], warnings: [], notes: [] };
  if (!loader) {
    out.warnings.push({
      code: 'W_CATALOG_UNAVAILABLE',
      where: 'document',
      message:
        'hardware bindings were not checked: this server has no hardware catalog',
    });
    return out;
  }
  let catalog;
  try {
    catalog = await loader.get(doc.catalogVersion);
  } catch (err) {
    out.warnings.push({
      code: 'W_CATALOG_UNAVAILABLE',
      where: 'document',
      message: `hardware bindings were not checked: catalog ${
        doc.catalogVersion ?? '(latest)'
      } could not be loaded (${err instanceof Error ? err.message : String(err)})`,
    });
    return out;
  }
  out.catalogVersion = catalog.version;
  for (const f of validateWiring(doc, catalog)) {
    const row = { code: f.code, where: f.where, message: f.message };
    if (f.level === 'error') out.errors.push({ level: 'error', ...row });
    else if (f.level === 'warning') out.warnings.push(row);
    else out.notes.push(row);
  }
  return out;
}
