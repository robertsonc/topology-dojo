/**
 * Topology Dojo — flipbook editor shell.
 *
 * The shell (header, stage, filmstrip) is built once; the Editor owns the canvas
 * (art + interaction overlay) and the filmstrip is re-rendered on page changes.
 */
// Self-hosted JetBrains Mono (bundled by Vite — no external font fetch at runtime).
// Latin-only subset: the UI is latin, and the aggregate weight CSS ships six
// @font-face subsets (cyrillic/greek/vietnamese/…) per weight, bloating the
// deployed bundle 6x for glyphs this app never draws.
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import { Editor } from './editor/editor.js';
import { clientToUser } from './editor/coords.js';
import { engineDefs, renderPageSVG } from './vendor/topology-ds.js';
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
import { DEFAULT_PAGE_DURATION, pageDuration } from './pages/playback.js';
import { exportPagePNG, exportPageSVG } from './editor/export.js';
import { buildTemplate, listTemplates } from './api/templates.js';
import { registerCustomNode, registerCustomNodes } from './nodes/render.js';
import { STOCK_NODE_SPECS } from './nodes/stock.js';
import { openNodeDesigner } from './nodes/designer.js';
import type { CustomNodeSpec } from './nodes/spec.js';
import { validateDocument, type Problem } from './api/validate.js';
import { analyzeLayout } from './api/layout.js';
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
// Register the shipped cloud-native types, then the document's custom types,
// with the engine before any render.
registerCustomNodes(STOCK_NODE_SPECS);
registerCustomNodes(doc.customNodes);
let current = 0;

const app = document.getElementById('app')!;

