/**
 * Owner-authenticated browser API for the Authoring Preferences panel
 * (Packet P3 / proposal 0003-A, observe-only).
 *
 * Mirrors `workspace-api.ts`: the owner always comes from the session cookie
 * (`currentUser`), never from request input, so cross-owner isolation holds by
 * construction. The route set is deliberately tiny — list, pause/resume, and
 * forget — because confirmation/scoping is Packet P4's authority domain and no
 * agent-facing surface exists here.
 */
import type { WorkerEnv } from './env.js';
import { currentUser } from './auth.js';
import type { AuthoringPreference } from '../src/profile/model.js';

/** Narrow RPC view of the per-owner authoring-profile DO. Kept explicit so the
 * cross-DO call typechecks without depending on Cloudflare's conservative
 * Stubable<> inference (same pattern as `document.ts` / `workspaces.ts`). */
interface AuthoringProfileRpc {
  listPreferences(ownerId: string): Promise<AuthoringPreference[]>;
  setPreferenceStatus(
    ownerId: string,
    preferenceId: string,
    status: 'candidate' | 'paused',
  ): Promise<AuthoringPreference>;
  deletePreference(ownerId: string, preferenceId: string): Promise<void>;
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: JSON_HEADERS,
  });
}

function methodNotAllowed(): Response {
  return json({ error: 'method not allowed' }, 405);
}

export async function handleProfileApi(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  const user = await currentUser(request, env);
  if (!user) return json({ error: 'authentication required' }, 401);
  // The DO instance is addressed by the bare stable uid — EXACTLY the key the
  // coordinator's outcome emission uses (`document.ts` `emitAuthoringOutcomes`:
  // `ns.idFromName(meta.ownerId)`), so these reads/manage calls hit the same
  // per-owner instance the learner writes.
  const ns = env.AUTHORING_PROFILE;
  const profile = ns.get(
    ns.idFromName(user.uid),
  ) as unknown as AuthoringProfileRpc;
  const url = new URL(request.url);
  // ['api', 'profile', 'preferences', :id?, 'pause' | 'resume'?]
  const parts = url.pathname.split('/').filter(Boolean);

  try {
    if (parts[2] !== 'preferences') return json({ error: 'not found' }, 404);

    // /api/profile/preferences
    if (parts.length === 3) {
      if (request.method !== 'GET') return methodNotAllowed();
      return json(await profile.listPreferences(user.uid));
    }

    const id = decodeURIComponent(parts[3] ?? '');
    if (!id) return json({ error: 'preference id is required' }, 400);

    // /api/profile/preferences/:id — "forget" (owner authority: delete).
    if (parts.length === 4) {
      if (request.method !== 'DELETE') return methodNotAllowed();
      await profile.deletePreference(user.uid, id);
      return json({ deleted: id });
    }

    // /api/profile/preferences/:id/pause | /resume (candidate↔paused only).
    if (parts.length === 5 && (parts[4] === 'pause' || parts[4] === 'resume')) {
      if (request.method !== 'POST') return methodNotAllowed();
      return json(
        await profile.setPreferenceStatus(
          user.uid,
          id,
          parts[4] === 'pause' ? 'paused' : 'candidate',
        ),
      );
    }

    return json({ error: 'not found' }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('unknown preference') ? 404 : 400;
    return json({ error: message }, status);
  }
}
