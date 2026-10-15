/**
 * Document overlays — everything drawn OVER the engine's art, in page
 * coordinates, that the per-page engine render does not know about: the
 * auto-legend, the sheet frame + title block (W6) and, as later packets
 * land, port pills, bundle outlines and port tables. One composer so the
 * editor canvas, every browser export and the headless MCP render path draw
 * the same overlay in the same order.
 */
import type { Page, TopologyDocument } from '../pages/model.js';
import { legendSVG } from '../editor/legend.js';
import { sheetSVG } from './sheet.js';
import { portPillsSVG } from './port-pills.js';
import { sheetInset } from '../api/sheet.js';

/** The overlay `<g>`s for a page, bottom → top. '' when nothing is on. */
export function documentOverlaySVG(doc: TopologyDocument, page: Page): string {
  return (
    sheetSVG(doc, page) +
    portPillsSVG(doc, page) +
    legendSVG(doc, page, { margin: sheetInset(doc.sheet) })
  );
}
