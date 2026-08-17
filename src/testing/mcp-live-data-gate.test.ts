/**
 * LIVE_DATA_ENABLED gate on MCP tool discovery (issue #228) —
 * `worker/mcp.ts`'s `init()` only hands `registerTopologyTools` a `provider`
 * dep (which is what makes the seven live-data tools appear in
 * `tools/list`, per `src/mcp/tools.test.ts`) when
 * `liveDataToolNames(...).length > 0`. Mirrors `mcp-profile-gate.test.ts`
 * (same Durable Object constraint — see that file's header) and proves the
 * opt-in default: secret presence alone must not register the fabric tools.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildWorkerBundle,
  startMiniflare,
  type MiniflareHandle,
} from './worker-harness.js';
import { LIVE_DATA_TOOL_NAMES_FIXTURE } from './worker-fixtures.js';

const LIVE_DATA_TOOL_NAMES = [
  'describe_data_source',
  'list_appliances',
  'list_tunnels',
  'get_overlay_policies',
  'list_flows',
  'get_flow_details',
  'build_flow_topology',
];

let handle: MiniflareHandle;

beforeAll(async () => {
  const bundle = await buildWorkerBundle(LIVE_DATA_TOOL_NAMES_FIXTURE, {
    sourcefile: 'mcp-live-data-gate-fixture.ts',
  });
  handle = await startMiniflare({ bundle });
}, 30_000);

afterAll(async () => {
  await handle?.dispose();
});

async function names(opts: {
  flag?: string;
  ownerId?: string;
  allowlist?: string;
  hasSecrets?: boolean;
}): Promise<string[]> {
  const params = new URLSearchParams();
  if (opts.flag !== undefined) params.set('flag', opts.flag);
  if (opts.ownerId !== undefined) params.set('ownerId', opts.ownerId);
  if (opts.allowlist !== undefined) params.set('allowlist', opts.allowlist);
  params.set('hasSecrets', String(opts.hasSecrets === true));
  const res = await handle.fetch(`/?${params.toString()}`);
  return (await res.json()) as string[];
}

describe('liveDataToolNames — MCP tool-discovery gate (opt-in)', () => {
  it('registers the live-data tools only when the flag is exactly "true", secrets exist, and an owner is present', async () => {
    expect(
      await names({ flag: 'true', ownerId: '17257145', hasSecrets: true }),
    ).toEqual(LIVE_DATA_TOOL_NAMES);
  });

  it('excludes them when the flag is unset — even with secrets (the #228 blast-radius fix)', async () => {
    expect(await names({ ownerId: '17257145', hasSecrets: true })).toEqual([]);
  });

  it('excludes them for "false" or any non-"true" value (fails closed)', async () => {
    expect(
      await names({
        flag: 'false',
        ownerId: '17257145',
        hasSecrets: true,
      }),
    ).toEqual([]);
    expect(
      await names({ flag: 'TRUE', ownerId: '17257145', hasSecrets: true }),
    ).toEqual([]);
    expect(
      await names({ flag: '1', ownerId: '17257145', hasSecrets: true }),
    ).toEqual([]);
  });

  it('excludes them when Orchestrator secrets are absent, even with the flag on', async () => {
    expect(
      await names({ flag: 'true', ownerId: '17257145', hasSecrets: false }),
    ).toEqual([]);
  });

  it('excludes them when no authenticated owner id is available, regardless of the flag', async () => {
    expect(await names({ flag: 'true', hasSecrets: true })).toEqual([]);
    expect(await names({ hasSecrets: true })).toEqual([]);
  });

  it('honours an optional LIVE_DATA_GITHUB_IDS allowlist (same numeric-id identity as ADMIN_GITHUB_ID)', async () => {
    expect(
      await names({
        flag: 'true',
        ownerId: '17257145',
        allowlist: '17257145, 99',
        hasSecrets: true,
      }),
    ).toEqual(LIVE_DATA_TOOL_NAMES);
    expect(
      await names({
        flag: 'true',
        ownerId: '17257145',
        allowlist: '99',
        hasSecrets: true,
      }),
    ).toEqual([]);
  });
});
