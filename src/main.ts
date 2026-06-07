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

// Restore the last session from localStorage, else start from the sample.
const doc: TopologyDocument = loadLocal() ?? sampleDocument();
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
  current = 0;
  editor.setPage(doc.pages[current]!);
  renderFilmstrip();
  markDirty();
}

/* File actions: new / save (download) / open (upload). */
app.querySelector('#fNew')?.addEventListener('click', () => {
  if (!confirm('Start a new document? Unsaved changes to this one are lost.'))
    return;
  loadDoc({ title: 'Untitled', pages: [blankPage('Frame 1')] });
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
const LINK_TYPES = [
  'line',
  'tunnel',
  'wireguard',
  'flow',
  'wifi',
  'poe',
  'optical',
  'blocked',
  'packet',
];
const NODE_TYPE_OPTS = [
  'ec',
  'router',
  'switch',
  'firewall',
  'server',
  'database',
  'host',
  'cloud',
  'saas',
  'connector',
  'apps',
  'ap',
  'text',
];

// One snapshot per edit "session": reset on each focus into the inspector.
let editing = false;
inspector.addEventListener('focusin', () => (editing = false));

function swatchRow(current: string | undefined): string {
  return (
    `<div class="swatches">` +
    SWATCHES.map(
      (c) =>
        `<button class="sw ${c === current ? 'on' : ''}" data-color="${c}" style="background:${c}"></button>`,
    ).join('') +
    `</div>`
  );
}

function options(list: string[], current: string): string {
  return list
    .map(
      (t) =>
        `<option value="${t}" ${t === current ? 'selected' : ''}>${t}</option>`,
    )
    .join('');
}

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
    inspector.innerHTML = `
      <div class="insp-h">Node</div>
      <label class="insp-row">Label<input id="i-label" value="${esc(String(node.label ?? ''))}"/></label>
      <label class="insp-row">Sublabel<input id="i-sub" value="${esc(String(node.sublabel ?? ''))}"/></label>
      <label class="insp-row">Type<select id="i-type">${options(NODE_TYPE_OPTS.includes(node.type) ? NODE_TYPE_OPTS : [node.type, ...NODE_TYPE_OPTS], node.type)}</select></label>
      <div class="insp-row col">Color${swatchRow(node.color)}<input id="i-color" class="hex" value="${esc(String(node.color ?? ''))}" placeholder="#rrggbb"/></div>
    `;
    bindText('#i-label', (v) => editor.updateNode({ label: v }, !editing));
    bindText('#i-sub', (v) => editor.updateNode({ sublabel: v }, !editing));
    bindSelect('#i-type', (v) => editor.updateNode({ type: v }));
    bindSwatches((c) => editor.updateNode({ color: c }));
    bindHex('#i-color', (v) => editor.updateNode({ color: v }));
  } else if (link) {
    inspector.innerHTML = `
      <div class="insp-h">Link</div>
      <label class="insp-row">Label<input id="i-label" value="${esc(String(link.label ?? ''))}"/></label>
      <label class="insp-row">Type<select id="i-type">${options(LINK_TYPES.includes(link.type) ? LINK_TYPES : [link.type, ...LINK_TYPES], link.type)}</select></label>
      <label class="insp-row">Route<select id="i-route">${options(['straight', 'orthogonal', 'curved'], (link.lineStyle as string) ?? 'straight')}</select></label>
      <div class="insp-row col">Color${swatchRow(link.color)}<input id="i-color" class="hex" value="${esc(String(link.color ?? ''))}" placeholder="#rrggbb"/></div>
    `;
    bindText('#i-label', (v) => editor.updateLink({ label: v }, !editing));
    bindSelect('#i-type', (v) => editor.updateLink({ type: v }));
    bindSelect('#i-route', (v) =>
      editor.updateLink({
        lineStyle:
          v === 'straight' ? undefined : (v as 'orthogonal' | 'curved'),
      }),
    );
    bindSwatches((c) => editor.updateLink({ color: c }));
    bindHex('#i-color', (v) => editor.updateLink({ color: v }));
  }
}

function bindText(sel: string, set: (v: string) => void): void {
  inspector
    .querySelector<HTMLInputElement>(sel)
    ?.addEventListener('input', (e) => {
      set((e.target as HTMLInputElement).value);
      editing = true;
    });
}
function bindSelect(sel: string, set: (v: string) => void): void {
  inspector
    .querySelector<HTMLSelectElement>(sel)
    ?.addEventListener('change', (e) =>
      set((e.target as HTMLSelectElement).value),
    );
}
function bindHex(sel: string, set: (v: string) => void): void {
  inspector
    .querySelector<HTMLInputElement>(sel)
    ?.addEventListener('change', (e) =>
      set((e.target as HTMLInputElement).value),
    );
}
function bindSwatches(set: (c: string) => void): void {
  inspector.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((b) =>
    b.addEventListener('click', () => {
      set(b.dataset.color!);
      renderInspector();
    }),
  );
}

/* Node palette — click a type to add it at the view center, then drag to place. */
const PALETTE: { type: string; label: string }[] = [
  { type: 'ec', label: 'EdgeConnect' },
  { type: 'router', label: 'Router' },
  { type: 'switch', label: 'Switch' },
  { type: 'firewall', label: 'Firewall' },
  { type: 'server', label: 'Server' },
  { type: 'database', label: 'Database' },
  { type: 'host', label: 'Host' },
  { type: 'cloud', label: 'Cloud' },
  { type: 'saas', label: 'SaaS' },
  { type: 'connector', label: 'Connector' },
  { type: 'apps', label: 'Apps' },
  { type: 'ap', label: 'Access Pt' },
  { type: 'text', label: 'Text' },
];
const palette = app.querySelector<HTMLElement>('#palette')!;
palette.innerHTML =
  `<div class="palette-h">Add node</div>` +
  PALETTE.map(
    (p) =>
      `<button class="pitem" data-type="${p.type}">${esc(p.label)}</button>`,
  ).join('');
palette
  .querySelectorAll<HTMLButtonElement>('[data-type]')
  .forEach((b) =>
    b.addEventListener('click', () => editor.addNode(b.dataset.type!)),
  );

function renderFilmstrip(): void {
  strip.innerHTML = `
    ${doc.pages
      .map(
        (p, i) => `
      <button class="frame ${i === current ? 'on' : ''}" data-page="${i}" title="${esc(p.name)}">
        <span class="frame-n">${i + 1}</span>
        <span class="frame-name">${esc(p.name)}</span>
      </button>`,
      )
      .join('')}
    <button class="frame add" id="dupPage" title="Duplicate current frame">⧉ duplicate</button>
    <button class="frame add" id="addPage" title="Add blank frame">＋ frame</button>
  `;

  strip
    .querySelectorAll<HTMLButtonElement>('[data-page]')
    .forEach((b) =>
      b.addEventListener('click', () => selectPage(Number(b.dataset.page))),
    );
  strip.querySelector('#addPage')?.addEventListener('click', () => {
    doc.pages.push(blankPage(`Frame ${doc.pages.length + 1}`));
    selectPage(doc.pages.length - 1);
    markDirty();
  });
  strip.querySelector('#dupPage')?.addEventListener('click', () => {
    doc.pages.splice(
      current + 1,
      0,
      duplicatePage(doc.pages[current]!, `Frame ${doc.pages.length + 1}`),
    );
    selectPage(current + 1);
    markDirty();
  });
}

function selectPage(i: number): void {
  if (i < 0 || i >= doc.pages.length) return;
  current = i;
  editor.setPage(doc.pages[current]!);
  renderFilmstrip();
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