app.innerHTML = `
  <header class="bar">
    <div class="bar-left">
      <span class="brand" title="Topology Dojo">
        <svg class="logo-mark" viewBox="0 0 32 32" width="26" height="26" aria-label="Topology Dojo" role="img">
          <path d="M16 5 L27 16 L16 27 L5 16 Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-opacity="0.45" stroke-linejoin="round"/>
          <circle cx="16" cy="5" r="2.5" fill="currentColor"/>
          <circle cx="27" cy="16" r="2.5" fill="currentColor"/>
          <circle cx="16" cy="27" r="2.5" fill="currentColor"/>
          <circle cx="5" cy="16" r="2.5" fill="currentColor"/>
          <circle cx="16" cy="16" r="4.2" fill="none" stroke="currentColor" stroke-width="1.5"/>
          <circle cx="16" cy="16" r="1.7" fill="currentColor"/>
        </svg>
        <span class="wordmark">topology<b>dojo</b></span>
      </span>
      <span class="bar-div"></span>
      <div class="tgroup">
        <button class="tbtn" id="fNew" title="New document">new</button>
        <button class="tbtn" id="fSave" title="Download as JSON">save</button>
        <button class="tbtn" id="fOpen" title="Open a JSON file">open</button>
      </div>
      <span class="bar-div"></span>
      <div class="tgroup">
        <button class="tbtn ticon" id="tUndo" title="Undo (Ctrl/Cmd+Z)">↶</button>
        <button class="tbtn ticon" id="tRedo" title="Redo (Ctrl/Cmd+Shift+Z)">↷</button>
      </div>
      <span class="bar-div"></span>
      <div class="tgroup">
        <button class="tbtn" id="fSvg" title="Export current frame as SVG">svg</button>
        <button class="tbtn" id="fPng" title="Export current frame as PNG">png</button>
        <select class="tbtn" id="fTemplate" title="New from a starter template"></select>
      </div>
      <input type="file" id="fInput" accept="application/json,.json" hidden />
      <span class="saved" id="saved"></span>
    </div>
    <div class="bar-right">
      <div class="tgroup">
        <button class="tbtn on" id="tSelect" title="Select/move tool (V)">⤧<span class="tlabel">select</span></button>
        <button class="tbtn" id="tLink" title="Draw link tool (L)">🔗<span class="tlabel">link</span></button>
        <button class="tbtn" id="tAnchor" title="Drop anchor tool (A) — free-floating link endpoints">◇<span class="tlabel">anchor</span></button>
      </div>
      <span class="bar-div"></span>
      <div class="tgroup">
        <button class="tbtn ticon on" id="tGrid" title="Toggle grid (R)">▦</button>
        <button class="tbtn ticon on" id="tSnap" title="Toggle snap (G)">⌗</button>
        <button class="tbtn ticon" id="tCalm" title="Calm canvas — pause animations (C)">◓</button>
        <button class="tbtn ticon" id="tTheme" title="Toggle light / dark theme">☀</button>
        <button class="tbtn ticon" id="tFit" title="Fit view (0)">⤢</button>
        <button class="tbtn ticon" id="tHelp" title="Keyboard shortcuts (?)">?</button>
      </div>
      <span class="bar-div"></span>
      <div class="tgroup">
        <button class="tbtn" id="tDelete" title="Delete selection (Del)">🗑<span class="tlabel">delete</span></button>
        <button class="tbtn" id="tTidy" title="Tidy layout — grid-snap + de-overlap (T)">✦<span class="tlabel">tidy</span></button>
        <select class="tbtn" id="tLayout" title="Auto-arrange with a layout algorithm">
          <option value="">⤢ arrange…</option>
          <option value="hierarchical">hierarchical</option>
          <option value="grid">grid</option>
          <option value="circular">circular</option>
          <option value="force">force-directed</option>
        </select>
        <select class="tbtn" id="tSelectBy" title="Select nodes by a criterion">
          <option value="">⛶ select…</option>
          <option value="type">same type</option>
          <option value="color">same color</option>
          <option value="connected">connected (grow)</option>
          <option value="invert">invert</option>
          <option value="all">all</option>
        </select>
      </div>
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
    </div>
  </header>

  <div class="stage">
    <aside class="palette" id="palette"></aside>
    <div class="tds-root">
      <div class="tds-canvas-row">
        <div class="tds-canvas canvas-host">
          <svg id="page-canvas" preserveAspectRatio="xMidYMid meet"></svg>
          <svg id="overlay" class="overlay" preserveAspectRatio="xMidYMid meet"></svg>
          <div class="canvas-ctrls" id="canvasCtrls">
            <button class="cc-btn" id="ccHand" title="Hand / pan tool (hold Space to pan anytime)">✋</button>
            <button class="cc-btn" id="ccZoomIn" title="Zoom in">+</button>
            <button class="cc-btn cc-zoom" id="ccZoom" title="Fit view (0)">100%</button>
            <button class="cc-btn" id="ccZoomOut" title="Zoom out">−</button>
            <button class="cc-btn" id="ccFit" title="Fit to content (0)">⤢</button>
          </div>
        </div>
      </div>
    </div>
    <div class="inspector-wrap" id="inspector-wrap">
      <button class="inspector-toggle" id="inspector-toggle" title="Hide properties (P)">hide ▸</button>
      <aside class="inspector" id="inspector"></aside>
    </div>
    <div class="minimap-wrap" id="minimap-wrap">
      <button class="minimap-toggle" id="minimap-toggle" title="Hide minimap (M)">hide ▾</button>
      <svg id="minimap" class="minimap" preserveAspectRatio="xMidYMid meet"></svg>
    </div>
    <div class="problems-wrap collapsed" id="problems-wrap">
      <button class="problems-toggle" id="problems-toggle" title="Show problems (validation + layout)">✓ ok</button>
      <div class="problems" id="problems"></div>
    </div>
  </div>

  <footer class="filmstrip" id="filmstrip"></footer>
  <footer class="statusbar" id="statusbar"></footer>
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
  renderStatus();
  renderMinimap();
  renderProblems();
  markDirty();
}

// Guards the status bar from rendering before `editor`/`statusbar` are set up
// (the Editor constructor fires onView during construction).
let statusReady = false;

const editor = new Editor(
  artSvg,
  overlaySvg,
  doc.pages[current]!,
  onDocChange,
  onSelectionChange,
  onLinkSelectChange,
  onAnchorSelectChange,
  () => {
    renderStatus();
    renderMinimap();
  },
);

/*
 * Tell the editor how much of the canvas the floating panels cover, so
 * fit-to-content frames the *visible* area and never tucks edge content behind
 * the inspector or minimap. Recomputed on each fit (panels collapse/expand).
 */
editor.setViewInsets(() => {
  const canvas = overlaySvg.getBoundingClientRect();
  let right = 0;
  let bottom = 0;
  const insp = document.getElementById('inspector-wrap');
  if (insp && !insp.classList.contains('collapsed')) {
    const r = insp.getBoundingClientRect();
    if (r.width > 0) right = Math.max(right, canvas.right - r.left + 12);
  }
  const mm = document.getElementById('minimap-wrap');
  if (mm && !mm.classList.contains('collapsed')) {
    const r = mm.getBoundingClientRect();
    if (r.height > 0) bottom = Math.max(bottom, canvas.bottom - r.top + 12);
  }
  // Never surrender more than ~60% of the canvas to a panel.
  return {
    right: Math.max(0, Math.min(right, canvas.width * 0.6)),
    bottom: Math.max(0, Math.min(bottom, canvas.height * 0.6)),
  };
});
// Initial fit once the canvas has real dimensions (constructor ran pre-layout).
requestAnimationFrame(() => editor.resetView());

/* Replace the whole document (open / new) and refresh everything. */
function loadDoc(next: TopologyDocument): void {
  doc.title = next.title;
  doc.pages = next.pages;
  doc.customNodes = next.customNodes;
  registerCustomNodes(doc.customNodes);
  invalidatePreview(); // custom types replaced — clear cached previews
  current = 0;
  buildPalette();
  editor.setPage(doc.pages[current]!);
  renderFilmstrip();
  renderProblems();
  markDirty();
}

/*
 * Share links: opening "/v/<id>" loads a topology published by the MCP
 * `share_topology` tool (a snapshot stored in KV, fetched via /api/topology).
 * We load it over whatever booted from localStorage, then drop the /v/<id> path
 * so a refresh doesn't refetch and further edits stay in this local session.
 */
const shareMatch = location.pathname.match(/^\/v\/([\w-]+)\/?$/);
if (shareMatch) {
  void (async () => {
    try {
      const res = await fetch(`/api/topology/${shareMatch[1]}`);
      if (!res.ok)
        throw new Error(
          res.status === 404
            ? 'That shared topology was not found (it may have expired).'
            : `Could not load the shared topology (HTTP ${res.status}).`,
        );
      const parsed = parseDoc(await res.json());
      if (!parsed) throw new Error('The shared topology was invalid.');
      loadDoc(parsed);
      history.replaceState({}, '', '/');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not load shared link.');
    }
  })();
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

/* Image export: SVG (vector, honors calm) and PNG (always a static raster). */
function exportBase(): string {
  const page = doc.pages[current]!;
  return `${(doc.title || 'topology').replace(/[^\w.-]+/g, '_')}_${(page.name || 'frame').replace(/[^\w.-]+/g, '_')}`;
}
app.querySelector('#fSvg')?.addEventListener('click', () => {
  exportPageSVG(`${exportBase()}.svg`, doc.pages[current]!, {
    calm: editor.calm,
  });
});
app.querySelector('#fPng')?.addEventListener('click', () => {
  void exportPagePNG(`${exportBase()}.png`, doc.pages[current]!, 2).catch(() =>
    alert('PNG export failed.'),
  );
});
/* New from a starter template. */
const templateSel = app.querySelector<HTMLSelectElement>('#fTemplate')!;
templateSel.innerHTML =
  `<option value="">＋ template…</option>` +
  listTemplates()
    .map(
      (t) =>
        `<option value="${t.id}" title="${esc(t.description)}">${esc(t.name)}</option>`,
    )
    .join('');
templateSel.addEventListener('change', () => {
  const id = templateSel.value;
  templateSel.value = '';
  if (!id) return;
  if (!confirm('Start from this template? Unsaved changes are lost.')) return;
  loadDoc(buildTemplate(id));
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
const anchorBtn = app.querySelector<HTMLButtonElement>('#tAnchor')!;
function setTool(t: 'select' | 'link' | 'anchor'): void {
  editor.setTool(t);
  if (editor.isHandActive()) setHand(false); // picking a tool exits Hand mode
  selectBtn.classList.toggle('on', t === 'select');
  linkBtn.classList.toggle('on', t === 'link');
  anchorBtn.classList.toggle('on', t === 'anchor');
  renderStatus();
}
selectBtn.addEventListener('click', () => setTool('select'));
linkBtn.addEventListener('click', () => setTool('link'));
anchorBtn.addEventListener('click', () => setTool('anchor'));

/* Undo / Redo buttons (mirror Ctrl/Cmd+Z) + History readout. */
const undoBtn = app.querySelector<HTMLButtonElement>('#tUndo')!;
const redoBtn = app.querySelector<HTMLButtonElement>('#tRedo')!;
undoBtn.addEventListener('click', () => editor.undo());
redoBtn.addEventListener('click', () => editor.redo());

/* On-canvas controls: hand/pan, zoom +/−, zoom %, fit. */
const handBtn = app.querySelector<HTMLButtonElement>('#ccHand')!;
const ccZoom = app.querySelector<HTMLButtonElement>('#ccZoom')!;
function setHand(on: boolean): void {
  editor.setHandTool(on);
  handBtn.classList.toggle('on', on);
}
handBtn.addEventListener('click', () => setHand(!editor.isHandActive()));
app
  .querySelector('#ccZoomIn')!
  .addEventListener('click', () => editor.zoomIn());
app
  .querySelector('#ccZoomOut')!
  .addEventListener('click', () => editor.zoomOut());
ccZoom.addEventListener('click', () => editor.resetView());
app
  .querySelector('#ccFit')!
  .addEventListener('click', () => editor.resetView());

/** Reflect undo/redo availability + live zoom % in the chrome. */
function refreshChrome(): void {
  undoBtn.disabled = !editor.canUndo();
  redoBtn.disabled = !editor.canRedo();
  ccZoom.textContent = `${Math.round(editor.zoom() * 100)}%`;
}

/* Select-by dropdown — select nodes by a criterion (resets to placeholder). */
const selectBySel = app.querySelector<HTMLSelectElement>('#tSelectBy')!;
selectBySel.addEventListener('change', () => {
  const mode = selectBySel.value;
  selectBySel.value = '';
  if (mode === 'type') editor.selectSameType();
  else if (mode === 'color') editor.selectSameColor();
  else if (mode === 'connected') editor.growConnected();
  else if (mode === 'invert') editor.invertSelection();
  else if (mode === 'all') editor.selectAll();
});

/* Status bar — live tool / cursor / element counts / zoom. */
const statusbar = app.querySelector<HTMLElement>('#statusbar')!;
let cursor: { x: number; y: number } | null = null;
function renderStatus(): void {
  if (!statusReady) return; // editor / statusbar not wired yet
  const p = editor.page;
  const sel = editor.selectionCount();
  const cur = cursor ? `${cursor.x}, ${cursor.y}` : '–';
  statusbar.innerHTML =
    `<span><span class="sb-k">tool</span> ${editor.tool}</span>` +
    `<span><span class="sb-k">x,y</span> ${cur}</span>` +
    `<span><span class="sb-k">nodes</span> ${p.nodes.length}</span>` +
    `<span><span class="sb-k">links</span> ${p.links.length}</span>` +
    `<span><span class="sb-k">anchors</span> ${p.anchors.length}</span>` +
    `<span><span class="sb-k">zones</span> ${p.zones.length}</span>` +
    `<span><span class="sb-k">selected</span> ${sel}</span>` +
    `<span><span class="sb-k">history</span> ${editor.historyDepth()}</span>` +
    `<span><span class="sb-k">zoom</span> ${Math.round(editor.zoom() * 100)}%</span>` +
    `<span class="sb-hint">drag move · wheel zoom · space/middle-drag pan · ? shortcuts</span>`;
  refreshChrome();
}
// Live cursor readout (page coordinates) while hovering the canvas.
overlaySvg.addEventListener('pointermove', (e) => {
  const u = clientToUser(overlaySvg, e.clientX, e.clientY);
  cursor = { x: Math.round(u.x), y: Math.round(u.y) };
  renderStatus();
});
overlaySvg.addEventListener('pointerleave', () => {
  cursor = null;
  renderStatus();
});

/* Minimap — page overview with a draggable view rectangle. */
const minimap = app.querySelector<SVGSVGElement>('#minimap')!;
const MM_W = 170;
const MM_H = 120;
/** The page viewBox parsed as [x, y, w, h]. */
function pageVB(): [number, number, number, number] {
  const [x, y, w, h] = editor.page.viewBox.split(/\s+/).map(Number);
  return [x || 0, y || 0, w || 1050, h || 700];
}
/** Fit transform from page coords into the minimap box. */
function minimapXform(): {
  s: number;
  ox: number;
  oy: number;
  px: number;
  py: number;
} {
  const [px, py, pw, ph] = pageVB();
  const pad = 6;
  const s = Math.min((MM_W - pad * 2) / pw, (MM_H - pad * 2) / ph);
  return { s, ox: (MM_W - pw * s) / 2, oy: (MM_H - ph * s) / 2, px, py };
}
function renderMinimap(): void {
  if (!statusReady) return;
  const p = editor.page;
  const [, , pw, ph] = pageVB();
  const { s, ox, oy, px, py } = minimapXform();
  const mx = (x: number): number => ox + (x - px) * s;
  const my = (y: number): number => oy + (y - py) * s;
  const dots = p.nodes
    .map(
      (n) =>
        `<circle cx="${mx(n.x)}" cy="${my(n.y)}" r="2" fill="${n.color || '#7d8a92'}"/>`,
    )
    .join('');
  const v = editor.getView();
  minimap.setAttribute('viewBox', `0 0 ${MM_W} ${MM_H}`);
  minimap.innerHTML =
    `<rect x="${ox}" y="${oy}" width="${pw * s}" height="${ph * s}" fill="none" stroke="#7d8a92" stroke-opacity="0.5" stroke-width="1"/>` +
    dots +
    `<rect x="${mx(v.x)}" y="${my(v.y)}" width="${v.w * s}" height="${v.h * s}" fill="#01a982" fill-opacity="0.12" stroke="#01a982" stroke-width="1.5"/>`;
}
// Click / drag the minimap to recenter the view there.
function minimapPanTo(e: PointerEvent): void {
  const r = minimap.getBoundingClientRect();
  const mmx = ((e.clientX - r.left) / r.width) * MM_W;
  const mmy = ((e.clientY - r.top) / r.height) * MM_H;
  const { s, ox, oy, px, py } = minimapXform();
  editor.panTo(px + (mmx - ox) / s, py + (mmy - oy) / s);
}
minimap.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  minimap.setPointerCapture(e.pointerId);
  minimapPanTo(e);
});
minimap.addEventListener('pointermove', (e) => {
  if (e.buttons === 1) minimapPanTo(e);
});

// Collapse / restore the minimap so it stops covering the inspector panel.
const minimapWrap = app.querySelector<HTMLDivElement>('#minimap-wrap')!;
const minimapToggle = app.querySelector<HTMLButtonElement>('#minimap-toggle')!;
function setMinimapCollapsed(collapsed: boolean): void {
  minimapWrap.classList.toggle('collapsed', collapsed);
  minimapToggle.textContent = collapsed ? 'map ▴' : 'hide ▾';
  minimapToggle.title = collapsed ? 'Show minimap (M)' : 'Hide minimap (M)';
  try {
    localStorage.setItem('tds-minimap-collapsed', collapsed ? '1' : '0');
  } catch {
    /* storage unavailable — fine, just don't persist */
  }
}
minimapToggle.addEventListener('click', () =>
  setMinimapCollapsed(!minimapWrap.classList.contains('collapsed')),
);
setMinimapCollapsed(localStorage.getItem('tds-minimap-collapsed') === '1');

/* Problems panel — runs the same checks as the MCP `validate_topology`
 * (semantic validation + layout analysis) live in the studio, so overlapping
 * zones, off-canvas nodes, dangling refs, etc. surface as you edit instead of
 * only at load time. Click a problem to jump to the node it references. */
const problemsWrap = app.querySelector<HTMLDivElement>('#problems-wrap')!;
const problemsToggle =
  app.querySelector<HTMLButtonElement>('#problems-toggle')!;
const problemsPanel = app.querySelector<HTMLDivElement>('#problems')!;

/** First quoted token in a problem that names a node on the current page. */
function problemNodeId(p: Problem): string | undefined {
  const ids = new Set(editor.page.nodes.map((n) => n.id));
  for (const m of `${p.where} ${p.message}`.matchAll(/"([^"]+)"/g))
    if (ids.has(m[1]!)) return m[1];
  return undefined;
}

function renderProblems(): void {
  if (!statusReady) return;
  const problems = [...validateDocument(doc), ...analyzeLayout(doc)];
  const errors = problems.filter((p) => p.level === 'error').length;
  const warnings = problems.length - errors;

  problemsWrap.classList.toggle('has-error', errors > 0);
  problemsWrap.classList.toggle('has-warn', errors === 0 && warnings > 0);
  problemsToggle.textContent = problems.length
    ? `⚠ ${errors ? `${errors} error${errors > 1 ? 's' : ''}` : ''}${errors && warnings ? ', ' : ''}${warnings ? `${warnings} warning${warnings > 1 ? 's' : ''}` : ''}`
    : '✓ ok';

  if (!problems.length) {
    problemsPanel.innerHTML = `<div class="prob-empty">No problems — validation and layout are clean.</div>`;
    return;
  }
  problemsPanel.innerHTML = problems
    .map((p, i) => {
      const nodeId = problemNodeId(p);
      return (
        `<button class="prob prob-${p.level}"${nodeId ? ` data-prob-node="${esc(nodeId)}"` : ''} data-i="${i}">` +
        `<span class="prob-dot"></span>` +
        `<span class="prob-msg">${esc(p.message)}<span class="prob-where">${esc(p.where)}</span></span>` +
        `</button>`
      );
    })
    .join('');
  problemsPanel
    .querySelectorAll<HTMLButtonElement>('[data-prob-node]')
    .forEach((b) =>
      b.addEventListener('click', () => editor.focusNode(b.dataset.probNode!)),
    );
}

function setProblemsCollapsed(collapsed: boolean): void {
  problemsWrap.classList.toggle('collapsed', collapsed);
  try {
    localStorage.setItem('tds-problems-collapsed', collapsed ? '1' : '0');
  } catch {
    /* storage unavailable — fine, just don't persist */
  }
}
problemsToggle.addEventListener('click', () =>
  setProblemsCollapsed(!problemsWrap.classList.contains('collapsed')),
);
setProblemsCollapsed(localStorage.getItem('tds-problems-collapsed') !== '0');

statusReady = true;
renderProblems();

/* Find / jump-to-element (Ctrl+F) — search nodes by label / id / type and jump. */
let findEl: HTMLDivElement | null = null;
let findMatches: { id: string; label: string; type: string }[] = [];
let findSel = 0;

function closeFind(): void {
  findEl?.remove();
  findEl = null;
}
function jumpFind(id: string): void {
  editor.focusNode(id);
  closeFind();
}
function renderFindResults(): void {
  const list = findEl?.querySelector<HTMLElement>('.find-results');
  if (!list) return;
  if (findMatches.length === 0) {
    list.innerHTML = `<div class="find-empty">No matching nodes</div>`;
    return;
  }
  list.innerHTML = findMatches
    .map(
      (m, i) =>
        `<div class="find-item ${i === findSel ? 'on' : ''}" data-id="${esc(m.id)}"><span>${esc(m.label)}</span><span class="fi-type">${esc(m.type)}</span></div>`,
    )
    .join('');
  list
    .querySelectorAll<HTMLElement>('.find-item')
    .forEach((el) =>
      el.addEventListener('click', () => jumpFind(el.dataset.id!)),
    );
}
function runFindQuery(q: string): void {
  const s = q.trim().toLowerCase();
  findMatches = editor.page.nodes
    .filter(
      (n) =>
        !s ||
        (n.label ?? '').toLowerCase().includes(s) ||
        n.id.toLowerCase().includes(s) ||
        n.type.toLowerCase().includes(s),
    )
    .slice(0, 50)
    .map((n) => ({ id: n.id, label: n.label || '(no label)', type: n.type }));
  findSel = 0;
  renderFindResults();
}
function openFind(): void {
  if (findEl) {
    findEl.querySelector('input')?.focus();
    return;
  }
  findEl = document.createElement('div');
  findEl.className = 'find';
  findEl.innerHTML =
    `<input type="text" placeholder="Find node by label / id / type…" />` +
    `<div class="find-results"></div>`;
  app.appendChild(findEl);
  const input = findEl.querySelector('input')!;
  input.addEventListener('input', () => runFindQuery(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeFind();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      findSel = Math.min(findMatches.length - 1, findSel + 1);
      renderFindResults();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      findSel = Math.max(0, findSel - 1);
      renderFindResults();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const m = findMatches[findSel];
      if (m) jumpFind(m.id);
    }
  });
  input.focus();
  runFindQuery('');
}

/* Inspector — properties of the single selected node, link, or anchor. */
const inspector = app.querySelector<HTMLElement>('#inspector')!;

/* Collapse / restore the properties panel (mirrors the minimap toggle). */
const inspectorWrap = app.querySelector<HTMLDivElement>('#inspector-wrap')!;
const inspectorToggle =
  app.querySelector<HTMLButtonElement>('#inspector-toggle')!;
function setInspectorCollapsed(collapsed: boolean): void {
  inspectorWrap.classList.toggle('collapsed', collapsed);
  inspectorToggle.textContent = collapsed ? 'props ◂' : 'hide ▸';
  inspectorToggle.title = collapsed
    ? 'Show properties (P)'
    : 'Hide properties (P)';
  try {
    localStorage.setItem('tds-inspector-collapsed', collapsed ? '1' : '0');
  } catch {
    /* storage unavailable — fine, just don't persist */
  }
}
inspectorToggle.addEventListener('click', () =>
  setInspectorCollapsed(!inspectorWrap.classList.contains('collapsed')),
);
setInspectorCollapsed(localStorage.getItem('tds-inspector-collapsed') === '1');
function onLinkSelectChange(_linkId: string | null): void {
  renderInspector();
}
function onAnchorSelectChange(_anchorId: string | null): void {
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
  renderStatus();
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
    case 'record':
      return ''; // rendered by the dedicated metadata editor
    default:
      return `<label class="insp-row">${f.label}<input data-key="${f.key}" value="${esc(String(v ?? ''))}"/></label>`;
  }
}

/** Node metadata key/value editor (serials, versions, hostnames, sites…). */
function metaHtml(meta?: Record<string, string | number | boolean>): string {
  const rows = Object.entries(meta ?? {})
    .map(
      ([k, v]) =>
        `<div class="meta-row" data-mk="${esc(k)}">` +
        `<input class="meta-k" value="${esc(k)}" readonly />` +
        `<input class="meta-v" value="${esc(String(v))}" />` +
        `<button class="meta-x" title="Remove">✕</button></div>`,
    )
    .join('');
  return (
    `<div class="insp-h meta-top">Metadata</div>` +
    rows +
    `<div class="meta-row meta-add">` +
    `<input class="meta-nk" placeholder="key" />` +
    `<input class="meta-nv" placeholder="value" />` +
    `<button class="meta-addbtn" title="Add">＋</button></div>`
  );
}

function wireMeta(_meta?: Record<string, string | number | boolean>): void {
  // Read live metadata each time so successive edits compose correctly.
  const cur = (): Record<string, string | number | boolean> => ({
    ...(editor.getSelectedNode()?.meta ?? {}),
  });
  inspector
    .querySelectorAll<HTMLElement>('.meta-row[data-mk]')
    .forEach((row) => {
      const key = row.dataset.mk!;
      const vIn = row.querySelector<HTMLInputElement>('.meta-v')!;
      vIn.addEventListener('input', () => {
        const next = cur();
        next[key] = vIn.value;
        editor.updateNode({ meta: next }, !editing);
        editing = true;
      });
      row
        .querySelector<HTMLButtonElement>('.meta-x')
        ?.addEventListener('click', () => {
          const next = cur();
          delete next[key];
          editor.updateNode({
            meta: Object.keys(next).length ? next : undefined,
          } as Record<string, unknown>);
          renderInspector();
        });
    });
  const addRow = inspector.querySelector<HTMLElement>('.meta-add');
  const add = (): void => {
    const k = addRow?.querySelector<HTMLInputElement>('.meta-nk')?.value.trim();
    const v = addRow?.querySelector<HTMLInputElement>('.meta-nv')?.value ?? '';
    if (!k) return;
    const next = cur();
    next[k] = v;
    editor.updateNode({ meta: next });
    renderInspector();
  };
  addRow
    ?.querySelector<HTMLButtonElement>('.meta-addbtn')
    ?.addEventListener('click', add);
  addRow?.querySelectorAll<HTMLInputElement>('input').forEach((i) =>
    i.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') add();
    }),
  );
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

/** A named, ordered bucket of catalog field keys for the inspector. */
interface FieldGroup {
  title: string;
  keys: string[];
  /** Whether the section starts expanded (defaults to collapsed). */
  open?: boolean;
}

/** Link fields, organised so the common edits surface first. */
const LINK_GROUPS: FieldGroup[] = [
  {
    title: 'Appearance',
    keys: ['color', 'strokeWidth', 'opacity', 'dashed'],
    open: true,
  },
  { title: 'Label', keys: ['label', 'fromLabel', 'toLabel'], open: true },
  {
    title: 'Routing',
    keys: ['lineStyle', 'cornerRadius', 'waypoints'],
    open: true,
  },
  {
    title: 'Animation',
    keys: ['dots', 'flowSpeed', 'flowParticles', 'reverseFlow'],
  },
  { title: 'Advanced', keys: ['locked', 'layer', 'source'] },
];

/** Node fields, grouped the same way. */
const NODE_GROUPS: FieldGroup[] = [
  {
    title: 'Label',
    keys: ['label', 'sublabel', 'labelColor', 'labelOffset'],
    open: true,
  },
  { title: 'Appearance', keys: ['color', 'opacity'], open: true },
  { title: 'Position', keys: ['x', 'y'] },
  { title: 'Advanced', keys: ['locked', 'layer', 'source'] },
];

/**
 * Per-group expanded/collapsed state, remembered across inspector re-renders so
 * toggling a section doesn't get reset by the next live edit. Keyed by title.
 */
const groupOpen = new Map<string, boolean>();

/**
 * Render an element's catalog fields as collapsible sections. Fields that don't
 * fall into a declared group (e.g. per-type extras like a host's "Managed"
 * flag) are gathered into a trailing "Type options" section so nothing is lost.
 */
function groupedFieldsHtml(
  info: NodeTypeInfo | LinkTypeInfo | undefined,
  cfg: Record<string, unknown>,
  groups: FieldGroup[],
): string {
  // `record` fields (metadata / source) are rendered by dedicated editors.
  const fields = (info?.fields ?? []).filter((f) => f.kind !== 'record');
  const byKey = new Map(fields.map((f) => [f.key, f] as const));
  const used = new Set<string>();

  const section = (
    title: string,
    specs: FieldSpec[],
    fallbackOpen: boolean,
  ): string => {
    if (!specs.length) return '';
    const open = groupOpen.get(title) ?? fallbackOpen;
    return (
      `<details class="insp-group" data-group="${esc(title)}"${open ? ' open' : ''}>` +
      `<summary class="insp-h">${title}</summary>` +
      specs.map((f) => fieldControl(f, cfg)).join('') +
      `</details>`
    );
  };

  let html = '';
  for (const g of groups) {
    const specs = g.keys
      .map((k) => byKey.get(k))
      .filter((f): f is FieldSpec => Boolean(f));
    specs.forEach((f) => used.add(f.key));
    html += section(g.title, specs, g.open ?? false);
  }
  const rest = fields.filter((f) => !used.has(f.key));
  return html + section('Type options', rest, true);
}

/** Persist each section's open/closed state as the user toggles it. */
function wireGroups(): void {
  inspector
    .querySelectorAll<HTMLDetailsElement>('details.insp-group[data-group]')
    .forEach((d) => {
      d.addEventListener('toggle', () => {
        groupOpen.set(d.dataset.group!, d.open);
      });
    });
}

/* Document + page properties — shown when nothing is selected. These edit the
 * document contract directly (title, page name, canvas size); the same fields
 * are settable headlessly via the MCP set_document_title / set_page_properties
 * tools, so this surface is not GUI-only. */
function propertiesHtml(): string {
  const page = editor.page;
  const [, , w, h] = page.viewBox.split(/\s+/).map(Number);
  return (
    `<div class="insp-h">Document</div>` +
    `<label class="insp-row">Title<input id="p-title" value="${esc(doc.title)}"/></label>` +
    `<div class="insp-h">Page</div>` +
    `<label class="insp-row">Name<input id="p-name" value="${esc(page.name)}"/></label>` +
    `<label class="insp-row">Canvas W<input type="number" id="p-w" min="1" value="${w || 0}"/></label>` +
    `<label class="insp-row">Canvas H<input type="number" id="p-h" min="1" value="${h || 0}"/></label>` +
    `<div class="insp-h">Playback</div>` +
    `<label class="insp-row">Hold (ms)<input type="number" id="p-dur" min="100" step="100" placeholder="${DEFAULT_PAGE_DURATION}" value="${page.duration ?? ''}"/></label>` +
    `<label class="insp-row">Transition<select id="p-tr">` +
    `<option value="cut"${page.transition !== 'fade' ? ' selected' : ''}>cut</option>` +
    `<option value="fade"${page.transition === 'fade' ? ' selected' : ''}>fade</option>` +
    `</select></label>`
  );
}

function wireProperties(): void {
  const title = inspector.querySelector<HTMLInputElement>('#p-title');
  title?.addEventListener('input', () => {
    doc.title = title.value;
    markDirty();
  });
  const name = inspector.querySelector<HTMLInputElement>('#p-name');
  name?.addEventListener('input', () => editor.renamePage(name.value));
  // Canvas size reframes the page, so commit on change (blur/Enter), not keystroke.
  const wIn = inspector.querySelector<HTMLInputElement>('#p-w');
  const hIn = inspector.querySelector<HTMLInputElement>('#p-h');
  const applySize = (): void => {
    const [vx, vy] = editor.page.viewBox.split(/\s+/).map(Number);
    const w = Math.max(1, Math.round(Number(wIn?.value)) || 0);
    const h = Math.max(1, Math.round(Number(hIn?.value)) || 0);
    editor.setViewBox(`${vx || 0} ${vy || 0} ${w} ${h}`);
  };
  wIn?.addEventListener('change', applySize);
  hIn?.addEventListener('change', applySize);
  // Playback timing — same fields the MCP set_page_properties tool sets.
  const dur = inspector.querySelector<HTMLInputElement>('#p-dur');
  dur?.addEventListener('change', () => {
    const v = Number(dur.value);
    if (Number.isFinite(v) && v > 0) editor.page.duration = v;
    else delete editor.page.duration;
    markDirty();
  });
  const tr = inspector.querySelector<HTMLSelectElement>('#p-tr');
  tr?.addEventListener('change', () => {
    if (tr.value === 'fade') editor.page.transition = 'fade';
    else delete editor.page.transition;
    markDirty();
  });
}

/** Render the inspector for the current selection, driven entirely by the catalog. */
function renderInspector(): void {
  const link = editor.getSelectedLink();
  const node = link ? null : editor.getSelectedNode();
  const anchor = link || node ? null : editor.getSelectedAnchor();
  inspector.hidden = false;

  let html = '';
  if (node) {
    const info = getNodeType(node.type, doc.customNodes);
    const types = nodeCatalog(doc.customNodes).map((n) => n.type);
    html +=
      `<div class="insp-h">Node</div>` +
      typeRow(node.type, types) +
      groupedFieldsHtml(info, node as Record<string, unknown>, NODE_GROUPS) +
      metaHtml(node.meta) +
      arrangeRow();
  } else if (link) {
    const info = getLinkType(link.type);
    const types = linkCatalog().map((l) => l.type);
    html +=
      `<div class="insp-h">Link</div>` +
      typeRow(link.type, types) +
      `<div class="insp-row"><span>Endpoints</span><button class="tbtn ab" id="i-swap" title="Swap from/to">⇄ swap</button></div>` +
      groupedFieldsHtml(info, link as Record<string, unknown>, LINK_GROUPS) +
      arrangeRow();
  } else if (anchor) {
    html +=
      `<div class="insp-h">Anchor</div>` +
      `<div class="insp-row"><span>Id</span><span class="muted">${esc(anchor.id)}</span></div>` +
      `<label class="insp-row">X<input type="number" id="a-x" value="${anchor.x}"/></label>` +
      `<label class="insp-row">Y<input type="number" id="a-y" value="${anchor.y}"/></label>` +
      `<div class="insp-row"><span>Endpoint for ${editor.anchorLinkCount(anchor.id)} link(s)</span><button class="tbtn ab" id="a-del" title="Delete anchor">🗑 delete</button></div>`;
  } else {
    // Nothing selected — show document + page properties.
    html += propertiesHtml();
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
    wireMeta(node.meta);
  } else if (link) {
    wireType((t) => {
      editor.updateLink({ type: t });
      renderInspector();
    });
    wireFields((key, val, commit) =>
      editor.updateLink({ [key]: val } as Record<string, unknown>, commit),
    );
    inspector.querySelector('#i-swap')?.addEventListener('click', () => {
      editor.swapLink();
      renderInspector();
    });
  } else if (anchor) {
    const ax = inspector.querySelector<HTMLInputElement>('#a-x');
    const ay = inspector.querySelector<HTMLInputElement>('#a-y');
    ax?.addEventListener('input', () => {
      editor.updateAnchor({ x: Number(ax.value) }, !editing);
      editing = true;
    });
    ay?.addEventListener('input', () => {
      editor.updateAnchor({ y: Number(ay.value) }, !editing);
      editing = true;
    });
    inspector.querySelector('#a-del')?.addEventListener('click', () => {
      editor.deleteSelected();
      renderInspector();
    });
  } else {
    wireProperties();
  }
  inspector.querySelector('[data-z="front"]')?.addEventListener('click', () => {
    editor.bringToFront();
    renderInspector();
  });
  inspector
    .querySelector('[data-z="forward"]')
    ?.addEventListener('click', () => {
      editor.bringForward();
      renderInspector();
    });
  inspector
    .querySelector('[data-z="backward"]')
    ?.addEventListener('click', () => {
      editor.sendBackward();
      renderInspector();
    });
  inspector.querySelector('[data-z="back"]')?.addEventListener('click', () => {
    editor.sendToBack();
    renderInspector();
  });
  wireGroups();
  wireAnnotations();
}

/** Z-order ("Arrange") controls — shown for a single node or a link. */
function arrangeRow(): string {
  return (
    `<div class="insp-row"><span>Arrange</span><span class="arrange">` +
    `<button class="tbtn ab" data-z="back" title="Send to back ([Ctrl+[)">⤓⤓</button>` +
    `<button class="tbtn ab" data-z="backward" title="Send backward ([)">⤓</button>` +
    `<button class="tbtn ab" data-z="forward" title="Bring forward (])">⤒</button>` +
    `<button class="tbtn ab" data-z="front" title="Bring to front (Ctrl+])">⤒⤒</button>` +
    `</span></div>`
  );
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

/** Human label for a waypoint/member ref (node label, anchor id, or raw id). */
function endpointLabel(id: string): string {
  const n = editor.page.nodes.find((m) => m.id === id);
  if (n) {
    const label = (n as { label?: unknown }).label;
    return typeof label === 'string' && label ? label : n.id;
  }
  if (editor.page.anchors.some((a) => a.id === id)) return `⚓ ${id}`;
  return id; // dangling ref — surface the id so it can be fixed
}

/** One removable, reorderable chip in a refs editor. */
function refChip(id: string): string {
  return (
    `<span class="refchip" data-id="${esc(id)}">` +
    `<button type="button" class="refmv" data-refmove="-1" title="Move earlier">‹</button>` +
    `<span class="reflbl">${esc(endpointLabel(id))}</span>` +
    `<button type="button" class="refmv" data-refmove="1" title="Move later">›</button>` +
    `<button type="button" class="refx" data-refdel title="Remove">✕</button>` +
    `</span>`
  );
}

/** "+ add…" picker options: every node (by label) then every anchor. */
function refAddOptions(): string {
  const nodes = editor.page.nodes
    .map((n) => {
      const label = (n as { label?: unknown }).label;
      const text = typeof label === 'string' && label ? label : n.id;
      return `<option value="${esc(n.id)}">${esc(text)}</option>`;
    })
    .join('');
  const anchors = editor.page.anchors
    .map((a) => `<option value="${esc(a.id)}">⚓ ${esc(a.id)}</option>`)
    .join('');
  return `<option value="">＋ add…</option>${nodes}${anchors}`;
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
    case 'refs': {
      const ids = Array.isArray(v) ? (v as string[]) : [];
      const hint =
        f.key === 'waypoints'
          ? `<div class="refhint">Order is the route. Add nodes below or select them in order, then “＋ flow”. Reorder with ‹ ›.</div>`
          : '';
      return (
        `<div class="insp-row col">${f.label}${req}` +
        `<div class="refchips" data-refkey="${f.key}">` +
        ids.map(refChip).join('') +
        `<select class="refadd" title="Add by node">${refAddOptions()}</select>` +
        `</div>${hint}</div>`
      );
    }
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
  // Group by type into collapsible sections with counts, so a frame with many
  // zones/flows/markers stays scannable instead of one long flat list.
  for (const g of ANNO_GROUPS) {
    const info = getAnnotationType(g.kind)!;
    const items = page[g.col] as { id: string }[];
    if (!items.length) continue;
    html +=
      `<details class="anno-group" open data-agroup="${g.col}">` +
      `<summary class="anno-group-h">${esc(info.label)}s<span class="anno-count">${items.length}</span></summary>`;
    for (const item of items) {
      const cfg = item as Record<string, unknown>;
      const title = String(cfg.label ?? cfg.type ?? item.id);
      html +=
        `<details class="anno" data-acol="${g.col}" data-aid="${esc(item.id)}">` +
        `<summary><span class="anno-k">${info.label}</span><span class="anno-t">${esc(title)}</span><button class="anno-x" data-adel title="Delete">✕</button></summary>` +
        info.fields.map((f) => annoFieldControl(f, cfg)).join('') +
        `</details>`;
    }
    html += `</details>`;
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
    // Refs editor (flow waypoints / zone members): add by node picker, reorder
    // with ‹ ›, remove with ✕ — all by chip position so duplicates behave.
    host.querySelectorAll<HTMLElement>('.refchips').forEach((box) => {
      const key = box.dataset.refkey!;
      const ids = (): string[] =>
        [...box.querySelectorAll<HTMLElement>('.refchip')].map(
          (c) => c.dataset.id!,
        );
      const commit = (next: string[]): void => {
        setA(key, next, true);
        renderInspector();
      };
      const indexOfChip = (el: HTMLElement): number =>
        [...box.querySelectorAll<HTMLElement>('.refchip')].indexOf(el);
      box
        .querySelector<HTMLSelectElement>('.refadd')
        ?.addEventListener('change', (e) => {
          const sel = e.target as HTMLSelectElement;
          if (sel.value) commit([...ids(), sel.value]);
        });
      box.querySelectorAll<HTMLButtonElement>('[data-refdel]').forEach((b) =>
        b.addEventListener('click', (e) => {
          e.preventDefault();
          const i = indexOfChip(b.closest<HTMLElement>('.refchip')!);
          const next = ids();
          next.splice(i, 1);
          commit(next);
        }),
      );
      box.querySelectorAll<HTMLButtonElement>('[data-refmove]').forEach((b) =>
        b.addEventListener('click', (e) => {
          e.preventDefault();
          const i = indexOfChip(b.closest<HTMLElement>('.refchip')!);
          const j = i + Number(b.dataset.refmove);
          const next = ids();
          if (j < 0 || j >= next.length) return;
          [next[i], next[j]] = [next[j]!, next[i]!];
          commit(next);
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
  invalidatePreview(spec.typeName); // its art changed — drop the stale preview
  buildPalette();
  editor.refresh(); // existing nodes of this type pick up the new render
  markDirty();
}

/**
 * A small SVG thumbnail of a node type's actual engine art (label-less), for the
 * palette. Renders a one-node page through the same engine the canvas uses, so
 * the preview always matches what gets drawn. `<defs>` is stripped because the
 * palette shares one copy (see buildPalette) — keeps the DOM light across types.
 */
// Previews are pure functions of the node type's art, which is stable for
// built-ins and only changes when a custom type is re-designed. Memoize so a
// palette rebuild (custom-node edit, document open) doesn't re-run the engine
// for every built-in type each time; invalidated via invalidatePreview().
const previewCache = new Map<string, string>();
function invalidatePreview(type?: string): void {
  if (type) previewCache.delete(type);
  else previewCache.clear();
}

function nodePreviewSVG(type: string): string {
  const cached = previewCache.get(type);
  if (cached !== undefined) return cached;
  let inner: string;
  try {
    inner = renderPageSVG({
      viewBox: '0 0 110 84',
      nodes: [{ id: 'p', type, x: 55, y: 42 }],
      links: [],
    });
  } catch {
    return ''; // unknown/unrenderable type — fall back to the label only
  }
  inner = inner.replace(/<defs[\s\S]*?<\/defs>/, '');
  const svg = `<svg class="ppreview" viewBox="0 0 110 84" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${inner}</svg>`;
  previewCache.set(type, svg);
  return svg;
}

function buildPalette(): void {
  const byCat = new Map<string, NodeTypeInfo[]>();
  for (const info of nodeCatalog(doc.customNodes)) {
    const list = byCat.get(info.category) ?? [];
    list.push(info);
    byCat.set(info.category, list);
  }
  // One shared copy of the engine's filter/gradient defs for every preview.
  let html = `<svg class="pdefs" width="0" height="0" aria-hidden="true">${engineDefs()}</svg>`;
  for (const [cat, infos] of byCat) {
    html += `<div class="palette-h">${esc(cat)}</div>`;
    for (const info of infos) {
      const item = `<button class="pitem" data-type="${esc(info.type)}">${nodePreviewSVG(info.type)}<span class="plabel">${esc(info.label)}</span></button>`;
      html += info.custom
        ? `<div class="pcustom">${item}<button class="pedit" data-edit="${esc(info.type)}" title="Edit type">✎</button></div>`
        : item;
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

/* Flipbook playback: step through pages on their durations (loop). The same
 * timing model drives the MCP export_flipbook artifact (pages/playback). */
let playTimer: number | null = null;
function stopPlayback(): void {
  if (playTimer === null) return;
  clearTimeout(playTimer);
  playTimer = null;
  const b = strip.querySelector('#playFlip');
  if (b) b.textContent = '▶ play';
}
function startPlayback(): void {
  if (doc.pages.length < 2) return;
  stopPlayback();
  const advance = (): void => {
    const next = (current + 1) % doc.pages.length;
    selectPage(next);
    if (doc.pages[next]!.transition === 'fade')
      artSvg.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 350,
        easing: 'ease',
      });
    playTimer = window.setTimeout(advance, pageDuration(doc.pages[next]!));
  };
  playTimer = window.setTimeout(advance, pageDuration(doc.pages[current]!));
  const b = strip.querySelector('#playFlip');
  if (b) b.textContent = '⏸ pause';
}

function renderFilmstrip(): void {
  const canDelete = doc.pages.length > 1;
  strip.innerHTML = `
    ${
      doc.pages.length > 1
        ? `<button class="frame add" id="playFlip" title="Play the flipbook (each frame holds for its duration)">${playTimer !== null ? '⏸ pause' : '▶ play'}</button>`
        : ''
    }
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
      stopPlayback(); // a manual frame choice takes over from the player
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
  strip
    .querySelector('#playFlip')
    ?.addEventListener('click', () =>
      playTimer !== null ? stopPlayback() : startPlayback(),
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
  stopPlayback();
  current = i;
  editor.setPage(doc.pages[current]!);
  renderFilmstrip();
  renderProblems();
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
  stopPlayback();
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
  stopPlayback();
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

/* Light / dark theme — a view preference, persisted across sessions. */
const themeBtn = app.querySelector<HTMLButtonElement>('#tTheme')!;
const THEME_KEY = 'topology-dojo:theme';
function applyTheme(light: boolean): void {
  document.documentElement.classList.toggle('light', light);
  themeBtn.classList.toggle('on', light);
  themeBtn.textContent = light ? '🌙' : '☀';
  themeBtn.title = light ? 'Switch to dark theme' : 'Switch to light theme';
  try {
    localStorage.setItem(THEME_KEY, light ? 'light' : 'dark');
  } catch {
    // storage unavailable — non-fatal
  }
}
applyTheme(localStorage.getItem(THEME_KEY) === 'light');
themeBtn.addEventListener('click', () =>
  applyTheme(!document.documentElement.classList.contains('light')),
);

app
  .querySelector('#tDelete')
  ?.addEventListener('click', () => editor.deleteSelected());
app.querySelector('#tTidy')?.addEventListener('click', () => editor.tidy());
const layoutSel = app.querySelector<HTMLSelectElement>('#tLayout')!;
layoutSel.addEventListener('change', () => {
  const algorithm = layoutSel.value;
  layoutSel.value = ''; // reset to the placeholder
  if (algorithm)
    editor.layout({
      algorithm: algorithm as 'grid' | 'hierarchical' | 'circular' | 'force',
    });
});
app.querySelector('#tFit')?.addEventListener('click', () => editor.resetView());

/* ── Keyboard-shortcut help overlay (?) ────────────────────────────── */
const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  {
    group: 'Tools',
    items: [
      ['V', 'Select / move'],
      ['L', 'Draw link'],
      ['A', 'Drop anchor'],
      ['Space / H', 'Hand — drag to pan'],
    ],
  },
  {
    group: 'Edit',
    items: [
      ['Ctrl/Cmd+Z', 'Undo'],
      ['Ctrl/Cmd+Shift+Z · Ctrl+Y', 'Redo'],
      ['Ctrl/Cmd+C / X / V', 'Copy / Cut / Paste'],
      ['Ctrl/Cmd+D', 'Duplicate'],
      ['Ctrl/Cmd+L', 'Lock / unlock'],
      ['Del / Backspace', 'Delete selection'],
      ['[ / ]', 'Send back / bring forward'],
      ['Ctrl/Cmd+[ / ]', 'Send to back / bring to front'],
    ],
  },
  {
    group: 'Select',
    items: [
      ['Ctrl/Cmd+A', 'Select all'],
      ['Shift+click', 'Add to selection'],
      ['←↑→↓', 'Nudge (Shift = ×10)'],
    ],
  },
  {
    group: 'Canvas',
    items: [
      ['Wheel', 'Zoom to cursor'],
      ['Space / Middle-drag', 'Pan'],
      ['0', 'Fit to content'],
      ['Ctrl/Cmd+F', 'Find / jump to node'],
      ['R', 'Toggle grid'],
      ['G', 'Toggle snap'],
      ['M / P', 'Toggle minimap / properties'],
      ['C', 'Calm canvas (pause animation)'],
      ['T', 'Tidy layout'],
      ['? ', 'This shortcut reference'],
    ],
  },
];
let helpEl: HTMLElement | null = null;
function closeHelp(): void {
  helpEl?.remove();
  helpEl = null;
}
function openHelp(): void {
  if (helpEl) {
    closeHelp();
    return;
  }
  helpEl = document.createElement('div');
  helpEl.className = 'help-backdrop';
  const cols = SHORTCUTS.map(
    (s) =>
      `<div class="help-col"><h4>${s.group}</h4>` +
      s.items
        .map(
          ([k, d]) =>
            `<div class="help-row"><kbd>${esc(k)}</kbd><span>${esc(d)}</span></div>`,
        )
        .join('') +
      `</div>`,
  ).join('');
  helpEl.innerHTML =
    `<div class="help-card" role="dialog" aria-label="Keyboard shortcuts">` +
    `<div class="help-head"><h3>Keyboard shortcuts</h3>` +
    `<button class="tbtn ticon" id="helpClose" title="Close (Esc)">✕</button></div>` +
    `<div class="help-cols">${cols}</div></div>`;
  app.appendChild(helpEl);
  helpEl.addEventListener('click', (e) => {
    if (e.target === helpEl) closeHelp(); // click backdrop to dismiss
  });
  helpEl
    .querySelector('#helpClose')
    ?.addEventListener('click', () => closeHelp());
}
app.querySelector('#tHelp')?.addEventListener('click', () => openHelp());

