/**
 * Drop the `<defs>` entries an SVG never references.
 *
 * The engine always emits its whole definition table — 35 filters, gradients
 * and patterns, about 14 KB — and the headless render then flattens away
 * almost every reference to it (see `flattenViewer`). A typical page uses one
 * or two of those definitions; the rest is dead weight an agent pays for in
 * context and a client pays for in transfer. Pruning changes nothing that is
 * drawn: an unreferenced definition has no effect in SVG.
 */

/** Ids referenced from `text` via `url(#id)` or `href="#id"` (incl. xlink). */
function referencedIds(text: string, into: Set<string>): void {
  const re =
    /url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)|href\s*=\s*["']#([^"']+)["']/g;
  for (let m = re.exec(text); m; m = re.exec(text)) into.add((m[1] ?? m[2])!);
}

interface DefChild {
  /** The child's complete markup, opening tag through closing tag. */
  markup: string;
  /** Its `id`, if it has one (children without an id are always kept). */
  id: string | undefined;
}

/** Split the inside of a `<defs>` into its top-level child elements, or null
 * when the markup is not what we expect (unbalanced tags) — the caller then
 * leaves the SVG alone rather than guess. */
function topLevelChildren(inner: string): DefChild[] | null {
  const tag = /<(\/?)([A-Za-z][\w:.-]*)\b[^>]*?(\/?)>/g;
  const out: DefChild[] = [];
  let depth = 0;
  let start = -1;
  let open = '';
  for (let m = tag.exec(inner); m; m = tag.exec(inner)) {
    const closing = m[1] === '/';
    const selfClosing = m[3] === '/';
    if (!closing) {
      if (depth === 0) {
        start = m.index;
        open = m[0];
      }
      if (!selfClosing) depth++;
    } else {
      depth--;
      if (depth < 0) return null;
    }
    if (depth === 0 && start >= 0) {
      const markup = inner.slice(start, m.index + m[0].length);
      out.push({ markup, id: /\sid="([^"]+)"/.exec(open)?.[1] });
      start = -1;
    }
  }
  return depth === 0 ? out : null;
}

/**
 * Remove every id-bearing `<defs>` child that nothing references — directly
 * from the drawing, or from another definition that is itself kept. Empty
 * `<defs>` blocks go too. Returns the input unchanged if a `<defs>` cannot be
 * parsed.
 */
export function pruneUnusedDefs(svg: string): string {
  const block = /<defs\b[^>]*>([\s\S]*?)<\/defs>/g;
  const blocks: { whole: string; children: DefChild[] }[] = [];
  for (let m = block.exec(svg); m; m = block.exec(svg)) {
    const children = topLevelChildren(m[1]!);
    if (!children) return svg;
    blocks.push({ whole: m[0], children });
  }
  if (!blocks.length) return svg;

  // Start from what the drawing itself (everything outside <defs>) uses, then
  // follow references out of each kept definition until nothing new appears.
  const used = new Set<string>();
  referencedIds(svg.replace(block, ''), used);
  const all = blocks.flatMap((b) => b.children);
  const kept = new Set<DefChild>();
  for (const child of all)
    if (child.id === undefined) {
      kept.add(child);
      referencedIds(child.markup, used);
    }
  for (let grew = true; grew; ) {
    grew = false;
    for (const child of all) {
      if (kept.has(child) || !used.has(child.id!)) continue;
      kept.add(child);
      referencedIds(child.markup, used);
      grew = true;
    }
  }
  if (kept.size === all.length) return svg;

  let i = 0;
  return svg.replace(block, () => {
    const mine = blocks[i++]!.children.filter((c) => kept.has(c));
    return mine.length
      ? `<defs>${mine.map((c) => c.markup).join('')}</defs>`
      : '';
  });
}

/** Geometry attributes whose numbers can be rounded without visible effect. */
const GEOMETRY_ATTR =
  /\s(d|points|transform|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|width|height|dx|dy)="([^"]*)"/g;

/**
 * Round the long decimals in geometry attributes to two places. The engine
 * computes attach points in floating point and prints them in full
 * (`554.6666666666666`); at two decimals nothing moves by more than 0.005 px,
 * and a large page loses several kilobytes. Text content, ids, colours and
 * every other attribute are left alone.
 */
export function roundGeometry(svg: string): string {
  return svg.replace(GEOMETRY_ATTR, (whole, name: string, value: string) => {
    if (!/\.\d{3}/.test(value)) return whole;
    const rounded = value.replace(/-?\d+\.\d{3,}/g, (n) =>
      String(Math.round(Number(n) * 100) / 100),
    );
    return ` ${name}="${rounded}"`;
  });
}
