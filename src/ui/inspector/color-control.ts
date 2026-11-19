/**
 * The colour control of the properties panel: one button that shows the
 * colour (a swatch and its value, "Auto" while unset) and opens a small
 * popover with the nine swatches, a hex field and "Auto".
 *
 * The popover keeps the data contract the panel's wiring already reads, so
 * the code that writes the document does not change: the hex field carries
 * the field's binding (`data-key` + `data-kind="color"` for a node or link,
 * `data-akey` + `data-akind="color"` for an annotation) and the swatches are
 * a `[data-swatch]` / `[data-aswatch]` group of `[data-color]` buttons.
 * "Auto" clears the hex field and reports it as typed, which is what
 * clearing the field by hand always wrote.
 *
 * The popover lives inside its row, so it is part of the panel's markup and
 * goes away with it when the panel redraws. While open it is placed beside
 * its button with the menu component's placement helper and registered with
 * the overlay primitive (Escape closes it, Tab stays inside it, the shell's
 * shortcuts stand down, focus goes back to the button).
 */
import { placeMenu } from '../menu.js';
import { icon } from '../icons.js';
import { registerOverlay } from '../overlay.js';
import { esc } from './html.js';

/** The nine colours of the palette, in the order they are shown. */
export const SWATCHES = [
  '#01a982',
  '#05cc93',
  '#65aef9',
  '#7764fc',
  '#deb146',
  '#fc6161',
  '#00a4b3',
  '#d25f4b',
  '#b1b9be',
] as const;

/** A usable colour value as typed in the hex field. */
export function isHexColour(value: string): boolean {
  return /^#[0-9a-f]{3,8}$/i.test(value.trim());
}

/** The button's text for a stored value. */
export function colourValueText(value: string | undefined): string {
  return value ? value : 'Auto';
}

export interface ColourBinding {
  /** `data-key` (node and link fields) or `data-akey` (annotation fields). */
  attr: 'data-key' | 'data-akey';
  /** The field's key. */
  key: string;
  /** The field's label, for the button's and the popover's names. */
  label: string;
}

/** The markup of one colour row: label, then the button and its popover. */
export function colourRowHtml(
  binding: ColourBinding,
  current: string | undefined,
  rowLabel: string = esc(binding.label),
): string {
  const c = current ?? '';
  const kind = binding.attr === 'data-key' ? 'data-kind' : 'data-akind';
  const group = binding.attr === 'data-key' ? 'data-swatch' : 'data-aswatch';
  const swatches = SWATCHES.map(
    (s) =>
      `<button type="button" class="sw${s === c ? ' on' : ''}" data-color="${s}" style="background:${s}" title="${s}" aria-label="Color ${s}" aria-pressed="${s === c}"></button>`,
  ).join('');
  const name = esc(binding.label);
  return (
    `<div class="insp-row insp-colour"><span>${rowLabel}</span>` +
    `<span class="colour-ctl">` +
    `<button type="button" class="colour-btn data" data-colour-open aria-haspopup="dialog" aria-expanded="false" aria-label="${name}: ${esc(colourValueText(c))}">` +
    `<i class="colour-dot" style="background:${esc(c) || 'transparent'}"></i>` +
    `<span class="colour-val">${esc(colourValueText(c))}</span>${icon('chevron-down', { size: 12 })}</button>` +
    `<div class="colour-pop" role="dialog" aria-label="${name}" hidden>` +
    `<div class="swatches" ${group}="${esc(binding.key)}">${swatches}</div>` +
    `<div class="colour-pop-row">` +
    `<span class="hexwrap"><i class="hexdot" style="background:${esc(c) || 'transparent'}"></i>` +
    `<input class="hex field data" ${binding.attr}="${esc(binding.key)}" ${kind}="color" value="${esc(c)}" placeholder="auto" aria-label="${name} hex value" spellcheck="false"/></span>` +
    `<button type="button" class="btn btn-sm" data-colour-auto>Auto</button>` +
    `</div></div></span></div>`
  );
}

/** The popover on show, if any. */
let open: {
  pop: HTMLElement;
  button: HTMLElement;
  release: () => void;
  stop: AbortController;
} | null = null;