/* Keyboard. Shortcuts are suppressed while typing in a form field so they don't
 * hijack the inspector / rename inputs (and Ctrl+C/V do native text edit there). */
window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement | null;
  if (
    t &&
    (t.tagName === 'INPUT' ||
      t.tagName === 'SELECT' ||
      t.tagName === 'TEXTAREA' ||
      t.isContentEditable)
  )
    return;

  // ? (Shift+/) opens the shortcut reference; Esc closes it (handled here so it
  // takes priority over the selection-clearing Esc below).
  if (e.key === '?') {
    e.preventDefault();
    openHelp();
    return;
  }
  if (e.key === 'Escape' && helpEl) {
    e.preventDefault();
    closeHelp();
    return;
  }

  // Spacebar → hand mode (hold and left-drag to pan). Prevent page scroll.
  if (e.key === ' ') {
    e.preventDefault();
    editor.setSpacePan(true);
    return;
  }

  const mod = e.ctrlKey || e.metaKey;
  if (mod) {
    const k = e.key.toLowerCase();
    if (k === 'z') {
      e.preventDefault();
      if (e.shiftKey) editor.redo();
      else editor.undo();
    } else if (k === 'y') {
      e.preventDefault();
      editor.redo();
    } else if (k === 'a') {
      e.preventDefault();
      editor.selectAll();
    } else if (k === 'f') {
      e.preventDefault();
      openFind();
    } else if (k === 'c') {
      e.preventDefault();
      editor.copySelection();
    } else if (k === 'x') {
      e.preventDefault();
      editor.cut();
    } else if (k === 'v') {
      e.preventDefault();
      editor.paste();
    } else if (k === 'd') {
      e.preventDefault();
      editor.duplicateSelection();
    } else if (k === 'l') {
      e.preventDefault();
      editor.toggleLock();
    } else if (e.key === ']') {
      e.preventDefault();
      editor.bringToFront();
    } else if (e.key === '[') {
      e.preventDefault();
      editor.sendToBack();
    }
    return; // other mod combos: leave to the browser
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    editor.deleteSelected();
    return;
  }
  if (e.key === ']') {
    editor.bringForward();
    return;
  }
  if (e.key === '[') {
    editor.sendBackward();
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
  if (e.key === 'm' || e.key === 'M')
    setMinimapCollapsed(!minimapWrap.classList.contains('collapsed'));
  if (e.key === 'p' || e.key === 'P')
    setInspectorCollapsed(!inspectorWrap.classList.contains('collapsed'));
  if (e.key === 'c' || e.key === 'C') applyCalm(!editor.calm);
  if (e.key === 't' || e.key === 'T') editor.tidy();
  if (e.key === '0') editor.resetView();
  if (e.key === 'l' || e.key === 'L') setTool('link');
  if (e.key === 'v' || e.key === 'V') setTool('select');
  if (e.key === 'a' || e.key === 'A') setTool('anchor');
  if (e.key === 'h' || e.key === 'H') setHand(!editor.isHandActive());
  if (e.key === 'Escape') {
    editor.clearSelection();
    setTool('select');
  }

  // Arrows: nudge the selection (Shift = 10px); otherwise flip pages.
  if (e.key.startsWith('Arrow')) {
    if (editor.selectionCount() > 0) {
      e.preventDefault();
      const s = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') editor.nudge(-s, 0);
      else if (e.key === 'ArrowRight') editor.nudge(s, 0);
      else if (e.key === 'ArrowUp') editor.nudge(0, -s);
      else if (e.key === 'ArrowDown') editor.nudge(0, s);
    } else if (e.key === 'ArrowRight') selectPage(current + 1);
    else if (e.key === 'ArrowLeft') selectPage(current - 1);
  }
});

