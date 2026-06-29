import { describe, it, expect } from 'vitest';
import {
  MARKER_ICONS,
  POLICY_MARKER_TYPES,
  withMarkerIcon,
} from './markers.js';

describe('policy markers', () => {
  it('covers enforcement + host-OS + SSE + network services (29 types)', () => {
    expect(POLICY_MARKER_TYPES).toHaveLength(29);
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
      // network services & SASE
      'dns-proxy',
      'web-proxy',
      'captive-portal',
      'waf',
      'casb',
      'dlp',
      'ips',
      'sandbox',
      'ztna',
      'sso',
      'mfa',
      'geo-block',
    ])
      expect(POLICY_MARKER_TYPES).toContain(t);
    // every type has a default glyph
    for (const t of POLICY_MARKER_TYPES) expect(MARKER_ICONS[t]).toBeTruthy();
    // glyphs are unique — no two types share a badge glyph
    const glyphs = POLICY_MARKER_TYPES.map((t) => MARKER_ICONS[t]);
    expect(new Set(glyphs).size).toBe(glyphs.length);
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
