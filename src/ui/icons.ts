/**
 * The editor chrome's icons: one SVG set, drawn in `currentColor`.
 *
 * The chrome used Unicode symbols and emoji as icons, which the UI font does
 * not contain, so each one was drawn by whatever fallback font the OS had
 * and looked different (or was missing) from one machine to the next. Icons
 * now come from one set (`icons.generated.ts`, built from Lucide by
 * `scripts/build-icons.ts`) through an inline sprite: `iconSprite()` is
 * mounted once in the app shell and `icon(name)` returns a small `<svg>` that
 * references a symbol in it.
 *
 * An icon is always decorative (`aria-hidden`): the accessible name stays on
 * the button that holds it (its `aria-label`, `title` or text). Size, stroke
 * and alignment are styled by `src/styles/icons.css`.
 *
 * This module builds strings only and touches no DOM, so modules that build
 * HTML strings can import it and it runs in the node test environment.
 */
import { ICON_BODIES } from './icons.generated.js';

/** The name of an icon in the set (a key of the manifest). */
export type IconName = keyof typeof ICON_BODIES;

export interface IconOptions {
  /** Width and height in CSS pixels. Default 16. */
  size?: number;
  /** Extra class names, added after `icon`. */
  className?: string;
}

const DEFAULT_SIZE = 16;

/** Every icon name, in manifest order. */
export function iconNames(): IconName[] {
  return Object.keys(ICON_BODIES) as IconName[];
}

/** The id of an icon's `<symbol>` in the sprite. */
export function iconSymbolId(name: IconName): string {
  return `i-${name}`;
}

/**
 * The markup of one icon, to place inside a button or beside a label:
 * `<svg class="icon" …><use href="#i-NAME"/></svg>`.
 */
export function icon(name: IconName, opts: IconOptions = {}): string {
  const size =
    opts.size !== undefined && Number.isFinite(opts.size) && opts.size > 0
      ? opts.size
      : DEFAULT_SIZE;
  // Class names only: nothing here may close the attribute.
  const extra = (opts.className ?? '').replace(/[^\w -]/g, '').trim();
  const cls = extra ? `icon ${extra}` : 'icon';
  // The stylesheet sizes and aligns .icon from --icon-size (16px unless
  // set), so another size is stated there as well as in the attributes.
  const style = size === DEFAULT_SIZE ? '' : ` style="--icon-size:${size}px"`;
  return `<svg class="${cls}" width="${size}" height="${size}"${style} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#${iconSymbolId(name)}"/></svg>`;
}

/**
 * The `<symbol>` of every icon, to mount once inside an `<svg>` that stays in
 * the render tree (the shell's `#ui-icon-sprite`).
 */
export function iconSprite(): string {
  return iconNames()
    .map(
      (name) =>
        `<symbol id="${iconSymbolId(name)}" viewBox="0 0 24 24">${ICON_BODIES[name]}</symbol>`,
    )
    .join('');
}