/* Right-click context menu — adaptive to whatever is under the cursor. Every
 * item maps to an existing editor command (nothing UI-only here): the menu is a
 * second surface onto the same actions as the toolbar/keyboard/inspector. */
type CtxItem =
  | { sep: true }
  | { label: string; run: () => void; disabled?: boolean };

let ctxMenu: HTMLDivElement | null = null;

function closeCtxMenu(): void {
  ctxMenu?.remove();
  ctxMenu = null;
}

function ctxItemsFor(kind: 'node' | 'link' | 'empty'): CtxItem[] {
  if (kind === 'node') {
    const lockLabel = editor.selectionLocked() ? 'Unlock' : 'Lock';
    return [
      { label: 'Duplicate', run: () => editor.duplicateSelection() },
      { label: 'Copy', run: () => editor.copySelection() },
      { sep: true },
      { label: 'Group into zone', run: () => addAnnotation('zone') },
      { label: 'Add policy marker', run: () => addAnnotation('policyMarker') },
      { sep: true },
      {
        label: 'Bring to front',
        run: () => editor.bringToFront(),
        disabled: !editor.canArrange(),
      },
      {
        label: 'Send to back',
        run: () => editor.sendToBack(),
        disabled: !editor.canArrange(),
      },
      { sep: true },
      { label: lockLabel, run: () => editor.toggleLock() },
      { label: 'Delete', run: () => editor.deleteSelected() },
    ];
  }
  if (kind === 'link') {
    const lockLabel = editor.selectionLocked() ? 'Unlock' : 'Lock';
    return [
      { label: 'Swap endpoints', run: () => editor.swapLink() },
      { sep: true },
      { label: 'Bring to front', run: () => editor.bringToFront() },
      { label: 'Send to back', run: () => editor.sendToBack() },
      { sep: true },
      { label: lockLabel, run: () => editor.toggleLock() },
      { label: 'Delete', run: () => editor.deleteSelected() },
    ];
  }
  return [
    { label: 'Paste', run: () => editor.paste(), disabled: !editor.canPaste() },
    { label: 'Select all', run: () => editor.selectAll() },
    { sep: true },
    { label: 'Tidy layout', run: () => editor.tidy() },
  ];
}

