/**
 * The Document tab of the properties panel: settings of the whole document
 * (title, legend, drawing sheet, layers). Each control writes the document
 * and redraws the overlay; none of them is per page.
 */
import {
  SHEET_SIZE_IDS,
  SHEET_SIZE_LABELS,
  sheetViewBox,
  type SheetConfig,
} from '../../api/sheet.js';
import { icon } from '../icons.js';
import type { InspectorContext } from './context.js';
import { esc } from './html.js';
import { sectionHtml } from './sections.js';

export function documentTabHtml(ctx: InspectorContext): string {
  const { sections, doc } = ctx;
  return (
    sectionHtml(
      sections,
      'Document',
      `<label class="insp-row"><span>Title</span><input id="p-title" value="${esc(doc.title)}"/></label>`,
      { open: true },
    ) +
    sectionHtml(sections, 'Legend', legendRows(ctx), { open: true }) +
    sectionHtml(sections, 'Sheet', sheetRows(ctx), { open: false }) +
    sectionHtml(sections, 'Layers', layerRows(ctx), {
      open: false,
      count: (doc.layers ?? []).length,
    })
  );
}

function legendRows(ctx: InspectorContext): string {
  const { doc } = ctx;
  return (
    `<label class="insp-row"><span>Show key</span><input type="checkbox" id="p-legend"${doc.legend?.show ? ' checked' : ''}/></label>` +
    `<label class="insp-row"><span>Position</span><select id="p-legend-pos">` +
    (['tl', 'tr', 'bl', 'br'] as const)
      .map(
        (p) =>
          `<option value="${p}"${(doc.legend?.position ?? 'tl') === p ? ' selected' : ''}>${
            {
              tl: 'top-left',
              tr: 'top-right',
              bl: 'bottom-left',
              br: 'bottom-right',
            }[p]
          }</option>`,
      )
      .join('') +
    `</select></label>` +
    (doc.legend?.show
      ? `<label class="insp-row" title="Lay the key out across columns, like a drawing sheet's Key strip"><span>Columns</span><input type="number" id="p-legend-cols" min="1" max="8" value="${doc.legend.columns ?? 1}"/></label>` +
        `<label class="insp-row"><span>Key title</span><input id="p-legend-title" value="${esc(doc.legend.title ?? '')}" placeholder="Key"/></label>`
      : '')
  );
}

/** The drawing sheet (W6): paper size, border, title block. */
function sheetRows(ctx: InspectorContext): string {
  const sh = ctx.doc.sheet;
  const tb = sh?.titleBlock;
  const field = (label: string): string =>
    tb?.fields?.find((f) => f.label.toLowerCase() === label.toLowerCase())
      ?.value ?? '';
  return (
    `<label class="insp-row" title="Draw the document as a drawing sheet: border, top title, bottom-right title block"><span>Sheet frame</span><input type="checkbox" id="p-sheet"${sh ? ' checked' : ''}/></label>` +
    (sh
      ? `<label class="insp-row"><span>Size</span><select id="p-sheet-size">` +
        `<option value="custom"${!sh.size || sh.size === 'custom' ? ' selected' : ''}>custom (keep canvas)</option>` +
        SHEET_SIZE_IDS.map(
          (id) =>
            `<option value="${id}"${sh.size === id ? ' selected' : ''}>${esc(SHEET_SIZE_LABELS[id])}</option>`,
        ).join('') +
        `</select></label>` +
        `<label class="insp-row"><span>Orientation</span><select id="p-sheet-orient">` +
        `<option value="landscape"${sh.orientation !== 'portrait' ? ' selected' : ''}>landscape</option>` +
        `<option value="portrait"${sh.orientation === 'portrait' ? ' selected' : ''}>portrait</option>` +
        `</select></label>` +
        `<label class="insp-row"><span>Border</span><input type="checkbox" id="p-sheet-border"${sh.border !== false ? ' checked' : ''}/></label>` +
        `<label class="insp-row"><span>Top title</span><input type="checkbox" id="p-sheet-title"${sh.title !== false ? ' checked' : ''}/></label>` +
        `<label class="insp-row"><span>Title block</span><input type="checkbox" id="p-sheet-tb"${tb && tb.show !== false ? ' checked' : ''}/></label>` +
        (tb && tb.show !== false
          ? `<label class="insp-row"><span>Subtitle</span><input id="p-sheet-sub" value="${esc(tb.subtitle ?? '')}" placeholder="sheet name"/></label>` +
            `<label class="insp-row"><span>Drawn by</span><input class="p-sheet-field" data-label="Drawn by" value="${esc(field('Drawn by'))}"/></label>` +
            `<label class="insp-row"><span>Revision</span><input class="p-sheet-field" data-label="Revision" value="${esc(field('Revision'))}"/></label>` +
            `<label class="insp-row"><span>Date</span><input class="p-sheet-field" data-label="Date" value="${esc(field('Date'))}"/></label>` +
            `<label class="insp-row"><span>Logo URL</span><input id="p-sheet-logo" value="${esc(tb.logoHref ?? '')}" placeholder="https://…"/></label>`
          : '')
      : '')
  );
}

