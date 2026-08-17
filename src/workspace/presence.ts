import type { WorkspaceActor } from './model.js';

/** Hard cap on a presence `actorLabel` (GitHub logins are ≤39; 64 leaves room). */
export const MAX_ACTOR_LABEL_LENGTH = 64;

/** True for C0 (U+0000–U+001F), DEL (U+007F), and C1 (U+0080–U+009F). */
function isControlChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

function stripControlChars(value: string): string {
  let out = '';
  for (const ch of value) {
    if (!isControlChar(ch)) out += ch;
  }
  return out;
}

/**
 * Bound and clean a presence actor label from a WebSocket upgrade query
 * param (or the authenticated session login forwarded by the browser route).
 * Returns `undefined` when nothing printable remains.
 */
export function sanitizeActorLabel(
  raw: string | null | undefined,
): string | undefined {
  if (raw == null) return undefined;
  const cleaned = stripControlChars(raw).trim();
  if (!cleaned) return undefined;
  return cleaned.slice(0, MAX_ACTOR_LABEL_LENGTH);
}

/**
 * Allow-list a presence actor kind. Unknown or missing values become `user`
 * so a spoofed query param cannot invent a new kind (or CSS class).
 */
export function sanitizeActorKind(
  raw: string | null | undefined,
): WorkspaceActor['kind'] {
  return raw === 'agent' || raw === 'system' ? raw : 'user';
}

/**
 * Presence identity for an owner-authenticated browser socket. Always `user`
 * from the session — never a client-supplied `actorKind`.
 */
export function browserPresenceActor(login: string): {
  kind: 'user';
  label?: string;
} {
  const label = sanitizeActorLabel(login);
  return { kind: 'user', ...(label ? { label } : {}) };
}
