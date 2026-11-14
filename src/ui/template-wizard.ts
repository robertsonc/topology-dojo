/**
 * Parameter dialog for the parametric starter templates — the small sibling
 * of the SD-WAN wizard (./sdwan-wizard.ts), built the same way and from the
 * same styles: one question per template parameter, a live preview with its
 * node and link counts, Create, and Escape to cancel. The questions come
 * straight from the template's parameter list (src/api/templates.ts), so a
 * new parameter appears here without touching this file, and the document on
 * the canvas is the one `create_from_template` builds for the same values.
 *
 * The dialog owns no persisted state: Create hands the generated document to
 * the caller, which loads it as it loads any template. A template without
 * parameters never opens it (`openTemplateWizard` returns false).
 *
 * State and markup are pure functions (tested in template-wizard.test.ts);
 * `openTemplateWizard` is the thin DOM shell around them.
 */
import {
  generateTemplate,
  templateInfo,
  type TemplateInfo,
  type TemplateParamSpec,
  type TemplateParams,
  type TemplateStats,
} from '../api/templates.js';
import type { TopologyDocument } from '../pages/model.js';
import { registerOverlay } from './overlay.js';

export interface TemplateWizardHost {
  /** Element the backdrop is appended to (the app root). */
  mount: HTMLElement;
  /** Render a generated document's first page to a standalone SVG string. */
  render: (doc: TopologyDocument) => string;
  /** Called with the generated document when the user presses Create. */
  onCreate: (doc: TopologyDocument) => void;
}

/** What the dialog is editing: one template and a value for each parameter. */
export interface TemplateWizardState {
  template: TemplateInfo;
  values: TemplateParams;
}

/** A whole-number parameter with more values than this gets a slider. */
export const MAX_CHOICE_BUTTONS = 8;

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
}

/**
 * The dialog's starting state — every parameter at its default — or null when
 * the template has no parameters (or does not exist): nothing to ask.
 */
export function templateWizardState(id: string): TemplateWizardState | null {
  const template = templateInfo(id);
  if (!template || template.params.length === 0) return null;
  return {
    template,
    values: Object.fromEntries(template.params.map((p) => [p.name, p.default])),
  };
}

/**
 * The state after a control reports `raw` (its `data-value` or input value)
 * for a parameter. Numbers are rounded and held inside the parameter's
 * bounds; anything unreadable, or an unknown parameter, changes nothing.
 */
export function withTemplateParam(
  state: TemplateWizardState,
  name: string,
  raw: string,
): TemplateWizardState {
  const spec = state.template.params.find((p) => p.name === name);
  if (!spec) return state;
  let value: number | boolean;
  if (spec.type === 'boolean') {
    if (raw !== 'true' && raw !== 'false') return state;
    value = raw === 'true';
  } else {
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n)) return state;
    value = Math.min(spec.max, Math.max(spec.min, Math.round(n)));
  }
  return { ...state, values: { ...state.values, [name]: value } };
}

/** Whether a parameter is asked with a slider rather than one button a value. */
export function usesSlider(spec: TemplateParamSpec): boolean {
  return (
    spec.type === 'integer' && spec.max - spec.min + 1 > MAX_CHOICE_BUTTONS
  );
}

/** The choices of a button group: `[data-value, caption]` pairs. */
function choices(spec: TemplateParamSpec): [string, string][] {
  if (spec.type === 'boolean')
    return [
      ['false', 'No'],
      ['true', 'Yes'],
    ];
  return Array.from({ length: spec.max - spec.min + 1 }, (_, i) => {
    const v = String(spec.min + i);
    return [v, v];
  });
}

/** DOM id of a parameter's label (and, with `-input`, of its slider). */
const fieldId = (name: string): string => `tpw-${name}`;

function questionHtml(
  spec: TemplateParamSpec,
  value: number | boolean,
): string {
  const id = fieldId(spec.name);
  const open = `<div class="sdw-q" data-param="${escapeHtml(spec.name)}">`;
  // The parameter's one-line description, read out with its control.
  const hint = `<p class="sdw-note tpw-hint" id="${id}-hint">${escapeHtml(spec.description)}</p></div>`;
  if (usesSlider(spec) && spec.type === 'integer')
    return (
      open +
      `<label class="sdw-label" id="${id}" for="${id}-input">${escapeHtml(spec.label)}</label>` +
      `<div class="tpw-range">` +
      `<input type="range" id="${id}-input" min="${spec.min}" max="${spec.max}" step="1" value="${Number(value)}" aria-describedby="${id}-hint"/>` +
      `<output for="${id}-input">${Number(value)}</output>` +
      `</div>` +
      hint
    );
  return (
    open +
    `<div class="sdw-label" id="${id}">${escapeHtml(spec.label)}</div>` +
    `<div class="sdw-seg" role="group" aria-labelledby="${id}" aria-describedby="${id}-hint">` +
    choices(spec)
      .map(
        ([v, caption]) =>
          `<button type="button" class="tbtn sdw-opt" data-value="${v}" aria-pressed="${String(v === String(value))}">${caption}</button>`,
      )
      .join('') +
    `</div>` +
    hint
  );
}

