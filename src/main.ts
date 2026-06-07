/**
 * Topology Dojo — flipbook editor shell.
 *
 * The shell (header, stage, filmstrip) is built once; the Editor owns the canvas
 * (art + interaction overlay) and the filmstrip is re-rendered on page changes.
 */
import { Editor } from './editor/editor.js';
import {
  blankPage,
  duplicatePage,
  sampleDocument,
  type TopologyDocument,
} from './pages/model.js';
import {
  loadLocal,
  parseDoc,
  saveLocal,
  serializeDoc,
} from './pages/persist.js';
import { registerCustomNode, registerCustomNodes } from './nodes/render.js';
import { openNodeDesigner } from './nodes/designer.js';
import type { CustomNodeSpec } from './nodes/spec.js';
import { validateDocument } from './api/validate.js';
import {
  getLinkType,
  getNodeType,
  linkCatalog,
  nodeCatalog,
  type FieldSpec,
  type LinkTypeInfo,
  type NodeTypeInfo,
} from './api/catalog.js';

// Restore the last session from localStorage, else start from the sample.
const doc: TopologyDocument = loadLocal() ?? sampleDocument();
// Register the document's custom node types with the engine before any render.
registerCustomNodes(doc.customNodes);
let current = 0;

const app = document.getElementById('app')!;

app.innerHTML = `
  <header class="bar">
    <div class="brand">
      Topology Dojo
      <button class="tbtn file" id="fNew" title="New document">new</button>
      <button class="tbtn file" id="fSave" title="Download as JSON">save</button>
      <button class="tbtn file" id="fOpen" title="Open a JSON file">open</button>
      <input type="file" id="fInput" accept="application/json,.json" hidden />
      <span class="saved" id="saved"></span>
    </div>
    <div class="bar-actions">
      <button class="tbtn on" id="tSelect" title="Select/move tool (V)">⤧ select</button>
      <button class="tbtn" id="tLink" title="Draw link tool (L)">🔗 link</button>
      <button class="tbtn on" id="tGrid" title="Toggle grid (R)">▦ grid</button>
      <button class="tbtn on" id="tSnap" title="Toggle snap (G)">⌗ snap</button>
      <button class="tbtn" id="tDelete" title="Delete selection (Del)">🗑 delete</button>
      <button class="tbtn" id="tFit" title="Fit view (0)">⤢ fit</button>
      <span class="align-group" id="alignGroup" hidden>
        <button class="tbtn ab" data-align="left" title="Align left">⇤</button>
        <button class="tbtn ab" data-align="centerH" title="Align centers (h)">⇔</button>
        <button class="tbtn ab" data-align="right" title="Align right">⇥</button>
        <button class="tbtn ab" data-align="top" title="Align top">⤒</button>
        <button class="tbtn ab" data-align="middleV" title="Align middles (v)">⇕</button>
        <button class="tbtn ab" data-align="bottom" title="Align bottom">⤓</button>
        <button class="tbtn ab" data-dist="h" title="Distribute horizontally" disabled>↔̲</button>
        <button class="tbtn ab" data-dist="v" title="Distribute vertically" disabled>↕̲</button>
      </span>
      <span class="hint">click/shift/box select · drag move · wheel zoom · middle-drag pan · ←/→ flip</span>
    </div>
  </header>

  <div class="stage">
    <aside class="palette" id="palette"></aside>
    <div class="tds-root">
      <div class="tds-canvas-row">
        <div class="tds-canvas canvas-host">
          <svg id="page-canvas" preserveAspectRatio="xMidYMid meet"></svg>
          <svg id="overlay" class="overlay" preserveAspectRatio="xMidYMid meet"></svg>
        </div>
      </div>
    </div>
    <aside class="inspector" id="inspector" hidden></aside>
  </div>

  <footer class="filmstrip" id="filmstrip"></footer>
`;

const artSvg = app.querySelector<SVGSVGElement>('#page-canvas')!;
const overlaySvg = app.querySelector<SVGSVGElement>('#overlay')!;
const strip = app.querySelector<HTMLElement>('#filmstrip')!;
const savedEl = app.querySelector<HTMLElement>('#saved')!;

