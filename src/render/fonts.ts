/**
 * The diagram typeface.
 *
 * On the canvas, text gets its font from the page's CSS
 * (`.tds-canvas svg text { font-family: var(--tds-font) }`). A standalone SVG
 * has no page CSS, so without a family of its own every label falls back to
 * the viewer's default — Times, in most browsers. The family therefore goes
 * on the root `<svg>`, where every `<text>` inherits it.
 *
 * JetBrains Mono first (the engine's typeface, and the one the server-side
 * rasterizer embeds); then the platform monospace faces, so a machine without
 * it still draws fixed-width labels that fit the pills sized for them.
 */
export const DIAGRAM_FONT_FAMILY =
  "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** ` font-family="…"` for a root `<svg>` tag. */
export const ROOT_FONT_ATTR = ` font-family="${DIAGRAM_FONT_FAMILY}"`;
