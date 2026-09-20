# Proposal 0005 — User-tied API keys for the hosted MCP endpoint

**Status:** Implemented behind `API_KEYS_ENABLED` (staging on, production off
until the UAT below passes). Also adds the repository's `LICENSE`
(Apache-2.0), which the NetClaw integration was blocked on.

**Captured:** 2026-09-20

**Addresses:** the unattended-agent gap found while planning the NetClaw
integration (`robertsonc/netclaw` spec 124, research R2/R13): the hosted
`/mcp` endpoint is OAuth 2.1 + GitHub only, so a headless agent needs a
browser hop and a third-party token-caching bridge. Also promotes the
roadmap's "Per-key MCP auth" item out of _Later_, since the machine-credential
use case it was waiting for now exists.

## Context

`worker/index.ts` wraps the whole Worker in Cloudflare's
`workers-oauth-provider`; `/mcp` is the protected API route and every other
`/api/*` surface authenticates with the browser session cookie. An
authenticated MCP session receives `{ id, login, name }` from the OAuth grant
as `this.props`, and **every** downstream identity decision keys on `props.id`
(the GitHub numeric uid): registry addressing (`user-id:<uid>`), the per-user
rate-limit windows, share ownership, the live-data allowlist, and analytics.

That is the right tenancy model, and it is exactly why an API key can be a
small addition rather than a second identity system: a key only has to
resolve to the same `props` shape as a grant. The provider already offers the
extension point — `resolveExternalToken`, called for any bearer that is not
one of its own `<userId>:<grantId>:<secret>` tokens — so no request has to
bypass the provider and `/mcp` keeps its `WWW-Authenticate` contract.

What existed before this proposal for an unattended agent: complete the OAuth
flow once through `mcp-remote` (browser + `localhost` callback, so an SSH
port-forward on a server), and rely on its on-disk token cache and refresh.
Workable, but every host needs its own interactive login and the client
depends on a bridge the deployment does not control.

## Goals

1. Let a signed-in user mint a credential that an agent presents as
   `Authorization: Bearer <key>` on `/mcp`, resolving to **that user** — same
   drafts, same workspaces, same quotas.
2. Keep the provider in front of `/mcp`; add no second auth path for the
   cookie routes or the admin surface.
3. Store only a hash; show the plaintext exactly once; make keys labeled,
   optionally expiring, listable, and revocable by the owner in the browser.
4. Scope keys so a key can be issued without the one irreversible action in
   the product (a public share) and without live-fabric access.
5. Ship behind an opt-in flag with no new binding and no Durable Object
   migration, following the existing forward-only activation pattern.
6. Add a `LICENSE` so downstream projects can clone, vendor, or package this
   repository. `public/vendor/` (the Topology Studio engine) is the
   maintainer's own work, so a single repository license covers it.

## Non-goals

- Service accounts, organization-owned keys, or keys not tied to a GitHub
  user. Tenancy stays per uid.
- Minting or revoking keys over MCP. A key must never be able to grant itself
  persistence.
- Accepting API keys on `/api/*` cookie routes, `/api/admin`, or as a query
  parameter.
- Replacing OAuth for interactive clients. Claude Desktop / Code style
  clients keep discovery + dynamic registration.
- Strong-consistency revocation. KV propagation is ~60 s; see Risks.

## Design

### Key format

```
tdk_<keyId>_<secret>
     │       └─ 32 random bytes, base64url (43 chars); only SHA-256(secret) is stored
     └───────── 10 lowercase alphanumerics; public handle for storage, listing, revoke
```

The `tdk_` prefix makes a key recognizable in secret scanning and in a
client's contract test (NetClaw asserts no `tdk_` literal in tracked files),
and can never collide with the provider's colon-delimited tokens.
`src/server/api-key.ts` holds the primitives (mint, parse, hash,
constant-time compare, scope/label/expiry validation) and is pure Web Crypto,
so Node 22 tests and the Worker run the same code.

### Storage

`OAUTH_KV`, two prefixes, no new binding:

| Key                           | Value                                                                                         | TTL                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------ |
| `apikey:<keyId>`              | `{ keyId, uid, login, name?, secretHash, scopes, label, createdAt, expiresAt?, lastUsedAt? }` | matches `expiresAt` (+60 s) when set |
| `apikeys:<uid>`               | `[keyId, …]` — the owner's index for listing                                                  | none                                 |
| `rl:apikeyfail:<ip>:<window>` | failed-authentication counter                                                                 | window + 1 s                         |

Credential-class data lives beside the provider's own grants and tokens, and
`scripts/check-wrangler-env.mjs` already guarantees staging and production
never share this namespace.

### Authentication path

```
agent ──POST /mcp, Authorization: Bearer tdk_…──▶ OAuthProvider
                                                    │ not an internal token
                                                    ▼
                                    resolveExternalToken → resolveApiKeyToken
                                      flag on? · prefix? · IP failure budget?
                                      parse → KV get apikey:<keyId>
                                      sha256(secret) ⟷ secretHash (constant time)
                                      not expired? → touch lastUsedAt (≤ hourly)
                                                    │
                                                    ▼
                    ctx.props = { id, login, name, auth: "api_key", keyId, scopes }
                                                    │
                                                    ▼
                                  TopologyMcp.init() — unchanged identity code,
                                  scopes consulted once at tool registration
```

`worker/api-keys.ts` is structural (no ambient Cloudflare types) so the
resolver and store are unit-tested against an in-memory KV, and exercised in
Miniflare against real KV through a test fixture; the provider's own bearer
dispatch is covered by the `mcp-apikey-unauth` smoke check.

