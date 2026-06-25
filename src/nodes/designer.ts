/**
 * Node Designer (F2) — a modal that edits a CustomNodeSpec with a live preview.
 *
 * The dialog DOM is built once; controls mutate a working `spec` clone and
 * update only the preview (so text fields keep focus). Save returns the spec to
 * the caller, which persists + registers it.
 */
import {
  ICONS,
  PATTERN_KEYS,
  SHAPE_KEYS,
  SWATCHES,
  shapeGeom,
} from './data.js';
import { defaultSpec, type CustomNodeSpec } from './spec.js';
import { renderCustomNode } from './render.js';
import { nodeSpecToCode } from './codegen.js';
import { engineDefs } from '../vendor/topology-ds.js';

/** Clipboard fallback for browsers/contexts without navigator.clipboard. */
function fallbackCopy(text: string, done: (ok: boolean) => void): void {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    done(ok);
  } catch {
    done(false);
  }
}

function esc(s: string): string {
  return String(s).replace(/[<>&"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;',
  );
}

function shapeThumb(shape: string): string {
  const g = shapeGeom(shape, 14, 14, 10, 2);
  return `<svg viewBox="0 0 28 28"><${g.tag} ${g.attrs} fill="none" stroke="#b1b9be" stroke-width="1.2"/></svg>`;
}

function swatchRow(field: string, current: string): string {
  return (
    `<div class="nd-swatches" data-swatch="${field}">` +
    SWATCHES.map(
      (c) =>
        `<button class="nd-sw ${c === current ? 'on' : ''}" data-color="${c}" style="background:${c}" title="${c}"></button>`,
    ).join('') +
    `</div>`
  );
}

/**
 * Open the designer. `initial` = a spec to edit, or null for a new one.
 * `onSave(spec)` is called with the finished spec; the dialog closes after.
 */
export function openNodeDesigner(
  initial: CustomNodeSpec | null,
  onSave: (spec: CustomNodeSpec) => void,
): void {
  const spec: CustomNodeSpec = initial
    ? structuredClone(initial)
    : defaultSpec();

  const root = document.createElement('div');
  root.className = 'nd-modal';

  const iconCats = [...new Set(Object.values(ICONS).map((i) => i.cat))];
  const iconPicker =
    `<button class="nd-icon ${spec.icon === null ? 'on' : ''}" data-icon="">none</button>` +
    iconCats
      .map((cat) =>
        Object.entries(ICONS)
          .filter(([, v]) => v.cat === cat)
          .map(
            ([key, v]) =>
              `<button class="nd-icon ${spec.icon === key ? 'on' : ''}" data-icon="${key}" title="${key}"><svg viewBox="0 0 24 24"><path d="${v.d}" fill="#b1b9be"/></svg></button>`,
          )
          .join(''),
      )
      .join('');

  const toggle = (field: string, label: string): string =>
    `<label class="nd-toggle"><input type="checkbox" data-bool="${field}" ${spec[field as keyof CustomNodeSpec] ? 'checked' : ''}/> ${label}</label>`;

  root.innerHTML = `
    <div class="nd-dialog">
      <div class="nd-head">
        <span class="nd-title">Node Designer</span>
        <input class="nd-name" id="nd-name" value="${esc(spec.typeName)}" placeholder="type name"/>
        <span class="nd-spacer"></span>
        <button class="nd-btn" id="nd-cancel">Cancel</button>
        <button class="nd-btn" id="nd-code" title="Copy a self-contained registerNodeType() snippet">Copy as code</button>
        <button class="nd-btn primary" id="nd-save">Save</button>
      </div>
      <div class="nd-body">
        <div class="nd-col nd-left">
          <div class="nd-h">Base shape</div>
          <div class="nd-shapes">${SHAPE_KEYS.map((s) => `<button class="nd-shape ${s === spec.shape ? 'on' : ''}" data-shape="${s}" title="${s}">${shapeThumb(s)}</button>`).join('')}</div>
          <div class="nd-h">Icon</div>
          <div class="nd-icons">${iconPicker}</div>
        </div>
        <div class="nd-col nd-center">
          <div class="tds-root nd-preview-wrap">
            <svg id="nd-preview" viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet"></svg>
          </div>
        </div>
        <div class="nd-col nd-right">
          <div class="nd-h">Colors</div>
          <label class="nd-row">Stroke</label>${swatchRow('colorStroke', spec.colorStroke)}
          <label class="nd-row">Fill</label>${swatchRow('colorFill', spec.colorFill)}
          <div class="nd-h">Dimensions</div>
          <label class="nd-row">Size <input type="range" min="12" max="48" step="1" data-num="size" value="${spec.size}"/></label>
          <label class="nd-row">Stroke width <input type="range" min="0.5" max="4" step="0.1" data-num="strokeW" value="${spec.strokeW}"/></label>
          <label class="nd-row">Corner radius <input type="range" min="0" max="20" step="1" data-num="radius" value="${spec.radius}"/></label>
          <div class="nd-h">Embellishments</div>
          ${toggle('glow', 'Glow')}
          ${toggle('highlight', 'Highlight bar')}
          ${toggle('innerRing', 'Inner ring')}
          ${toggle('antenna', 'Antenna')}
          ${toggle('pattern', 'Pattern')}
          <div class="nd-sub" data-sub="pattern" ${spec.pattern ? '' : 'hidden'}>
            <select data-sel="patternType">${PATTERN_KEYS.map((p) => `<option value="${p}" ${p === spec.patternType ? 'selected' : ''}>${p}</option>`).join('')}</select>
          </div>
          ${toggle('leds', 'Status LEDs')}
          <div class="nd-sub" data-sub="leds" ${spec.leds ? '' : 'hidden'}>
            <label class="nd-row">Count <input type="range" min="1" max="4" step="1" data-num="ledCount" value="${spec.ledCount}"/></label>
            ${swatchRow('ledColor', spec.ledColor)}
            <select data-sel="ledPos">${['bottom', 'top', 'left', 'right'].map((p) => `<option value="${p}" ${p === spec.ledPos ? 'selected' : ''}>${p}</option>`).join('')}</select>
          </div>
          ${toggle('badge', 'Badge')}
          <div class="nd-sub" data-sub="badge" ${spec.badge ? '' : 'hidden'}>
            <input type="text" data-text="badgeText" value="${esc(spec.badgeText)}" placeholder="badge text"/>
            ${swatchRow('badgeColor', spec.badgeColor)}
          </div>
          ${toggle('ports', 'Ports')}
          <div class="nd-sub" data-sub="ports" ${spec.ports ? '' : 'hidden'}>
            <label class="nd-row">Count <input type="range" min="2" max="8" step="1" data-num="portCount" value="${spec.portCount}"/></label>
            <select data-sel="portPos">${['bottom', 'top'].map((p) => `<option value="${p}" ${p === spec.portPos ? 'selected' : ''}>${p}</option>`).join('')}</select>
          </div>
        </div>
      </div>
    </div>`;

  document.body.appendChild(root);
  const $ = <T extends Element>(sel: string): T => root.querySelector<T>(sel)!;
  const preview = $<SVGSVGElement>('#nd-preview');
  const defs = engineDefs();

  function draw(): void {
    preview.innerHTML = defs + renderCustomNode(spec, 100, 100);
  }
  draw();

  function close(): void {
    root.remove();
  }

  // Shapes
  root.querySelectorAll<HTMLButtonElement>('[data-shape]').forEach((b) =>
    b.addEventListener('click', () => {
      spec.shape = b.dataset.shape as CustomNodeSpec['shape'];
      root
        .querySelectorAll('[data-shape]')
        .forEach((x) => x.classList.toggle('on', x === b));
      draw();
    }),
  );
  // Icons
  root.querySelectorAll<HTMLButtonElement>('[data-icon]').forEach((b) =>
    b.addEventListener('click', () => {
      spec.icon = b.dataset.icon ? b.dataset.icon : null;
      root
        .querySelectorAll('[data-icon]')
        .forEach((x) => x.classList.toggle('on', x === b));
      draw();
    }),
  );
  // Swatches (color fields)
  root.querySelectorAll<HTMLElement>('[data-swatch]').forEach((group) => {
    const field = group.dataset.swatch as keyof CustomNodeSpec;
    group.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((b) =>
      b.addEventListener('click', () => {
        (spec[field] as unknown) = b.dataset.color!;
        group
          .querySelectorAll('[data-color]')
          .forEach((x) => x.classList.toggle('on', x === b));
        draw();
      }),
    );
  });
  // Numeric sliders
  root.querySelectorAll<HTMLInputElement>('[data-num]').forEach((inp) =>
    inp.addEventListener('input', () => {
      (spec[inp.dataset.num as keyof CustomNodeSpec] as unknown) = Number(
        inp.value,
      );
      draw();
    }),
  );
  // Text fields
  root.querySelectorAll<HTMLInputElement>('[data-text]').forEach((inp) =>
    inp.addEventListener('input', () => {
      (spec[inp.dataset.text as keyof CustomNodeSpec] as unknown) = inp.value;
      draw();
    }),
  );
  // Selects
  root.querySelectorAll<HTMLSelectElement>('[data-sel]').forEach((sel) =>
    sel.addEventListener('change', () => {
      (spec[sel.dataset.sel as keyof CustomNodeSpec] as unknown) = sel.value;
      draw();
    }),
  );
  // Boolean toggles (show/hide sub-sections)
  root.querySelectorAll<HTMLInputElement>('[data-bool]').forEach((cb) =>
    cb.addEventListener('change', () => {
      const field = cb.dataset.bool as keyof CustomNodeSpec;
      (spec[field] as unknown) = cb.checked;
      const sub = root.querySelector<HTMLElement>(`[data-sub="${field}"]`);
      if (sub) sub.hidden = !cb.checked;
      draw();
    }),
  );
  $<HTMLInputElement>('#nd-name').addEventListener('input', (e) => {
    spec.typeName = (e.target as HTMLInputElement).value;
  });

  $('#nd-cancel').addEventListener('click', close);
  root.addEventListener('click', (e) => {
    if (e.target === root) close(); // click backdrop
  });
  // Copy-as-code (1.4): a self-contained registerNodeType() snippet for the
  // current design, copied to the clipboard. Save-into-document is unchanged.
  $<HTMLButtonElement>('#nd-code').addEventListener('click', () => {
    const btn = $<HTMLButtonElement>('#nd-code');
    const named = { ...spec, typeName: spec.typeName.trim() || 'myNode' };
    const code = nodeSpecToCode(named);
    const done = (ok: boolean): void => {
      btn.textContent = ok ? '✓ Copied' : 'Copy failed';
      setTimeout(() => (btn.textContent = 'Copy as code'), 1400);
    };
    const clip = navigator.clipboard;
    if (clip?.writeText)
      clip.writeText(code).then(
        () => done(true),
        () => fallbackCopy(code, done),
      );
    else fallbackCopy(code, done);
  });
  $('#nd-save').addEventListener('click', () => {
    spec.typeName = spec.typeName.trim() || 'myNode';
    onSave(spec);
    close();
  });
}
