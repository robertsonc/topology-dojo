/**
 * Cloudflare Worker entry — serves the built app (static assets) and exposes the
 * MCP server at `/mcp` behind a shared-secret bearer check.
 *
 *   GET/POST /mcp        → MCP over Streamable HTTP (auth required)
 *   everything else      → the static SPA (env.ASSETS)
 *
 * Deploy: see src/mcp/README.md → "Remote (Cloudflare)". The DO class below is
 * the per-session MCP agent and must be exported from the entry module.
 */
import { isAuthorized } from '../src/mcp/auth.js';
import { TopologyMcp } from './mcp.js';

export { TopologyMcp };

interface Env {
  /** Static-assets binding (the Vite build in ./dist). */
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  /** Shared secret for bearer auth (a Wrangler secret). */
  MCP_API_KEY?: string;
  /** Durable Object namespace backing the MCP agent. */
  MCP_OBJECT: DurableObjectNamespace;
}

const mcpHandler = TopologyMcp.serve('/mcp', { binding: 'MCP_OBJECT' });

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/mcp' || pathname.startsWith('/mcp/')) {
      if (!isAuthorized(request, env.MCP_API_KEY)) {
        return new Response('Unauthorized\n', {
          status: 401,
          headers: { 'WWW-Authenticate': 'Bearer realm="topology-dojo-mcp"' },
        });
      }
      return mcpHandler.fetch(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
};
