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
 * A smoke-suite target: the real `worker/default-handler.ts` plus minimal
 * stubs for the two surfaces `worker/index.ts`'s OAuthProvider wrapper (not
 * mounted here — see DEFAULT_HANDLER_FIXTURE's header) provides in a real
 * deployment: `/.well-known/oauth-authorization-server` metadata and the
 * OAuth-protected `/mcp` endpoint's unauthenticated 401. The ASSETS stub
 * mimics the deployed assets binding's `single-page-application` behavior
 * (app-shell HTML for unknown paths, an image response for the showcase
 * stills) so `scripts/smoke.mjs`'s full check list — which asserts exactly
 * those production shapes — can run green against Miniflare's local HTTP
 * server in `src/testing/smoke-checks.test.ts`.
 */
export const SMOKE_TARGET_FIXTURE = String.raw`
import { defaultHandler } from './worker/default-handler.ts';
export { TopologyDocument } from './worker/document.ts';
export { TopologyRegistry } from './worker/registry.ts';

const APP_SHELL =
  '<!doctype html><html><head><title>Topology Dojo</title></head>' +
  '<body><div id="app"></div></body></html>';

const assetsStub = {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/showcase/') && pathname.endsWith('.webp')) {
      return new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46]), {
        headers: { 'content-type': 'image/webp' },
      });
    }
    // single-page-application not_found_handling: unknown paths serve the
    // app shell with a 200, exactly like the deployed assets binding.
    return new Response(APP_SHELL, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  },
};

function unimplemented(name) {
  return () => {
    throw new Error(
      'OAUTH_PROVIDER.' + name + ' is not stubbed by the smoke-target fixture',
    );
  };
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    // Stand-ins for what the OAuthProvider wrapper serves in production.
    if (pathname === '/.well-known/oauth-authorization-server') {
      return new Response(
        JSON.stringify({
          authorization_endpoint: new URL('/authorize', request.url).href,
          token_endpoint: new URL('/token', request.url).href,
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }
    if (pathname === '/mcp') {
      return new Response('Unauthorized', { status: 401 });
    }
    const stubbedEnv = Object.assign({}, env, {
      OAUTH_PROVIDER: {
        parseAuthRequest: unimplemented('parseAuthRequest'),
        completeAuthorization: unimplemented('completeAuthorization'),
      },
      ASSETS: assetsStub,
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
 * Drives `worker/workspaces.ts`'s `WorkspaceService` directly (no HTTP auth
 * layer) so tests can exercise the `migrateLegacyOnAccess` split between the
 * owner-facing browser surface (default: lazily migrates a legacy draft) and
 * the agent-facing MCP surface (`mode=agent`: rejects a legacy id without
 * migrating). `/seed` plants a raw legacy `tdoc:` value in the login-keyed
 * registry the way the legacy authoring tools' persist path does.
 */
export const WORKSPACE_MIGRATION_FIXTURE = String.raw`
import { WorkspaceService } from './worker/workspaces.ts';
export { TopologyDocument } from './worker/document.ts';
export { TopologyRegistry } from './worker/registry.ts';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const uid = url.searchParams.get('uid') ?? '1';
    const login = url.searchParams.get('login') ?? 'alice';
    const id = url.searchParams.get('id') ?? '';
    const json = (value, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
      });

    if (url.pathname === '/seed' && request.method === 'POST') {
      const ns = env.TOPOLOGY_REGISTRY;
      await ns.get(ns.idFromName('user:' + login)).put('tdoc:' + id, await request.text());
      return json({ seeded: id });
    }

    const service = new WorkspaceService(
      env,
      { uid, login },
      { migrateLegacyOnAccess: url.searchParams.get('mode') !== 'agent' },
    );
    try {
      if (url.pathname === '/migrated')
        return json({ migrated: await service.isMigrated(id) });
      if (url.pathname === '/manifest')
        return json(await service.manifest(id));
      if (url.pathname === '/elements')
        return json(
          await service.elements(id, url.searchParams.get('pageId') ?? ''),
        );
      return json({ error: 'not found' }, 404);
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
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
