/**
 * Catalog loader (hw-catalog Phase 1): fetches a published bundle by
 * version and keeps the indexed `Catalog`s in a small in-memory LRU, so a
 * validation or binding resolves interfaces without re-parsing JSON.
 *
 * Runtime-agnostic: the byte source is injected — the Worker reads its
 * ASSETS binding (`worker/catalog.ts`), the stdio server reads
 * `public/catalog/` on disk (`src/server/catalog.ts`).
 */
import { BUNDLE_FORMAT, Catalog, type CatalogBundle } from './catalog.js';

/** `public/catalog/manifest.json`: the latest version and every published one. */
export interface CatalogManifest {
  latest: string;
  versions: string[];
}

export const MANIFEST_FILE = 'manifest.json';

/**
 * Whether a request path is the catalog's static folder. The Worker refuses
 * these over public HTTP (provenance names internal documents) and reads
 * them only through its ASSETS binding.
 */
export function isCatalogAssetPath(pathname: string): boolean {
  // Decode and case-fold first: "/%63atalog/" or "/Catalog/" must not slip
  // past a literal prefix check into an asset lookup that normalizes them.
  let p = pathname;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    // Malformed escapes: check the raw path.
  }
  p = p.toLowerCase().replace(/\/{2,}/g, '/');
  return p === '/catalog' || p.startsWith('/catalog/');
}

const VERSION_RE = /^[0-9a-f]{12}$/;

/** Reads a file from the published catalog folder; rejects if absent. */
export type CatalogSource = (file: string) => Promise<string>;

export class CatalogLoader {
  private readonly cache = new Map<string, Promise<Catalog>>();
  private manifest: Promise<CatalogManifest> | null = null;

  constructor(
    private readonly source: CatalogSource,
    /** Most catalog versions held at once (documents pin old ones). */
    private readonly capacity = 4,
  ) {}

  /** The published manifest (read once per loader). */
  async getManifest(): Promise<CatalogManifest> {
    this.manifest ??= this.source(MANIFEST_FILE)
      .then((text) => {
        const m = JSON.parse(text) as CatalogManifest;
        if (!VERSION_RE.test(m.latest) || !Array.isArray(m.versions))
          throw new Error('catalog manifest is malformed');
        return m;
      })
      .catch((err: unknown) => {
        this.manifest = null;
        throw new Error(
          `catalog manifest unavailable: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    return this.manifest;
  }

  /** The latest published version id. */
  async latestVersion(): Promise<string> {
    return (await this.getManifest()).latest;
  }

  /**
   * The catalog at `version` (a pinned document's `catalogVersion`), or the
   * latest when omitted. Most-recently-used versions stay cached.
   */
  async get(version?: string): Promise<Catalog> {
    const v = version ?? (await this.latestVersion());
    if (!VERSION_RE.test(v)) throw new Error(`invalid catalog version "${v}"`);
    const hit = this.cache.get(v);
    if (hit) {
      // Re-insert to mark as most recently used.
      this.cache.delete(v);
      this.cache.set(v, hit);
      return hit;
    }
    const loading = this.source(`catalog-${v}.json`)
      .then((text) => {
        const bundle = JSON.parse(text) as CatalogBundle;
        if (bundle.format !== BUNDLE_FORMAT)
          throw new Error(
            `unsupported bundle format "${String(bundle.format)}"`,
          );
        if (bundle.version !== v)
          throw new Error(`bundle declares version ${bundle.version}`);
        return new Catalog(bundle);
      })
      .catch((err: unknown) => {
        this.cache.delete(v);
        throw new Error(
          `catalog version ${v} unavailable: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    this.cache.set(v, loading);
    while (this.cache.size > this.capacity) {
      const oldest = this.cache.keys().next().value as string;
      this.cache.delete(oldest);
    }
    return loading;
  }

  /** Versions currently held, least recently used first (tests, metrics). */
  cachedVersions(): string[] {
    return [...this.cache.keys()];
  }
}
