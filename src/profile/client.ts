/**
 * Thin browser client for the owner-authenticated authoring-profile API
 * (Packet P3 / proposal 0003-A). Mirrors `src/workspace/client.ts`: plain
 * fetch wrappers plus one typed error for the deployment-level feature gate so
 * the panel can show a clean "disabled" state instead of a raw 503.
 */
import type { AuthoringPreference } from './model.js';

/**
 * Thrown instead of a generic `Error` when the server reports the
 * authoring-profile surface is disabled for this deployment
 * (`PROFILES_ENABLED` unset/!== "true" — see `worker/env.ts`). The message is
 * already user-facing; the Authoring Preferences panel special-cases this type
 * to swap its list for a plain disabled notice (same pattern as
 * `WorkspaceDisabledError` in `src/workspace/client.ts`).
 */
export class ProfilesDisabledError extends Error {
  constructor() {
    super('Authoring preferences are not enabled on this deployment.');
    this.name = 'ProfilesDisabledError';
  }
}

async function decode<T>(response: Response): Promise<T> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error(`profile request failed (HTTP ${response.status})`);
  }
  if (!response.ok) {
    const message = (value as { error?: unknown }).error;
    if (response.status === 503 && message === 'profiles_disabled') {
      throw new ProfilesDisabledError();
    }
    throw new Error(
      typeof message === 'string'
        ? message
        : `profile request failed (HTTP ${response.status})`,
    );
  }
  return value as T;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return decode<T>(
    await fetch(path, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
    }),
  );
}

/** All of the owner's learned candidates, strongest first. */
export function listAuthoringPreferences(): Promise<AuthoringPreference[]> {
  return request('/api/profile/preferences');
}

/** Pause a candidate: it stays visible but (future P4) retrieval skips it. */
export function pauseAuthoringPreference(
  id: string,
): Promise<AuthoringPreference> {
  return request(`/api/profile/preferences/${encodeURIComponent(id)}/pause`, {
    method: 'POST',
    body: '{}',
  });
}

/** Resume a paused candidate (back to `candidate`). */
export function resumeAuthoringPreference(
  id: string,
): Promise<AuthoringPreference> {
  return request(`/api/profile/preferences/${encodeURIComponent(id)}/resume`, {
    method: 'POST',
    body: '{}',
  });
}

/** Forget a candidate outright — the owner's "No, do not learn this". */
export function forgetAuthoringPreference(
  id: string,
): Promise<{ deleted: string }> {
  return request(`/api/profile/preferences/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