/* Autosave to localStorage (debounced) whenever the document changes. */
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function markDirty(): void {
  savedEl.textContent = '…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveLocal(doc);
    savedEl.textContent = '✓ saved';
  }, 400);
}
function onDocChange(): void {
  renderFilmstrip();
  markDirty();
}

const editor = new Editor(
  artSvg,
  overlaySvg,
  doc.pages[current]!,
  onDocChange,
  onSelectionChange,
  onLinkSelectChange,
);

/* Replace the whole document (open / new) and refresh everything. */
function loadDoc(next: TopologyDocument): void {
  doc.title = next.title;
  doc.pages = next.pages;
  doc.customNodes = next.customNodes;
  registerCustomNodes(doc.customNodes);
  current = 0;
  buildPalette();
  editor.setPage(doc.pages[current]!);
  renderFilmstrip();
  markDirty();
}

/* File actions: new / save (download) / open (upload). */
app.querySelector('#fNew')?.addEventListener('click', () => {
  if (!confirm('Start a new document? Unsaved changes to this one are lost.'))
    return;
  loadDoc({
    title: 'Untitled',
    pages: [blankPage('Frame 1')],
    customNodes: [],
  });
});
app.querySelector('#fSave')?.addEventListener('click', () => {
  const blob = new Blob([serializeDoc(doc)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(doc.title || 'topology').replace(/[^\w.-]+/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
});
const fileInput = app.querySelector<HTMLInputElement>('#fInput')!;
app.querySelector('#fOpen')?.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  const parsed = parseDoc(await file.text());
  if (!parsed) {
    alert('That file is not a valid Topology Dojo document.');
    return;
  }
  const errors = validateDocument(parsed).filter((p) => p.level === 'error');
  if (errors.length) {
    alert(
      `Loaded with ${errors.length} issue(s):\n` +
        errors
          .slice(0, 8)
          .map((p) => `• ${p.where}: ${p.message}`)
          .join('\n'),
    );
  }
  loadDoc(parsed);
});

/* Tool toggle (select / link) */
const selectBtn = app.querySelector<HTMLButtonElement>('#tSelect')!;
const linkBtn = app.querySelector<HTMLButtonElement>('#tLink')!;
function setTool(t: 'select' | 'link'): void {
  editor.setTool(t);
  selectBtn.classList.toggle('on', t === 'select');
  linkBtn.classList.toggle('on', t === 'link');
}
selectBtn.addEventListener('click', () => setTool('select'));
linkBtn.addEventListener('click', () => setTool('link'));

/* Inspector — properties of the single selected node or link. */
const inspector = app.querySelector<HTMLElement>('#inspector')!;
function onLinkSelectChange(_linkId: string | null): void {
  renderInspector();
}

/* Align/distribute toolbar — shown when 2+ nodes are selected. */
const alignGroup = app.querySelector<HTMLElement>('#alignGroup')!;
function onSelectionChange(count: number): void {
  alignGroup.hidden = count < 2;
  alignGroup
    .querySelectorAll<HTMLButtonElement>('[data-dist]')
    .forEach((b) => (b.disabled = count < 3));
  renderInspector();
}
alignGroup
  .querySelectorAll<HTMLButtonElement>('[data-align]')
  .forEach((b) =>
    b.addEventListener('click', () =>
      editor.alignSelection(
        b.dataset.align as
          | 'left'
          | 'centerH'
          | 'right'
          | 'top'
          | 'middleV'
          | 'bottom',
      ),
    ),
  );
alignGroup
  .querySelectorAll<HTMLButtonElement>('[data-dist]')
  .forEach((b) =>
    b.addEventListener('click', () =>
      editor.distributeSelection(b.dataset.dist as 'h' | 'v'),
    ),
  );

/* ── Inspector ──────────────────────────────────────────────────── */
const SWATCHES = [
  '#01a982',
  '#05cc93',
  '#65aef9',
  '#7764fc',
  '#deb146',
  '#fc6161',
  '#00a4b3',
  '#d25f4b',
  '#b1b9be',
];

// One snapshot per edit "session": reset on each focus into the inspector.
let editing = false;
inspector.addEventListener('focusin', () => (editing = false));

function swatchRow(key: string, current: string | undefined): string {
  return (
    `<div class="swatches" data-swatch="${key}">` +
    SWATCHES.map(
      (c) =>
        `<button class="sw ${c === current ? 'on' : ''}" data-color="${c}" style="background:${c}"></button>`,
    ).join('') +
    `</div>`
  );
}

/** A control for one catalog field, bound to the element's current value. */
function fieldControl(f: FieldSpec, cfg: Record<string, unknown>): string {
  const v = cfg[f.key];
  switch (f.kind) {
    case 'boolean':
      return `<label class="insp-row"><span>${f.label}${f.animation ? ' ⟳' : ''}</span><input type="checkbox" data-key="${f.key}" ${v ? 'checked' : ''}/></label>`;
    case 'enum':
      return `<label class="insp-row">${f.label}<select data-key="${f.key}">${(
        f.options ?? []
      )
        .map(
          (o) =>
            `<option value="${o}" ${String(v ?? '') === o ? 'selected' : ''}>${o}</option>`,
        )
        .join('')}</select></label>`;
    case 'color':
      return `<div class="insp-row col">${f.label}${swatchRow(f.key, v as string | undefined)}<input class="hex" data-key="${f.key}" data-kind="color" value="${esc(String(v ?? ''))}" placeholder="#rrggbb"/></div>`;
    case 'number':
      return `<label class="insp-row">${f.label}<input type="number" data-key="${f.key}" data-kind="number" value="${esc(String(v ?? ''))}"/></label>`;
    case 'point':
    case 'points':
      return `<div class="insp-row"><span>${f.label}</span><span class="muted">${Array.isArray(v) ? v.length : 0} pt</span></div>`;
    default:
      return `<label class="insp-row">${f.label}<input data-key="${f.key}" value="${esc(String(v ?? ''))}"/></label>`;
  }
}

function typeRow(current: string, types: string[]): string {
  const opts = types.includes(current) ? types : [current, ...types];
  return `<label class="insp-row">Type<select id="i-type">${opts
    .map(
      (t) =>
        `<option value="${t}" ${t === current ? 'selected' : ''}>${t}</option>`,
    )
    .join('')}</select></label>`;
}

function fieldsHtml(
  info: NodeTypeInfo | LinkTypeInfo | undefined,
  cfg: Record<string, unknown>,
): string {
  return (info?.fields ?? []).map((f) => fieldControl(f, cfg)).join('');
}

/** Render the inspector for the current selection, driven entirely by the catalog. */
function renderInspector(): void {
  const link = editor.getSelectedLink();
  const node = link ? null : editor.getSelectedNode();
  if (!node && !link) {
    inspector.hidden = true;
    inspector.innerHTML = '';
    return;
  }
  inspector.hidden = false;

  if (node) {
    const info = getNodeType(node.type, doc.customNodes);
    const types = nodeCatalog(doc.customNodes).map((n) => n.type);
    inspector.innerHTML =
      `<div class="insp-h">Node</div>` +
      typeRow(node.type, types) +
      fieldsHtml(info, node as Record<string, unknown>);
    wireType((t) => {
      editor.updateNode({ type: t });
      renderInspector();
    });
    wireFields((key, val, commit) =>
      editor.updateNode({ [key]: val } as Record<string, unknown>, commit),
    );
  } else if (link) {
    const info = getLinkType(link.type);
    const types = linkCatalog().map((l) => l.type);
    inspector.innerHTML =
      `<div class="insp-h">Link</div>` +
      typeRow(link.type, types) +
      fieldsHtml(info, link as Record<string, unknown>);
    wireType((t) => {
      editor.updateLink({ type: t });
      renderInspector();
    });
    wireFields((key, val, commit) =>
      editor.updateLink({ [key]: val } as Record<string, unknown>, commit),
    );
  }
}

function wireType(onChange: (t: string) => void): void {
  inspector
    .querySelector<HTMLSelectElement>('#i-type')
    ?.addEventListener('change', (e) =>
      onChange((e.target as HTMLSelectElement).value),
    );
}

/** Wire every catalog-rendered field control to the given setter. */
function wireFields(
  set: (key: string, val: unknown, commit: boolean) => void,
): void {
  inspector
    .querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key]')
    .forEach((el) => {
      const key = el.dataset.key!;
      if (el instanceof HTMLSelectElement) {
        el.addEventListener('change', () => set(key, el.value, true));
      } else if (el.type === 'checkbox') {
        el.addEventListener('change', () => set(key, el.checked, true));
      } else {
        const num = el.dataset.kind === 'number';
        el.addEventListener('input', () => {
          set(key, num ? Number(el.value) : el.value, !editing);
          editing = true;
        });
      }
    });
  inspector.querySelectorAll<HTMLElement>('[data-swatch]').forEach((group) => {
    const key = group.dataset.swatch!;
    group.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((b) =>
      b.addEventListener('click', () => {
        set(key, b.dataset.color!, true);
        renderInspector();
      }),
    );
  });
}

