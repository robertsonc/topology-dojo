/**
 * In-document page links — an element's `href` of the form `#page=<pageId>`
 * points at another page (flipbook frame) of the same document, the way an
 * overview tile drills into a detail page.
 *
 * Reusing `href` (instead of a second link field) keeps one hyperlink concept
 * across the GUI inspector, the headless API and MCP. The form is a URL
 * fragment, so it is inert everywhere a real URL is expected: the renderer and
 * the Visio / PowerPoint / PDF exporters emit only http(s) links and skip it,
 * and draw.io export translates it to draw.io's own page-link form
 * (`data:page/id,<diagramId>`).
 */

/** Prefix of an in-document page link. */
export const PAGE_LINK_PREFIX = '#page=';

/** draw.io's page-link prefix (`link="data:page/id,<diagram id>"`). */
export const DRAWIO_PAGE_LINK_PREFIX = 'data:page/id,';

/** The `href` that links to `pageId`. */
export function pageLinkHref(pageId: string): string {
  return `${PAGE_LINK_PREFIX}${pageId}`;
}

/** The target page id of an in-document page link, else null. */
export function pageLinkTarget(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  const h = href.trim();
  if (!h.startsWith(PAGE_LINK_PREFIX)) return null;
  const id = h.slice(PAGE_LINK_PREFIX.length);
  return id ? id : null;
}

/** Whether `href` is something the editor can follow (http(s) or a page). */
export function isFollowableHref(href: unknown): boolean {
  return (
    pageLinkTarget(href) !== null ||
    (typeof href === 'string' && /^https?:\/\//i.test(href.trim()))
  );
}
