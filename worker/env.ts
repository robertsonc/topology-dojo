/**
 * The Worker's binding surface, shared by the OAuth entry (`index.ts`), the
 * default handler (`default-handler.ts`), and the MCP Durable Object (`mcp.ts`).
 * Kept in one place so the KV/secret/DO bindings stay in sync.
 */
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';

export interface WorkerEnv {
  /** Static-assets binding (the Vite build in ./dist). */
  ASSETS: { fetch: (request: Request) => Promise<Response> };
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
  /** KV namespace where the OAuth provider stores grants/tokens. */
  OAUTH_KV: KVNamespace;
  /** OAuth helper API, injected by the OAuthProvider into every handler. */
  OAUTH_PROVIDER: OAuthHelpers;
  /** GitHub OAuth App client id (public; set as a var). */
  GITHUB_CLIENT_ID: string;
  /** GitHub OAuth App client secret (set as a Wrangler/dashboard secret). */
  GITHUB_CLIENT_SECRET: string;
  /**
   * EdgeConnect Orchestrator origin + API key (both optional; set the key as
   * a Wrangler/dashboard secret). When both are present, the MCP agent wires
   * the live-data provider and registers the read-only fabric tools.
   */
  ORCH_BASE_URL?: string;
  ORCH_API_KEY?: string;
}
