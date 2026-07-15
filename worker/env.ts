/**
 * The Worker's binding surface, shared by the OAuth entry (`index.ts`), the
 * default handler (`default-handler.ts`), and the MCP Durable Object (`mcp.ts`).
 * Kept in one place so the KV/secret/DO bindings stay in sync.
 */
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import type { TopologyRegistry } from './registry.js';
import type { TopologyDocument } from './document.js';
import type { AuthoringProfile } from './profile.js';

export interface WorkerEnv {
  /** Static-assets binding (the Vite build in ./dist). */
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  /**
   * Public origin of this deployment (e.g. https://topology-dojo.example.com),
   * used to build absolute share links returned by `share_topology`. If unset,
   * links fall back to a site-relative path.
   */
  PUBLIC_BASE_URL?: string;
  /** Durable Object namespace backing the MCP agent (one DO per MCP session). */
  MCP_OBJECT: DurableObjectNamespace;
  /**
   * Per-user document registry DO (one DO per authenticated GitHub user). This
   * is the durable home for authored topologies — independent of the ephemeral,
   * per-session MCP_OBJECT DO, so a user's documents survive and are shared
   * across all of their MCP sessions.
   */
  TOPOLOGY_REGISTRY: DurableObjectNamespace<TopologyRegistry>;
  /** One canonical, revisioned coordinator per shared topology document. */
  TOPOLOGY_DOCUMENT: DurableObjectNamespace<TopologyDocument>;
  /**
   * Per-owner authoring-profile store (Packet P2 / proposal 0003-A). One DO per
   * authenticated owner, keyed by the stable numeric uid — the same identity
   * scheme the coordinator uses. It holds bounded, observe-only preference
   * *candidates* learned asynchronously from attributed correction outcomes; it
   * never changes agent output (retrieval/guidance is a later packet).
   */
  AUTHORING_PROFILE: DurableObjectNamespace<AuthoringProfile>;
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
  /**
   * Feature flag gating the shared workspace surfaces — the `/api/workspaces`
   * REST routes (`default-handler.ts`) and the eight workspace MCP tools
   * (`mcp.ts`). Unset means enabled: local dev (`wrangler dev` with no vars
   * set) and `env.staging` (which sets `"true"` explicitly, for clarity) must
   * keep working exactly as before this flag existed. Only the literal string
   * `"false"` disables it. The production bootstrap deploy sets
   * `"WORKSPACE_ENABLED": "false"` at the top level of `wrangler.jsonc` so the
   * `v3` `TopologyDocument` migration can ship with workspace traffic held
   * back until a later, explicit activation deploy flips this to `"true"`
   * (see proposal 0004, decision 4).
   */
  WORKSPACE_ENABLED?: string;
  /**
   * The deployed commit SHA, surfaced verbatim by `GET /healthz` (`sha`
   * field) so `scripts/smoke.mjs --sha <sha>` and deploy workflow summaries
   * can prove which commit is actually live. Deploy workflows set this with
   * `wrangler deploy --var GIT_SHA:$GITHUB_SHA`; unset in local dev, where
   * `/healthz` reports `sha: null`.
   */
  GIT_SHA?: string;
  /**
   * Feature flag gating the observe-only authoring-profile learner (Packet P2 /
   * proposal 0003-A) — the coordinator's outcome-emission hook (`document.ts`)
   * and, later, the profile read/manage surfaces. This is a brand-new Durable
   * Object class (`AuthoringProfile`, migration `v4`), so unlike
   * `WORKSPACE_ENABLED` it defaults **OFF**: only the literal string `"true"`
   * enables it (unset ⇒ disabled). A new class must bootstrap disabled in
   * production so the `v4` migration can ship inert (no coordinator overhead,
   * no behavior change) and be activated by a later, explicit deploy that sets
   * `"PROFILES_ENABLED": "true"` at the top level of `wrangler.jsonc`.
   * `env.staging` sets it `"true"` so staging observes; production stays unset
   * until the operator activates (see proposal 0004's bootstrap-then-activate
   * pattern and DEPLOYMENT_RUNBOOK.md).
   */
  PROFILES_ENABLED?: string;
}

/**
 * Whether the shared workspace surfaces should accept traffic. Unset ⇒
 * enabled (see the `WORKSPACE_ENABLED` field doc comment above) — only the
 * exact string `"false"` disables. Any other value (including a typo'd var)
 * fails open to "enabled" rather than silently cutting off workspace access.
 */
export function workspaceEnabled(
  env: Pick<WorkerEnv, 'WORKSPACE_ENABLED'>,
): boolean {
  return env.WORKSPACE_ENABLED !== 'false';
}

/**
 * Whether the observe-only authoring-profile learner should run. Defaults OFF —
 * the OPPOSITE of `workspaceEnabled` (see the `PROFILES_ENABLED` field doc
 * comment above): this is a brand-new DO class that must bootstrap disabled in
 * production, so it is opt-in and only the exact string `"true"` enables it.
 * Any other value (unset, `"false"`, a typo) fails closed to "disabled", so an
 * un-activated production deploy never runs the learner.
 */
export function profilesEnabled(
  env: Pick<WorkerEnv, 'PROFILES_ENABLED'>,
): boolean {
  return env.PROFILES_ENABLED === 'true';
}
