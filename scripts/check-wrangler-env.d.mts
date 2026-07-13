/**
 * Type declarations for `check-wrangler-env.mjs`, so
 * `src/testing/check-wrangler-env.test.ts` can import it under `strict`
 * without widening `tsconfig.json`'s `allowJs`/`checkJs` settings. Kept in
 * sync by hand — the script has no build step of its own.
 */

export interface WranglerDurableObjectBinding {
  name: string;
  class_name: string;
  script_name?: string;
}

export interface WranglerKvNamespace {
  binding: string;
  id: string;
}

export interface WranglerMigration {
  tag: string;
  new_sqlite_classes?: string[];
  new_classes?: string[];
}

export interface WranglerEnvConfig {
  name?: string;
  vars?: Record<string, string>;
  kv_namespaces?: WranglerKvNamespace[];
  durable_objects?: { bindings?: WranglerDurableObjectBinding[] };
  migrations?: WranglerMigration[];
}

export interface WranglerConfig extends WranglerEnvConfig {
  env?: { staging?: WranglerEnvConfig; [key: string]: unknown };
}

export function stripJsonc(input: string): string;
export function parseWranglerJsonc(text: string): WranglerConfig;
export function deepEqual(a: unknown, b: unknown): boolean;
export function checkWranglerConfig(config: unknown): string[];
export function checkWranglerEnvFile(filePath: string): string[];