/** Layers (B.3): per-layer eye and opacity, and a button to add one. */
function layerRows(ctx: InspectorContext): string {
  const layers = ctx.doc.layers ?? [];
  const rows = layers
    .map((l, i) => {
      const vis = l.defaultVisible !== false;
      const op = Math.round((l.opacity ?? 1) * 100);
      return (
        `<div class="layer-row" data-li="${i}">` +
        `<button class="layer-eye" data-li="${i}" title="Show / hide layer" aria-label="${vis ? 'Hide' : 'Show'} layer ${esc(l.name ?? l.id)}" aria-pressed="${vis}">${icon(vis ? 'eye' : 'eye-off')}</button>` +
        `<span class="layer-name">${esc(l.name ?? l.id)}</span>` +
        `<input class="layer-op" data-li="${i}" type="range" min="0" max="100" step="5" value="${op}" title="Layer opacity (${op}%)" aria-label="Opacity of layer ${esc(l.name ?? l.id)}"/>` +
        `</div>`
      );
    })
    .join('');
  // The plus is an icon, which a screen reader skips: the name says "Add".
  return (
    (rows || `<div class="insp-hint">No layers declared.</div>`) +
    `<button class="insp-btn" id="p-layer-add" aria-label="Add layer">${icon('plus')} Layer</button>`
  );
}

export function wireDocumentTab(ctx: InspectorContext): void {
  const { root, doc, editor } = ctx;
  const title = root.querySelector<HTMLInputElement>('#p-title');
  title?.addEventListener('input', () => {
    doc.title = title.value;
    ctx.markDirty();
  });
  // Legend (B.1) — a per-document setting; redraw the overlay so it shows live.
  const legendOn = root.querySelector<HTMLInputElement>('#p-legend');
  legendOn?.addEventListener('change', () => {
    doc.legend = { ...doc.legend, show: legendOn.checked };
    editor.redrawOverlay();
    ctx.markDirty();
    ctx.rerender(); // the key's own options appear / go with it
  });
  const legendPos = root.querySelector<HTMLSelectElement>('#p-legend-pos');
  legendPos?.addEventListener('change', () => {
    doc.legend = {
      ...doc.legend,
      position: legendPos.value as 'tl' | 'tr' | 'bl' | 'br',
    };
    editor.redrawOverlay();
    ctx.markDirty();
  });
  const legendCols = root.querySelector<HTMLInputElement>('#p-legend-cols');
  legendCols?.addEventListener('change', () => {
    const n = Math.max(1, Math.min(8, Math.round(Number(legendCols.value))));
    const next = { ...doc.legend };
    if (n > 1) next.columns = n;
    else delete next.columns;
    doc.legend = next;
    editor.redrawOverlay();
    ctx.markDirty();
  });
  const legendTitle = root.querySelector<HTMLInputElement>('#p-legend-title');
  legendTitle?.addEventListener('input', () => {
    const next = { ...doc.legend };
    if (legendTitle.value.trim()) next.title = legendTitle.value;
    else delete next.title;
    doc.legend = next;
    editor.redrawOverlay();
    ctx.markDirty();
  });
  wireSheet(ctx);
  wireLayers(ctx);
}

