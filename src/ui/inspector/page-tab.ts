/**
 * The Page tab of the properties panel: the current page's own settings.
 *
 * These edit the document contract directly (page name, canvas size, link
 * attachment, playback); the same fields are settable headlessly through the
 * MCP set_page_properties tool, so this surface is not GUI-only.
 */
import { LINK_ATTACH_FIELDS } from '../../api/catalog.js';
import { DEFAULT_PAGE_DURATION } from '../../pages/playback.js';
import { icon } from '../icons.js';
import { parseNumberField } from '../number-field.js';
import type { InspectorContext } from './context.js';
import { esc } from './html.js';
import { wireNumberInput } from './number-input.js';
import { sectionHtml } from './sections.js';

/** The page's annotations list, drawn by the shell, and how many there are. */
export interface AnnotationsPart {
  html: string;
  count: number;
}

export function pageTabHtml(
  ctx: InspectorContext,
  annotations: AnnotationsPart,
): string {
  const { sections } = ctx;
  return (
    sectionHtml(sections, 'Page', pageRows(ctx), { open: true }) +
    sectionHtml(sections, 'Links', linkRows(ctx), {
      open: true,
      hint: 'How links meet nodes on this page. A node can override these.',
    }) +
    sectionHtml(sections, 'Story', storyRows(ctx), { open: true }) +
    sectionHtml(sections, 'Playback', playbackRows(ctx), { open: false }) +
    sectionHtml(sections, 'Annotations', annotations.html, {
      open: false,
      count: annotations.count,
    })
  );
}

function pageRows(ctx: InspectorContext): string {
  const page = ctx.editor.page;
  const [, , w, h] = page.viewBox.split(/\s+/).map(Number);
  return (
    `<label class="insp-row"><span>Name</span><input id="p-name" value="${esc(page.name)}"/></label>` +
    `<div class="insp-row"><span>Canvas</span><span class="insp-pair">` +
    `<input type="number" id="p-w" min="1" value="${w || 0}" aria-label="Canvas width" title="Width"/>` +
    `<input type="number" id="p-h" min="1" value="${h || 0}" aria-label="Canvas height" title="Height"/></span></div>` +
    `<div class="insp-row"><span>Size</span><span class="insp-btns"><button class="tbtn ab" id="p-fit" title="Resize the page to wrap all content (Tidy/Balance grow it automatically)">${icon('fit-page')} fit to content</button></span></div>`
  );
}

function linkRows(ctx: InspectorContext): string {
  const page = ctx.editor.page;
  return (
    // Link anchor box — page-level; nodes may override it.
    `<label class="insp-row" title="Links attach to a padded box that clears the node label instead of the icon edge. On for new documents; nodes can override it in their Properties."><span>Anchor box</span><input type="checkbox" id="p-attach"${page.linkAttach ? ' checked' : ''}/></label>` +
    (page.linkAttach
      ? `<label class="insp-row"><span>Box padding</span><input type="number" id="p-attach-pad" min="0" max="200" step="any" placeholder="6" value="${page.linkAttach.pad ?? ''}"/></label>` +
        `<label class="insp-row" title="Spread every link endpoint on a node side into evenly spaced slots"><span>Distribute ends</span><input type="checkbox" id="p-attach-dist"${page.linkAttach.distribute ? ' checked' : ''}/></label>`
      : '') +
    `<label class="insp-row" title="Draw a hop where standard line links cross others — the classic 'these wires aren't joined' notation"><span>Crossings</span><select id="p-jumps">` +
    `<option value=""${!page.lineJumps ? ' selected' : ''}>overlap (none)</option>` +
    `<option value="arc"${page.lineJumps === 'arc' ? ' selected' : ''}>jump — arc</option>` +
    `<option value="gap"${page.lineJumps === 'gap' ? ' selected' : ''}>jump — gap</option>` +
    `</select></label>` +
    `<label class="insp-row" title="How endpoint (port) labels draw: a glass chip beside the wire, or a dark pill on the node edge at the attach point (wiring-sheet style — pair with the anchor box's Distribute ends)"><span>Port labels</span><select id="p-portlabels">` +
    `<option value="chip"${page.portLabels !== 'pill' ? ' selected' : ''}>chip beside the wire</option>` +
    `<option value="pill"${page.portLabels === 'pill' ? ' selected' : ''}>pill on the node edge</option>` +
    `</select></label>`
  );
}

/** Caption and emphasis (frame storytelling, 2.1 / 2.2 / 2.4). */
function storyRows(ctx: InspectorContext): string {
  const page = ctx.editor.page;
  const emph = new Set(page.emphasis ?? []);
  const total = page.nodes.length + page.links.length;
  const item = (id: string, label: string, type: string): string =>
    `<label class="emph-row"><input type="checkbox" class="emph-cb" data-eid="${esc(id)}"${emph.has(id) ? ' checked' : ''}/>` +
    `<span class="emph-label">${esc(label || id)}</span><span class="emph-type">${esc(type)}</span></label>`;
  const nodeRows = page.nodes
    .map((n) => item(n.id, n.label ?? n.type, n.type))
    .join('');
  const linkRows = page.links
    .map((l) => item(l.id, l.label ?? `${l.from}→${l.to}`, l.type))
    .join('');
  const picker =
    total === 0
      ? `<div class="insp-hint">No elements on this frame.</div>`
      : `<div class="emph-list scroll-slim">${nodeRows}${linkRows}</div>`;
  return (
    `<label class="insp-row"><span>Caption</span>` +
    `<input id="p-caption" value="${esc(page.caption ?? '')}" placeholder="what this frame shows"/></label>` +
    `<div class="insp-row"><span>Emphasis</span><span class="insp-val">${emph.size} of ${total}</span></div>` +
    `<div class="insp-hint">Tick elements to spotlight; the rest dim. Or right-click a selection → “Emphasize on this frame”.</div>` +
    `<div class="emph-actions">` +
    `<button class="insp-btn" id="p-emph-clear"${emph.size ? '' : ' disabled'}>Clear emphasis</button></div>` +
    picker
  );
}

