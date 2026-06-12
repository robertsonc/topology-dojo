/**
 * Standalone flipbook export — one self-contained HTML document that embeds
 * every page's rendered SVG plus the playback schedule, and plays them on
 * their durations (loop, play/pause, frame dots, fade transitions). No
 * external assets, no server: the artifact an agent hands a human to watch a
 * flow end to end.
 *
 * DOM-free builder: the renderer is injected (Node or Worker), same as the
 * MCP render path.
 */
import type { TopologyDocument } from '../pages/model.js';
import { flipbookSchedule } from '../pages/playback.js';

export interface FlipbookRenderer {
  (doc: TopologyDocument, pageIndex: number): string;
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

export function exportFlipbookHTML(
  doc: TopologyDocument,
  renderPage: FlipbookRenderer,
): string {
  const schedule = flipbookSchedule(doc);
  const frames = doc.pages
    .map(
      (page, i) =>
        `<div class="frame${i === 0 ? ' on' : ''}" data-frame="${i}" data-name="${escAttr(page.name)}">${renderPage(doc, i)}</div>`,
    )
    .join('\n');
  const dots = doc.pages
    .map(
      (_, i) =>
        `<button class="dot${i === 0 ? ' on' : ''}" data-go="${i}"></button>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escAttr(doc.title)} — flipbook</title>
<style>
  body { margin: 0; background: #14161c; color: #c8ccd4; font: 13px/1.4 ui-monospace, monospace; }
  .stage { display: grid; place-items: center; min-height: calc(100vh - 56px); }
  .frame { display: none; max-width: 96vw; }
  .frame.on { display: block; }
  .frame.fade { animation: fadein 400ms ease; }
  @keyframes fadein { from { opacity: 0; } to { opacity: 1; } }
  .frame svg { max-width: 96vw; height: auto; }
  .bar { position: fixed; inset: auto 0 0 0; height: 56px; display: flex; gap: 12px;
         align-items: center; justify-content: center; background: #1d1f27; }
  button { background: #292d3a; color: #c8ccd4; border: 1px solid #3a3f4f;
           border-radius: 6px; padding: 6px 14px; cursor: pointer; font: inherit; }
  .dot { width: 12px; height: 12px; border-radius: 50%; padding: 0; }
  .dot.on { background: #01a982; border-color: #01a982; }
  .name { min-width: 14ch; text-align: center; opacity: 0.8; }
</style>
<div class="stage">
${frames}
</div>
<div class="bar">
  <button id="play">⏸</button>
  ${dots}
  <span class="name" id="name"></span>
</div>
<script>
  const SCHEDULE = ${JSON.stringify(schedule.frames)};
  const frames = [...document.querySelectorAll('.frame')];
  const dotEls = [...document.querySelectorAll('.dot')];
  const nameEl = document.getElementById('name');
  const playBtn = document.getElementById('play');
  let i = 0, timer = null;
  function show(n, animate) {
    i = (n + frames.length) % frames.length;
    frames.forEach((f, k) => {
      f.classList.toggle('on', k === i);
      f.classList.toggle('fade', k === i && animate && SCHEDULE[i].transition === 'fade');
    });
    dotEls.forEach((d, k) => d.classList.toggle('on', k === i));
    nameEl.textContent = frames[i].dataset.name;
  }
  function tick() { timer = setTimeout(() => { show(i + 1, true); tick(); }, SCHEDULE[i].duration); }
  function play() { stop(); tick(); playBtn.textContent = '⏸'; }
  function stop() { if (timer) clearTimeout(timer); timer = null; playBtn.textContent = '▶'; }
  playBtn.addEventListener('click', () => (timer ? stop() : play()));
  dotEls.forEach((d) => d.addEventListener('click', () => { stop(); show(Number(d.dataset.go), false); }));
  show(0, false);
  ${doc.pages.length > 1 ? 'play();' : 'stop();'}
</script>
</html>`;
}
