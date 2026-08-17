/**
 * Screen ↔ SVG user-space conversion. Drag/hit math happens in user space (the
 * coordinates the model stores), so it stays correct regardless of how the SVG
 * is scaled/letterboxed into the viewport.
 */
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

/**
 * Inverse of `clientToUser`: map a model-space point to viewport (client)
 * coordinates — used to place DOM overlays (e.g. the inline label editor)
 * over a canvas element.
 */
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