function playbackRows(ctx: InspectorContext): string {
  const page = ctx.editor.page;
  return (
    `<label class="insp-row"><span>Hold (ms)</span><input type="number" id="p-dur" min="100" step="100" placeholder="${DEFAULT_PAGE_DURATION}" value="${page.duration ?? ''}"/></label>` +
    `<label class="insp-row"><span>Transition</span><select id="p-tr">` +
    `<option value="cut"${page.transition !== 'fade' ? ' selected' : ''}>cut</option>` +
    `<option value="fade"${page.transition === 'fade' ? ' selected' : ''}>fade</option>` +
    `</select></label>`
  );
}

export function wirePageTab(ctx: InspectorContext): void {
  const { root, editor } = ctx;
  const name = root.querySelector<HTMLInputElement>('#p-name');
  name?.addEventListener('input', () => editor.renamePage(name.value));
  // Canvas size reframes the page, so commit on change (blur/Enter), not keystroke.
  const wIn = root.querySelector<HTMLInputElement>('#p-w');
  const hIn = root.querySelector<HTMLInputElement>('#p-h');
  const applySize = (): void => {
    if (!wIn || !hIn) return;
    const [vx, vy, vw, vh] = editor.page.viewBox.split(/\s+/).map(Number);
    // A canvas always has a size: a blank, zero or negative entry is not one,
    // so the field goes back to the size the page has.
    const size = (input: HTMLInputElement, now: number | undefined): number => {
      const parsed = parseNumberField(
        input.value,
        { min: 0, exclusiveMin: true },
        { required: true, badInput: input.validity.badInput },
      );
      const px = parsed.kind === 'value' ? Math.round(parsed.value) : 0;
      return px >= 1 ? px : now || 0;
    };
    const w = size(wIn, vw);
    const h = size(hIn, vh);
    wIn.value = String(w);
    hIn.value = String(h);
    if (w === vw && h === vh) return;
    editor.setViewBox(`${vx || 0} ${vy || 0} ${w} ${h}`);
  };
  wIn?.addEventListener('change', applySize);
  hIn?.addEventListener('change', applySize);
  root
    .querySelector('#p-fit')
    ?.addEventListener('click', () => ctx.run('page.fitToContent'));
  // Playback timing — same fields the MCP set_page_properties tool sets.
  // Routed through updatePageProps so the edits land on the undo stack (#205).
  const dur = root.querySelector<HTMLInputElement>('#p-dur');
  dur?.addEventListener('change', () => {
    const v = Number(dur.value);
    editor.updatePageProps({
      duration: Number.isFinite(v) && v > 0 ? v : undefined,
    });
  });
  const tr = root.querySelector<HTMLSelectElement>('#p-tr');
  tr?.addEventListener('change', () => {
    editor.updatePageProps({
      transition: tr.value === 'fade' ? 'fade' : undefined,
    });
  });
  const jumps = root.querySelector<HTMLSelectElement>('#p-jumps');
  jumps?.addEventListener('change', () => {
    editor.updatePageProps({
      lineJumps:
        jumps.value === 'arc' || jumps.value === 'gap'
          ? jumps.value
          : undefined,
    });
  });
  const portLabels = root.querySelector<HTMLSelectElement>('#p-portlabels');
  portLabels?.addEventListener('change', () => {
    editor.updatePageProps({
      portLabels: portLabels.value === 'pill' ? 'pill' : undefined,
    });
  });
  // Link anchor box — page-level; the art redraws on change.
  const attachOn = root.querySelector<HTMLInputElement>('#p-attach');
  attachOn?.addEventListener('change', () => {
    editor.updatePageProps({
      linkAttach: attachOn.checked ? { ...editor.page.linkAttach } : undefined,
    });
    ctx.rerender();
  });
  const attachPad = root.querySelector<HTMLInputElement>('#p-attach-pad');
  if (attachPad)
    wireNumberInput(
      attachPad,
      LINK_ATTACH_FIELDS.find((f) => f.key === 'pad'),
      (val) => {
        const next = { ...editor.page.linkAttach };
        if (val === undefined) delete next.pad;
        else next.pad = val;
        editor.updatePageProps({ linkAttach: next }, ctx.firstEdit());
      },
      () => editor.page.linkAttach?.pad,
    );
  const attachDist = root.querySelector<HTMLInputElement>('#p-attach-dist');
  attachDist?.addEventListener('change', () => {
    const next = { ...editor.page.linkAttach };
    if (attachDist.checked) next.distribute = true;
    else delete next.distribute;
    editor.updatePageProps({ linkAttach: next });
  });
  wireStory(ctx);
}

/** Caption and the emphasis picker / actions (Phase 2). */
function wireStory(ctx: InspectorContext): void {
  const { root, editor } = ctx;
  const cap = root.querySelector<HTMLInputElement>('#p-caption');
  cap?.addEventListener('input', () => {
    // Undoable via updatePageProps; a typing run snapshots once.
    editor.updatePageProps(
      { caption: cap.value || undefined },
      ctx.firstEdit(),
    );
  });
  root
    .querySelector('#p-emph-clear')
    ?.addEventListener('click', () => ctx.run('page.emphasis.clear'));
  root.querySelectorAll<HTMLInputElement>('.emph-cb').forEach((cb) => {
    cb.addEventListener('change', () => {
      editor.toggleEmphasis(cb.dataset.eid!);
      ctx.rerender();
    });
  });
}
