/**
 * Shared esbuild + Miniflare harness for Worker-level tests, generalized from
 * the pattern proven in `src/workspace/document-do.test.ts`.
 *
 * A test entry is TypeScript *source text*, not a file on disk: worker/*.ts
 * relies on ambient Cloudflare Workers types (`cloudflare:workers`,
 * `DurableObjectNamespace`, `KVNamespace`, …) that only `worker/tsconfig.json`
 * declares. A real `.ts` fixture living under `src/` would be pulled into the
 * root `tsc --noEmit` program (which lacks those globals) the moment it
 * imports anything from `worker/`, and fail to typecheck. Feeding esbuild the
 * entry as in-memory `stdin` source — exactly as the original harness did —
 * keeps it out of the root TypeScript project entirely; esbuild only
 * transpiles (strips types), it never typechecks.
 */
import { build } from 'esbuild';
import { Miniflare, Log, LogLevel, type MiniflareOptions } from 'miniflare';
import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface WorkerBundle {
  /** Absolute path to the bundled ESM worker script. */
  path: string;
  /** Delete the temp bundle file. Safe to call more than once. */
  dispose(): Promise<void>;
}

let bundleSeq = 0;

/**
 * Bundle a worker entry (TypeScript source text) to a temp ESM file with
 * esbuild, resolving relative imports (e.g. `./worker/document.ts`) against
 * the repo root. `cloudflare:workers` stays external — Miniflare's runtime
 * provides it.
 */
export async function buildWorkerBundle(
  entry: string,
  options: { sourcefile?: string } = {},
): Promise<WorkerBundle> {
  const path = resolve(
    `.worker-harness-${process.pid}-${Date.now()}-${bundleSeq++}.mjs`,
  );
  await build({
    stdin: {
      contents: entry,
      loader: 'ts',
      resolveDir: process.cwd(),
      sourcefile: options.sourcefile ?? 'worker-harness-entry.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    external: ['cloudflare:workers'],
    outfile: path,
    logLevel: 'silent',
  });
  return {
    path,
    dispose: () => unlink(path).catch(() => undefined),
  };
}

// Miniflare's `dispatchFetch` uses Workers-flavored Request/Response types
// (from its own `workerd` bindings), which are structurally close to but not
// assignable to the DOM `Request`/`Response` globals under this project's
// root tsconfig (no `@cloudflare/workers-types` there — see the file header).
// Deriving the handle's types from `dispatchFetch` itself keeps both sides
// consistent without importing that types package into `src/`.
type DispatchFetch = Miniflare['dispatchFetch'];
type DispatchInit = Parameters<DispatchFetch>[1];
type DispatchResponse = Awaited<ReturnType<DispatchFetch>>;

export interface MiniflareHandle {
  readonly miniflare: Miniflare;
  /** `dispatchFetch` against the worker, taking a path (or full URL) + init. */
  fetch(pathOrUrl: string, init?: DispatchInit): Promise<DispatchResponse>;
  /** Dispose the Miniflare instance and the underlying bundle file. */
  dispose(): Promise<void>;
}

export interface StartMiniflareOptions {
  bundle: WorkerBundle;
  /** DO bindings, e.g. `{ DOC: { className: 'TopologyDocument', useSQLite: true } }`. */
  durableObjects?: MiniflareOptions['durableObjects'];
  /** KV namespace binding names (each provisioned empty). */
  kvNamespaces?: string[];
  /** Plain string vars, e.g. GITHUB_CLIENT_SECRET for a test HMAC key. */
  vars?: Record<string, string>;
  compatibilityDate?: string;
}

const DEFAULT_COMPATIBILITY_DATE = '2026-06-07';
const DEFAULT_BASE_URL = 'http://worker.test/';

/** Start a Miniflare instance running the given bundle; requests default to a fixed local origin. */
export async function startMiniflare(
  options: StartMiniflareOptions,
): Promise<MiniflareHandle> {
  const miniflare = new Miniflare({
    scriptPath: options.bundle.path,
    modules: true,
    compatibilityDate: options.compatibilityDate ?? DEFAULT_COMPATIBILITY_DATE,
    ...(options.durableObjects
      ? { durableObjects: options.durableObjects }
      : {}),
    ...(options.kvNamespaces ? { kvNamespaces: options.kvNamespaces } : {}),
    ...(options.vars ? { bindings: options.vars } : {}),
    log: new Log(LogLevel.ERROR),
  });
  // Force the runtime to start now, surfacing bundle/binding errors at setup
  // rather than on the first test's first request.
  await miniflare.ready;

  return {
    miniflare,
    fetch: (pathOrUrl, init) =>
      miniflare.dispatchFetch(new URL(pathOrUrl, DEFAULT_BASE_URL).href, init),
    dispose: async () => {
      await miniflare.dispose();
      await options.bundle.dispose();
    },
  };
}