/* Node palette — driven by the catalog; grouped by category. Click to add. */
const palette = app.querySelector<HTMLElement>('#palette')!;

/** Add or replace a custom node type, re-register it, and refresh the UI. */
function upsertCustomNode(spec: CustomNodeSpec): void {
  const i = doc.customNodes.findIndex((c) => c.typeName === spec.typeName);
  if (i >= 0) doc.customNodes[i] = spec;
  else doc.customNodes.push(spec);
  registerCustomNode(spec);
  buildPalette();
  editor.refresh(); // existing nodes of this type pick up the new render
  markDirty();
}

function buildPalette(): void {
  const byCat = new Map<string, NodeTypeInfo[]>();
  for (const info of nodeCatalog(doc.customNodes)) {
    const list = byCat.get(info.category) ?? [];
    list.push(info);
    byCat.set(info.category, list);
  }
  let html = '';
  for (const [cat, infos] of byCat) {
    html += `<div class="palette-h">${esc(cat)}</div>`;
    for (const info of infos) {
      html += info.custom
        ? `<div class="pcustom"><button class="pitem" data-type="${esc(info.type)}">${esc(info.label)}</button><button class="pedit" data-edit="${esc(info.type)}" title="Edit type">✎</button></div>`
        : `<button class="pitem" data-type="${esc(info.type)}">${esc(info.label)}</button>`;
    }
  }
  html += `<button class="pitem design" id="pDesign">＋ design node</button>`;
  palette.innerHTML = html;

  palette
    .querySelectorAll<HTMLButtonElement>('[data-type]')
    .forEach((b) =>
      b.addEventListener('click', () => editor.addNode(b.dataset.type!)),
    );
  palette.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => {
      const spec = doc.customNodes.find((c) => c.typeName === b.dataset.edit);
      if (spec) openNodeDesigner(spec, upsertCustomNode);
    }),
  );
  palette
    .querySelector('#pDesign')
    ?.addEventListener('click', () => openNodeDesigner(null, upsertCustomNode));
}
buildPalette();

