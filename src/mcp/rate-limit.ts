/**
 * Application-level quotas for remote MCP + public share reads.
 *
 * The coordinator already caps operation-batch size (250 ops / 512 KiB) and
 * page size. This module is the request-rate complement: a sliding window
 * over timestamps, plus a hard byte cap on SVG/HTML export payloads.
 *
 * Kept pure (no Worker imports) so the algorithm is unit-testable in Node.
 * The per-user Durable Object (`TopologyRegistry`) stores the windows; the
 * public snapshot GET uses the same fixed-window helper against KV.
 */

/** UTF-8 byte length of a string (export payloads, not JSON). */
export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function formatMib(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  return Number.isInteger(mib) ? `${mib} MiB` : `${mib.toFixed(1)} MiB`;
}

/**
 * `render_svg` typically returns 20–300 KiB. 2 MiB rejects pathological
 * pages without clipping a normal diagram.
 */
export const MAX_SVG_EXPORT_BYTES = 2 * 1024 * 1024;

/**
 * Flipbook HTML embeds every page's SVG. 6 MiB covers a handful of dense
 * pages; larger stories should `render_svg` pages individually.
 */
export const MAX_HTML_EXPORT_BYTES = 6 * 1024 * 1024;

export function assertExportWithinLimit(
  body: string,
  maxBytes: number,
  kind: 'SVG' | 'HTML',
): string {
  const size = utf8Bytes(body);
  if (size > maxBytes) {
    throw new Error(
      `${kind} export exceeds the ${formatMib(maxBytes)} limit (${size} bytes). ` +
        'Reduce page density or export fewer pages; do not retry the same oversized output.',
    );
  }
  return body;
}

export type RateLimitBucket = 'mutating' | 'share';

export interface RateLimitSpec {
  /** Human-readable label used in error text (agents parse this to back off). */
  label: string;
  limit: number;
  windowMs: number;
}

/**
 * Mutating MCP tools (legacy authoring + workspace writes). 120/min is
 * enough for an agent building a dense diagram with individual `add_*`
 * calls, and still prefers `edit_topology` batches (one call per batch).
 */
export const MUTATING_LIMIT: RateLimitSpec = {
  label: 'mutating MCP tools',
  limit: 120,
  windowMs: 60_000,
};

/**
 * `share_topology` writes a new public KV snapshot (30-day TTL). 8 per 5
 * minutes covers iterate-and-republish without allowing share-link spam.
 */
export const SHARE_LIMIT: RateLimitSpec = {
  label: 'share_topology',
  limit: 8,
  windowMs: 5 * 60_000,
};

/**
 * Public `GET /api/topology/:id`. Edge cache already absorbs repeats
 * (24h immutable). 60/min per IP covers a classroom opening the same
 * link without amplifying KV reads on scrape.
 */
export const SNAPSHOT_GET_LIMIT: RateLimitSpec = {
  label: 'public snapshot GET',
  limit: 60,
  windowMs: 60_000,
};

export const RATE_LIMITS: Record<RateLimitBucket, RateLimitSpec> = {
  mutating: MUTATING_LIMIT,
  share: SHARE_LIMIT,
};

/**
 * Tools that mutate a private draft, a shared workspace, or publish a
 * snapshot. Read-only inspect/render/list tools are intentionally absent —
 * those are bounded by the export-size cap (and by the agent’s own context
 * budget) rather than a request quota.
 */
export const MUTATING_MCP_TOOLS: ReadonlySet<string> = new Set([
  'create_topology',
  'create_from_template',
  'delete_topology',
  'import_topology',
  'set_document_title',
  'add_page',
  'set_page_properties',
  'add_node',
  'add_link',
  'add_anchor',
  'add_zone',
  'add_flow_path',
  'add_policy_marker',
  'edit_topology',
  'update_element',
  'remove_element',
  'upsert_by_source',
  'define_layer',
  'define_node_type',
  'set_node_metadata',
  'set_legend',
  'set_palette',
  'tidy_topology',
  'balance_topology',
  'layout_topology',
  'build_flow_topology',
  'create_workspace',
  'propose_workspace_changes',
  'apply_workspace_changes',
  'create_checkpoint',
]);

