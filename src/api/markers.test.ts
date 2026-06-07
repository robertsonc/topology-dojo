import { describe, it, expect } from 'vitest';
import {
  MARKER_ICONS,
  POLICY_MARKER_TYPES,
  withMarkerIcon,
} from './markers.js';

describe('policy markers', () => {
  it('covers enforcement + host-OS + SSE posture (17 types)', () => {
    expect(POLICY_MARKER_TYPES).toHaveLength(17);
    for (const t of [
      'inspect',
      'deny',
      'windows',
      'macos',
      'linux',
      'ios',
      'android',
      'chromeos',
      'agent',
      'agentless',
    ])
      expect(POLICY_MARKER_TYPES).toContain(t);
    // every type has a default glyph
    for (const t of POLICY_MARKER_TYPES) expect(MARKER_ICONS[t]).toBeTruthy();
  });

  it('withMarkerIcon resolves a default glyph from the type', () => {
    expect(withMarkerIcon({ type: 'windows' }).icon).toBe(MARKER_ICONS.windows);
    expect(withMarkerIcon({ type: 'deny' }).icon).toBe(MARKER_ICONS.deny);
  });

  it('an explicit icon overrides the type default; unknown → bullet', () => {
    expect(withMarkerIcon({ type: 'windows', icon: '★' }).icon).toBe('★');
    expect(withMarkerIcon({ type: 'nope' }).icon).toBe('•');
  });
});
