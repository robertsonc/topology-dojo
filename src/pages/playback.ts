/**
 * Flipbook playback — the pure timing model every player shares (the editor's
 * filmstrip play control and the standalone HTML export). Pages are still
 * independent static frames (ADR-0001); playback is just visiting them in
 * order on their declared durations. No DOM here.
 */
import type { Page, TopologyDocument } from './model.js';

/** How long a frame holds when it doesn't declare a duration (ms). */
export const DEFAULT_PAGE_DURATION = 2000;

/** A page's effective hold time in ms (declared, else the default). */
export function pageDuration(page: Page): number {
  const d = page.duration;
  return typeof d === 'number' && Number.isFinite(d) && d > 0
    ? d
    : DEFAULT_PAGE_DURATION;
}

export interface FlipbookFrame {
  pageIndex: number;
  /** Offset from playback start (ms). */
  start: number;
  duration: number;
  transition: 'cut' | 'fade';
}

export interface FlipbookSchedule {
  frames: FlipbookFrame[];
  /** One full loop's length (ms). */
  total: number;
}

/** The full playback schedule for a document (one loop, page order). */
export function flipbookSchedule(doc: TopologyDocument): FlipbookSchedule {
  const frames: FlipbookFrame[] = [];
  let start = 0;
  doc.pages.forEach((page, pageIndex) => {
    const duration = pageDuration(page);
    frames.push({
      pageIndex,
      start,
      duration,
      transition: page.transition === 'fade' ? 'fade' : 'cut',
    });
    start += duration;
  });
  return { frames, total: start };
}