export const SHARE_MCP_TOOL = 'share_topology';

/** Which per-user bucket a tool consumes, or `null` if it is not quota'd. */
export function rateLimitBucketForTool(
  toolName: string,
): RateLimitBucket | null {
  if (toolName === SHARE_MCP_TOOL) return 'share';
  if (MUTATING_MCP_TOOLS.has(toolName)) return 'mutating';
  return null;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  limit: number;
  windowMs: number;
  label: string;
}

export interface SlidingWindowOutcome {
  hits: number[];
  result: RateLimitResult;
}

/**
 * Sliding window over allowed-request timestamps. Denied calls are not
 * recorded, so a retry storm does not push the window forward.
 */
export function consumeSlidingWindow(
  hits: readonly number[],
  now: number,
  spec: RateLimitSpec,
): SlidingWindowOutcome {
  const inWindow = hits.filter((t) => now - t < spec.windowMs);
  if (inWindow.length >= spec.limit) {
    const oldest = inWindow[0]!;
    return {
      hits: inWindow,
      result: {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(1, spec.windowMs - (now - oldest)),
        limit: spec.limit,
        windowMs: spec.windowMs,
        label: spec.label,
      },
    };
  }
  return {
    hits: [...inWindow, now],
    result: {
      allowed: true,
      remaining: spec.limit - inWindow.length - 1,
      retryAfterMs: 0,
      limit: spec.limit,
      windowMs: spec.windowMs,
      label: spec.label,
    },
  };
}

export interface FixedWindowOutcome {
  next: number;
  result: RateLimitResult;
}

/**
 * Fixed-window counter (KV-friendly: one integer per window id). Denied
 * calls do not increment, matching the sliding-window policy.
 */
export function consumeFixedWindow(
  current: number,
  now: number,
  spec: RateLimitSpec,
): FixedWindowOutcome {
  const windowStart = Math.floor(now / spec.windowMs) * spec.windowMs;
  const retryAfterMs = Math.max(1, windowStart + spec.windowMs - now);
  if (current >= spec.limit) {
    return {
      next: current,
      result: {
        allowed: false,
        remaining: 0,
        retryAfterMs,
        limit: spec.limit,
        windowMs: spec.windowMs,
        label: spec.label,
      },
    };
  }
  return {
    next: current + 1,
    result: {
      allowed: true,
      remaining: spec.limit - current - 1,
      retryAfterMs: 0,
      limit: spec.limit,
      windowMs: spec.windowMs,
      label: spec.label,
    },
  };
}

/** KV key for one IP's snapshot-GET window. Isolated from `doc:<id>` shares. */
export function snapshotRateLimitKey(ip: string, now: number): string {
  const windowId = Math.floor(now / SNAPSHOT_GET_LIMIT.windowMs);
  return `rl:snap:${ip}:${windowId}`;
}

/** Client IP for the public snapshot limiter. Missing ⇒ skip (fail open). */
export function snapshotClientIp(request: Request): string | null {
  const cf = request.headers.get('CF-Connecting-IP')?.trim();
  if (cf) return cf;
  const forwarded = request.headers
    .get('X-Forwarded-For')
    ?.split(',')[0]
    ?.trim();
  return forwarded || null;
}

export function formatRateLimitError(result: RateLimitResult): string {
  const retrySec = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
  const hint =
    result.label === MUTATING_LIMIT.label
      ? ' Prefer edit_topology batches over per-element calls.'
      : '';
  return (
    `rate limited (${result.label}: ${result.limit} per ${result.windowMs / 1000}s). ` +
    `Retry after ${retrySec}s.${hint}`
  );
}

/** Durable-object storage key for one per-user bucket (not a `tdoc:` draft). */
export function registryRateLimitKey(bucket: RateLimitBucket): string {
  return `rl:${bucket}`;
}
