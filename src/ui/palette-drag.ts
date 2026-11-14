/**
 * Dragging a tile of the node library onto the canvas.
 *
 * A click on a tile still adds the node in the middle of the view. Pressing
 * a tile and moving the pointer away from where it was pressed starts a
 * drag instead: a ghost of the tile follows the pointer, and releasing it
 * over the canvas puts the node there. Over a link, the link is marked and
 * the node is inserted into it. Released anywhere else, or after Escape,
 * nothing is added.
 *
 * Mouse and pen only: a finger on a tile scrolls the library, and a tap
 * still adds the node.
 */

/** How far the pointer moves, in CSS pixels, before a press becomes a drag. */
export const DRAG_START_PX = 6;

/** Whether the pointer has moved far enough from where it was pressed. */
export function isDrag(
  start: { x: number; y: number },
  now: { x: number; y: number },
): boolean {
  return Math.hypot(now.x - start.x, now.y - start.y) >= DRAG_START_PX;
}

/** Where a dragged tile can land; the shell provides it. */
export interface PaletteDropTarget {
  /** The canvas is what is under this viewport point (no panel in front). */
  overCanvas(x: number, y: number): boolean;
  /** The link under the point that a dropped node would be inserted into. */
  linkAt(x: number, y: number): string | null;
  /** Show which link the drop would land on; `null` clears it. */
  markLink(id: string | null): void;
  /** The drop: at this viewport point, into `linkId` when there is one. */
  drop(x: number, y: number, linkId: string | null): void;
}

/** The ghost that follows the pointer: the tile's picture and its name. */
function makeGhost(tile: HTMLElement): HTMLDivElement {
  const ghost = document.createElement('div');
  ghost.className = 'pdrag-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  const art = tile.querySelector('svg');
  if (art) ghost.appendChild(art.cloneNode(true));
  const name = document.createElement('span');
  name.className = 'pdrag-name';
  name.textContent = tile.querySelector('.plabel')?.textContent ?? '';
  const hint = document.createElement('span');
  hint.className = 'pdrag-hint';
  hint.textContent = 'insert on link';
  ghost.append(name, hint);
  return ghost;
}

/** Make a library tile draggable onto `target`. */
export function enablePaletteDrag(
  tile: HTMLElement,
  target: PaletteDropTarget,
): void {
  let press: { x: number; y: number; id: number } | null = null;
  let ghost: HTMLDivElement | null = null;
  // The release of a drag is followed by a click on the tile (the pointer is
  // captured by it); that click must not add a second node.
  let swallowClick = false;

  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    finish();
  };
  /** End the drag and take away everything it put on screen. */
  function finish(): void {
    ghost?.remove();
    ghost = null;
    press = null;
    target.markLink(null);
    document.documentElement.classList.remove('palette-dragging');
    window.removeEventListener('keydown', onKey, true);
  }
  /** Where the pointer is, as a drop target. */
  const aim = (e: PointerEvent): { over: boolean; link: string | null } => {
    const over = target.overCanvas(e.clientX, e.clientY);
    return { over, link: over ? target.linkAt(e.clientX, e.clientY) : null };
  };

  tile.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.pointerType === 'touch') return;
    press = { x: e.clientX, y: e.clientY, id: e.pointerId };
    swallowClick = false;
    // Captured from the press, so a quick flick off the tile is still seen.
    tile.setPointerCapture(e.pointerId);
  });

  tile.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (!ghost) {
      if (!isDrag(press, { x: e.clientX, y: e.clientY })) return;
      ghost = makeGhost(tile);
      document.body.appendChild(ghost);
      document.documentElement.classList.add('palette-dragging');
      window.addEventListener('keydown', onKey, true);
      swallowClick = true;
    }
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;
    const { over, link } = aim(e);
    ghost.classList.toggle('can-drop', over);
    ghost.classList.toggle('on-link', link !== null);
    target.markLink(link);
  });

  tile.addEventListener('pointerup', (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (!ghost) {
      press = null; // a click: the tile's own handler adds the node
      return;
    }
    const { over, link } = aim(e);
    finish();
    if (over) target.drop(e.clientX, e.clientY, link);
  });

  tile.addEventListener('pointercancel', finish);

  tile.addEventListener(
    'click',
    (e) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );
}
