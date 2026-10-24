/**
 * Catalog type generation (build-time only; Node). Shared by the
 * `catalog:types` script and the drift test so both produce identical text.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { compile, type JSONSchema } from 'json-schema-to-typescript';
import prettier from 'prettier';

export const SCHEMA_PATH = 'catalog/schema/catalog.schema.json';
export const TYPES_PATH = 'src/catalog/types.generated.ts';

const BANNER =
  '/* GENERATED from catalog/schema/catalog.schema.json by\n' +
  ' * scripts/catalog-types.ts — do not edit; run `npm run catalog:types`. */';

export async function generateCatalogTypes(root: string): Promise<string> {
  const schema = JSON.parse(
    readFileSync(path.join(root, SCHEMA_PATH), 'utf8'),
  ) as JSONSchema;
  const raw = await compile(schema, 'CatalogEntry', {
    bannerComment: BANNER,
    additionalProperties: false,
    unreachableDefinitions: true,
    strictIndexSignatures: true,
    style: { singleQuote: true, trailingComma: 'all' },
    cwd: path.join(root, 'catalog/schema'),
  });
  // Format with the repo's Prettier config so `npm run lint` and the drift
  // check agree on one canonical text.
  const target = path.join(root, TYPES_PATH);
  const config = (await prettier.resolveConfig(target)) ?? {};
  return prettier.format(raw, { ...config, filepath: target });
}