/** The questions, one per parameter, in the template's order. */
export function renderTemplateFormHtml(state: TemplateWizardState): string {
  return state.template.params
    .map((spec) => questionHtml(spec, state.values[spec.name] ?? spec.default))
    .join('');
}

/** "16 nodes · 48 links" — the counts under the preview. */
export function templateStatsText(stats: TemplateStats): string {
  const plural = (n: number, w: string): string =>
    `${n} ${w}${n === 1 ? '' : 's'}`;
  return `${plural(stats.nodes, 'node')} · ${plural(stats.links, 'link')}`;
}

let open: { close: () => void } | null = null;

/**
 * Open the dialog for a parametric template. Returns false — and opens
 * nothing — for a template without parameters, so the caller keeps its
 * plain "start from this template" path for those.
 */
export function openTemplateWizard(
  id: string,
  host: TemplateWizardHost,
): boolean {
  const initial = templateWizardState(id);
  if (!initial) return false;
  if (open) return true;
  let state: TemplateWizardState = initial;
  let doc: TopologyDocument | null = null;

  const root = document.createElement('div');
  root.className = 'help-backdrop';
  root.innerHTML =
    `<div class="help-card sdw-card tpw-card scroll-slim" role="dialog" aria-modal="true" aria-labelledby="tpwTitle">` +
    `<div class="help-head"><h3 id="tpwTitle">${escapeHtml(state.template.name)}</h3>` +
    `<button class="tbtn ticon" data-act="close" title="Close (Esc)" aria-label="Close">✕</button></div>` +
    `<div class="sdw-body"><div class="sdw-form"></div>` +
    `<div class="sdw-side"><div class="sdw-preview" aria-hidden="true"></div>` +
    `<div class="sdw-stats" role="status" aria-live="polite"></div>` +
    `<p class="sdw-note">${escapeHtml(state.template.description)}</p></div></div>` +
    `<div class="sdw-foot"><button class="tbtn" data-act="close">Cancel</button>` +
    `<button class="tbtn sdw-create" data-act="create">Create diagram</button></div></div>`;
  const form = root.querySelector<HTMLElement>('.sdw-form')!;
  const preview = root.querySelector<HTMLElement>('.sdw-preview')!;
  const stats = root.querySelector<HTMLElement>('.sdw-stats')!;
  const createBtn = root.querySelector<HTMLButtonElement>('.sdw-create')!;

  /** Regenerate the document, preview and counts from the current values. */
  const regenerate = (): void => {
    try {
      const result = generateTemplate(id, state.values);
      doc = result.doc;
      preview.innerHTML = host.render(result.doc);
      stats.textContent = templateStatsText(result.stats);
      createBtn.disabled = false;
    } catch (err) {
      doc = null;
      preview.replaceChildren();
      stats.textContent = err instanceof Error ? err.message : String(err);
      createBtn.disabled = true;
    }
  };

  const paramOf = (el: Element): string | null =>
    el.closest<HTMLElement>('[data-param]')?.getAttribute('data-param') ?? null;

  // A button: take its value, redraw the questions (pressed states), and
  // keep keyboard focus on the same choice.
  form.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-value]');
    const name = btn && paramOf(btn);
    if (!btn || !name) return;
    const value = btn.getAttribute('data-value')!;
    state = withTemplateParam(state, name, value);
    form.innerHTML = renderTemplateFormHtml(state);
    form
      .querySelector<HTMLElement>(
        `[data-param="${name}"] [data-value="${value}"]`,
      )
      ?.focus();
    regenerate();
  });
  // A slider: follow the drag without redrawing the control under the hand.
  form.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    const name = paramOf(input);
    if (input.type !== 'range' || !name) return;
    state = withTemplateParam(state, name, input.value);
    const out = input.parentElement?.querySelector('output');
    if (out) out.textContent = String(state.values[name]);
    regenerate();
  });

  let release: () => void = () => {};
  const close = (): void => {
    root.remove();
    release();
    open = null;
  };
  root.addEventListener('click', (e) => {
    if (e.target === root) return close();
    const act = (e.target as HTMLElement)
      .closest<HTMLElement>('[data-act]')
      ?.getAttribute('data-act');
    if (act === 'close') close();
    else if (act === 'create' && doc) {
      const generated = doc;
      close();
      host.onCreate(generated);
    }
  });

  form.innerHTML = renderTemplateFormHtml(state);
  regenerate();
  host.mount.appendChild(root);
  open = { close };
  release = registerOverlay(root, {
    close,
    initialFocus: form.querySelector<HTMLElement>(
      '.sdw-opt[aria-pressed="true"], input',
    ),
  });
  return true;
}
