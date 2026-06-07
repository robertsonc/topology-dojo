/**
 * Topology Dojo — flipbook editor shell.
 *
 * The shell (header, stage, filmstrip) is built once; the Editor owns the canvas
 * (art + interaction overlay) and the filmstrip is re-rendered on page changes.
 */
// Self-hosted JetBrains Mono (bundled by Vite — no external font fetch at runtime).
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';
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
import { genId } from './api/builder.js';
import {
  getAnnotationType,
  getLinkType,
  getNodeType,
  linkCatalog,
  nodeCatalog,
  type AnnotationKind,
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
      <button class="tbtn" id="tCalm" title="Calm canvas — pause animations (C)">◓ calm</button>
      <button class="tbtn" id="tDelete" title="Delete selection (Del)">🗑 delete</button>
      <button class="tbtn" id="tTidy" title="Tidy layout — grid-snap + de-overlap (T)">✦ tidy</button>
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
  inspector.hidden = false;

  let html = '';
  if (node) {
    const info = getNodeType(node.type, doc.customNodes);
    const types = nodeCatalog(doc.customNodes).map((n) => n.type);
    html +=
      `<div class="insp-h">Node</div>` +
      typeRow(node.type, types) +
      fieldsHtml(info, node as Record<string, unknown>);
  } else if (link) {
    const info = getLinkType(link.type);
    const types = linkCatalog().map((l) => l.type);
    html +=
      `<div class="insp-h">Link</div>` +
      typeRow(link.type, types) +
      fieldsHtml(info, link as Record<string, unknown>);
  }
  html += annotationsHtml();
  inspector.innerHTML = html;

  if (node) {
    wireType((t) => {
      editor.updateNode({ type: t });
      renderInspector();
    });
    wireFields((key, val, commit) =>
      editor.updateNode({ [key]: val } as Record<string, unknown>, commit),
    );
  } else if (link) {
    wireType((t) => {
      editor.updateLink({ type: t });
      renderInspector();
    });
    wireFields((key, val, commit) =>
      editor.updateLink({ [key]: val } as Record<string, unknown>, commit),
    );
  }
  wireAnnotations();
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

/* ── Annotations (zones / flow paths / policy markers) ──────────────
 * A page-level layer, edited from the same inspector. "Add" seeds the new
 * element from the current node selection (members / waypoints / target). */
const ANNO_GROUPS: { kind: AnnotationKind; col: AnnoCol }[] = [
  { kind: 'zone', col: 'zones' },
  { kind: 'flowPath', col: 'flowPaths' },
  { kind: 'policyMarker', col: 'policyMarkers' },
];
type AnnoCol = 'zones' | 'flowPaths' | 'policyMarkers';

function aswatchRow(key: string, current: string | undefined): string {
  return (
    `<div class="swatches" data-aswatch="${key}">` +
    SWATCHES.map(
      (c) =>
        `<button class="sw ${c === current ? 'on' : ''}" data-color="${c}" style="background:${c}"></button>`,
    ).join('') +
    `</div>`
  );
}

/** A control for one annotation field (distinct attrs so node wiring won't grab it). */
function annoFieldControl(f: FieldSpec, cfg: Record<string, unknown>): string {
  const v = cfg[f.key];
  const req = f.required ? ' *' : '';
  switch (f.kind) {
    case 'enum':
      return `<label class="insp-row">${f.label}${req}<select data-akey="${f.key}">${(
        f.options ?? []
      )
        .map(
          (o) =>
            `<option value="${o}" ${String(v ?? '') === o ? 'selected' : ''}>${o}</option>`,
        )
        .join('')}</select></label>`;
    case 'color':
      return `<div class="insp-row col">${f.label}${aswatchRow(f.key, v as string | undefined)}<input class="hex" data-akey="${f.key}" data-akind="color" value="${esc(String(v ?? ''))}" placeholder="#rrggbb"/></div>`;
    case 'number':
      return `<label class="insp-row">${f.label}<input type="number" data-akey="${f.key}" data-akind="number" value="${esc(String(v ?? ''))}"/></label>`;
    case 'refs':
      return `<label class="insp-row col">${f.label}${req}<input data-akey="${f.key}" data-akind="refs" value="${esc(Array.isArray(v) ? v.join(' ') : '')}" placeholder="space-separated ids"/></label>`;
    case 'ref':
      return `<label class="insp-row">${f.label}${req}<input data-akey="${f.key}" value="${esc(String(v ?? ''))}" placeholder="id"/></label>`;
    default:
      return `<label class="insp-row">${f.label}<input data-akey="${f.key}" value="${esc(String(v ?? ''))}"/></label>`;
  }
}

function annotationsHtml(): string {
  const page = editor.page;
  const counts =
    page.zones.length + page.flowPaths.length + page.policyMarkers.length;
  let html =
    `<div class="insp-h anno-top">Annotations</div>` +
    `<div class="anno-add">` +
    `<button class="tbtn" data-add="zone" title="Group selected nodes into a zone">＋ zone</button>` +
    `<button class="tbtn" data-add="flowPath" title="Route a flow path through selected nodes">＋ flow</button>` +
    `<button class="tbtn" data-add="policyMarker" title="Badge the selected node">＋ marker</button>` +
    `</div>`;
  if (counts === 0)
    html += `<div class="muted anno-empty">Select node(s), then add a zone, flow path, or marker.</div>`;
  for (const g of ANNO_GROUPS) {
    const info = getAnnotationType(g.kind)!;
    for (const item of page[g.col] as { id: string }[]) {
      const cfg = item as Record<string, unknown>;
      const title = String(cfg.label ?? cfg.type ?? item.id);
      html +=
        `<details class="anno" data-acol="${g.col}" data-aid="${esc(item.id)}">` +
        `<summary><span class="anno-k">${info.label}</span><span class="anno-t">${esc(title)}</span><button class="anno-x" data-adel title="Delete">✕</button></summary>` +
        info.fields.map((f) => annoFieldControl(f, cfg)).join('') +
        `</details>`;
    }
  }
  return html;
}

function addAnnotation(kind: AnnotationKind): void {
  const sel = editor.selectedNodeIds();
  if (kind === 'zone') {
    editor.addZone({
      id: genId('z'),
      label: 'Zone',
      nodes: sel,
      color: '#65aef9',
    });
  } else if (kind === 'flowPath') {
    editor.addFlowPath({
      id: genId('fp'),
      label: 'Flow',
      waypoints: sel,
      color: '#01a982',
      animation: 'particles',
      speed: 'medium',
    });
  } else {
    const nodeId = sel[0];
    if (!nodeId) {
      alert('Select a node first to attach a policy marker.');
      return;
    }
    editor.addPolicyMarker({
      id: genId('pm'),
      nodeId,
      type: 'inspect',
      align: 'NE',
      color: '#65aef9',
    });
  }
  renderInspector();
}

function wireAnnotations(): void {
  inspector
    .querySelectorAll<HTMLButtonElement>('[data-add]')
    .forEach((b) =>
      b.addEventListener('click', () =>
        addAnnotation(b.dataset.add as AnnotationKind),
      ),
    );
  inspector.querySelectorAll<HTMLButtonElement>('[data-adel]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.preventDefault();
      const host = b.closest<HTMLElement>('[data-aid]')!;
      editor.removeAnnotation(host.dataset.acol as AnnoCol, host.dataset.aid!);
      renderInspector();
    }),
  );
  inspector.querySelectorAll<HTMLElement>('details.anno').forEach((host) => {
    const col = host.dataset.acol as AnnoCol;
    const id = host.dataset.aid!;
    const setA = (key: string, val: unknown, commit: boolean): void =>
      editor.updateAnnotation(col, id, { [key]: val }, commit);
    host
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-akey]')
      .forEach((el) => {
        const key = el.dataset.akey!;
        if (el instanceof HTMLSelectElement) {
          el.addEventListener('change', () => setA(key, el.value, true));
        } else {
          const kind = el.dataset.akind;
          el.addEventListener('input', () => {
            let val: unknown = el.value;
            if (kind === 'number') val = Number(el.value);
            else if (kind === 'refs')
              val = el.value.split(/[\s,]+/).filter(Boolean);
            setA(key, val, !editing);
            editing = true;
          });
        }
      });
    host.querySelectorAll<HTMLElement>('[data-aswatch]').forEach((group) => {
      const key = group.dataset.aswatch!;
      group.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((b) =>
        b.addEventListener('click', () => {
          setA(key, b.dataset.color!, true);
          renderInspector();
        }),
      );
    });
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

/* Calm canvas — pause animations (glow/particles) for a quieter editing view.
 * A view preference (not document data), persisted across sessions. */
const calmBtn = app.querySelector<HTMLButtonElement>('#tCalm')!;
const CALM_KEY = 'topology-dojo:calm';
function applyCalm(on: boolean): void {
  editor.setCalm(on);
  calmBtn.classList.toggle('on', on);
  try {
    localStorage.setItem(CALM_KEY, on ? '1' : '0');
  } catch {
    // storage unavailable — non-fatal
  }
}
applyCalm(localStorage.getItem(CALM_KEY) === '1');
calmBtn.addEventListener('click', () => applyCalm(!editor.calm));

app
  .querySelector('#tDelete')
  ?.addEventListener('click', () => editor.deleteSelected());
app.querySelector('#tTidy')?.addEventListener('click', () => editor.tidy());
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
  if (e.key === 'c' || e.key === 'C') applyCalm(!editor.calm);
  if (e.key === 't' || e.key === 'T') editor.tidy();
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
renderInspector();
