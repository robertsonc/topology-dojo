/**
 * Visio stencil (.vssx) of catalog hardware masters (hw-catalog Phase 5):
 * the same masters the `.vsdx` export uses, real size, for people who draw
 * by hand. One master per model (front face where the catalog has art,
 * else the face it has; one chassis). GA-eligible models only unless
 * `all` — a non-GA master says so in its GAEligible Shape Data.
 */
import type { Catalog } from '../catalog/catalog.js';
import { gaEligible } from '../catalog/catalog.js';
import {
  CT,
  REL,
  contentTypesXml,
  corePropsXml,
  relsXml,
  zipPackage,
} from './opc.js';
import {
  buildMaster,
  masterContentsXml,
  masterFace,
  mastersXml,
  VISIO_MASTER_CT,
  VISIO_MASTER_REL,
} from './visio-masters.js';
import { documentXml } from './vsdx.js';

const STENCIL_CT = 'application/vnd.ms-visio.stencil.main+xml';
const DOCUMENT_REL =
  'http://schemas.microsoft.com/visio/2010/relationships/document';

export interface StencilResult {
  bytes: Uint8Array<ArrayBuffer>;
  /** Model ids in the stencil, in master order. */
  models: string[];
  /** Model ids left out (not GA-eligible). */
  skipped: string[];
}

export function catalogToVssx(
  catalog: Catalog,
  opts: { all?: boolean; title?: string } = {},
): StencilResult {
  const ids = [...catalog.models.keys()].sort();
  const models = ids.filter((id) => opts.all || gaEligible(catalog.model(id)));
  const skipped = ids.filter((id) => !models.includes(id));
  const masters = models.map((id, i) =>
    buildMaster(
      catalog,
      id,
      masterFace(catalog, catalog.platformFor(id), 'front'),
      1,
      i + 2,
    ),
  );
  const parts: Record<string, string | Uint8Array> = {};
  const overrides: Record<string, string> = {
    '/visio/document.xml': STENCIL_CT,
    '/visio/masters/masters.xml': VISIO_MASTER_CT.masters,
    '/docProps/core.xml': CT.core,
  };
  masters.forEach((m, i) => {
    parts[`visio/masters/master${i + 1}.xml`] = masterContentsXml(m);
    overrides[`/visio/masters/master${i + 1}.xml`] = VISIO_MASTER_CT.master;
  });
  parts['[Content_Types].xml'] = contentTypesXml(
    { rels: CT.rels, xml: CT.xml },
    overrides,
  );
  parts['_rels/.rels'] = relsXml([
    { id: 'rId1', type: DOCUMENT_REL, target: 'visio/document.xml' },
    { id: 'rId2', type: REL.coreProps, target: 'docProps/core.xml' },
  ]);
  parts['docProps/core.xml'] = corePropsXml(
    opts.title ?? `Topology Dojo hardware (catalog ${catalog.version})`,
  );
  parts['visio/document.xml'] = documentXml();
  parts['visio/_rels/document.xml.rels'] = relsXml([
    {
      id: 'rId1',
      type: VISIO_MASTER_REL.masters,
      target: 'masters/masters.xml',
    },
  ]);
  parts['visio/masters/masters.xml'] = mastersXml(masters);
  parts['visio/masters/_rels/masters.xml.rels'] = relsXml(
    masters.map((_m, i) => ({
      id: `rId${i + 1}`,
      type: VISIO_MASTER_REL.master,
      target: `master${i + 1}.xml`,
    })),
  );
  return { bytes: zipPackage(parts), models, skipped };
}
