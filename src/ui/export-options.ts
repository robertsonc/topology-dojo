/**
 * The render options for anything that leaves the canvas as an image: SVG,
 * PNG and PDF exports, the flipbook, a clipboard copy, Present mode.
 *
 * Each of those used to build its own options object, and each forgot
 * something the canvas applies — the brand palette above all, so a document
 * recoloured to its brand exported in the default green. One function builds
 * them all, so an export is drawn with exactly what the canvas is drawn with.
 */
import type { RenderOptions } from '../vendor/topology-ds.js';
import type { Page, TopologyDocument } from '../pages/model.js';
import type { RenderTheme } from '../render/theme.js';

/**
 * Options to render `page` of `doc` off the canvas, in `theme`.
 *
 * `page` supplies the frame's emphasis (which elements are spotlit). A
 * selection-only crop passes the cropped page, which carries none.
 */
export function exportRenderOptions(
  doc: Pick<TopologyDocument, 'layers' | 'linkStyles' | 'palette'>,
  page: Pick<Page, 'emphasis'>,
  theme: RenderTheme,
): RenderOptions {
  return {
    layers: doc.layers,
    linkStyles: doc.linkStyles,
    ...(page.emphasis ? { emphasis: page.emphasis } : {}),
    theme,
    ...(doc.palette ? { palette: doc.palette } : {}),
  };
}
