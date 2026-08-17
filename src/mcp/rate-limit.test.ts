import { describe, expect, it } from 'vitest';
import {
  MAX_HTML_EXPORT_BYTES,
  MAX_SVG_EXPORT_BYTES,
  MUTATING_LIMIT,
  MUTATING_MCP_TOOLS,
  SHARE_LIMIT,
  SHARE_MCP_TOOL,
  SNAPSHOT_GET_LIMIT,
  assertExportWithinLimit,
  consumeFixedWindow,
  consumeSlidingWindow,
  formatMib,
  formatRateLimitError,
  rateLimitBucketForTool,
  registryRateLimitKey,
  snapshotClientIp,
  snapshotRateLimitKey,
  utf8Bytes,
} from './rate-limit.js';

describe('utf8Bytes / formatMib / assertExportWithinLimit', () => {
  it('counts UTF-8 bytes, not JS string length', () => {
    expect(utf8Bytes('abc')).toBe(3);
    expect(utf8Bytes('é')).toBe(2);
  });

  it('formats whole and fractional MiB', () => {
    expect(formatMib(2 * 1024 * 1024)).toBe('2 MiB');
    expect(formatMib(6 * 1024 * 1024)).toBe('6 MiB');
    expect(formatMib(1536 * 1024)).toBe('1.5 MiB');
  });

  it('returns a body that is within the cap', () => {
    expect(assertExportWithinLimit('<svg/>', MAX_SVG_EXPORT_BYTES, 'SVG')).toBe(
      '<svg/>',
    );
  });

  it('rejects an SVG over the 2 MiB cap with a clear, non-retry hint', () => {
    const oversized = 'x'.repeat(MAX_SVG_EXPORT_BYTES + 1);
    expect(() =>
      assertExportWithinLimit(oversized, MAX_SVG_EXPORT_BYTES, 'SVG'),
    ).toThrow(
      /SVG export exceeds the 2 MiB limit \(2097153 bytes\).*do not retry/,
    );
  });

  it('rejects an HTML flipbook over the 6 MiB cap', () => {
    const oversized = 'y'.repeat(MAX_HTML_EXPORT_BYTES + 1);
    expect(() =>
      assertExportWithinLimit(oversized, MAX_HTML_EXPORT_BYTES, 'HTML'),
    ).toThrow(/HTML export exceeds the 6 MiB limit/);
  });
});

describe('rateLimitBucketForTool', () => {
  it('puts share_topology in its own tighter bucket', () => {
    expect(rateLimitBucketForTool(SHARE_MCP_TOOL)).toBe('share');
  });

  it('quotas mutating authoring and workspace writes', () => {
    expect(rateLimitBucketForTool('edit_topology')).toBe('mutating');
    expect(rateLimitBucketForTool('propose_workspace_changes')).toBe(
      'mutating',
    );
    expect(rateLimitBucketForTool('apply_workspace_changes')).toBe('mutating');
    expect(rateLimitBucketForTool('create_checkpoint')).toBe('mutating');
    expect(MUTATING_MCP_TOOLS.has(SHARE_MCP_TOOL)).toBe(false);
  });

  it("leaves read-only inspect/render/list tools unquota'd", () => {
    for (const name of [
      'describe_capabilities',
      'list_topologies',
      'get_topology',
      'validate_topology',
      'inspect_render',
      'render_svg',
      'export_flipbook',
      'get_workspace_manifest',
      'get_workspace_changes',
      'list_checkpoints',
      'get_authoring_guidance',
    ]) {
      expect(rateLimitBucketForTool(name)).toBeNull();
    }
  });
});

