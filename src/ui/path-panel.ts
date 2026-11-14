/**
 * What the editor's "Analyze path" bar says about an analysis.
 *
 * The analysis itself is `analyzePath` (src/api/path.ts), the function behind
 * the `analyze_path` tool, so a person and an agent get the same answer from
 * the same page. This module only words it: one headline, the notes that
 * qualify it, and which route of several is on show. Pure and DOM-free.
 */
import {
  pathCaption,
  type PathAnalysis,
  type PathPage,
  type PathRoute,
} from '../api/path.js';

export interface PathPanelView {
  /** A route is on show (the actions that need one are available). */
  found: boolean;
  /** One line: the route in words, or why there is none. */
  title: string;
  /** What qualifies the headline, most important first. May be empty. */
  notes: string[];
  /** Routes found (0 when none). */
  count: number;
  /** Which route is on show, from 0 (0 when none). */
  index: number;
  /** The route on show, or null. */
  route: PathRoute | null;
}

/** Longest element name quoted in the bar. */
const NAME_MAX = 40;

/** A node's label, else its id, on one line and kept short. */
function nameOf(page: PathPage, id: string): string {
  const label = page.nodes.find((n) => n.id === id)?.label;
  const name =
    (typeof label === 'string' && label.replace(/\s+/g, ' ').trim()) || id;
  return name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name;
}

const plural = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The bar's content for `analysis`, showing route number `index` (clamped to
 * the routes there are).
 */
export function pathPanelView(
  page: PathPage,
  analysis: PathAnalysis,
  index = 0,
): PathPanelView {
  const none = (title: string, notes: string[] = []): PathPanelView => ({
    found: false,
    title,
    notes,
    count: 0,
    index: 0,
    route: null,
  });
  const from = nameOf(page, analysis.from);
  const to = nameOf(page, analysis.to);

  if (analysis.status === 'same')
    return none(`${from} is both ends: there is nothing to trace.`);
  if (analysis.status === 'unknown')
    return none('Select two nodes on this frame to trace a path.');

  if (analysis.status === 'disconnected') {
    const notes: string[] = [];
    if (analysis.hiddenLayers?.length)
      notes.push(
        `They are joined only through ${
          analysis.hiddenLayers.length === 1
            ? 'a hidden layer'
            : 'hidden layers'
        }: ${analysis.hiddenLayers.join(', ')}. Show ${
          analysis.hiddenLayers.length === 1 ? 'it' : 'them'
        } to trace the path.`,
      );
    else if (!analysis.reach.from || !analysis.reach.to) {
      const lone = [
        ...(analysis.reach.from ? [] : [from]),
        ...(analysis.reach.to ? [] : [to]),
      ];
      notes.push(
        `${lone.join(' and ')} ${
          lone.length > 1 ? 'have' : 'has'
        } no usable link on this frame.`,
      );
    } else
      notes.push(
        `They sit in separate groups of linked elements: ${from} reaches ${plural(
          analysis.reach.from,
          'other element',
          'other elements',
        )}, ${to} reaches ${analysis.reach.to}.`,
      );
    return none(`No drawn path joins ${from} and ${to}.`, notes);
  }

  const count = analysis.paths.length;
  const at = Math.min(Math.max(0, Math.trunc(index) || 0), count - 1);
  const route = analysis.paths[at]!;
  const notes: string[] = [];
  if (analysis.blockedOnly)
    notes.push('Every route crosses a blocked or down element.');
  if (route.hops > analysis.hops)
    notes.push(
      `${plural(route.hops - analysis.hops, 'hop', 'hops')} longer than the shortest route.`,
    );
  if (analysis.truncated)
    notes.push(`More routes exist; the ${count} shortest are listed.`);
  return {
    found: true,
    // "Path: Branch -> Hub · 3 hops via Edge, Core" — the caption a new frame
    // made from this route gets, so the bar and the frame read the same.
    title: pathCaption(page, route),
    notes,
    count,
    index: at,
    route,
  };
}
