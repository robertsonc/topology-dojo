/**
 * Policy-marker vocabulary — the single source of truth for marker types and
 * their default glyphs, shared by the catalog, validation, the MCP enum, and
 * the render paths. DOM-free leaf module (no imports).
 *
 * The vendored engine renders a marker's glyph from `cfg.icon` (a per-marker
 * override) falling back to its own 9-type table. `withMarkerIcon` injects the
 * default glyph for a marker's type at render time, so the document stays clean
 * (just `type`) while SASE markers (host OS, SSE posture) still draw correctly
 * in the GUI, headless, and MCP output alike.
 */
export const POLICY_MARKER_TYPES = [
  // Enforcement actions (the engine's built-in nine).
  'inspect',
  'allow',
  'deny',
  'redirect',
  'encrypt',
  'decrypt',
  'nat',
  'load-balance',
  'log',
  // Host OS posture.
  'windows',
  'macos',
  'linux',
  'ios',
  'android',
  'chromeos',
  // SSE posture.
  'agent',
  'agentless',
  // Network services & SASE security functions (glyph-only; the engine renders
  // whatever glyph `withMarkerIcon` resolves, so these need no engine change).
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
] as const;

export type PolicyMarkerType = (typeof POLICY_MARKER_TYPES)[number];

/** Default glyph per marker type. The first nine mirror the engine's table. */
export const MARKER_ICONS: Record<string, string> = {
  inspect: '🔍',
  allow: '✓',
  deny: '✕',
  redirect: '↪',
  encrypt: '🔒',
  decrypt: '🔓',
  nat: '⇄',
  'load-balance': '⎂',
  log: '👁',
  windows: '🪟',
  macos: '🍎',
  linux: '🐧',
  ios: '📱',
  android: '🤖',
  chromeos: '🌐',
  agent: '🛡',
  agentless: '☁',
  'dns-proxy': '🧭',
  'web-proxy': '🌍',
  'captive-portal': '🚪',
  waf: '🧱',
  casb: '☂',
  dlp: '🔏',
  ips: '🚨',
  sandbox: '🧪',
  ztna: '🔐',
  sso: '🎫',
  mfa: '🔢',
  'geo-block': '🚫',
};

/**
 * Return a marker cfg with `icon` resolved: an explicit override wins, else the
 * type's default glyph. Applied at render time; never written into the document.
 */
export function withMarkerIcon<T extends { type?: unknown; icon?: unknown }>(
  cfg: T,
): T & { icon: string } {
  const icon =
    (typeof cfg.icon === 'string' && cfg.icon) ||
    MARKER_ICONS[String(cfg.type)] ||
    '•';
  return { ...cfg, icon };
}
