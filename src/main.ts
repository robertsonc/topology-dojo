import { resolve, validate } from './core/resolve.js';
import { diff } from './core/tween.js';
import {
  authoredThisBeat,
  clearOverrideField,
  cycleEmphasis,
  moveNode,
  setOverrideField,
} from './core/edits.js';
import { renderScene } from './render-svg/render.js';
import { clientToUser, userToClient } from './app/svg-coords.js';
import { sampleScene } from './sample-scene.js';
import type { ElementId, ResolvedScene, Scene } from './core/model.js';

/* ------------------------------------------------------------------ *
 * App state (UI-only; the Scene is the document of record)
 * ------------------------------------------------------------------ */
const scene: Scene = structuredClone(sampleScene);
let mode: 'editor' | 'presenter' = 'editor';
/** Editor: the beat being authored (-1 = base/structure). Presenter: current beat. */
let beatIndex = 0;
/** Canvas selection — the heart of the canvas-first authoring surface. */
let selectedId: ElementId | null = null;

const app = document.getElementById('app')!;

const isNode = (id: ElementId): boolean => id in scene.topology.nodes;
const onBase = (): boolean => beatIndex < 0;

/** Where an element's controls/decorations anchor: node position, or link midpoint. */
function anchorOf(
  resolved: ResolvedScene,
  id: ElementId,
): { x: number; y: number } | null {
  const node = scene.topology.nodes[id];
  if (node) {
    const el = resolved.elements[id];
    return el ? { x: el.x, y: el.y } : null;
  }
  const link = scene.topology.links[id];
  if (link) {
    const a = resolved.elements[link.from];
    const b = resolved.elements[link.to];
    if (a && b) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Render
 * ------------------------------------------------------------------ */
function draw(): void {
  const problems = validate(scene);
  const resolved = resolve(scene, beatIndex);
  const svg = renderScene(resolved);
  const editing = mode === 'editor';

  app.innerHTML = `
    <header class="bar">
      <div class="brand">Topology Dojo <span class="proto">beat model</span></div>
      <div class="modes">
        <button class="${editing ? 'on' : ''}" data-mode="editor">✎ Author</button>
        <button class="${!editing ? 'on' : ''}" data-mode="presenter">▶ Present</button>
      </div>
    </header>

    <div class="stage">
      <div class="canvas">${svg}</div>
      ${editing ? decorations(resolved) : ''}
      ${editing && selectedId ? '<div class="inline"></div>' : ''}
      ${!editing ? presenterOverlay(resolved.note, resolved.beatName) : ''}
    </div>

    ${editing ? editorPanel(problems) : ''}
    ${beatStrip()}
  `;

  wire();
  if (editing && selectedId) positionInline(resolved);
}

/**
 * Editor-only overlay drawn on top of the (pure) scene SVG: selection ring,
 * "authored this beat" badges, and ghosts showing where moved nodes came from.
 * It shares the scene's viewBox so coordinates line up, and ignores pointer
 * events so clicks fall through to the scene below.
 */
function decorations(resolved: ResolvedScene): string {
  const [vx, vy, vw, vh] = scene.topology.viewBox;
  // SVG presentation attributes don't resolve CSS var(); use the literal accent
  // (matching render.ts, which also uses literal colors).
  const ACCENT = '#05cc93';
  let out = '';

  // Ghosts + motion lines for nodes this beat moves (derived, never authored).
  if (!onBase()) {
    const prev = resolve(scene, beatIndex - 1);
    for (const t of diff(prev, resolved).elements) {
      if (!t.moved || !isNode(t.id)) continue;
      out += `<line x1="${t.from.x}" y1="${t.from.y}" x2="${t.to.x}" y2="${t.to.y}" stroke="${ACCENT}" stroke-width="1.5" stroke-dasharray="4 4" opacity=".5"/>`;
      out += `<circle cx="${t.from.x}" cy="${t.from.y}" r="22" fill="none" stroke="${ACCENT}" stroke-width="1.5" stroke-dasharray="3 4" opacity=".4"/>`;
    }
    // "Authored this beat" badges.
    for (const id of authoredThisBeat(scene, beatIndex)) {
      const a = anchorOf(resolved, id);
      if (a)
        out += `<circle cx="${a.x + 18}" cy="${a.y - 18}" r="4.5" fill="${ACCENT}"/>`;
    }
  }

  // Selection highlight.
  if (selectedId) {
    const a = anchorOf(resolved, selectedId);
    if (a) {
      const r = isNode(selectedId) ? 32 : 9;
      out += `<circle cx="${a.x}" cy="${a.y}" r="${r}" fill="none" stroke="${ACCENT}" stroke-width="2" stroke-dasharray="5 4" opacity=".95"/>`;
    }
  }

  return `<svg class="decor" viewBox="${vx} ${vy} ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg">${out}</svg>`;
}

function presenterOverlay(note: string | undefined, name: string): string {
  return `
    <div class="presenter-hint">click anywhere / → to advance · ← to go back</div>
    <div class="speaker">
      <div class="speaker-beat">${beatIndex + 1} / ${scene.beats.length} — ${esc(name)}</div>
      <div class="speaker-note">${esc(note ?? '')}</div>
    </div>`;
}

/** Build the inline contextual controls for the current selection. */
function inlineControlsHtml(resolved: ResolvedScene): string {
  const id = selectedId;
  if (!id) return '';
  const node = scene.topology.nodes[id];
  const link = scene.topology.links[id];
  const label = node?.label ?? link?.label ?? id;

  if (onBase()) {
    return `<span class="lbl">${esc(label)}</span>
      <span class="base-hint">${node ? 'drag to set base position' : 'base topology'}</span>`;
  }

  const beat = scene.beats[beatIndex]!;
  const ov = beat.overrides[id] ?? {};
  const el = resolved.elements[id]!;

  let controls = `<span class="lbl">${esc(label)}</span>`;

  // Visibility — button shows the effective state; click writes the opposite.
  controls += `<button class="ictl ${el.visible ? 'on' : 'off'}" data-act="visible" title="toggle visibility">${el.visible ? '◉ shown' : '○ hidden'}</button>`;
  if (ov.visible !== undefined)
    controls += `<button class="ictl clear" data-act="clear-visible" title="revert to inherited">↺</button>`;

  // Emphasis — cycles inherit → focus → dim → neutral → inherit.
  const emph = ov.emphasis ?? 'inherit';
  controls += `<button class="ictl ${ov.emphasis ? 'on' : ''}" data-act="emphasis" title="cycle emphasis">✦ ${emph}</button>`;

  // Flow — links only.
  if (link) {
    controls += `<button class="ictl ${el.flowActive ? 'on' : 'off'}" data-act="flow" title="toggle flow">⟶ ${el.flowActive ? 'flow' : 'no flow'}</button>`;
    if (ov.flowActive !== undefined)
      controls += `<button class="ictl clear" data-act="clear-flow" title="revert to inherited">↺</button>`;
  }

  // Reset a position override written by dragging.
  if (ov.x !== undefined || ov.y !== undefined)
    controls += `<button class="ictl clear" data-act="clear-pos" title="reset moved position">⤺ pos</button>`;

  return controls;
}

/** Position the HTML inline controls above the selected element on screen. */
function positionInline(resolved: ResolvedScene): void {
  const box = app.querySelector<HTMLDivElement>('.inline');
  const svg = app.querySelector<SVGSVGElement>('.canvas svg');
  if (!box || !svg || !selectedId) return;
  box.innerHTML = inlineControlsHtml(resolved);
  const a = anchorOf(resolved, selectedId);
  if (!a) return;
  const stage = app.querySelector<HTMLDivElement>('.stage')!;
  const stageRect = stage.getBoundingClientRect();
  const screen = userToClient(svg, a.x, a.y);
  box.style.left = `${screen.x - stageRect.left}px`;
  box.style.top = `${screen.y - stageRect.top - 44}px`;
  wireInline();
}

function editorPanel(problems: string[]): string {
  const beat = onBase() ? undefined : scene.beats[beatIndex];
  const authored = onBase()
    ? new Set<ElementId>()
    : authoredThisBeat(scene, beatIndex);

  const elements = [
    ...Object.values(scene.topology.nodes),
    ...Object.values(scene.topology.links),
  ];
  const list = elements
    .map((el) => {
      const lbl = 'label' in el && el.label ? el.label : el.id;
      const kind = 'type' in el ? el.type : '';
      const sel = el.id === selectedId ? 'sel' : '';
      const dot = authored.has(el.id) ? '<span class="dot"></span>' : '';
      return `<div class="elrow ${sel}" data-select="${el.id}">
        <span><b>${esc(lbl)}</b> <span class="kind">${kind}</span></span>${dot}
      </div>`;
    })
    .join('');

  return `
    <aside class="panel">
      <div class="panel-h">
        ${beat ? `Beat ${beatIndex + 1}: <input id="beatName" value="${esc(beat.name)}"/>` : 'Base topology'}
      </div>
      ${beat ? `<textarea id="beatNote" placeholder="Presenter note…">${esc(beat.note ?? '')}</textarea>` : ''}
      <div class="tip">${
        beat
          ? 'Click an element on the canvas to author it. Drag a node to move it — this beat records where it goes.'
          : 'Base topology — drag nodes to set their default position. Pick a beat below to choreograph.'
      }</div>
      <div class="el-list">${list}</div>
      ${problems.length ? `<div class="problems">⚠ ${problems.length} problem(s):<br/>${problems.map(esc).join('<br/>')}</div>` : `<div class="ok">✓ scene resolves cleanly</div>`}
    </aside>`;
}

function beatStrip(): string {
  const baseChip = `<button class="beat ${beatIndex === -1 ? 'on' : ''}" data-beat="-1"><span class="bn">Base</span></button>`;
  const chips = scene.beats
    .map(
      (b, i) =>
        `<button class="beat ${beatIndex === i ? 'on' : ''}" data-beat="${i}">
          <span class="bi">${i + 1}</span><span class="bn">${esc(b.name)}</span>
        </button>`,
    )
    .join('<span class="arrow">→</span>');

  return `
    <footer class="strip">
      ${mode === 'editor' ? baseChip + '<span class="arrow">→</span>' : ''}
      ${chips}
      ${mode === 'editor' ? `<button class="beat add" id="addBeat">＋ beat</button>` : ''}
    </footer>`;
}

/* ------------------------------------------------------------------ *
 * Interaction wiring
 * ------------------------------------------------------------------ */
function wire(): void {
  app.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      mode = b.dataset.mode as typeof mode;
      if (mode === 'presenter' && beatIndex < 0) beatIndex = 0;
      selectedId = null;
      draw();
    }),
  );

  app.querySelectorAll<HTMLButtonElement>('[data-beat]').forEach((b) =>
    b.addEventListener('click', () => {
      beatIndex = Number(b.dataset.beat);
      draw();
    }),
  );

  app.querySelector('#addBeat')?.addEventListener('click', () => {
    const n = scene.beats.length + 1;
    scene.beats.push({
      id: `b${Date.now()}`,
      name: `Beat ${n}`,
      overrides: {},
    });
    beatIndex = scene.beats.length - 1;
    draw();
  });

  app.querySelectorAll<HTMLElement>('[data-select]').forEach((row) =>
    row.addEventListener('click', () => {
      selectedId = row.dataset.select!;
      draw();
    }),
  );

  app
    .querySelector<HTMLInputElement>('#beatName')
    ?.addEventListener('change', (e) => {
      const beat = scene.beats[beatIndex];
      if (beat) beat.name = (e.target as HTMLInputElement).value;
      draw();
    });
  app
    .querySelector<HTMLTextAreaElement>('#beatNote')
    ?.addEventListener('change', (e) => {
      const beat = scene.beats[beatIndex];
      if (beat) beat.note = (e.target as HTMLTextAreaElement).value;
    });

  if (mode === 'editor') wireCanvas();

  // Presenter: click canvas / overlay to advance.
  if (mode === 'presenter') {
    app.querySelector('.stage')?.addEventListener('click', () => advance(1));
  }
}

