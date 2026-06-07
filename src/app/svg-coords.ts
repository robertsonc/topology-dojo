/**
 * Screen ↔ SVG user-space conversion. Drag math happens in user space (the same
 * coordinates the model stores), so a node dropped under the cursor lands where
 * the cursor is regardless of how the SVG is scaled to the viewport.
 */

/** Convert a client (screen) point to the SVG's user-space coordinates. */
export function clientToUser(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: clientX, y: clientY };
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

/** Convert an SVG user-space point to client (screen) coordinates. */
export function userToClient(
  svg: SVGSVGElement,
  x: number,
  y: number,
): { x: number; y: number } {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x, y };
  const p = new DOMPoint(x, y).matrixTransform(ctm);
  return { x: p.x, y: p.y };
}