function openCtxMenu(clientX: number, clientY: number): void {
  closeCtxMenu();
  const hit = editor.pickAt(clientX, clientY);
  renderInspector();
  const items = ctxItemsFor(hit.kind);

  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.setAttribute('role', 'menu');
  for (const item of items) {
    if ('sep' in item) {
      const hr = document.createElement('div');
      hr.className = 'ctx-sep';
      menu.appendChild(hr);
      continue;
    }
    const btn = document.createElement('button');
    btn.className = 'ctx-item';
    btn.type = 'button';
    btn.textContent = item.label;
    btn.disabled = !!item.disabled;
    btn.addEventListener('click', () => {
      closeCtxMenu();
      item.run();
      renderInspector();
    });
    menu.appendChild(btn);
  }

  // Place at the cursor, then nudge back on-screen if it would overflow.
  menu.style.left = '0px';
  menu.style.top = '0px';
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  const x = Math.min(clientX, window.innerWidth - r.width - 4);
  const y = Math.min(clientY, window.innerHeight - r.height - 4);
  menu.style.left = `${Math.max(4, x)}px`;
  menu.style.top = `${Math.max(4, y)}px`;
  ctxMenu = menu;
}

// Attached to the canvas host (an HTML box) rather than the overlay <svg>,
// because an svg root only dispatches contextmenu over painted geometry — a
// right-click on empty canvas would otherwise be missed.
const canvasHost = app.querySelector<HTMLElement>('.canvas-host')!;
canvasHost.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  openCtxMenu(e.clientX, e.clientY);
});
// Dismiss on outside click, scroll/resize, or Escape.
window.addEventListener('pointerdown', (e) => {
  if (ctxMenu && !ctxMenu.contains(e.target as Node)) closeCtxMenu();
  if (findEl && !findEl.contains(e.target as Node)) closeFind();
});
window.addEventListener('blur', closeCtxMenu);
window.addEventListener('resize', () => {
  closeCtxMenu();
  editor.resync();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeCtxMenu();
});

// Release hand mode when Space lifts (or the window loses focus while held).
window.addEventListener('keyup', (e) => {
  if (e.key === ' ') editor.setSpacePan(false);
});
window.addEventListener('blur', () => editor.setSpacePan(false));

function esc(s: string): string {
  return s.replace(/[<>&"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;',
  );
}

renderFilmstrip();
renderInspector();
renderStatus();
renderMinimap();