/** Every Sheet control writes `doc.sheet` and redraws. */
function wireSheet(ctx: InspectorContext): void {
  const { root, doc, editor } = ctx;
  const on = root.querySelector<HTMLInputElement>('#p-sheet');
  const commit = (rerender = false): void => {
    editor.redrawOverlay();
    ctx.markDirty();
    if (rerender) ctx.rerender();
  };
  on?.addEventListener('change', () => {
    if (on.checked) doc.sheet = doc.sheet ?? {};
    else delete doc.sheet;
    commit(true);
  });
  const sh = (): SheetConfig => (doc.sheet ??= {});
  const applySize = (): void => {
    const vb = sheetViewBox(sh().size, sh().orientation);
    if (!vb) return;
    for (const p of doc.pages) p.viewBox = vb;
    ctx.showCurrentPage();
  };
  root
    .querySelector<HTMLSelectElement>('#p-sheet-size')
    ?.addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value;
      if (v === 'custom') delete sh().size;
      else sh().size = v as SheetConfig['size'];
      applySize();
      commit();
    });
  root
    .querySelector<HTMLSelectElement>('#p-sheet-orient')
    ?.addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value;
      if (v === 'portrait') sh().orientation = 'portrait';
      else delete sh().orientation;
      applySize();
      commit();
    });
  const bool = (id: string, key: 'border' | 'title'): void => {
    root
      .querySelector<HTMLInputElement>(id)
      ?.addEventListener('change', (e) => {
        if ((e.target as HTMLInputElement).checked) delete sh()[key];
        else sh()[key] = false;
        commit();
      });
  };
  bool('#p-sheet-border', 'border');
  bool('#p-sheet-title', 'title');
  root
    .querySelector<HTMLInputElement>('#p-sheet-tb')
    ?.addEventListener('change', (e) => {
      const tb = { ...(sh().titleBlock ?? {}) };
      if ((e.target as HTMLInputElement).checked) delete tb.show;
      else tb.show = false;
      sh().titleBlock = tb;
      commit(true);
    });
  root
    .querySelector<HTMLInputElement>('#p-sheet-sub')
    ?.addEventListener('input', (e) => {
      const tb = { ...(sh().titleBlock ?? {}) };
      const v = (e.target as HTMLInputElement).value;
      if (v.trim()) tb.subtitle = v;
      else delete tb.subtitle;
      sh().titleBlock = tb;
      commit();
    });
  root.querySelectorAll<HTMLInputElement>('.p-sheet-field').forEach((inp) =>
    inp.addEventListener('input', () => {
      const tb = { ...(sh().titleBlock ?? {}) };
      const label = inp.dataset.label!;
      const fields = (tb.fields ?? []).filter(
        (f) => f.label.toLowerCase() !== label.toLowerCase(),
      );
      if (inp.value.trim()) fields.push({ label, value: inp.value });
      // Keep the canonical order so the block reads Drawn by / Revision / Date.
      const order = ['drawn by', 'revision', 'date'];
      fields.sort(
        (a, b) =>
          (order.indexOf(a.label.toLowerCase()) + 1 || 99) -
          (order.indexOf(b.label.toLowerCase()) + 1 || 99),
      );
      if (fields.length) tb.fields = fields;
      else delete tb.fields;
      sh().titleBlock = tb;
      commit();
    }),
  );
  root
    .querySelector<HTMLInputElement>('#p-sheet-logo')
    ?.addEventListener('change', (e) => {
      const tb = { ...(sh().titleBlock ?? {}) };
      const v = (e.target as HTMLInputElement).value.trim();
      if (/^https:\/\//i.test(v)) tb.logoHref = v;
      else delete tb.logoHref;
      sh().titleBlock = tb;
      commit();
    });
}

/** The Layers controls (B.3): eye, opacity, + Layer. */
function wireLayers(ctx: InspectorContext): void {
  const { root, doc, editor } = ctx;
  const layers = doc.layers ?? [];
  root.querySelectorAll<HTMLButtonElement>('.layer-eye').forEach((btn) => {
    btn.addEventListener('click', () => {
      const l = layers[Number(btn.dataset.li)];
      if (!l) return;
      l.defaultVisible = l.defaultVisible === false; // toggle (default = visible)
      editor.rerender();
      ctx.rerender(); // refresh the eye glyph
      ctx.markDirty();
    });
  });
  root.querySelectorAll<HTMLInputElement>('.layer-op').forEach((slider) => {
    slider.addEventListener('input', () => {
      const l = layers[Number(slider.dataset.li)];
      if (!l) return;
      l.opacity = Math.max(0, Math.min(1, Number(slider.value) / 100));
      editor.rerender();
      ctx.markDirty();
    });
  });
  root.querySelector('#p-layer-add')?.addEventListener('click', () => {
    const n = (doc.layers ?? []).length + 1;
    const KINDS = ['underlay', 'overlay', 'policy', 'service'] as const;
    doc.layers = [
      ...(doc.layers ?? []),
      {
        id: `layer${n}`,
        name: `Layer ${n}`,
        kind: KINDS[(n - 1) % KINDS.length],
        defaultVisible: true,
      },
    ];
    editor.rerender();
    ctx.rerender();
    ctx.markDirty();
  });
}