/** Close the open popover (if any). The panel calls this before it redraws. */
export function closeColourPopover(): void {
  if (!open) return;
  const { pop, button, release, stop } = open;
  open = null;
  stop.abort();
  pop.hidden = true;
  button.setAttribute('aria-expanded', 'false');
  release();
}

function place(pop: HTMLElement, button: HTMLElement): void {
  const at = button.getBoundingClientRect();
  const spot = placeMenu(
    at,
    { width: pop.offsetWidth, height: pop.offsetHeight },
    { width: window.innerWidth, height: window.innerHeight },
    'below-end',
  );
  pop.style.left = `${spot.left}px`;
  pop.style.top = `${spot.top}px`;
}

function show(pop: HTMLElement, button: HTMLElement): void {
  closeColourPopover();
  pop.hidden = false;
  place(pop, button);
  button.setAttribute('aria-expanded', 'true');
  const stop = new AbortController();
  // A press outside the popover and its button closes it, and still lands.
  document.addEventListener(
    'pointerdown',
    (e) => {
      const t = e.target as Node | null;
      if (t && (pop.contains(t) || button.contains(t))) return;
      closeColourPopover();
    },
    { capture: true, signal: stop.signal },
  );
  window.addEventListener('resize', () => closeColourPopover(), {
    signal: stop.signal,
  });
  const scroller = button.closest<HTMLElement>('.inspector');
  const top = scroller?.scrollTop ?? 0;
  const release = registerOverlay(pop, {
    close: () => closeColourPopover(),
    initialFocus:
      pop.querySelector<HTMLElement>('.sw.on') ??
      pop.querySelector<HTMLElement>('input.hex'),
  });
  // Moving focus into the popover makes the browser scroll the panel to it
  // (the popover sits inside the panel's scroller, though it is placed with
  // fixed coordinates). Put the panel back where it was, so the popover
  // stays beside its button.
  if (scroller) scroller.scrollTop = top;
  // The panel scrolling under it would leave it beside nothing. The scroll
  // event of the focus move above still arrives, after the position has been
  // put back: only a scroll that leaves the panel elsewhere closes it.
  scroller?.addEventListener(
    'scroll',
    () => {
      if (scroller.scrollTop !== top) closeColourPopover();
    },
    { signal: stop.signal },
  );
  open = { pop, button, release, stop };
}

/**
 * Wire every colour control under `root`: the button opens and closes its
 * popover, the hex field keeps the button's swatch and value in step as it
 * is typed, and "Auto" clears the field through its own input event.
 */
export function wireColourControls(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.colour-ctl').forEach((ctl) => {
    const button = ctl.querySelector<HTMLElement>('[data-colour-open]')!;
    const pop = ctl.querySelector<HTMLElement>('.colour-pop')!;
    const hex = pop.querySelector<HTMLInputElement>('input.hex')!;
    button.addEventListener('click', () => {
      if (open?.pop === pop) closeColourPopover();
      else show(pop, button);
    });
    const dots = ctl.querySelectorAll<HTMLElement>('.colour-dot, .hexdot');
    const value = ctl.querySelector<HTMLElement>('.colour-val')!;
    const name = button.getAttribute('aria-label')!.replace(/: [^:]*$/, '');
    hex.addEventListener('input', () => {
      const typed = hex.value.trim();
      const shown = isHexColour(typed) ? typed : 'transparent';
      dots.forEach((d) => (d.style.background = shown));
      value.textContent = colourValueText(typed);
      button.setAttribute('aria-label', `${name}: ${colourValueText(typed)}`);
      pop.querySelectorAll<HTMLElement>('[data-color]').forEach((sw) => {
        const on = sw.dataset.color!.toLowerCase() === typed.toLowerCase();
        sw.classList.toggle('on', on);
        sw.setAttribute('aria-pressed', String(on));
      });
    });
    pop
      .querySelector<HTMLButtonElement>('[data-colour-auto]')
      ?.addEventListener('click', () => {
        hex.value = '';
        hex.dispatchEvent(new Event('input', { bubbles: true }));
        closeColourPopover();
        button.focus();
      });
  });
}
