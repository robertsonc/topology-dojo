/**
 * PROFILES_ENABLED HTTP gate + owner-authed route surface for
 * `/api/profile/*` (worker/default-handler.ts → worker/profile-api.ts,
 * Packet P3). Mirrors `workspace-disabled.test.ts`:
 *
 * - default (flag unset) ⇒ DISABLED (the opposite of WORKSPACE_ENABLED —
 *   see `env.ts`): the stable 503 `{"error":"profiles_disabled"}` body for
 *   every method/path, proven to run before any binding read by simply not
 *   configuring the AUTHORING_PROFILE Durable Object for that instance;
 * - `"true"` ⇒ enabled: 401 without a session; list/pause/resume/forget
 *   round-trip against the SAME DO instance the coordinator's emission
 *   addresses (`idFromName(<bare uid>)` — the seed route below writes through
 *   exactly that key), and cross-owner reads stay isolated.
 *
 * Worker-level harness (Miniflare, CI only — fails to start locally with
 * `File is not defined`, same as the other suites in this directory).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildWorkerBundle,
  startMiniflare,
  type MiniflareHandle,
} from './worker-harness.js';
import { signSession } from '../server/session.js';

const GITHUB_CLIENT_SECRET = 'p3-profile-flag-secret';

/** DEFAULT_HANDLER_FIXTURE plus the AuthoringProfile DO and one test-only
 * seed route that records an outcome through the emission path's exact
 * identity key (`ns.idFromName(ownerId)` — see `document.ts`
 * `emitAuthoringOutcomes`), so the suite can prove the HTTP reads hit the
 * same instance the learner writes. */
