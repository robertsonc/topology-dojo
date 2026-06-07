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