describe('consumeSlidingWindow', () => {
  const spec = { label: 'test', limit: 3, windowMs: 1_000 };

  it('allows up to the limit and then denies with retry-after', () => {
    let hits: number[] = [];
    let now = 10_000;
    for (let i = 0; i < 3; i++) {
      const out = consumeSlidingWindow(hits, now, spec);
      expect(out.result.allowed).toBe(true);
      expect(out.result.remaining).toBe(2 - i);
      hits = out.hits;
      now += 10;
    }
    const denied = consumeSlidingWindow(hits, now, spec);
    expect(denied.result.allowed).toBe(false);
    expect(denied.result.remaining).toBe(0);
    expect(denied.hits).toEqual(hits);
    expect(denied.result.retryAfterMs).toBeGreaterThan(0);
    expect(denied.result.retryAfterMs).toBeLessThanOrEqual(spec.windowMs);
  });

  it('does not record a denied hit, so a retry storm cannot extend the window', () => {
    const hits = [10_000, 10_100, 10_200];
    const first = consumeSlidingWindow(hits, 10_300, spec);
    const second = consumeSlidingWindow(first.hits, 10_400, spec);
    expect(first.result.allowed).toBe(false);
    expect(second.result.allowed).toBe(false);
    expect(second.hits).toEqual(hits);
  });

  it('prunes timestamps that have left the window and allows a new hit', () => {
    const hits = [10_000, 10_100, 10_200];
    const out = consumeSlidingWindow(hits, 11_050, spec);
    expect(out.result.allowed).toBe(true);
    expect(out.hits).toEqual([10_100, 10_200, 11_050]);
    expect(out.result.remaining).toBe(0);
  });
});

describe('consumeFixedWindow', () => {
  const spec = SNAPSHOT_GET_LIMIT;

  it('allows `limit` hits then denies until the window rolls', () => {
    const now = spec.windowMs * 5 + 1_000;
    let current = 0;
    for (let i = 0; i < spec.limit; i++) {
      const out = consumeFixedWindow(current, now, spec);
      expect(out.result.allowed).toBe(true);
      current = out.next;
    }
    const denied = consumeFixedWindow(current, now, spec);
    expect(denied.result.allowed).toBe(false);
    expect(denied.next).toBe(spec.limit);
    expect(denied.result.retryAfterMs).toBe(spec.windowMs - 1_000);
  });
});

describe('formatRateLimitError', () => {
  it('names the bucket, limit, and retry-after so an agent can back off', () => {
    const denied = consumeSlidingWindow(
      Array.from({ length: MUTATING_LIMIT.limit }, (_, i) => 1_000 + i),
      2_000,
      MUTATING_LIMIT,
    ).result;
    const message = formatRateLimitError(denied);
    expect(message).toMatch(/rate limited \(mutating MCP tools: 120 per 60s\)/);
    expect(message).toMatch(/Retry after \d+s/);
    expect(message).toContain('Prefer edit_topology batches');
  });

  it('omits the batching hint for share_topology', () => {
    const denied = consumeSlidingWindow(
      Array.from({ length: SHARE_LIMIT.limit }, () => 1_000),
      1_100,
      SHARE_LIMIT,
    ).result;
    const message = formatRateLimitError(denied);
    expect(message).toMatch(/share_topology: 8 per 300s/);
    expect(message).not.toContain('edit_topology');
  });
});

describe('snapshot key / client IP helpers', () => {
  it('namespaces snapshot counters away from doc: share keys', () => {
    const key = snapshotRateLimitKey(
      '203.0.113.9',
      SNAPSHOT_GET_LIMIT.windowMs,
    );
    expect(key).toBe('rl:snap:203.0.113.9:1');
    expect(key.startsWith('doc:')).toBe(false);
  });

  it('prefers CF-Connecting-IP over X-Forwarded-For', () => {
    const request = new Request('https://example.test/api/topology/x', {
      headers: {
        'CF-Connecting-IP': '198.51.100.4',
        'X-Forwarded-For': '203.0.113.1, 192.0.2.1',
      },
    });
    expect(snapshotClientIp(request)).toBe('198.51.100.4');
  });

  it('falls back to the first X-Forwarded-For hop, or null', () => {
    const forwarded = new Request('https://example.test/api/topology/x', {
      headers: { 'X-Forwarded-For': ' 203.0.113.8, 192.0.2.1 ' },
    });
    expect(snapshotClientIp(forwarded)).toBe('203.0.113.8');
    expect(
      snapshotClientIp(new Request('https://example.test/api/topology/x')),
    ).toBeNull();
  });

  it('keeps registry quota keys out of the tdoc: persist prefix', () => {
    expect(registryRateLimitKey('mutating')).toBe('rl:mutating');
    expect(registryRateLimitKey('share')).toBe('rl:share');
  });
});
