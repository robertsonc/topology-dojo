/**
 * Markup-safe tokens: values a document carries that are written verbatim
 * into SVG/HTML attributes. Shared by the parse gate (`persist.ts`) and the
 * custom node spec check (`nodes/sanitize.ts`), which the headless builder
 * also uses — kept in a module of their own so the builder need not import
 * the persistence layer.
 */

/**
 * A colour string safe to interpolate verbatim into an SVG/HTML attribute:
 * strict hex, an `rgb()/rgba()/hsl()/hsla()` form with numeric content only, or
 * a bare CSS colour keyword. Anything else — in particular anything carrying a
 * quote or angle bracket — is rejected, so a document from an untrusted source
 * (an imported file or a shared `/v/<id>` snapshot) cannot break out of an
 * attribute and inject markup. Returns undefined when the value is unsafe.
 */
export function safeColor(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return s;
  if (/^(rgb|rgba|hsl|hsla)\([\d.,%\s/]*\)$/i.test(s)) return s;
  if (/^[a-z]{1,32}$/i.test(s)) return s; // named colour / keyword
  return undefined;
}

/**
 * An element `type` token reduced to markup-safe characters. Types are
 * interpolated into SVG/HTML in sinks the renderer does not escape (e.g. the
 * inspector's type row and the custom-node pattern id), so a hostile `type`
 * from an imported/shared document must never carry quotes or angle brackets.
 */
export function safeType(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const cleaned = v.replace(/[^\w:.-]/g, '');
  return cleaned || fallback;
}
