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

const doc: TopologyDocument = sampleDocument();
let current = 0;

const app = document.getElementById('app')!;

app.innerHTML = `
  <header class="bar">
    <div class="brand">Topology Dojo</div>
    <div class="bar-actions">
      <button class="tbtn on" id="tGrid" title="Toggle grid (R)">▦ grid</button>
      <button class="tbtn on" id="tSnap" title="Toggle snap (G)">⌗ snap</button>
      <button class="tbtn" id="tDelete" title="Delete selection (Del)">🗑 delete</button>
      <span class="hint">click / shift-click / drag a box to select · drag to move · ←/→ flip</span>
    </div>
  </header>

  <div class="stage">
    <div class="tds-root">
      <div class="tds-canvas-row">
        <div class="tds-canvas canvas-host">
          <svg id="page-canvas" preserveAspectRatio="xMidYMid meet"></svg>
          <svg id="overlay" class="overlay" preserveAspectRatio="xMidYMid meet"></svg>
        </div>
      </div>
    </div>
  </div>

  <footer class="filmstrip" id="filmstrip"></footer>
`;

const artSvg = app.querySelector<SVGSVGElement>('#page-canvas')!;
const overlaySvg = app.querySelector<SVGSVGElement>('#overlay')!;
const strip = app.querySelector<HTMLElement>('#filmstrip')!;

const editor = new Editor(
  artSvg,
  overlaySvg,
  doc.pages[current]!,
  renderFilmstrip,
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
  });
  strip.querySelector('#dupPage')?.addEventListener('click', () => {
    doc.pages.splice(
      current + 1,
      0,
      duplicatePage(doc.pages[current]!, `Frame ${doc.pages.length + 1}`),
    );
    selectPage(current + 1);
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
  if (e.key === 'ArrowRight') selectPage(current + 1);
  if (e.key === 'ArrowLeft') selectPage(current - 1);
});

function esc(s: string): string {
  return s.replace(/[<>&"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;',
  );
}

renderFilmstrip();