let dragFrom = -1;

function renderFilmstrip(): void {
  const canDelete = doc.pages.length > 1;
  strip.innerHTML = `
    ${doc.pages
      .map(
        (p, i) => `
      <div class="frame ${i === current ? 'on' : ''}" data-page="${i}" draggable="true" title="${esc(p.name)} — double-click to rename, drag to reorder">
        <span class="frame-n">${i + 1}</span>
        <span class="frame-name" data-name="${i}">${esc(p.name)}</span>
        ${canDelete ? `<button class="frame-x" data-del="${i}" title="Delete frame">✕</button>` : ''}
      </div>`,
      )
      .join('')}
    <button class="frame add" id="dupPage" title="Duplicate current frame">⧉ duplicate</button>
    <button class="frame add" id="addPage" title="Add blank frame">＋ frame</button>
  `;

  strip.querySelectorAll<HTMLElement>('[data-page]').forEach((el) => {
    const i = Number(el.dataset.page);
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-del]') || t.tagName === 'INPUT') return;
      selectPage(i);
    });
    el.addEventListener('dragstart', (e) => {
      dragFrom = i;
      e.dataTransfer?.setData('text/plain', String(i));
    });
    el.addEventListener('dragover', (e) => e.preventDefault());
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      reorderPage(dragFrom, i);
    });
  });
  strip
    .querySelectorAll<HTMLElement>('[data-name]')
    .forEach((el) =>
      el.addEventListener('dblclick', () =>
        startRename(Number(el.dataset.name), el),
      ),
    );
  strip.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      deletePage(Number(b.dataset.del));
    }),
  );
  strip.querySelector('#addPage')?.addEventListener('click', () => {
    doc.pages.push(blankPage(`Frame ${doc.pages.length + 1}`));
    gotoPage(doc.pages.length - 1);
    markDirty();
  });
  strip.querySelector('#dupPage')?.addEventListener('click', () => {
    doc.pages.splice(
      current + 1,
      0,
      duplicatePage(doc.pages[current]!, `Frame ${doc.pages.length + 1}`),
    );
    gotoPage(current + 1);
    markDirty();
  });
}