Fail-closed rules: flag off ⇒ null; parse failure ⇒ null before any I/O;
storage error during lookup ⇒ null. The failure budget (20 per 5 minutes per
client IP, successes never count) fails **open** on KV errors so a limiter
blip cannot lock every agent out.

### Scopes

`author` is implicit on every key. `share`, `workspace` and `live-data` each
unlock one tool group that `worker/mcp.ts` already registers conditionally;
`principalAllows(props, scope)` is consulted at registration, so a group
outside the key's scopes is absent from `tools/list` rather than present but
refusing. An OAuth session carries no `auth` marker and keeps its full grant.
A `props` object marked `auth: "api_key"` but malformed is treated as
having no scopes.

The existing `LIVE_DATA_GITHUB_IDS` allowlist and `ADMIN_GITHUB_ID` still
compare against `props.id`, so a key inherits exactly its owner's live-data
eligibility (when the key also carries `live-data`) and never reaches the
admin API (cookie-only).

### Minting and revocation (browser only)

| Route                     | Auth   | Behaviour                                                                          |
| ------------------------- | ------ | ---------------------------------------------------------------------------------- |
| `GET /keys`               | cookie | management page (server-rendered, script at `/keys.js`, CSP-compliant)             |
| `GET /api/keys`           | cookie | `{ keys: [{ keyId, prefix, label, scopes, createdAt, expiresAt?, lastUsedAt? }] }` |
| `POST /api/keys`          | cookie | `{ label, scopes?, expiresInDays? }` → `201 { token, key }` — token shown once     |
| `DELETE /api/keys/:keyId` | cookie | owner-only; foreign or unknown ⇒ `404 not_found` (never confirms existence)        |

Limits: 10 keys per user, 64-character label, expiry ∈ {never, 30, 90, 365}
days. With the flag off every route answers `503 { "error": "api_keys_disabled" }`
before any KV read (the workspace/profile/admin pattern), and `/keys` renders
a disabled notice.

The editor's account menu gains an **API keys** link. The page is deliberately
outside the SPA bundle so the editor's visual baselines are untouched.

### Analytics and audit

An API-key session indexes into the existing agent-activity trail and session
index under the owner's uid exactly like an OAuth session (tool name,
timestamp, coarse outcome — never arguments). Distinguishing key sessions in
the admin dashboard (`authKind`) is a follow-up; the data needed for it is
already on `props`.

## Security analysis

- **Hash at rest, constant-time verify.** A KV read never yields a usable
  credential; a 256-bit random secret needs no KDF.
- **Never logged.** The resolver logs only "resolve failed" on storage errors;
  the token never enters `console.error`, the activity trail, or analytics.
- **Keys cannot mint keys.** `/api/keys` is cookie-only; the MCP tool set has
  no key tool.
- **Blast radius equals the owner's.** A leaked key is the owner's drafts,
  workspaces (if scoped), and share links (if scoped), until revoked. Scopes
  and expiry bound it; `lastUsedAt` makes stale keys visible.
- **Online guessing.** 10 + 43 characters of alphabet-36/64 randomness plus a
  per-IP failure budget; the keyId lookup means a wrong secret costs one KV
  read and one hash, no enumeration signal beyond 401.
- **Revocation latency.** KV is eventually consistent; a revoked key can work
  for up to ~60 s at other edge locations. Documented in the user guide. If
  that ever matters, move the record store to a global Durable Object.
- **No downgrade of OAuth.** The provider's `accessTokenTTL` and grant model
  are untouched; the external-token hook is additive.

## Rollout

No migration, no new binding. `API_KEYS_ENABLED` is `"true"` in
`env.staging` and `"false"` at the top level (production). Activation is a
forward-only redeploy flipping the top-level value, per
`DEPLOYMENT_RUNBOOK.md`; disabling is the same redeploy with `"false"`, which
rejects every key immediately while leaving records in place for a later
re-activation.

Smoke: `mcp-apikey-unauth` (unknown `tdk_` bearer ⇒ 401) runs on every
deployment regardless of the flag.

## Acceptance criteria

- [x] `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`,
      `node scripts/check-wrangler-env.mjs` green.
- [x] Unit: primitives (`src/server/api-key.test.ts`); store, resolver,
      failure budget, flag, scope gate (`src/testing/api-keys.test.ts` half 1).
- [x] Miniflare: cookie gating, mint → list → resolve → foreign revoke 404 →
      owner revoke → 401, page + script, flag-off 503 contract
      (`src/testing/api-keys.test.ts` half 2).
- [x] Smoke check registered and pinned (`scripts/smoke.mjs`,
      `src/testing/smoke-checks.test.ts`, `DEPLOYMENT_RUNBOOK.md`).
- [ ] **Staging UAT (`UAT-MCP-04`)**: sign in, mint a `share`-less key on
      `/keys`, connect an MCP client with only the bearer header, confirm
      `tools/list` lacks `share_topology`, author + render a draft, see the
      draft in the browser under the same account, revoke, confirm 401 within
      a minute. Then a second key with `share` publishes and revokes a link.
- [ ] Production activation (top-level `API_KEYS_ENABLED: "true"`) after
      UAT, recorded in the deployment log.

## Follow-ups

- `authKind` on the admin dashboard's session index.
- NetClaw spec 124: replace the `mcp-remote` bridge with a plain `url` +
  `Bearer ${TOPOLOGY_DOJO_API_KEY}` registration once production activates.
- Consider `element.upsert` in the workspace operation vocabulary and a
  `get_topology` sourced-element listing (the other two alignment items from
  the NetClaw review), each as its own proposal.
