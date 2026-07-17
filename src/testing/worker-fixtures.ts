/**
 * Worker entry sources for `buildWorkerBundle` (see worker-harness.ts for why
 * these are TypeScript source text rather than files under `src/`).
 */

/**
 * Mounts the real `worker/default-handler.ts` — auth routes, the public share
 * snapshot API, and the workspace API — with a stubbed `OAUTH_PROVIDER`. The
 * real provider is injected by the `OAuthProvider` wrapper in `worker/index.ts`
 * (see `apiRoute`/`defaultHandler` there); this fixture bypasses that wrapper
 * entirely, so `/authorize` and the non-web `/callback` branch (the MCP OAuth
 * grant flow) are intentionally out of reach here — they would need a real
 * stub implementation, which is out of scope for this packet (see W1 report).
 * `ASSETS` falls back to a bare 404 responder when Miniflare doesn't bind it.
 */
export const DEFAULT_HANDLER_FIXTURE = String.raw`
import { defaultHandler } from './worker/default-handler.ts';
export { TopologyDocument } from './worker/document.ts';
export { TopologyRegistry } from './worker/registry.ts';

function unimplemented(name) {
  return () => {
    throw new Error(
      'OAUTH_PROVIDER.' + name + ' is not stubbed by the worker-harness fixture',
    );
  };
}

export default {
  async fetch(request, env, ctx) {
    const stubbedEnv = Object.assign({}, env, {
      OAUTH_PROVIDER: {
        parseAuthRequest: unimplemented('parseAuthRequest'),
        completeAuthorization: unimplemented('completeAuthorization'),
      },
      ASSETS:
        env.ASSETS ??
        { fetch: async () => new Response('Not Found', { status: 404 }) },
    });
    return defaultHandler.fetch(request, stubbedEnv, ctx);
  },
};
`;

/**
 * Exercises `worker/workspace-tools.ts`'s pure `workspaceToolNames` — the
 * WORKSPACE_ENABLED gate on the eight workspace MCP tools registered by
 * `worker/mcp.ts`'s `TopologyMcp.init()`. That Durable Object class needs a
 * live `cloudflare:workers` runtime (via `agents/mcp`) just to construct, so
 * it isn't exercised directly here; this fixture imports only the pure
 * decision function `init()` delegates to, with no Durable Object bindings
 * required. `flag`/`hasWorkspaceService` come from the query string so a
 * single Miniflare instance covers every combination.
 */
export const WORKSPACE_TOOL_NAMES_FIXTURE = String.raw`
import { workspaceToolNames } from './worker/workspace-tools.ts';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const flag = url.searchParams.get('flag');
    const hasWorkspaceService = url.searchParams.get('hasWorkspaceService') === 'true';
    const env = flag === null ? {} : { WORKSPACE_ENABLED: flag };
    return new Response(
      JSON.stringify(workspaceToolNames(env, hasWorkspaceService)),
      { headers: { 'content-type': 'application/json' } },
    );
  },
};
`;

/**
 * `WORKSPACE_TOOL_NAMES_FIXTURE`'s Packet P4 sibling: exercises
 * `worker/profile-tools.ts`'s pure `profileToolNames` — the PROFILES_ENABLED
 * gate (opt-in, unlike workspaces) on the three read-only guidance tools
 * registered by `TopologyMcp.init()`.
 */
export const PROFILE_TOOL_NAMES_FIXTURE = String.raw`
import { profileToolNames } from './worker/profile-tools.ts';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const flag = url.searchParams.get('flag');
    const hasProfileService = url.searchParams.get('hasProfileService') === 'true';
    const env = flag === null ? {} : { PROFILES_ENABLED: flag };
    return new Response(
      JSON.stringify(profileToolNames(env, hasProfileService)),
      { headers: { 'content-type': 'application/json' } },
    );
  },
};
`;
