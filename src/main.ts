/**
 * Topology Dojo — flipbook editor shell (Phase 1).
 *
 * Renders the current page with the vendored legacy renderer and provides the
 * pages filmstrip (add / duplicate / flip / delete). On-canvas editing
 * (select / drag / links / guides) arrives in the editor-core phase.
 */
import { renderPageInto } from './vendor/topology-ds.js';
import {
  blankPage,
  duplicatePage,
  sampleDocument,
  type TopologyDocument,
} from './pages/model.js';

const doc: TopologyDocument = sampleDocument();
let current = 0;

const app = document.getElementById('app')!;

function draw(): void {
  app.innerHTML = `
    <header class="bar">
      <div class="brand">Topology Dojo</div>
      <div class="bar-actions">
        <span class="hint">flipbook · ←/→ to flip frames</span>
      </div>
    </header>

    <div class="stage">
      <div class="tds-root">
        <div class="tds-canvas-row">
          <div class="tds-canvas">
            <svg id="page-canvas" preserveAspectRatio="xMidYMid meet"></svg>
          </div>
        </div>
      </div>
    </div>

    <footer class="filmstrip">
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
    </footer>
  `;

  const svg = app.querySelector<SVGSVGElement>('#page-canvas')!;
  const page = doc.pages[current]!;
  renderPageInto(svg, page);

  wire();
}

function wire(): void {
  app.querySelectorAll<HTMLButtonElement>('[data-page]').forEach((b) =>
    b.addEventListener('click', () => {
      current = Number(b.dataset.page);
      draw();
    }),
  );

  app.querySelector('#addPage')?.addEventListener('click', () => {
    doc.pages.push(blankPage(`Frame ${doc.pages.length + 1}`));
    current = doc.pages.length - 1;
    draw();
  });

  app.querySelector('#dupPage')?.addEventListener('click', () => {
    const src = doc.pages[current]!;
    doc.pages.splice(
      current + 1,
      0,
      duplicatePage(src, `Frame ${doc.pages.length + 1}`),
    );
    current += 1;
    draw();
  });
}

function flip(dir: 1 | -1): void {
  const next = current + dir;
  if (next < 0 || next >= doc.pages.length) return;
  current = next;
  draw();
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') flip(1);
  if (e.key === 'ArrowLeft') flip(-1);
});

function esc(s: string): string {
  return s.replace(/[<>&"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;',
  );
}

draw();
