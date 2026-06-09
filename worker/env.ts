/**
 * The Worker's binding surface, shared by the entry module (`index.ts`) and the
 * MCP Durable Object (`mcp.ts`). Kept in one place so the KV/secret/DO bindings
 * stay in sync between the request router and the agent that publishes to them.
 */
export interface WorkerEnv {
  /** Static-assets binding (the Vite build in ./dist). */
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  /** Shared secret for bearer auth (a Wrangler secret). */
  MCP_API_KEY?: string;
  /**
   * Temporary escape hatch: when set to "true", the bearer check on /mcp is
   * skipped entirely (the endpoint is wide open). Intended only for short-lived
   * testing of a client connection — unset it (or set anything but "true") to
   * restore the normal shared-secret auth. Never leave this on for a deploy that
   * is reachable from the public internet.
   */
  MCP_AUTH_DISABLED?: string;
  /**
   * Public origin of this deployment (e.g. https://topology-dojo.example.com),
   * used to build absolute share links returned by `share_topology`. If unset,
   * links fall back to a site-relative path.
   */
  PUBLIC_BASE_URL?: string;
  /** Durable Object namespace backing the MCP agent. */
  MCP_OBJECT: DurableObjectNamespace;
  /** KV namespace where `share_topology` snapshots published documents. */
  TOPOLOGY_KV: KVNamespace;
}
