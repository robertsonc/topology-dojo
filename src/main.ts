import { resolve, validate } from './core/resolve.js';
import { renderScene } from './render-svg/render.js';
import { sampleScene } from './sample-scene.js';
import type { ElementOverride, Scene } from './core/model.js';

/* ------------------------------------------------------------------ *
 * App state (UI-only; the Scene is the document of record)
 * ------------------------------------------------------------------ */
const scene: Scene = structuredClone(sampleScene);
let mode: 'editor' | 'presenter' = 'editor';
/** In editor: which beat we're authoring (-1 = base). In presenter: current beat. */
let beatIndex = 0;

const app = document.getElementById('app')!;

/* ------------------------------------------------------------------ *
 * Render
 * ------------------------------------------------------------------ */
function draw(): void {
  const problems = validate(scene);
  const resolved = resolve(scene, beatIndex);
  const svg = renderScene(resolved);

  app.innerHTML = `
    <header class="bar">
      <div class="brand">Topology Dojo <span class="proto">beat model</span></div>
      <div class="modes">
        <button class="${mode === 'editor' ? 'on' : ''}" data-mode="editor">✎ Author</button>
        <button class="${mode === 'presenter' ? 'on' : ''}" data-mode="presenter">▶ Present</button>
      </div>
    </header>

    <div class="stage">
      <div class="canvas">${svg}</div>
      ${mode === 'presenter' ? presenterOverlay(resolved.note, resolved.beatName) : ''}
    </div>

    ${mode === 'editor' ? editorPanel(problems) : ''}
    ${beatStrip()}
  `;

  wire();
}

function presenterOverlay(note: string | undefined, name: string): string {
  return `
    <div class="presenter-hint">click anywhere / → to advance · ← to go back</div>
    <div class="speaker">
      <div class="speaker-beat">${beatIndex + 1} / ${scene.beats.length} — ${esc(name)}</div>
      <div class="speaker-note">${esc(note ?? '')}</div>
    </div>`;
}

function editorPanel(problems: string[]): string {
  const beat = beatIndex >= 0 ? scene.beats[beatIndex] : undefined;
  const elements = [
    ...Object.values(scene.topology.nodes),
    ...Object.values(scene.topology.links),
  ];

  const rows = beat
    ? elements
        .map((el) => {
          const ov: ElementOverride = beat.overrides[el.id] ?? {};
          const label = 'label' in el && el.label ? el.label : el.id;
          const kind = 'type' in el ? el.type : '';
          return `<tr>
            <td class="el"><b>${esc(label)}</b><span class="kind">${kind}</span></td>
            <td><button class="chip ${ov.visible === false ? '' : 'on'}" data-tog="visible" data-id="${el.id}">${ov.visible === false ? 'hidden' : 'shown'}</button></td>
            <td><button class="chip ${ov.emphasis === 'focus' ? 'focus' : ov.emphasis === 'dim' ? 'dim' : ''}" data-tog="emphasis" data-id="${el.id}">${ov.emphasis ?? 'neutral'}</button></td>
            <td><button class="chip ${ov.flowActive ? 'on' : ''}" data-tog="flow" data-id="${el.id}">${ov.flowActive ? 'flow' : '—'}</button></td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="4" class="muted">Base topology — select a beat to author its deltas.</td></tr>`;

  return `
    <aside class="panel">
      <div class="panel-h">
        ${beat ? `Beat ${beatIndex + 1}: <input id="beatName" value="${esc(beat.name)}"/>` : 'Base topology'}
      </div>
      ${beat ? `<textarea id="beatNote" placeholder="Presenter note…">${esc(beat.note ?? '')}</textarea>` : ''}
      <table class="ov">
        <thead><tr><th>Element</th><th>Visible</th><th>Emphasis</th><th>Flow</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${problems.length ? `<div class="problems">⚠ ${problems.length} problem(s):<br/>${problems.map(esc).join('<br/>')}</div>` : `<div class="ok">✓ scene resolves cleanly</div>`}
      <div class="hint">Each beat stores only what <i>changes</i> from the beat before it. That's the whole model — no acts, no steps, no time ruler.</div>
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

  // Override toggles
  app.querySelectorAll<HTMLButtonElement>('[data-tog]').forEach((b) =>
    b.addEventListener('click', () => {
      const beat = scene.beats[beatIndex];
      if (!beat) return;
      const id = b.dataset.id!;
      const ov: ElementOverride = { ...(beat.overrides[id] ?? {}) };
      const tog = b.dataset.tog;
      if (tog === 'visible') ov.visible = ov.visible === false ? true : false;
      else if (tog === 'flow') ov.flowActive = !ov.flowActive;
      else if (tog === 'emphasis')
        ov.emphasis =
          ov.emphasis === undefined
            ? 'focus'
            : ov.emphasis === 'focus'
              ? 'dim'
              : undefined;
      beat.overrides[id] = ov;
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

  // Presenter: click canvas / overlay to advance
  if (mode === 'presenter') {
    app.querySelector('.stage')?.addEventListener('click', () => advance(1));
  }
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
