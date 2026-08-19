/**
 * The Worker's binding surface, shared by the OAuth entry (`index.ts`), the
 * default handler (`default-handler.ts`), and the MCP Durable Object (`mcp.ts`).
 * Kept in one place so the KV/secret/DO bindings stay in sync.
 */
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import type { TopologyRegistry } from './registry.js';
import type { TopologyDocument } from './document.js';
import type { AuthoringProfile } from './profile.js';
import type { AnalyticsLog } from './analytics.js';

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
  /**
   * Owner-analytics store for the admin dashboard (migration `v5`). One global
   * DO instance holding a bounded login roster + recent-login log — metadata
   * only. Gated by `ANALYTICS_ENABLED` (opt-in, like `PROFILES_ENABLED`): the
   * migration ships inert in production and a later deploy activates it.
   */
  ANALYTICS: DurableObjectNamespace<AnalyticsLog>;
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
   * Optional dedicated HMAC key for browser session cookies (Wrangler /
   * dashboard secret). When set, `worker/auth.ts` signs and verifies
   * `tdg_session` with this value instead of `GITHUB_CLIENT_SECRET`, so
   * rotating the OAuth client secret does not invalidate every browser
   * session. Unset ⇒ fall back to `GITHUB_CLIENT_SECRET` (see
   * `sessionHmacSecret` in `src/server/session.ts`). Not required yet —
   * this is a migration path, not a breaking cutover.
   */
  SESSION_HMAC_SECRET?: string;
  /**
   * EdgeConnect Orchestrator origin + API key (both optional; set the key as
   * a Wrangler/dashboard secret). Secret presence alone does **not** register
   * the live-data tools — `LIVE_DATA_ENABLED` must also be the literal
   * `"true"` (see `liveDataEnabled`). Credentials never pass through tool
   * arguments. When the flag is on and both values are present, every
   * authenticated MCP session on this deployment gets the full fabric tool
   * set unless `LIVE_DATA_GITHUB_IDS` further restricts the grant.
   */
  ORCH_BASE_URL?: string;
  ORCH_API_KEY?: string;
  /**
   * Feature flag gating the live-data / EdgeConnect fabric MCP tools
   * (`list_appliances`, `list_flows`, `build_flow_topology`, …). Opt-in like
   * `PROFILES_ENABLED` / `ANALYTICS_ENABLED`: only the literal string
   * `"true"` enables them (unset ⇒ disabled). Independent of secret
   * presence so provisioning `ORCH_*` cannot silently open fabric read
   * access. Production and staging both leave this unset/`"false"` until an
   * operator explicitly activates a (preferably non-production) Orchestrator.
   * See issue #228 and `docs/DEPLOYMENT_RUNBOOK.md`.
   */
  LIVE_DATA_ENABLED?: string;
  /**
   * Optional per-owner allowlist for the live-data fabric tools. Comma-
   * separated GitHub numeric ids (the same stable identity `ADMIN_GITHUB_ID`
   * / `isAdmin` use — never the mutable login). Unset or empty ⇒ every
   * authenticated MCP session on the deployment receives the tools once
   * `LIVE_DATA_ENABLED` and the `ORCH_*` secrets are in place (the remaining
   * all-or-nothing grant). When set, only listed owners get the tools.
   */
  LIVE_DATA_GITHUB_IDS?: string;
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
   * The mechanism is opt-in regardless of environment; the *current* value in
   * each environment is whatever `wrangler.jsonc` says today (as of the O11
   * activation, production has set this `"true"` too — check `wrangler.jsonc`
   * for the live value rather than trusting this comment). See proposal
   * 0004's bootstrap-then-activate pattern and DEPLOYMENT_RUNBOOK.md.
   */
  PROFILES_ENABLED?: string;
  /**
   * Feature flag gating the owner-analytics store + admin dashboard (migration
   * `v5`), including Initiative A's MCP-session activity trail and index.
   * Activity recording reuses this flag (same owner-visibility posture as the
   * dashboard it extends) rather than introducing a new one. Like
   * `PROFILES_ENABLED` this is a brand-new Durable Object class, so it
   * defaults **OFF**: only the literal string `"true"` enables it (unset ⇒
   * disabled). It must bootstrap disabled in production so the `v5` migration
   * can ship inert (no login recording, no admin API, no session index), then
   * be activated by a later deploy that sets `"ANALYTICS_ENABLED": "true"` at
   * the top level. `env.staging` sets it `"true"`. Currently on in production.
   */
  ANALYTICS_ENABLED?: string;
  /**
   * The single GitHub numeric id (as a string) allowed to reach the admin
   * dashboard (`/api/admin/*`). The gate is **fail-closed**: with this unset,
   * `isAdmin` returns false for everyone, so the admin surface is inert even if
   * `ANALYTICS_ENABLED` is on. Set it to the deployment owner's GitHub id.
   */
  ADMIN_GITHUB_ID?: string;
  /**
   * Staging-only diagnostics environment marker (`worker/staging-fault.ts`).
   * Set to the literal `"staging"` ONLY in `env.staging.vars`; any other
   * value (including unset — production's state) keeps the synthetic-fault
   * route fully inert. `scripts/check-wrangler-env.mjs` fails the build if
   * any `DIAGNOSTICS_*` key ever appears in the top-level (production) vars.
   */
  DIAGNOSTICS_ENV?: string;
  /**
   * Staging-only shared secret for `GET /__staging/fault` (set via
   * `wrangler secret put DIAGNOSTICS_TOKEN --env staging`; never configured
   * for production, never committed). Unset or shorter than 16 characters ⇒
   * the fault route stays inert even in staging. See
   * `worker/staging-fault.ts` for the full gate chain.
   */
  DIAGNOSTICS_TOKEN?: string;
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