const PROFILE_HANDLER_FIXTURE = String.raw`
import { defaultHandler } from './worker/default-handler.ts';
export { AuthoringProfile } from './worker/profile.ts';

function unimplemented(name) {
  return () => {
    throw new Error(
      'OAUTH_PROVIDER.' + name + ' is not stubbed by the profile-api fixture',
    );
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/__seed' && request.method === 'POST') {
      const { owner, outcome } = await request.json();
      const ns = env.AUTHORING_PROFILE;
      await ns
        .get(ns.idFromName(String(owner)))
        .recordOutcome(String(owner), outcome);
      return Response.json({ ok: true });
    }
    if (url.pathname === '/__guidance' && request.method === 'POST') {
      // Drives the DO's getGuidance through the same identity key the MCP
      // profile service uses (idFromName(<bare uid>) — see
      // TopologyMcp.profileService), so the P4 retrieval tests exercise the
      // real DO compile/cache/notModified path.
      const { owner, query } = await request.json();
      const ns = env.AUTHORING_PROFILE;
      const result = await ns
        .get(ns.idFromName(String(owner)))
        .getGuidance(String(owner), query ?? {});
      return Response.json(result);
    }
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

function outcome(over: Record<string, unknown> = {}) {
  return {
    archetype: 'multi-region-hub-spoke',
    addedTraits: ['layered-regional'],
    removedTraits: ['radial-placement'],
    scope: { kind: 'user' },
    sourceRevisionRef: 'w1@r5',
    documentRef: 'w1',
    summary: 'radial → layered regional hub/spoke hierarchy',
    ...over,
  };
}

async function sessionCookie(uid: string, login: string): Promise<string> {
  const token = await signSession({ uid, login }, GITHUB_CLIENT_SECRET);
  return `tdg_session=${token}`;
}

interface PrefRow {
  id: string;
  ownerId: string;
  status: string;
  directive: string;
}

describe('PROFILES_ENABLED="true" — owner-authed profile routes', () => {
  let handle: MiniflareHandle;

  beforeAll(async () => {
    const bundle = await buildWorkerBundle(PROFILE_HANDLER_FIXTURE, {
      sourcefile: 'profile-api-enabled-fixture.ts',
    });
    handle = await startMiniflare({
      bundle,
      kvNamespaces: ['TOPOLOGY_KV', 'OAUTH_KV'],
      durableObjects: {
        AUTHORING_PROFILE: { className: 'AuthoringProfile', useSQLite: true },
      },
      vars: {
        GITHUB_CLIENT_ID: 'test-client-id',
        GITHUB_CLIENT_SECRET,
        PROFILES_ENABLED: 'true',
      },
    });
  }, 30_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  it('401s an unauthenticated GET /api/profile/preferences', async () => {
    const res = await handle.fetch('/api/profile/preferences');
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: 'authentication required',
    });
  });

  it('lists the candidates the emission-path identity key wrote, and round-trips pause/resume/forget', async () => {
    const uid = 'u1';
    const cookie = await sessionCookie(uid, 'alice');
    // Seed through idFromName(<bare uid>) — the coordinator emission's key.
    const seed = await handle.fetch('/__seed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner: uid, outcome: outcome() }),
    });
    expect(seed.status).toBe(200);

    const listRes = await handle.fetch('/api/profile/preferences', {
      headers: { cookie },
    });
    expect(listRes.status).toBe(200);
    const prefs = (await listRes.json()) as PrefRow[];
    expect(prefs).toHaveLength(1);
    expect(prefs[0]!.ownerId).toBe(uid);
    expect(prefs[0]!.status).toBe('candidate');
    const id = prefs[0]!.id;

    const pauseRes = await handle.fetch(
      `/api/profile/preferences/${id}/pause`,
      { method: 'POST', headers: { cookie } },
    );
    expect(pauseRes.status).toBe(200);
    expect(((await pauseRes.json()) as PrefRow).status).toBe('paused');

    const resumeRes = await handle.fetch(
      `/api/profile/preferences/${id}/resume`,
      { method: 'POST', headers: { cookie } },
    );
    expect(resumeRes.status).toBe(200);
    expect(((await resumeRes.json()) as PrefRow).status).toBe('candidate');

    const forgetRes = await handle.fetch(`/api/profile/preferences/${id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(forgetRes.status).toBe(200);
    await expect(forgetRes.json()).resolves.toEqual({ deleted: id });

    const after = await handle.fetch('/api/profile/preferences', {
      headers: { cookie },
    });
    expect((await after.json()) as PrefRow[]).toHaveLength(0);

    // Forgetting again (or any unknown id) is a 404, not a silent success.
    const repeat = await handle.fetch(`/api/profile/preferences/${id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(repeat.status).toBe(404);
  }, 30_000);

  it('keeps owners isolated: another session never sees (or manages) the seeded candidate', async () => {
    const uid = 'u2';
    await handle.fetch('/__seed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner: uid, outcome: outcome() }),
    });
    const ownerCookie = await sessionCookie(uid, 'bob');
    const ownerList = (await (
      await handle.fetch('/api/profile/preferences', {
        headers: { cookie: ownerCookie },
      })
    ).json()) as PrefRow[];
    expect(ownerList).toHaveLength(1);

    const otherCookie = await sessionCookie('u3', 'carol');
    const otherList = (await (
      await handle.fetch('/api/profile/preferences', {
        headers: { cookie: otherCookie },
      })
    ).json()) as PrefRow[];
    expect(otherList).toHaveLength(0);

    // The other owner's DELETE addresses their OWN (empty) instance: 404,
    // and the owner's candidate survives.
    const foreignDelete = await handle.fetch(
      `/api/profile/preferences/${ownerList[0]!.id}`,
      { method: 'DELETE', headers: { cookie: otherCookie } },
    );
    expect(foreignDelete.status).toBe(404);
    const stillThere = (await (
      await handle.fetch('/api/profile/preferences', {
        headers: { cookie: ownerCookie },
      })
    ).json()) as PrefRow[];
    expect(stillThere).toHaveLength(1);
  }, 30_000);

  it('405s wrong methods on the route surface', async () => {
    const cookie = await sessionCookie('u4', 'dave');
    const post = await handle.fetch('/api/profile/preferences', {
      method: 'POST',
      headers: { cookie },
    });
    expect(post.status).toBe(405);
    const get = await handle.fetch('/api/profile/preferences/p1/pause', {
      headers: { cookie },
    });
    expect(get.status).toBe(405);
    const confirmGet = await handle.fetch(
      '/api/profile/preferences/p1/confirm',
      { headers: { cookie } },
    );
    expect(confirmGet.status).toBe(405);
  });

  it('confirm serves the rule to guidance, reject tombstones it, and revisions drive notModified', async () => {
    const uid = 'u6';
    const cookie = await sessionCookie(uid, 'frank');
    await handle.fetch('/__seed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner: uid, outcome: outcome() }),
    });
    const [seeded] = (await (
      await handle.fetch('/api/profile/preferences', { headers: { cookie } })
    ).json()) as PrefRow[];
    const id = seeded!.id;

    const guidance = async (query: Record<string, unknown>) =>
      (await (
        await handle.fetch('/__guidance', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ owner: uid, query }),
        })
      ).json()) as {
        notModified?: boolean;
        profileRevision: number;
        guidanceRevision: number;
        rules?: { id: string; scope: string; directive: string }[];
      };
    const query = { archetype: 'multi-region-hub-spoke' };

    // Unconfirmed candidates never reach an agent: product pack only.
    const before = await guidance(query);
    expect(before.rules!.every((rule) => rule.scope === 'product')).toBe(true);

    // Malformed scope is rejected outright — never silently widened.
    const badConfirm = await handle.fetch(
      `/api/profile/preferences/${id}/confirm`,
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ scope: { kind: 'workspace' } }),
      },
    );
    expect(badConfirm.status).toBe(400);

    // Owner confirm at archetype scope (the browser-only authority path).
    const confirmRes = await handle.fetch(
      `/api/profile/preferences/${id}/confirm`,
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: { kind: 'archetype', archetype: 'multi-region-hub-spoke' },
        }),
      },
    );
    expect(confirmRes.status).toBe(200);
    expect(((await confirmRes.json()) as PrefRow).status).toBe('confirmed');

    const after = await guidance(query);
    expect(after.profileRevision).toBe(before.profileRevision + 1);
    expect(after.rules![0]!.id).toBe(id); // user rule outranks product pack

    // Unchanged revisions short-circuit with no instruction body.
    const unchanged = await guidance({
      ...query,
      lastProfileRevision: after.profileRevision,
      lastGuidanceRevision: after.guidanceRevision,
    });
    expect(unchanged.notModified).toBe(true);
    expect(unchanged.rules).toBeUndefined();

    // Reject: the rule stops being served AND stays as a tombstone that
    // blocks re-learning the same correction.
    const rejectRes = await handle.fetch(
      `/api/profile/preferences/${id}/reject`,
      { method: 'POST', headers: { cookie } },
    );
    expect(((await rejectRes.json()) as PrefRow).status).toBe('rejected');
    const afterReject = await guidance(query);
    expect(afterReject.rules!.some((rule) => rule.id === id)).toBe(false);
    await handle.fetch('/__seed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        owner: uid,
        outcome: outcome({ sourceRevisionRef: 'w9@r2', documentRef: 'w9' }),
      }),
    });
    const rows = (await (
      await handle.fetch('/api/profile/preferences', { headers: { cookie } })
    ).json()) as PrefRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('rejected');
  }, 30_000);
});

describe('PROFILES_ENABLED unset — disabled by default (opt-in flag)', () => {
  let handle: MiniflareHandle;

  beforeAll(async () => {
    const bundle = await buildWorkerBundle(PROFILE_HANDLER_FIXTURE, {
      sourcefile: 'profile-api-disabled-fixture.ts',
    });
    // Deliberately no AUTHORING_PROFILE Durable Object binding: if the 503
    // gate ever regressed to routing into handleProfileApi before checking
    // the flag, touching the unbound namespace would throw instead of
    // cleanly 503ing — this suite would fail loudly.
    handle = await startMiniflare({
      bundle,
      kvNamespaces: ['TOPOLOGY_KV', 'OAUTH_KV'],
      vars: { GITHUB_CLIENT_ID: 'test-client-id', GITHUB_CLIENT_SECRET },
    });
  }, 30_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  it('503s GET /api/profile/preferences with the stable JSON body', async () => {
    const res = await handle.fetch('/api/profile/preferences');
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    await expect(res.json()).resolves.toEqual({ error: 'profiles_disabled' });
  });

  it('503s even when authenticated (the gate runs before auth/DO access)', async () => {
    const cookie = await sessionCookie('u5', 'erin');
    const res = await handle.fetch('/api/profile/preferences', {
      headers: { cookie },
    });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'profiles_disabled' });
  });

  it('503s the manage routes too', async () => {
    const pause = await handle.fetch('/api/profile/preferences/p1/pause', {
      method: 'POST',
    });
    expect(pause.status).toBe(503);
    const forget = await handle.fetch('/api/profile/preferences/p1', {
      method: 'DELETE',
    });
    expect(forget.status).toBe(503);
    await expect(forget.json()).resolves.toEqual({
      error: 'profiles_disabled',
    });
  });

  it('leaves the auth routes untouched', async () => {
    const login = await handle.fetch('/login');
    expect(login.status).toBe(200);
    const me = await handle.fetch('/api/me');
    expect(me.status).toBe(401);
  });
});