/** Inline-control buttons (rewired whenever the controls are (re)rendered). */
function wireInline(): void {
  const box = app.querySelector<HTMLDivElement>('.inline');
  if (!box || !selectedId) return;
  const id = selectedId;
  box.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const resolved = resolve(scene, beatIndex);
      const el = resolved.elements[id]!;
      const ov = scene.beats[beatIndex]?.overrides[id] ?? {};
      switch (b.dataset.act) {
        case 'visible':
          setOverrideField(scene, beatIndex, id, 'visible', !el.visible);
          break;
        case 'clear-visible':
          clearOverrideField(scene, beatIndex, id, 'visible');
          break;
        case 'emphasis':
          setOverrideField(
            scene,
            beatIndex,
            id,
            'emphasis',
            cycleEmphasis(ov.emphasis),
          );
          break;
        case 'flow':
          setOverrideField(scene, beatIndex, id, 'flowActive', !el.flowActive);
          break;
        case 'clear-flow':
          clearOverrideField(scene, beatIndex, id, 'flowActive');
          break;
        case 'clear-pos':
          clearOverrideField(scene, beatIndex, id, 'x');
          clearOverrideField(scene, beatIndex, id, 'y');
          break;
      }
      draw();
    }),
  );
}

/** Canvas selection + drag-to-author. */
function wireCanvas(): void {
  const svg = app.querySelector<SVGSVGElement>('.canvas svg');
  if (!svg) return;

  svg.addEventListener('pointerdown', (e) => {
    const target = e.target as Element;
    const group = target.closest('[data-id]') as SVGElement | null;
    if (!group) {
      // Click on empty canvas clears the selection.
      if (selectedId !== null) {
        selectedId = null;
        draw();
      }
      return;
    }
    const id = group.dataset.id!;
    selectedId = id;

    // Only nodes drag; links are selected for their toggles.
    if (isNode(id)) {
      startDrag(svg, group as SVGGElement, id, e);
    } else {
      draw();
    }
  });
}