/**
 * Whether the owner-analytics store + admin dashboard should run, including
 * Initiative A's MCP-session activity trail/index. Reuses `ANALYTICS_ENABLED`
 * (no new flag): same owner-visibility posture as the dashboard the trail
 * extends. Opt-in like `profilesEnabled` (only the exact string `"true"`
 * enables); any other value — unset, `"false"`, a typo — fails closed to
 * "disabled", so an un-activated production deploy never records logins,
 * session metadata, or the admin API.
 */
export function analyticsEnabled(
  env: Pick<WorkerEnv, 'ANALYTICS_ENABLED'>,
): boolean {
  return env.ANALYTICS_ENABLED === 'true';
}

/**
 * Whether `uid` is the deployment's admin. Fail-closed: with `ADMIN_GITHUB_ID`
 * unset there is no admin, so the dashboard stays inaccessible even when
 * analytics is enabled. Compared against the stable GitHub numeric id (never
 * the mutable login).
 */
export function isAdmin(
  env: Pick<WorkerEnv, 'ADMIN_GITHUB_ID'>,
  uid: string,
): boolean {
  return !!env.ADMIN_GITHUB_ID && uid === env.ADMIN_GITHUB_ID;
}

/**
 * Whether the live-data / EdgeConnect fabric MCP tools may register. Opt-in
 * like `profilesEnabled` / `analyticsEnabled`: only the exact string
 * `"true"` enables; any other value — unset, `"false"`, a typo — fails
 * closed to "disabled", so secret presence alone never opens the fabric.
 */
export function liveDataEnabled(
  env: Pick<WorkerEnv, 'LIVE_DATA_ENABLED'>,
): boolean {
  return env.LIVE_DATA_ENABLED === 'true';
}

/**
 * Whether `uid` is allowed to receive live-data fabric tools. Optional
 * allowlist: with `LIVE_DATA_GITHUB_IDS` unset or empty every authenticated
 * owner is allowed (the deployment-wide grant). When set, compared against
 * the stable GitHub numeric id the same way `isAdmin` compares
 * `ADMIN_GITHUB_ID`.
 */
export function liveDataAllowedForOwner(
  env: Pick<WorkerEnv, 'LIVE_DATA_GITHUB_IDS'>,
  uid: string,
): boolean {
  const raw = env.LIVE_DATA_GITHUB_IDS?.trim();
  if (!raw) return true;
  return raw.split(',').some((id) => id.trim() === uid);
}
