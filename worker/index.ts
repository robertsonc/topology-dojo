/**
 * Cloudflare Worker entry. The whole worker is wrapped in an OAuth 2.1 provider
 * (Cloudflare's `workers-oauth-provider`) so the MCP endpoint is real-auth
 * protected, with GitHub as the upstream identity provider:
 *
 *   /mcp                     → MCP over Streamable HTTP (OAuth-protected)
 *   /authorize, /callback    → GitHub sign-in (the default handler)
 *   /token, /register        → the OAuth provider's own endpoints
 *   /api/topology/:id, /v/:id, /* → the default handler (share API + static SPA)
 *   /keys, /api/keys         → user-tied API keys (proposal 0005; default handler)
 *
 * An authenticated MCP session receives the GitHub user as `this.props` in the
 * agent — from the OAuth grant, or (when `API_KEYS_ENABLED`) from a user-minted
 * `Bearer tdk_…` API key resolved through the provider's `resolveExternalToken`
 * hook (`worker/api-keys.ts`), which yields the same `{ id, login, name }` shape
 * plus `auth: 'api_key'` and the key's scopes. Setup (GitHub OAuth app, OAUTH_KV, GITHUB_CLIENT_SECRET,
 * optional SESSION_HMAC_SECRET): see src/mcp/README.md → "Remote
 * (Cloudflare)". The DO class must be exported here.
 */
import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { TopologyMcp } from './mcp.js';
import { TopologyRegistry } from './registry.js';
import { TopologyDocument } from './document.js';
import { AuthoringProfile } from './profile.js';
import { AnalyticsLog } from './analytics.js';
import { defaultHandler } from './default-handler.js';
import { resolveApiKeyToken } from './api-keys.js';
import type { WorkerEnv } from './env.js';

// Every Durable Object class must be exported from the Worker entry so the
// runtime can construct them (MCP_OBJECT → per-session agent; TOPOLOGY_REGISTRY
// → per-user document store; TOPOLOGY_DOCUMENT → per-topology coordinator;
// AUTHORING_PROFILE → per-owner observe-only authoring profile, migration v4;
// ANALYTICS → owner-analytics login roster, migration v5).
export {
  TopologyDocument,
  TopologyMcp,
  TopologyRegistry,
  AuthoringProfile,
  AnalyticsLog,
};

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
  // Bearers that are not one of the provider's own `<userId>:<grantId>:<secret>`
  // tokens are handed here. Only `tdk_…` API keys are ever accepted, and only
  // while API_KEYS_ENABLED; everything else stays an `invalid_token` 401.
  resolveExternalToken: (input) =>
    resolveApiKeyToken({
      token: input.token,
      request: input.request,
      env: input.env as WorkerEnv,
    }),
});
