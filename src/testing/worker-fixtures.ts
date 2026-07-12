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