/** Switch to a page AND rebuild the strip (after a structural change). */
function gotoPage(i: number): void {
  current = i;
  editor.setPage(doc.pages[current]!);
  renderFilmstrip();
}

function startRename(i: number, span: HTMLElement): void {
  const page = doc.pages[i];
  if (!page) return;
  const input = document.createElement('input');
  input.className = 'frame-rename';
  input.value = page.name;
  span.replaceWith(input);
  input.focus();
  input.select();
  const commit = (save: boolean): void => {
    if (save) page.name = input.value.trim() || page.name;
    renderFilmstrip();
    if (save) markDirty();
  };
  input.addEventListener('blur', () => commit(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    else if (e.key === 'Escape') commit(false);
  });
}

function deletePage(i: number): void {
  if (doc.pages.length <= 1) return;
  const page = doc.pages[i]!;
  const hasContent = page.nodes.length > 0 || page.links.length > 0;
  if (hasContent && !confirm(`Delete "${page.name}"? This frame has content.`))
    return;
  doc.pages.splice(i, 1);
  if (current >= doc.pages.length) current = doc.pages.length - 1;
  else if (i < current) current -= 1;
  editor.setPage(doc.pages[current]!);
  renderFilmstrip();
  markDirty();
}

function reorderPage(from: number, to: number): void {
  if (from < 0 || from === to || from >= doc.pages.length) return;
  const cur = doc.pages[current]!;
  const [moved] = doc.pages.splice(from, 1);
  doc.pages.splice(to, 0, moved!);
  current = doc.pages.indexOf(cur);
  renderFilmstrip();
  markDirty();
}

function selectPage(i: number): void {
  if (i < 0 || i >= doc.pages.length) return;
  current = i;
  editor.setPage(doc.pages[current]!);
  // Update highlight without rebuilding the strip (so dblclick-rename survives).
  strip
    .querySelectorAll<HTMLElement>('[data-page]')
    .forEach((el) => el.classList.toggle('on', Number(el.dataset.page) === i));
}

/* Toolbar */
const gridBtn = app.querySelector<HTMLButtonElement>('#tGrid')!;
const snapBtn = app.querySelector<HTMLButtonElement>('#tSnap')!;
gridBtn.addEventListener('click', () => {
  editor.toggleGrid();
  gridBtn.classList.toggle('on', editor.gridVisible);
});
snapBtn.addEventListener('click', () => {
  editor.toggleSnap();
  snapBtn.classList.toggle('on', editor.snap);
});
app
  .querySelector('#tDelete')
  ?.addEventListener('click', () => editor.deleteSelected());
app.querySelector('#tFit')?.addEventListener('click', () => editor.resetView());

/* Keyboard */
window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) editor.redo();
    else editor.undo();
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    editor.deleteSelected();
    return;
  }
  if (e.key === 'g' || e.key === 'G') {
    editor.toggleSnap();
    snapBtn.classList.toggle('on', editor.snap);
  }
  if (e.key === 'r' || e.key === 'R') {
    editor.toggleGrid();
    gridBtn.classList.toggle('on', editor.gridVisible);
  }
  if (e.key === '0') editor.resetView();
  if (e.key === 'l' || e.key === 'L') setTool('link');
  if (e.key === 'v' || e.key === 'V') setTool('select');
  if (e.key === 'Escape') {
    editor.clearSelection();
    setTool('select');
  }
  if (e.key === 'ArrowRight') selectPage(current + 1);
  if (e.key === 'ArrowLeft') selectPage(current - 1);
});

function esc(s: string): string {
  return s.replace(/[<>&"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;',
  );
}

renderFilmstrip();
