/**
 * Cloudflare Worker entry — serves the built app (static assets) and exposes the
 * MCP server at `/mcp` behind a shared-secret bearer check.
 *
 *   GET/POST /mcp           → MCP over Streamable HTTP (auth required)
 *   GET /api/topology/:id   → JSON of a published share snapshot (from KV)
 *   /v/:id                  → the SPA (it reads :id and loads the snapshot)
 *   everything else         → the static SPA (env.ASSETS)
 *
 * Deploy: see src/mcp/README.md → "Remote (Cloudflare)". The DO class below is
 * the per-session MCP agent and must be exported from the entry module.
 */
import { isAuthorized } from '../src/mcp/auth.js';
import { TopologyMcp } from './mcp.js';
import type { WorkerEnv } from './env.js';

export { TopologyMcp };

const mcpHandler = TopologyMcp.serve('/mcp', { binding: 'MCP_OBJECT' });

const API_TOPOLOGY_PREFIX = '/api/topology/';

/** Serve a published snapshot's JSON from KV (the SPA fetches this for /v/:id). */
async function serveSnapshot(id: string, env: WorkerEnv): Promise<Response> {
  const json = await env.TOPOLOGY_KV.get(`doc:${id}`);
  if (!json) {
    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(json, {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=60',
    },
  });
}

export default {
  async fetch(
    request: Request,
    env: WorkerEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/mcp' || pathname.startsWith('/mcp/')) {
      const authDisabled = env.MCP_AUTH_DISABLED === 'true';
      if (authDisabled) {
        console.warn('MCP auth DISABLED via MCP_AUTH_DISABLED — /mcp is open.');
      } else if (!isAuthorized(request, env.MCP_API_KEY)) {
        return new Response('Unauthorized\n', {
          status: 401,
          headers: { 'WWW-Authenticate': 'Bearer realm="topology-dojo-mcp"' },
        });
      }
      return mcpHandler.fetch(request, env, ctx);
    }
    if (pathname.startsWith(API_TOPOLOGY_PREFIX)) {
      if (request.method !== 'GET') {
        return new Response('Method Not Allowed\n', { status: 405 });
      }
      const id = pathname.slice(API_TOPOLOGY_PREFIX.length);
      if (!id) return new Response('Not Found\n', { status: 404 });
      return serveSnapshot(id, env);
    }
    // /v/:id and everything else fall through to the SPA (the not-found handler
    // serves index.html, and the app reads the share id from the path).
    return env.ASSETS.fetch(request);
  },
};
