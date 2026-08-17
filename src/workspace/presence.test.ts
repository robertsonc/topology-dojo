import { describe, expect, it } from 'vitest';
import {
  MAX_ACTOR_LABEL_LENGTH,
  browserPresenceActor,
  sanitizeActorKind,
  sanitizeActorLabel,
} from './presence.js';

describe('sanitizeActorLabel', () => {
  it('returns undefined for missing, empty, or whitespace-only values', () => {
    expect(sanitizeActorLabel(undefined)).toBeUndefined();
    expect(sanitizeActorLabel(null)).toBeUndefined();
    expect(sanitizeActorLabel('')).toBeUndefined();
    expect(sanitizeActorLabel('   ')).toBeUndefined();
  });

  it('trims surrounding whitespace and keeps a normal login', () => {
    expect(sanitizeActorLabel('  alice  ')).toBe('alice');
  });

  it('strips C0, DEL, and C1 control characters', () => {
    expect(sanitizeActorLabel('al\u0000ice\u0007')).toBe('alice');
    expect(sanitizeActorLabel('al\u007Fice')).toBe('alice');
    expect(sanitizeActorLabel('al\u009Fice')).toBe('alice');
    expect(sanitizeActorLabel('\n\talice\r')).toBe('alice');
  });

  it('returns undefined when only control characters remain', () => {
    expect(sanitizeActorLabel('\u0000\u0001\u007F')).toBeUndefined();
  });

  it(`clamps labels to ${MAX_ACTOR_LABEL_LENGTH} characters`, () => {
    const long = 'a'.repeat(MAX_ACTOR_LABEL_LENGTH + 20);
    const clamped = sanitizeActorLabel(long);
    expect(clamped).toHaveLength(MAX_ACTOR_LABEL_LENGTH);
    expect(clamped).toBe('a'.repeat(MAX_ACTOR_LABEL_LENGTH));
  });

  it('clamps after stripping so controls do not consume the budget', () => {
    const body = 'b'.repeat(MAX_ACTOR_LABEL_LENGTH);
    expect(sanitizeActorLabel(`\u0000${body}extra`)).toBe(body);
  });
});

describe('sanitizeActorKind', () => {
  it('allow-lists user, agent, and system; everything else is user', () => {
    expect(sanitizeActorKind('user')).toBe('user');
    expect(sanitizeActorKind('agent')).toBe('agent');
    expect(sanitizeActorKind('system')).toBe('system');
    expect(sanitizeActorKind('admin')).toBe('user');
    expect(sanitizeActorKind('<script>')).toBe('user');
    expect(sanitizeActorKind(null)).toBe('user');
    expect(sanitizeActorKind(undefined)).toBe('user');
  });
});

describe('browserPresenceActor', () => {
  it('forces kind user from the authenticated session login', () => {
    expect(browserPresenceActor('alice')).toEqual({
      kind: 'user',
      label: 'alice',
    });
  });

  it('sanitizes the session login the same way as a query param', () => {
    const long = 'x'.repeat(MAX_ACTOR_LABEL_LENGTH + 8);
    expect(browserPresenceActor(`\u0007${long}`)).toEqual({
      kind: 'user',
      label: 'x'.repeat(MAX_ACTOR_LABEL_LENGTH),
    });
  });

  it('omits label when the session login has no printable characters', () => {
    expect(browserPresenceActor('\u0000')).toEqual({ kind: 'user' });
  });
});