/** Live node drag: follow the cursor, commit to the model/beat on release. */
function startDrag(
  svg: SVGSVGElement,
  group: SVGGElement,
  id: ElementId,
  down: PointerEvent,
): void {
  const start = clientToUser(svg, down.clientX, down.clientY);
  const el = resolve(scene, beatIndex).elements[id]!;
  const origin = { x: el.x, y: el.y };
  let moved = false;
  let last = origin;
  group.setPointerCapture(down.pointerId);
  document.body.classList.add('dragging');

  const onMove = (e: PointerEvent): void => {
    const p = clientToUser(svg, e.clientX, e.clientY);
    last = { x: origin.x + (p.x - start.x), y: origin.y + (p.y - start.y) };
    if (Math.abs(p.x - start.x) > 1 || Math.abs(p.y - start.y) > 1)
      moved = true;
    group.setAttribute('transform', `translate(${last.x},${last.y})`);
  };
  const onUp = (): void => {
    group.releasePointerCapture(down.pointerId);
    document.body.classList.remove('dragging');
    svg.removeEventListener('pointermove', onMove);
    svg.removeEventListener('pointerup', onUp);
    if (moved) moveNode(scene, beatIndex, id, last.x, last.y);
    draw();
  };
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
}

function advance(dir: 1 | -1): void {
  const next = beatIndex + dir;
  if (next < 0 || next >= scene.beats.length) return;
  beatIndex = next;
  draw();
}

window.addEventListener('keydown', (e) => {
  if (mode !== 'presenter') return;
  if (e.key === 'ArrowRight' || e.key === ' ') advance(1);
  if (e.key === 'ArrowLeft') advance(-1);
});

function esc(s: string): string {
  return s.replace(/[<>&"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;',
  );
}

draw();
