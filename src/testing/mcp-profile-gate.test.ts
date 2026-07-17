/**
 * PROFILES_ENABLED gate on MCP tool discovery (Packet P4) —
 * `worker/mcp.ts`'s `init()` only hands `registerTopologyTools` a `profile`
 * dep (which is what makes the three read-only guidance tools appear in
 * `tools/list`, per `src/mcp/tools.test.ts`) when
 * `profileToolNames(...).length > 0`. Mirrors `mcp-workspace-gate.test.ts`
 * (same Durable Object constraint — see that file's header) but proves the
 * OPPOSITE default: this flag is opt-in, so unset means NO profile tools.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildWorkerBundle,
  startMiniflare,
  type MiniflareHandle,
} from './worker-harness.js';
import { PROFILE_TOOL_NAMES_FIXTURE } from './worker-fixtures.js';

const PROFILE_TOOL_NAMES = [
  'get_authoring_guidance',
  'list_authoring_preferences',
  'explain_authoring_preference',
];

let handle: MiniflareHandle;

beforeAll(async () => {
  const bundle = await buildWorkerBundle(PROFILE_TOOL_NAMES_FIXTURE, {
    sourcefile: 'mcp-profile-gate-fixture.ts',
  });
  handle = await startMiniflare({ bundle });
}, 30_000);

afterAll(async () => {
  await handle?.dispose();
});

async function names(
  flag: string | undefined,
  hasProfileService: boolean,
): Promise<string[]> {
  const params = new URLSearchParams();
  if (flag !== undefined) params.set('flag', flag);
  params.set('hasProfileService', String(hasProfileService));
  const res = await handle.fetch(`/?${params.toString()}`);
  return (await res.json()) as string[];
}

describe('profileToolNames — MCP tool-discovery gate (opt-in)', () => {
  it('registers the profile tools only when the flag is exactly "true" and a service exists', async () => {
    expect(await names('true', true)).toEqual(PROFILE_TOOL_NAMES);
  });

  it('excludes them when the flag is unset — the opt-in default (opposite of workspaces)', async () => {
    expect(await names(undefined, true)).toEqual([]);
  });

  it('excludes them for "false" or any non-"true" value (fails closed)', async () => {
    expect(await names('false', true)).toEqual([]);
    expect(await names('TRUE', true)).toEqual([]);
    expect(await names('1', true)).toEqual([]);
  });

  it('excludes them when no profile service is available, regardless of the flag', async () => {
    expect(await names('true', false)).toEqual([]);
    expect(await names(undefined, false)).toEqual([]);
  });
});
