/**
 * Cloudflare Worker entry. The whole worker is wrapped in an OAuth 2.1 provider
 * (Cloudflare's `workers-oauth-provider`) so the MCP endpoint is real-auth
 * protected, with GitHub as the upstream identity provider:
 *
 *   /mcp                     → MCP over Streamable HTTP (OAuth-protected)
 *   /authorize, /callback    → GitHub sign-in (the default handler)
 *   /token, /register        → the OAuth provider's own endpoints
 *   /api/topology/:id, /v/:id, /* → the default handler (share API + static SPA)
 *
 * An authenticated MCP session receives the GitHub user as `this.props` in the
 * agent. Setup (GitHub OAuth app, OAUTH_KV, GITHUB_CLIENT_SECRET): see
 * src/mcp/README.md → "Remote (Cloudflare)". The DO class must be exported here.
 */
import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { TopologyMcp } from './mcp.js';
import { TopologyRegistry } from './registry.js';
import { TopologyDocument } from './document.js';
import { defaultHandler } from './default-handler.js';
import type { WorkerEnv } from './env.js';

// Both Durable Object classes must be exported from the Worker entry so the
// runtime can bind them (MCP_OBJECT → per-session agent; TOPOLOGY_REGISTRY →
// per-user document store).
export { TopologyDocument, TopologyMcp, TopologyRegistry };

// The MCP agent's Streamable HTTP handler, gated by the OAuth provider. Wrapped
// so its (generic) fetch presents the concrete required signature the provider
// expects for an API handler.
const mcp = TopologyMcp.serve('/mcp');
const apiHandler = {
  fetch: (
    request: Request,
    env: WorkerEnv,
    ctx: ExecutionContext,
  ): Promise<Response> => mcp.fetch(request, env, ctx),
};

export default new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler,
  defaultHandler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
});
