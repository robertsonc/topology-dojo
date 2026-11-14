/**
 * Topology Dojo — flipbook editor shell.
 *
 * The shell (header, stage, status bar) is built once; the Editor owns the
 * canvas (art + interaction overlay) and the filmstrip — a hideable overlay
 * floating at the canvas's bottom-left — is re-rendered on page changes.
 */
// Self-hosted JetBrains Mono (bundled by Vite — no external font fetch at runtime).
// Latin-only subset: the UI is latin, and the aggregate weight CSS ships six
// @font-face subsets (cyrillic/greek/vietnamese/…) per weight, bloating the
// deployed bundle 6x for glyphs this app never draws.
import { pageFramedForExport } from './render/content-bounds.js';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import { Editor, type InlineEditRequest } from './editor/editor.js';
import { clientToUser } from './editor/coords.js';
import {
  applyPalette,
  engineDefs,
  renderPageSVG,
  type RenderOptions,
} from './vendor/topology-ds.js';
import {
  blankPage,
  duplicatePage,
  pageHasContent,
  sampleDocument,
  type Page,
  type TopologyDocument,
  type Stencil,
  type BrandPalette,
} from './pages/model.js';
import { captureStencil, stencilViewBox } from './editor/stencil.js';
import {
  autosaveKey,
  clearLocal,
  loadLocal,
  parseDoc,
  saveSerialized,
  serializeDoc,
  type DocSlot,
} from './pages/persist.js';
import { AutosaveLedger } from './pages/autosave-ledger.js';
import { DEFAULT_PAGE_DURATION, pageDuration } from './pages/playback.js';
import {
  copyPagePNG,
  downloadBlob,
  exportPagePNG,
  exportPageSVG,
  pagesToPDFBlob,
  pageToSVG,
  selectionPage,
} from './editor/export.js';
import { exportFlipbookHTML } from './render/flipbook.js';
import { documentToDrawioXML } from './export/drawio.js';
import { documentToVsdx } from './export/vsdx.js';
import { documentToPptx } from './export/pptx.js';
import { documentToMermaid } from './export/mermaid.js';
import { userToClient } from './editor/coords.js';
import { nodeBounds } from './api/geometry.js';
import { documentOverlaySVG } from './render/overlays.js';
import { registerHitBoxes } from './render/hit-boxes.js';
import {
  SHEET_SIZE_IDS,
  SHEET_SIZE_LABELS,
  sheetPaperPt,
  sheetViewBox,
  type SheetConfig,
} from './api/sheet.js';
import { captionSVG } from './editor/caption.js';
import { applyRenderTheme, type RenderTheme } from './render/theme.js';
import { buildTemplate, listTemplates } from './api/templates.js';
import { openSdwanWizard } from './ui/sdwan-wizard.js';
import { pageLinkTarget } from './api/page-link.js';
/** Template-picker value that opens the SD-WAN generator instead. */
const SDWAN_WIZARD = '__sdwan';
import { registerCustomNode, registerCustomNodes } from './nodes/render.js';
import { STOCK_NODE_SPECS } from './nodes/stock.js';
import { registerBackdrops } from './render/backdrops.js';
import { openNodeDesigner } from './nodes/designer.js';
import type { CustomNodeSpec } from './nodes/spec.js';
import { mountWorkspacePanel } from './ui/workspace-panel.js';
import { mountProfilePanel } from './ui/profile-panel.js';
import { mountAdminDashboard } from './ui/admin-dashboard.js';
import { overlayActive, registerOverlay } from './ui/overlay.js';
import { nodeLabelNudge, linkLabelNudge } from './ui/label-position.js';
import type { LabelPlacement } from './render/label-placement.js';
import {
  MOBILE_LAYOUT_MQ,
  defaultPanelCollapsed,
  isMobileLayoutWidth,
} from './ui/mobile-layout.js';
import {
  editorInsets,
  fitInsets,
  leftInsetShift,
  type PanelBox,
} from './ui/fit-insets.js';
import {
  escapeReleasesFocus,
  focusKind,
  releasesFocusAfterChange,
  routeKey,
  type FocusFacts,
} from './ui/key-routing.js';
import {
  boundsAttrs,
  findField,
  numberBounds,
  numberFieldText,
  parseNumberField,
} from './ui/number-field.js';
import { isImeKey } from './ui/ime.js';
import { importConfirmText } from './ui/replace-document.js';
import { problemsDockView } from './ui/problems-dock.js';
import { saveChip, type SaveChip } from './ui/save-status.js';
import { checkCustomTypeName, uniqueTypeName } from './ui/custom-type-name.js';
import {
  booleanFieldChecked,
  enumFieldOptions,
  enumFieldValue,
} from './ui/annotation-fields.js';
import { exportRenderOptions } from './ui/export-options.js';
import { exportReport, type ExportState } from './ui/export-status.js';
import { classifyOpenedFile } from './import/open.js';
import { validateDocument, type Problem } from './api/validate.js';
import { analyzeLayout } from './api/layout.js';
import { genId } from './api/builder.js';
import { computeBadgePlacements } from './editor/problem-badges.js';
import {
  LINK_ATTACH_FIELDS,
  filterNodeCatalog,
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
import { SHARE_PUBLIC_WARNING } from './share/copy.js';

// Restore the last session from localStorage, else start from the sample.
const restoredDoc = loadLocal();
const doc: TopologyDocument = restoredDoc ?? sampleDocument();
// Register the shipped cloud-native types, then the document's custom types,
// with the engine before any render.
registerCustomNodes(STOCK_NODE_SPECS);
registerBackdrops(window.TopologyDesigner);
registerCustomNodes(doc.customNodes);
registerHitBoxes(doc.customNodes);
let current = 0;

const app = document.getElementById('app')!;

app.innerHTML = `
  <!-- Shared engine SVG defs (glow/bloom/gradient filters) mounted ONCE at the
       app root, ahead of every consumer in DOM order, so canvas nodes, palette
       previews, and the minimap all resolve url(#tds-*) references here. It must
       live outside any collapsible container and stay in the render tree — hence
       width/height 0 + position:absolute + aria-hidden rather than display:none,
       which would break paint-server resolution in several browsers. -->
  <svg id="tds-defs-sprite" class="svg-defs-sprite" width="0" height="0" aria-hidden="true" focusable="false"></svg>
  <header class="bar scroll-slim">
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
        <button class="tbtn" id="fSave" title="Download the document as a JSON file">download</button>
        <button class="tbtn" id="fOpen" title="Open a JSON file">open</button>
        <button class="tbtn" id="fShare" title="Publish a public share link / manage published links" hidden>share</button>
      </div>
      <span class="bar-div"></span>
      <div class="tgroup">
        <button class="tbtn ticon" id="tUndo" title="Undo (Ctrl/Cmd+Z)" aria-label="Undo">↶</button>
        <button class="tbtn ticon" id="tRedo" title="Redo (Ctrl/Cmd+Shift+Z)" aria-label="Redo">↷</button>
      </div>
      <span class="bar-div"></span>
      <div class="tgroup">
        <button class="tbtn" id="fSvg" title="Export current frame as SVG">svg</button>
        <button class="tbtn" id="fPng" title="Export current frame as PNG">png</button>
        <select class="tbtn" id="fExport" title="More export formats" aria-label="More export formats">
          <option value="">⤓ export…</option>
          <option value="pdf-page">PDF — current frame</option>
          <option value="pdf-all">PDF — all frames</option>
          <option value="flipbook">Flipbook HTML — all frames</option>
          <option value="drawio">draw.io — all frames (editable, lossy)</option>
          <option value="vsdx">Visio .vsdx — all frames (editable, lossy)</option>
          <option value="pptx">PowerPoint .pptx — slide per frame</option>
          <option value="pptx-layers">PowerPoint .pptx — slide per layer</option>
          <option value="mermaid">Mermaid — current frame</option>
          <option value="copy-png">Copy PNG to clipboard</option>
          <option value="svg-selection">SVG — selection only</option>
          <option value="png-selection">PNG — selection only</option>
        </select>
        <span class="export-status" id="exportStatus" role="status" aria-live="polite"></span>
        <select class="tbtn" id="fTemplate" title="New from a starter template" aria-label="New from a starter template"></select>
      </div>
      <input type="file" id="fInput" accept="application/json,.json,.drawio,.xml,.mmd,.mermaid,.csv,.txt" hidden />
      <span class="saved" id="saved"></span>
      <!-- Spoken when a save fails or another tab's version arrives: the
           chip is a button then, so the alert has to be a region of its own. -->
      <span class="visually-hidden" id="saveAlert" role="alert"></span>
    </div>
    <div class="bar-right">
      <div class="tgroup">
        <button class="tbtn on" id="tSelect" title="Select/move tool (V)" aria-label="Select/move tool">⤧<span class="tlabel">select</span></button>
        <button class="tbtn" id="tLink" title="Draw link tool (L)" aria-label="Draw link tool">🔗<span class="tlabel">link</span></button>
        <button class="tbtn" id="tAnchor" title="Drop anchor tool (A) — free-floating link endpoints" aria-label="Drop anchor tool">◇<span class="tlabel">anchor</span></button>
      </div>
      <span class="bar-div"></span>
      <div class="tgroup">
        <button class="tbtn ticon on" id="tGrid" title="Toggle grid (R)" aria-label="Toggle grid">▦</button>
        <button class="tbtn ticon on" id="tSnap" title="Toggle snap (G)" aria-label="Toggle snap">⌗</button>
        <button class="tbtn ticon" id="tCalm" title="Calm canvas — pause animations (C)" aria-label="Calm canvas — pause animations">◓</button>
        <button class="tbtn ticon on" id="tBadges" title="Toggle on-canvas problem badges" aria-label="Toggle on-canvas problem badges">⚠</button>
        <button class="tbtn ticon" id="tDisplay" title="Display settings — ambient, glass" aria-label="Display settings" aria-haspopup="dialog" aria-expanded="false">⚙</button>
        <button class="tbtn ticon" id="tTheme" title="Toggle light / dark theme" aria-label="Toggle light / dark theme">☀</button>
        <button class="tbtn ticon" id="tFit" title="Fit view (0)" aria-label="Fit view">⤢</button>
        <button class="tbtn ticon" id="tPresent" title="Present — full-screen playback of all frames" aria-label="Present full-screen">▶</button>
        <button class="tbtn ticon" id="tHelp" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">?</button>
      </div>
      <span class="bar-div"></span>
      <div class="tgroup">
        <button class="tbtn" id="tDelete" title="Delete selection (Del)" aria-label="Delete selection">🗑<span class="tlabel">delete</span></button>
        <button class="tbtn" id="tTidy" title="Tidy layout — grid-snap + de-overlap (T)" aria-label="Tidy layout">✦<span class="tlabel">tidy</span></button>
        <button class="tbtn" id="tBalance" title="Balance layout — align rows/columns + centre (Shift+T)" aria-label="Balance layout">⚖<span class="tlabel">balance</span></button>
        <select class="tbtn" id="tLayout" title="Auto-arrange with a layout algorithm" aria-label="Auto-arrange with a layout algorithm">
          <option value="">⤢ arrange…</option>
          <option value="hierarchical">hierarchical</option>
          <option value="grid">grid</option>
          <option value="circular">circular</option>
          <option value="force">force-directed</option>
        </select>
        <select class="tbtn" id="tSelectBy" title="Select nodes by a criterion" aria-label="Select nodes by a criterion">
          <option value="">⛶ select…</option>
          <option value="type">same type</option>
          <option value="color">same color</option>
          <option value="connected">connected (grow)</option>
          <option value="invert">invert</option>
          <option value="all">all</option>
        </select>
      </div>
      <span class="align-group" id="alignGroup" hidden>
        <button class="tbtn ab" data-align="left" title="Align left" aria-label="Align left">⇤</button>
        <button class="tbtn ab" data-align="centerH" title="Align centers (h)" aria-label="Align horizontal centers">⇔</button>
        <button class="tbtn ab" data-align="right" title="Align right" aria-label="Align right">⇥</button>
        <button class="tbtn ab" data-align="top" title="Align top" aria-label="Align top">⤒</button>
        <button class="tbtn ab" data-align="middleV" title="Align middles (v)" aria-label="Align vertical middles">⇕</button>
        <button class="tbtn ab" data-align="bottom" title="Align bottom" aria-label="Align bottom">⤓</button>
        <button class="tbtn ab" data-dist="h" title="Distribute horizontally" aria-label="Distribute horizontally" disabled>↔̲</button>
        <button class="tbtn ab" data-dist="v" title="Distribute vertically" aria-label="Distribute vertically" disabled>↕̲</button>
      </span>
      <span class="bar-div" id="workspaceDiv" hidden></span>
      <button class="tbtn workspace-chip" id="workspaceChip" type="button" aria-haspopup="dialog" aria-expanded="false" title="Agent Workspace" hidden><span class="ws-dot" aria-hidden="true"></span><span id="workspaceLabel">agent · local</span></button>
      <button class="tbtn" id="profileChip" type="button" aria-haspopup="dialog" aria-expanded="false" title="Authoring Preferences" hidden>prefs</button>
      <button class="tbtn" id="adminChip" type="button" aria-haspopup="dialog" aria-expanded="false" title="Admin dashboard" hidden>admin</button>
      <span class="bar-div" id="userDiv" hidden></span>
      <button class="tbtn user-chip" id="userChip" type="button" aria-haspopup="menu" aria-expanded="false" title="Account" aria-label="Account menu" hidden><span class="uc-dot" aria-hidden="true">●</span><span class="tlabel" id="userName"></span><span class="uc-caret" aria-hidden="true">▾</span></button>
    </div>
  </header>

  <!-- Shown while the document on canvas is a /v/<id> shared snapshot: edits
       autosave to a separate slot so the user's own document stays intact
       until they explicitly adopt the copy (#202). -->
  <div class="shared-banner" id="sharedBanner" role="status" hidden>
    <span class="shared-banner-text">${SHARE_PUBLIC_WARNING} Viewing a shared copy — your own document is untouched.</span>
    <button class="tbtn" id="sharedKeep" title="Replace your locally saved document with this shared copy">keep this copy</button>
    <button class="tbtn" id="sharedBack" title="Return to your own locally saved document">back to my document</button>
    <button class="tbtn" id="sharedUnpublish" title="Remove the public snapshot so this link stops working" hidden>unpublish link</button>
  </div>

  <div class="stage">
    <div class="canvas-area" id="canvas-area">
      <aside class="palette" id="palette">
        <button class="palette-toggle" id="palette-toggle" title="Hide node library (B)">nodes ◂</button>
        <input id="palette-search" class="palette-search" type="search" placeholder="Search nodes…" autocomplete="off" aria-label="Search node library">
        <div class="palette-list scroll-slim" id="palette-list"></div>
        <div class="minimap-dock" id="minimap-dock">
          <button class="minimap-toggle" id="minimap-toggle" title="Hide minimap (M)">map ▾</button>
          <svg id="minimap" class="minimap" preserveAspectRatio="xMidYMid meet"></svg>
        </div>
      </aside>
      <div class="tds-root">
        <div class="tds-canvas-row">
          <div class="tds-canvas canvas-host">
            <svg id="page-canvas" preserveAspectRatio="xMidYMid meet"></svg>
            <svg id="overlay" class="overlay" preserveAspectRatio="xMidYMid meet"></svg>
          </div>
        </div>
      </div>
      <!-- The canvas's bottom band, floating over it to the right of the node
           library: the frames strip, then the view controls. They share one
           row while both fit; otherwise the controls sit above the strip. -->
      <div class="canvas-dock" id="canvas-dock">
        <div class="frames-dock" id="frames-dock" role="region" aria-label="Frames">
          <button class="frames-toggle" id="frames-toggle" type="button" aria-expanded="true" title="Hide frames (F)">pages <span class="frames-ind" id="frames-ind">1/1</span> <span class="frames-chev" aria-hidden="true">◂</span></button>
          <div class="frames-reveal">
            <div class="filmstrip scroll-slim" id="filmstrip"></div>
          </div>
        </div>
        <div class="canvas-ctrls" id="canvasCtrls" role="group" aria-label="Canvas view">
          <button class="cc-btn" id="ccHand" title="Hand / pan tool (hold Space to pan anytime)" aria-label="Hand / pan tool">✋</button>
          <button class="cc-btn" id="ccZoomIn" title="Zoom in" aria-label="Zoom in">+</button>
          <button class="cc-btn cc-zoom" id="ccZoom" title="Fit view (0)" aria-label="Zoom level — fit view">100%</button>
          <button class="cc-btn" id="ccZoomOut" title="Zoom out" aria-label="Zoom out">−</button>
          <button class="cc-btn" id="ccFit" title="Fit to content (0)" aria-label="Fit to content">⤢</button>
        </div>
      </div>
    </div>
    <div class="inspector-wrap" id="inspector-wrap">
      <div class="inspector-resizer" id="inspector-resizer" title="Drag to resize"></div>
      <div class="inspector-col">
        <button class="inspector-toggle" id="inspector-toggle" title="Hide properties (P)">hide ▸</button>
        <div class="inspector-body" id="inspector-body">
          <aside class="inspector scroll-slim" id="inspector"></aside>
        </div>
        <div class="problems-dock collapsed" id="problems-dock">
          <button class="problems-toggle" id="problems-toggle" title="Validation + layout problems">
            <span class="pt-label">Problems</span>
            <span class="prob-count" id="prob-count">0</span>
            <span class="prob-hidden-note" id="prob-hidden-note"></span>
            <span class="pt-chev" aria-hidden="true">▸</span>
          </button>
          <div class="problems scroll-slim" id="problems"></div>
        </div>
      </div>
    </div>
  </div>

  <footer class="statusbar scroll-slim" id="statusbar"></footer>
`;

// Populate the root defs sprite once. These are the engine's static shared
// filters/gradients (brand-independent), identical to the copy the palette used
// to inline into #palette-list — but here they can never be unmounted or hidden
// by a panel collapse.
app.querySelector<SVGSVGElement>('#tds-defs-sprite')!.innerHTML = engineDefs();

const artSvg = app.querySelector<SVGSVGElement>('#page-canvas')!;
const overlaySvg = app.querySelector<SVGSVGElement>('#overlay')!;
const strip = app.querySelector<HTMLElement>('#filmstrip')!;
const framesDock = app.querySelector<HTMLDivElement>('#frames-dock')!;
const framesToggle = app.querySelector<HTMLButtonElement>('#frames-toggle')!;
const framesInd = app.querySelector<HTMLElement>('#frames-ind')!;
const savedEl = app.querySelector<HTMLElement>('#saved')!;
const saveAlertEl = app.querySelector<HTMLElement>('#saveAlert')!;

/* Autosave to localStorage (debounced) whenever the document changes.
 *
 * Persistence is honest (#203): saveLocal reports whether the write actually
 * landed, and the status chip never claims "saved" after a failure — instead
 * it becomes a click-to-download recovery affordance that stays until a save
 * succeeds. While viewing a shared /v/<id> snapshot (#202) the autosave goes
 * to a separate slot and the canonical workspace sync is suspended, so a
 * colleague's document can never replace the user's own local autosave or
 * workspace without an explicit adoption. */
let activeSlot: DocSlot = 'local';
/** Share id from the current /v/:id load; used for owner-only unpublish. */
let activeShareId: string | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function downloadDocJSON(): void {
  downloadBlob(
    `${(doc.title || 'topology').replace(/[^\w.-]+/g, '_')}.json`,
    new Blob([serializeDoc(doc)], { type: 'application/json' }),
  );
}

/* Autosave is one localStorage entry shared by every tab on the origin. The
 * ledger records what THIS tab last read or wrote, so an idle tab never writes
 * its stale copy over newer work from another tab (see AutosaveLedger). It
 * starts from the document this tab opened with: when that was restored from
 * storage there is nothing to write until it changes. */
const autosave = new AutosaveLedger();
autosave.record(serializeDoc(doc));
function writeAutosave(): boolean {
  const json = serializeDoc(doc);
  const ok = saveSerialized(json, activeSlot);
  if (ok) autosave.record(json);
  return ok;
}
/** Write only if this tab holds something storage does not. */
function flushAutosave(): void {
  if (autosave.hasUnsaved(serializeDoc(doc))) writeAutosave();
}
// A first visit (nothing stored) saves its starting document once, so the
// slot is never empty while the app is open. It writes over nothing.
if (!restoredDoc) saveSerialized(serializeDoc(doc), 'local');

/** Show a save state in the toolbar chip, and announce it when it is a
 * warning. */
function showSaveChip(chip: SaveChip): void {
  savedEl.textContent = chip.text;
  savedEl.title = chip.title;
  savedEl.classList.toggle('save-failed', chip.state === 'failed');
  savedEl.classList.toggle('save-stale', chip.state === 'stale');
  if (chip.actionable) {
    savedEl.setAttribute('role', 'button');
    savedEl.tabIndex = 0;
  } else {
    savedEl.removeAttribute('role');
    savedEl.removeAttribute('tabindex');
  }
  // Written only when it changes: every edit made while storage is failing
  // fails again, and re-writing the alert would repeat it each time.
  if (saveAlertEl.textContent !== chip.announcement)
    saveAlertEl.textContent = chip.announcement;
}

/** Another tab saved a different document to this tab's slot. Say so, and
 * offer to load it; editing here instead keeps this tab's version. */
function reportChangedElsewhere(): void {
  showSaveChip(saveChip('stale'));
}
function loadFromOtherTab(): void {
  const latest = loadLocal(activeSlot);
  if (!latest) return;
  if (activeSlot === 'local' && !closeWorkspaceForDocumentReplacement()) return;
  loadDoc(latest, false, activeSlot);
}

/** Reflect a persistence attempt in the status chip. */
function reportSave(ok: boolean, okText?: string): void {
  showSaveChip(
    saveChip(ok ? 'saved' : 'failed', {
      shared: activeSlot === 'shared',
      ...(okText ? { okText } : {}),
    }),
  );
}
function savedChipAction(): boolean {
  if (savedEl.classList.contains('save-failed')) downloadDocJSON();
  else if (savedEl.classList.contains('save-stale')) loadFromOtherTab();
  else return false;
  return true;
}
savedEl.addEventListener('click', () => void savedChipAction());
savedEl.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && savedChipAction())
    e.preventDefault();
});

function markDirty(): void {
  savedEl.textContent = '…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    reportSave(writeAutosave());
    if (activeSlot === 'local') scheduleWorkspaceSync();
  }, 400);
}
function onDocChange(): void {
  if (statusReady) updateMiniBar();
  renderFilmstrip();
  renderStatus();
  renderMinimap();
  renderProblems();
  refreshInspectorAfterChange();
  markDirty();
}

// Guards the status bar from rendering before `editor`/`statusbar` are set up
// (the Editor constructor fires onView during construction).
let statusReady = false;
/** Set once the inspector has been drawn for the first time. */
let inspectorReady = false;

/**
 * Keep Properties in step with a change made outside it. A link bent on the
 * canvas, a node dragged or nudged, an undo: the editor reports the change
 * but not a new selection, so the panel would go on showing the old bends,
 * position or values until the element was selected again.
 *
 * While focus is inside the panel the change is the panel's own (a field
 * being typed in, a control just used), and its handlers already redraw what
 * needs it — redrawing here too would take the field out from under the
 * caret.
 */
function refreshInspectorAfterChange(): void {
  if (!inspectorReady || inspector.contains(document.activeElement)) return;
  renderInspector();
}

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
    if (statusReady) updateMiniBar();
  },
  onZoneSelectChange,
);

/**
 * The document-level overlays drawn over a page — the key (legend), the sheet
 * frame, the caption — recoloured for the brand palette like the art beneath
 * them, so the key's swatches match what they are the key to. The theme is
 * applied by whoever composites them: the canvas hook below, or `pageToSVG`
 * for an export.
 */
function pageOverlay(page: Page): string {
  const overlay = documentOverlaySVG(doc, page) + captionSVG(page);
  return doc.palette ? applyPalette(overlay, doc.palette) : overlay;
}
// Draw the auto-legend (B.1) on the canvas — recomputed each overlay paint from
// the elements in use, so it tracks edits live. Off unless the document opts in.
// Themed like the art (#264) so the on-canvas legend/caption read in light mode.
editor.setOverlayExtra(() =>
  applyRenderTheme(pageOverlay(editor.page), currentTheme()),
);

// Feed declared layers (with their visibility/opacity, B.3) into every render so
// hiding/fading a layer takes effect on canvas. Exports pass the same `layers`.
const renderLayerOpts = (): {
  layers: typeof doc.layers;
  linkStyles: typeof doc.linkStyles;
} => ({
  layers: doc.layers,
  linkStyles: doc.linkStyles,
});
editor.setRenderOpts(renderLayerOpts);

/* ── inline label editing (double-click a node / link / zone) ─────────
 * The editor resolves the double-click into a selected element + a client-
 * space anchor; this shell owns the floating <input> and commits through the
 * same update paths the inspector uses, so undo/workspace ops are identical. */
let inlineEditEl: HTMLInputElement | null = null;
function closeInlineEdit(): void {
  inlineEditEl?.remove();
  inlineEditEl = null;
}
function openInlineLabelEditor(req: InlineEditRequest): void {
  closeInlineEdit();
  if (req.kind === 'empty') {
    openQuickAdd(req);
    return;
  }
  if (!req.id) return;
  const host = document.querySelector<HTMLElement>('.canvas-host');
  if (!host) return;
  const hostRect = host.getBoundingClientRect();
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-label-edit';
  input.value = req.current;
  input.setAttribute('aria-label', `Edit ${req.kind} label`);
  const w = Math.max(140, Math.min(360, req.current.length * 9 + 60));
  input.style.width = `${w}px`;
  input.style.left = `${Math.round(req.clientX - hostRect.left - w / 2)}px`;
  input.style.top = `${Math.round(req.clientY - hostRect.top - 15)}px`;
  host.appendChild(input);
  inlineEditEl = input;
  // The page the editor was opened on. Ids repeat across pages (a duplicated
  // frame keeps them), so a commit after a page switch must not land there.
  const pageId = editor.page.id;
  let done = false;
  const commit = (save: boolean): void => {
    if (done) return;
    done = true;
    const val = input.value.trim();
    closeInlineEdit();
    if (!save || val === req.current || editor.page.id !== pageId) return;
    // By id, not by selection: when the commit comes from a blur, the click
    // that caused it has already selected another element (or none).
    editor.renameElement(req.kind as 'node' | 'link' | 'zone', req.id!, val);
    renderInspector();
  };
  input.addEventListener('blur', () => commit(true));
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    // Enter / Escape that confirm or discard an IME candidate are not ours.
    if (isImeKey(e)) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      commit(false);
    }
  });
  input.focus();
  input.select();
}
editor.setInlineEditHandler(openInlineLabelEditor);
// Ctrl/Cmd+click on an element carrying an `href` opens it in a new tab —
// mirroring the clickable <a> the renderer emits in SVG exports and /v/:id.
editor.setOpenHrefHandler((href) => {
  // In-document page link (`#page=<id>`): switch frames, never navigate.
  const target = pageLinkTarget(href);
  if (target !== null) {
    const i = doc.pages.findIndex((p) => p.id === target);
    if (i >= 0) choosePage(i);
    return;
  }
  window.open(href, '_blank', 'noopener');
});

/* ── quick-add (double-click empty canvas → type-to-place a node) ─────
 * A draw.io/Lucid-style creation accelerator: a small popover with the same
 * type-ahead search the Node library uses; Enter/click places the chosen type
 * exactly at the double-clicked point (grid-snapped when snap is on). */
let quickAddEl: HTMLDivElement | null = null;
function closeQuickAdd(): void {
  quickAddEl?.remove();
  quickAddEl = null;
}
function openQuickAdd(req: InlineEditRequest, connectFrom?: string): void {
  closeQuickAdd();
  closeInlineEdit();
  const host = document.querySelector<HTMLElement>('.canvas-host');
  if (!host) return;
  const hostRect = host.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.className = 'quick-add';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute(
    'aria-label',
    connectFrom ? 'Add a connected node here' : 'Add a node here',
  );
  const W = 260;
  const left = Math.max(
    4,
    Math.min(req.clientX - hostRect.left - W / 2, hostRect.width - W - 4),
  );
  const top = Math.max(
    4,
    Math.min(req.clientY - hostRect.top + 10, hostRect.height - 300),
  );
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
  pop.innerHTML =
    `<input type="search" class="qa-input" placeholder="Add node… (type to search)" aria-label="Search node types" autocomplete="off">` +
    `<div class="qa-list scroll-slim" role="listbox"></div>`;
  host.appendChild(pop);
  quickAddEl = pop;
  const input = pop.querySelector<HTMLInputElement>('.qa-input')!;
  const list = pop.querySelector<HTMLDivElement>('.qa-list')!;
  let items: { type: string; label: string }[] = [];
  let active = 0;
  const place = (type: string): void => {
    closeQuickAdd();
    const g = editor.grid;
    const sx = editor.snap
      ? Math.round(req.pageX / g) * g
      : Math.round(req.pageX);
    const sy = editor.snap
      ? Math.round(req.pageY / g) * g
      : Math.round(req.pageY);
    if (connectFrom) editor.quickConnectTo(connectFrom, type, sx, sy);
    else editor.addNode(type, undefined, { x: sx, y: sy });
  };
  const renderList = (): void => {
    items = filterNodeCatalog(input.value, doc.customNodes)
      .slice(0, 8)
      .map((i) => ({ type: i.type, label: i.label }));
    active = Math.min(active, Math.max(0, items.length - 1));
    list.innerHTML = items.length
      ? items
          .map(
            (i, ix) =>
              `<button class="qa-item${ix === active ? ' active' : ''}" role="option" aria-selected="${ix === active}" data-type="${esc(i.type)}">${nodePreviewSVG(i.type)}<span class="plabel">${esc(i.label)}</span></button>`,
          )
          .join('')
      : `<div class="qa-none">No matching node type</div>`;
    list.querySelectorAll<HTMLButtonElement>('.qa-item').forEach((b) =>
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); // beat the input's blur
        place(b.dataset.type!);
      }),
    );
  };
  input.addEventListener('input', () => {
    active = 0;
    renderList();
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (isImeKey(e)) return; // the key belongs to an IME composition
    if (e.key === 'Escape') {
      e.preventDefault();
      closeQuickAdd();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = items[active];
      if (pick) place(pick.type);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      active =
        e.key === 'ArrowDown'
          ? (active + 1) % items.length
          : (active - 1 + items.length) % items.length;
      renderList();
    }
  });
  input.addEventListener('blur', () => {
    // Give a same-popover pointerdown a beat to run first.
    setTimeout(() => {
      if (quickAddEl === pop && !pop.contains(document.activeElement))
        closeQuickAdd();
    }, 120);
  });
  renderList();
  input.focus();
}
/* ── mini style bar (Phase 1.4) ───────────────────────────────────────
 * A compact contextual bar floating above the selection with the top
 * inspector actions — color swatches + frame emphasis for nodes, plus
 * link type / routing for a selected link. Pure convenience over the
 * inspector (same update paths); view state only, nothing persisted. */
const miniBar = document.createElement('div');
miniBar.className = 'mini-bar';
miniBar.hidden = true;
document.querySelector('.canvas-host')?.appendChild(miniBar);

function miniBarHtml(kind: 'node' | 'link'): string {
  const swatches = SWATCHES.map(
    (c) =>
      `<button class="mb-sw" data-mbcolor="${c}" style="background:${c}" title="${c}" aria-label="Color ${c}"></button>`,
  ).join('');
  const emph = `<button class="mb-btn" id="mbEmph" title="Emphasize on this frame" aria-label="Emphasize on this frame">★</button>`;
  if (kind === 'link') {
    const info = editor.selectedLinkInfo();
    const typeOpts = linkCatalog()
      .map(
        (l) =>
          `<option value="${l.type}"${l.type === info?.type ? ' selected' : ''}>${esc(l.label)}</option>`,
      )
      .join('');
    const styleOpts = ['straight', 'orthogonal', 'curved']
      .map(
        (s) =>
          `<option value="${s}"${s === (info?.style ?? 'straight') ? ' selected' : ''}>${s}</option>`,
      )
      .join('');
    return (
      `<select class="mb-sel" id="mbType" title="Link type" aria-label="Link type">${typeOpts}</select>` +
      `<select class="mb-sel" id="mbStyle" title="Routing" aria-label="Link routing">${styleOpts}</select>` +
      `<span class="mb-div"></span>${swatches}<span class="mb-div"></span>${emph}`
    );
  }
  return `${swatches}<span class="mb-div"></span>${emph}`;
}

/** Selection anchor (top-centre of the selection bbox) in client coords. */
function miniBarAnchor(): { x: number; y: number } | null {
  const link = editor.getSelectedLink();
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity;
  if (link) {
    const pts: { x: number; y: number }[] = [];
    for (const id of [link.from, link.to]) {
      const n = editor.page.nodes.find((m) => m.id === id);
      const a = n ?? editor.page.anchors.find((m) => m.id === id);
      if (a) pts.push({ x: a.x, y: a.y });
    }
    pts.push(...(link.waypoints ?? []));
    if (pts.length === 0) return null;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
    }
  } else {
    const sel = editor.selectionElements();
    if (!sel || sel.nodes.length === 0) return null;
    for (const n of sel.nodes) {
      const b = nodeBounds(n);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
    }
  }
  return userToClient(overlaySvg, (minX + maxX) / 2, minY);
}

let miniBarSuppressed = false;
function updateMiniBar(): void {
  const link = editor.getSelectedLink();
  const nodeCount = link ? 0 : (editor.selectionElements()?.nodes.length ?? 0);
  if (miniBarSuppressed || (!link && nodeCount === 0)) {
    miniBar.hidden = true;
    return;
  }
  const anchor = miniBarAnchor();
  const host = document.querySelector<HTMLElement>('.canvas-host');
  if (!anchor || !host) {
    miniBar.hidden = true;
    return;
  }
  const kind = link ? 'link' : 'node';
  if (miniBar.dataset.kind !== kind || miniBar.hidden) {
    miniBar.dataset.kind = kind;
    miniBar.innerHTML = miniBarHtml(kind);
  } else if (kind === 'link') {
    // Keep the selects in sync when a different link is picked.
    const info = editor.selectedLinkInfo();
    const t = miniBar.querySelector<HTMLSelectElement>('#mbType');
    const s = miniBar.querySelector<HTMLSelectElement>('#mbStyle');
    if (t && info) t.value = info.type;
    if (s && info) s.value = info.style;
  }
  miniBar.hidden = false;
  const hostRect = host.getBoundingClientRect();
  const w = miniBar.offsetWidth || 200;
  const left = Math.max(
    4,
    Math.min(anchor.x - hostRect.left - w / 2, hostRect.width - w - 4),
  );
  const top = Math.max(4, anchor.y - hostRect.top - 46);
  miniBar.style.left = `${Math.round(left)}px`;
  miniBar.style.top = `${Math.round(top)}px`;
  const emph = miniBar.querySelector<HTMLButtonElement>('#mbEmph');
  if (emph) {
    const ids = link ? [link.id] : (editor.selectedNodeIds() ?? []);
    const on = ids.length > 0 && ids.every((id) => editor.isEmphasized(id));
    emph.classList.toggle('on', on);
  }
}
miniBar.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const sw = t.closest<HTMLButtonElement>('[data-mbcolor]');
  if (sw) {
    const color = sw.dataset.mbcolor!;
    if (editor.getSelectedLink()) editor.updateLink({ color });
    else editor.updateSelectedNodes({ color });
    renderInspector();
    return;
  }
  if (t.closest('#mbEmph')) {
    const link = editor.getSelectedLink();
    if (link) editor.toggleEmphasis(link.id);
    else editor.emphasizeSelection();
    renderInspector();
    updateMiniBar();
  }
});
miniBar.addEventListener('change', (e) => {
  const t = e.target as HTMLSelectElement;
  if (t.id === 'mbType') editor.updateLink({ type: t.value });
  else if (t.id === 'mbStyle')
    editor.updateLink({
      lineStyle: t.value as 'orthogonal' | 'curved',
    });
  renderInspector();
});
// Hide while a canvas gesture is in flight; re-anchor when it settles.
overlaySvg.addEventListener('pointerdown', () => {
  miniBarSuppressed = true;
  miniBar.hidden = true;
  // Working on the canvas ends flipbook playback: each flip would otherwise
  // drop the selection and switch the frame under the pointer.
  stopPlayback();
});
overlaySvg.addEventListener('pointerup', () => {
  miniBarSuppressed = false;
  // Selection callbacks fire before this listener; re-anchor now.
  setTimeout(updateMiniBar, 0);
});

// A link dragged out from a node and released over empty canvas offers the
// same picker in connect mode: pick a type → node + link in one undo step.
editor.setConnectEmptyHandler((req) =>
  openQuickAdd(
    {
      kind: 'empty',
      id: null,
      current: '',
      clientX: req.clientX,
      clientY: req.clientY,
      pageX: req.pageX,
      pageY: req.pageY,
    },
    req.from,
  ),
);

/*
 * Tell the editor how much of the canvas the floating panels cover, so
 * fit-to-content frames the *visible* area and never tucks edge content behind
 * the node library, the bottom band or the properties drawer. Recomputed on
 * each fit (panels collapse/expand).
 */
/** A floating panel's box, or null while it is collapsed or not laid out. */
const openPanelBox = (id: string): PanelBox | null => {
  const el = document.getElementById(id);
  if (!el || el.classList.contains('collapsed')) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
};
/** The left inset the editor's latest fit was computed with (see fitView). */
let fitLeftInset = 0;
editor.setViewInsets(() => {
  const insets = fitInsets({
    canvas: overlaySvg.getBoundingClientRect(),
    palette: openPanelBox('palette'),
    inspector: openPanelBox('inspector-wrap'),
    // The view controls are always in the bottom band, so it is reserved
    // with the frames strip collapsed too.
    dock: openPanelBox('canvas-dock'),
  });
  fitLeftInset = insets.left;
  return editorInsets(insets);
});
/*
 * The editor's fit takes a right and a bottom inset and centres the content
 * in what is left, measured from the canvas's left edge — it has no notion of
 * a panel on the left. So the left inset reaches it folded into the right one
 * (which gets the scale right), and once the editor has fitted, the view is
 * moved here so the content sits past the node library instead of under it.
 * Every fit the shell asks for goes through fitView / showPage for that.
 */
function settleFit(): void {
  const left = fitLeftInset;
  fitLeftInset = 0;
  const width = overlaySvg.getBoundingClientRect().width;
  const view = editor.getView();
  const shift = leftInsetShift(view.w, width, left);
  if (shift > 0) editor.panTo(view.x + view.w / 2 - shift, view.y + view.h / 2);
}
/** Fit the view to the page's content, clear of the floating panels. */
function fitView(): void {
  fitLeftInset = 0;
  editor.resetView();
  settleFit();
}
/** Show a page in the editor, fitted clear of the floating panels. */
function showPage(page: Page): void {
  fitLeftInset = 0;
  editor.setPage(page);
  settleFit();
}
// Initial fit once the canvas has real dimensions (constructor ran pre-layout).
requestAnimationFrame(fitView);

/* Replace the whole document (open / new) and refresh everything.
 * `slot` is the autosave destination: every explicit replacement (new, open,
 * template, workspace adoption) is the user's own document again, so the
 * default exits shared-copy mode and releases its slot (#202). */
// Declared here, not with the rest of playback further down: `loadDoc` stops
// playback and runs during start-up, before that code is reached.
let playTimer: number | null = null;
function loadDoc(
  next: TopologyDocument,
  sync = true,
  slot: DocSlot = 'local',
  sameDocument = false,
): void {
  // A different document: its history starts empty and nothing is playing.
  // `sameDocument` is the one exception — the open workspace document moving
  // to another revision (a pull, an accepted proposal, a restored checkpoint)
  // is still the document the user was editing, so their undo steps stay.
  stopPlayback();
  if (!sameDocument) editor.resetHistory();
  activeSlot = slot;
  if (slot === 'local') {
    activeShareId = undefined;
    clearLocal('shared');
  }
  updateSharedBanner();
  doc.title = next.title;
  doc.pages = structuredClone(next.pages);
  doc.customNodes = structuredClone(next.customNodes);
  for (const key of [
    'layers',
    'legend',
    'stencils',
    'palette',
    'linkStyles',
    'sheet',
    'tiers',
    'bundles',
    'catalogVersion',
  ] as const) {
    if (next[key] === undefined) delete doc[key];
    else (doc[key] as unknown) = structuredClone(next[key]);
  }
  registerCustomNodes(doc.customNodes);
  registerHitBoxes(doc.customNodes);
  invalidatePreview(); // custom types replaced — clear cached previews
  finalizeFrameDelete(); // a pending frame restore can't outlive its document
  current = 0;
  buildPalette();
  // Adopt the incoming document's brand palette (canvas + chrome + inputs).
  applyBrandPalette(doc.palette, false);
  showPage(doc.pages[current]!);
  renderFilmstrip();
  renderProblems();
  if (sync) markDirty();
  else
    reportSave(
      writeAutosave(),
      activeSlot === 'shared' ? '👁 shared copy' : '✓ synced',
    );
}

/* Shared Agent Workspace ---------------------------------------------------
 *
 * The panel implementation (state, sync/proposal/lease logic, panel DOM) lives
 * in `src/ui/workspace-panel.ts` (Packet R0). `main.ts` keeps only the
 * toolbar chip markup (above), this one mount call, and thin delegating call
 * sites that the rest of the app shell already depends on (document
 * replacement confirmation, the autosave→sync hook, sign-in activation, and
 * the beforeunload recovery write). */
const workspacePanelHandle = mountWorkspacePanel({
  getDoc: () => doc,
  loadDoc: (next, sync, sameDocument) =>
    loadDoc(next, sync, 'local', sameDocument),
  getCurrentPageId: () => editor.page.id,
  takePendingOperations: () => editor.takePendingOperations(),
  savedEl,
  chip: app.querySelector<HTMLButtonElement>('#workspaceChip')!,
  chipLabel: app.querySelector<HTMLElement>('#workspaceLabel')!,
  chipDivider: app.querySelector<HTMLElement>('#workspaceDiv')!,
});
/* Authoring Preferences (Packet P3, observe-only): a small toolbar chip next
 * to the workspace chip, revealed with it on sign-in. The panel implementation
 * (fetching, pause/forget wiring, panel DOM) lives in
 * `src/ui/profile-panel.ts`. */
const profilePanelHandle = mountProfilePanel({
  chip: app.querySelector<HTMLButtonElement>('#profileChip')!,
});
/** Owner-only admin dashboard — revealed only when `/api/me` reports `admin`;
 * the panel + fetching live in `src/ui/admin-dashboard.ts`. */
const adminDashboardHandle = mountAdminDashboard({
  chip: app.querySelector<HTMLButtonElement>('#adminChip')!,
});
function closeWorkspaceForDocumentReplacement(): boolean {
  return workspacePanelHandle.closeForDocumentReplacement();
}
function scheduleWorkspaceSync(): void {
  workspacePanelHandle.notifyDocChanged();
}
function enableWorkspaceUi(): void {
  workspacePanelHandle.enable();
}
window.addEventListener('beforeunload', () => {
  // Only what this tab changed. An idle tab writing here would overwrite
  // newer work another tab saved to the same slot.
  flushAutosave();
  workspacePanelHandle.flushBeforeUnload();
});
window.addEventListener('storage', (e) => {
  if (e.storageArea !== localStorage) return;
  if (e.key !== autosaveKey(activeSlot)) return;
  if (autosave.isForeignChange(e.newValue)) reportChangedElsewhere();
});

/*
 * Share links: opening "/v/<id>" loads a topology published by the MCP
 * `share_topology` tool (a snapshot stored in KV, fetched via /api/topology).
 * The snapshot opens as a SEPARATE shared copy (#202): it autosaves to its own
 * slot, the canonical-workspace sync is suspended, and a banner offers either
 * adopting the copy or returning to the user's own document — clicking a link
 * from chat can never silently replace locally autosaved work. The /v/<id>
 * path is dropped after load; a refresh resumes the shared copy from its slot.
 */
const sharedBanner = app.querySelector<HTMLElement>('#sharedBanner')!;
const sharedUnpublish =
  sharedBanner.querySelector<HTMLButtonElement>('#sharedUnpublish')!;
function updateSharedBanner(): void {
  sharedBanner.hidden = activeSlot !== 'shared';
  sharedUnpublish.hidden = activeSlot !== 'shared' || !activeShareId;
}
sharedBanner.querySelector('#sharedKeep')?.addEventListener('click', () => {
  if (
    !confirm(
      'Keep this shared copy as your document? Your previous locally saved ' +
        'document will be replaced. (Cancel and use "back to my document" ' +
        'to return to it, downloading a JSON copy of this first if needed.)',
    )
  )
    return;
  activeSlot = 'local';
  activeShareId = undefined;
  clearLocal('shared');
  updateSharedBanner();
  markDirty();
  promptSignIn();
});
sharedBanner.querySelector('#sharedBack')?.addEventListener('click', () => {
  activeShareId = undefined;
  loadDoc(loadLocal() ?? sampleDocument());
});
sharedUnpublish.addEventListener('click', () => {
  if (!activeShareId) return;
  if (
    !confirm(
      'Unpublish this public link? Anyone with the URL will no longer be able to load the snapshot. Your local copy of the document is unchanged.',
    )
  )
    return;
  const id = activeShareId;
  void (async () => {
    try {
      const res = await fetch(`/api/topology/${id}`, { method: 'DELETE' });
      if (res.status === 401) {
        alert('Sign in to unpublish a link you published.');
        return;
      }
      if (res.status === 403) {
        alert('Only the publisher can unpublish this link.');
        return;
      }
      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? 'This link is already unpublished or expired.'
            : `Could not unpublish (HTTP ${res.status}).`,
        );
      }
      activeShareId = undefined;
      updateSharedBanner();
      alert('Link unpublished. The public URL no longer serves this snapshot.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not unpublish.');
    }
  })();
});

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
      activeShareId = shareMatch[1];
      loadDoc(parsed, false, 'shared');
      history.replaceState({}, '', '/');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not load shared link.');
    }
  })();
} else {
  // A tab closed (or refreshed) while viewing a shared copy resumes it —
  // edits made to the copy survive, and the local document stays parked.
  const sharedResume = loadLocal('shared');
  if (sharedResume) loadDoc(sharedResume, false, 'shared');
}

/* File actions: new / save (download) / open (upload). */
app.querySelector('#fNew')?.addEventListener('click', () => {
  if (!confirm('Start a new document? Unsaved changes to this one are lost.'))
    return;
  if (!closeWorkspaceForDocumentReplacement()) return;
  loadDoc({
    title: 'Untitled',
    pages: [blankPage('Frame 1')],
    customNodes: [],
  });
  // An anonymous visitor (in from a share link) has just started a document
  // of their own: say, without blocking, what signing in would add.
  promptSignIn();
});
app.querySelector('#fSave')?.addEventListener('click', downloadDocJSON);

/* Image export: SVG (vector, honors calm) and PNG (always a static raster).
 * #222: the click used to fire a detached <a download> and revoke the blob
 * URL in the same turn, which Chrome can drop silently. downloadBlob now
 * inserts the anchor and keeps the URL alive; this chip reports success or
 * failure so a swallowed download is never the only outcome. */
const exportStatus = app.querySelector<HTMLElement>('#exportStatus')!;
const pngBtn = app.querySelector<HTMLButtonElement>('#fPng');
/** Show how export `kind` is going in the status chip (and to a screen
 * reader: the chip is a polite live region). */
function reportExport(kind: string, state: ExportState, detail?: string): void {
  const report = exportReport(kind, state, detail);
  exportStatus.textContent = report.message;
  exportStatus.title = report.detail;
  exportStatus.classList.toggle('export-ok', state === 'ok');
  exportStatus.classList.toggle('export-pending', state === 'pending');
  exportStatus.classList.toggle('export-failed', state === 'error');
}
/** The file name stem for a whole-document export. */
function docBase(): string {
  return (doc.title || 'topology').replace(/[^\w.-]+/g, '_');
}
/** The file name stem for a single-frame export. */
function exportBase(): string {
  const page = doc.pages[current]!;
  return `${docBase()}_${(page.name || 'frame').replace(/[^\w.-]+/g, '_')}`;
}
app.querySelector('#fSvg')?.addEventListener('click', () => {
  const page = framed(doc.pages[current]!);
  const filename = `${exportBase()}.svg`;
  try {
    exportPageSVG(
      filename,
      page,
      { ...pageOpts(page), calm: editor.calm },
      pageOverlay(page),
    );
    reportExport('svg', 'ok', filename);
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'SVG export failed.';
    reportExport('svg', 'error', detail);
  }
});
app.querySelector('#fPng')?.addEventListener('click', () => {
  if (pngBtn?.disabled) return;
  const page = framed(doc.pages[current]!);
  const filename = `${exportBase()}.png`;
  if (pngBtn) pngBtn.disabled = true;
  reportExport('png', 'pending', filename);
  void exportPagePNG(filename, page, 2, pageOverlay(page), pageOpts(page))
    .then(() => reportExport('png', 'ok', filename))
    .catch((err: unknown) => {
      const detail = err instanceof Error ? err.message : 'PNG export failed.';
      reportExport('png', 'error', detail);
    })
    .finally(() => {
      if (pngBtn) pngBtn.disabled = false;
    });
});
/* More export formats: PDF (raster @2× through the same pipeline as PNG, so
 * it always matches the canvas), the standalone flipbook HTML (same generator
 * as the MCP tool — no fork), clipboard PNG, and selection-only crops. */
const exportSel = app.querySelector<HTMLSelectElement>('#fExport')!;
/**
 * The page as an image export frames it. Exports render the page frame
 * (viewBox); when drawn content — a zone box, an outside label — extends past
 * it, the frame is widened so nothing is cut off. A document with a sheet
 * frame keeps its frame exactly: there the frame is the paper.
 */
function framed(page: Page): Page {
  return doc.sheet ? page : pageFramedForExport(page);
}
/* Everything drawn off the canvas — every export, the clipboard copy,
 * Present — uses these options, so it carries what the canvas shows: the
 * layers, the link styles, the frame's emphasis, the brand palette, and the
 * editor's current light/dark toggle (#264: a light canvas exports light). */
function pageOpts(page: Page): RenderOptions {
  return exportRenderOptions(doc, page, currentTheme());
}
/** The same for a selection-only crop, which has no frame emphasis. */
function selectionOpts(): RenderOptions {
  return exportRenderOptions(doc, {}, currentTheme());
}
/** PDF paper size from the sheet frame (W6), when a standard size is set. */
function paperSpec(): { paper?: { w: number; h: number } } {
  const paper = sheetPaperPt(doc.sheet?.size, doc.sheet?.orientation);
  return paper ? { paper } : {};
}
/** The selection as a cropped standalone page, or null when nothing usable. */
function selectionAsPage(): Page | null {
  const sel = editor.selectionElements();
  if (!sel || sel.nodes.length === 0) return null;
  return selectionPage(doc.pages[current]!, sel.nodes, sel.links);
}
/** Run one export from the menu. Resolves with the name of the file it
 * downloaded (nothing for a clipboard copy); rejects with the reason. */
async function runExport(kind: string): Promise<string | undefined> {
  const page = doc.pages[current]!;
  const save = (filename: string, blob: Blob): string => {
    downloadBlob(filename, blob);
    return filename;
  };
  switch (kind) {
    case 'pdf-page': {
      const whole = framed(page);
      const blob = await pagesToPDFBlob([
        {
          page: whole,
          opts: pageOpts(whole),
          extra: pageOverlay(whole),
          ...paperSpec(),
        },
      ]);
      return save(`${exportBase()}.pdf`, blob);
    }
    case 'pdf-all': {
      const blob = await pagesToPDFBlob(
        doc.pages.map(framed).map((p) => ({
          page: p,
          opts: pageOpts(p),
          extra: pageOverlay(p),
          ...paperSpec(),
        })),
      );
      return save(`${docBase()}.pdf`, blob);
    }
    case 'flipbook': {
      const html = exportFlipbookHTML(
        doc,
        (d, i) => {
          const p = d.pages[i]!;
          return pageToSVG(
            p,
            { ...pageOpts(p), calm: editor.calm },
            pageOverlay(p),
          );
        },
        { theme: currentTheme() },
      );
      return save(
        `${docBase()}_flipbook.html`,
        new Blob([html], { type: 'text/html' }),
      );
    }
    case 'drawio': {
      return save(
        `${docBase()}.drawio`,
        new Blob([documentToDrawioXML(doc)], { type: 'application/xml' }),
      );
    }
    case 'vsdx': {
      return save(
        `${docBase()}.vsdx`,
        new Blob([documentToVsdx(doc)], {
          type: 'application/vnd.ms-visio.drawing',
        }),
      );
    }
    case 'pptx':
    case 'pptx-layers': {
      return save(
        `${docBase()}.pptx`,
        new Blob(
          [
            documentToPptx(doc, {
              slides: kind === 'pptx-layers' ? 'layers' : 'pages',
            }),
          ],
          {
            type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          },
        ),
      );
    }
    case 'mermaid': {
      return save(
        `${exportBase()}.mmd`,
        new Blob([documentToMermaid(doc, current)], { type: 'text/plain' }),
      );
    }
    case 'copy-png':
      await copyPagePNG(
        framed(page),
        pageOverlay(framed(page)),
        pageOpts(page),
      );
      return undefined;
    case 'svg-selection': {
      const sp = selectionAsPage();
      if (!sp) throw new Error('Select one or more nodes first.');
      const filename = `${exportBase()}_selection.svg`;
      exportPageSVG(filename, sp, { ...selectionOpts(), calm: true });
      return filename;
    }
    case 'png-selection': {
      const sp = selectionAsPage();
      if (!sp) throw new Error('Select one or more nodes first.');
      const filename = `${exportBase()}_selection.png`;
      await exportPagePNG(filename, sp, 2, '', selectionOpts());
      return filename;
    }
  }
  throw new Error(`unknown export "${kind}"`);
}
/** Copy an image to the clipboard from the canvas's right-click menu,
 * reporting through the same chip as the toolbar's exports. */
function copyImage(copy: () => Promise<void>): void {
  reportExport('copy-png', 'pending');
  copy().then(
    () => reportExport('copy-png', 'ok'),
    (err: unknown) => {
      const detail = err instanceof Error ? err.message : String(err);
      reportExport('copy-png', 'error', detail);
      alert(`Copy failed: ${detail}`);
    },
  );
}
exportSel.addEventListener('change', () => {
  const kind = exportSel.value;
  exportSel.value = '';
  if (!kind) return;
  // The chip says what is happening from the start, so a stale message from
  // an earlier export never stands in for this one's outcome.
  reportExport(kind, 'pending');
  runExport(kind).then(
    (filename) => reportExport(kind, 'ok', filename),
    (err: unknown) => {
      const detail = err instanceof Error ? err.message : String(err);
      reportExport(kind, 'error', detail);
      alert(`Export failed: ${detail}`);
    },
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
    .join('') +
  `<option value="${SDWAN_WIZARD}" title="Generate an SD-WAN fabric: vendor, regions, hubs, branches, WAN transports, HA, LAN">Generate SD-WAN…</option>`;
templateSel.addEventListener('change', () => {
  const id = templateSel.value;
  templateSel.value = '';
  if (!id) return;
  if (id === SDWAN_WIZARD) {
    openSdwanWizard({
      mount: app,
      render: (generated) => {
        const p = generated.pages[0]!;
        return pageToSVG(p, {
          layers: generated.layers,
          calm: true,
          theme: currentTheme(),
        });
      },
      onCreate: (generated) => {
        if (!confirm('Replace the current diagram? Unsaved changes are lost.'))
          return;
        if (!closeWorkspaceForDocumentReplacement()) return;
        loadDoc(generated);
      },
    });
    return;
  }
  if (!confirm('Start from this template? Unsaved changes are lost.')) return;
  if (!closeWorkspaceForDocumentReplacement()) return;
  loadDoc(buildTemplate(id));
});

const fileInput = app.querySelector<HTMLInputElement>('#fInput')!;
app.querySelector('#fOpen')?.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  const text = await file.text();

  const classified = classifyOpenedFile(text);
  if (
    classified.kind === 'mermaid' ||
    classified.kind === 'csv' ||
    classified.kind === 'drawio'
  ) {
    const what =
      classified.kind === 'mermaid'
        ? 'Mermaid flowchart'
        : classified.kind === 'drawio'
          ? 'draw.io diagram'
          : 'CSV data';
    if (!classified.result.ok) {
      alert(`Could not import this ${what}: ${classified.result.error}`);
      return;
    }
    const { document, warnings } = classified.result;
    if (!confirm(importConfirmText(what, document!, warnings))) return;
    if (!closeWorkspaceForDocumentReplacement()) return;
    loadDoc(document!);
    return;
  }
  if (classified.kind === 'legacy') {
    if (!classified.result.ok) {
      alert(
        `Could not convert this legacy Topology Studio file: ${classified.result.error.message}`,
      );
      return;
    }
    const { document, warnings } = classified.result;
    const question = importConfirmText(
      'converted Topology Studio file',
      document,
      warnings,
    );
    if (!confirm(question)) return;
    if (!closeWorkspaceForDocumentReplacement()) return;
    loadDoc(document);
    return;
  }

  const parsed = parseDoc(text);
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
  if (!closeWorkspaceForDocumentReplacement()) return;
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
ccZoom.addEventListener('click', fitView);
app.querySelector('#ccFit')!.addEventListener('click', fitView);

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
// What the Problems dock last showed, shared with the always-visible status-bar
// indicator so it stays in sync with the dock without recomputing here.
let problemsView = problemsDockView({
  visible: 0,
  errors: 0,
  hidden: 0,
  collapsedPref: null,
});
function statusProblemsHTML(): string {
  const { severity, statusLabel, statusTitle } = problemsView;
  const cls =
    severity === 'error' ? 'has-error' : severity === 'warn' ? 'has-warn' : '';
  return `<button class="sb-problems ${cls}" id="sb-problems" title="${esc(statusTitle)}" aria-label="${esc(statusTitle)}">${esc(statusLabel)}</button>`;
}
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
    statusProblemsHTML() +
    `<span class="sb-hint">drag move · wheel zoom · space/middle-drag pan · ? shortcuts</span>`;
  refreshChrome();
}
// Delegated: the status-bar problems indicator opens the right rail (if hidden)
// and expands the pinned Problems section.
statusbar.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('#sb-problems')) {
    setInspectorCollapsed(false);
    setProblemsCollapsed(false);
    problemsPanel.scrollIntoView({ block: 'nearest' });
  }
});
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
  const html =
    `<rect x="${ox}" y="${oy}" width="${pw * s}" height="${ph * s}" fill="none" stroke="#7d8a92" stroke-opacity="0.5" stroke-width="1"/>` +
    dots +
    `<rect x="${mx(v.x)}" y="${my(v.y)}" width="${v.w * s}" height="${v.h * s}" fill="#01a982" fill-opacity="0.12" stroke="#01a982" stroke-width="1.5"/>`;
  // Mirror the canvas brand remap so the minimap dots + viewport box match (#7).
  minimap.innerHTML = doc.palette ? applyPalette(html, doc.palette) : html;
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

// Collapse / restore the minimap section docked at the bottom of the left rail.
const minimapDock = app.querySelector<HTMLDivElement>('#minimap-dock')!;
const minimapToggle = app.querySelector<HTMLButtonElement>('#minimap-toggle')!;
function setMinimapCollapsed(collapsed: boolean): void {
  minimapDock.classList.toggle('collapsed', collapsed);
  minimapToggle.textContent = collapsed ? 'map ▸' : 'map ▾';
  minimapToggle.title = collapsed ? 'Show minimap (M)' : 'Hide minimap (M)';
  try {
    localStorage.setItem('tds-minimap-collapsed', collapsed ? '1' : '0');
  } catch {
    /* storage unavailable — fine, just don't persist */
  }
}
minimapToggle.addEventListener('click', () =>
  setMinimapCollapsed(!minimapDock.classList.contains('collapsed')),
);
setMinimapCollapsed(localStorage.getItem('tds-minimap-collapsed') === '1');

// Collapse / restore the node palette so it stops crowding the left edge.
const paletteEl = app.querySelector<HTMLElement>('#palette')!;
const paletteToggle = app.querySelector<HTMLButtonElement>('#palette-toggle')!;
function setPaletteCollapsed(collapsed: boolean, persist = true): void {
  paletteEl.classList.toggle('collapsed', collapsed);
  paletteToggle.textContent = collapsed ? 'nodes ▸' : 'nodes ◂';
  paletteToggle.title = collapsed
    ? 'Show node library (B)'
    : 'Hide node library (B)';
  if (!persist) return;
  try {
    localStorage.setItem('tds-palette-collapsed', collapsed ? '1' : '0');
  } catch {
    /* storage unavailable — fine, just don't persist */
  }
}
paletteToggle.addEventListener('click', () =>
  setPaletteCollapsed(!paletteEl.classList.contains('collapsed')),
);

/* Collapse / restore the frames strip — a floating overlay at the canvas's
 * bottom-left, so toggling never resizes the canvas or moves the viewport.
 * Collapsed it shrinks to a pill whose current/total readout stays live
 * (playback keeps running and updating it without forcing the strip open). */
function setFramesCollapsed(collapsed: boolean): void {
  framesDock.classList.toggle('collapsed', collapsed);
  framesToggle.setAttribute('aria-expanded', String(!collapsed));
  const chev = framesToggle.querySelector('.frames-chev');
  if (chev) chev.textContent = collapsed ? '▸' : '◂';
  framesToggle.title = collapsed ? 'Show frames (F)' : 'Hide frames (F)';
  try {
    localStorage.setItem('tds-frames-collapsed', collapsed ? '1' : '0');
  } catch {
    /* storage unavailable — fine, just don't persist */
  }
  // Re-opening should land with the active frame in view (incl. mid-playback).
  if (!collapsed) scrollActiveFrameIntoView();
}
framesToggle.addEventListener('click', () =>
  setFramesCollapsed(!framesDock.classList.contains('collapsed')),
);
setFramesCollapsed(localStorage.getItem('tds-frames-collapsed') === '1');

// Wheel over the strip pans it horizontally. The editor's zoom handler lives
// on the canvas overlay underneath, so a wheel here can never zoom the canvas;
// preventDefault also stops any residual ancestor scrolling.
strip.addEventListener(
  'wheel',
  (e) => {
    if (e.deltaY && !e.deltaX) {
      // deltaMode 1 = lines (Firefox wheel default) — convert to ~pixels.
      strip.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      e.preventDefault();
    }
  },
  { passive: false },
);

/* Problems panel — runs the same checks as the MCP `validate_topology`
 * (semantic validation + layout analysis) live in the studio, so overlapping
 * zones, off-canvas nodes, dangling refs, etc. surface as you edit instead of
 * only at load time. Click a problem to jump to the node it references. */
const problemsDock = app.querySelector<HTMLDivElement>('#problems-dock')!;
const problemsToggle =
  app.querySelector<HTMLButtonElement>('#problems-toggle')!;
const problemsPanel = app.querySelector<HTMLDivElement>('#problems')!;
const probCount = app.querySelector<HTMLSpanElement>('#prob-count')!;
const probHiddenNote = app.querySelector<HTMLSpanElement>('#prob-hidden-note')!;

/** Locate the element a problem refers to on the CURRENT page (feeds the canvas
 * badge layer, which only glyphs elements on the page being viewed). */
function problemLocate(
  p: Problem,
): { kind: 'node' | 'link' | 'zone'; id: string } | undefined {
  const nodes = new Set(editor.page.nodes.map((n) => n.id));
  const links = new Set(editor.page.links.map((l) => l.id));
  const zones = new Set(editor.page.zones.map((z) => z.id));
  for (const m of `${p.where} ${p.message}`.matchAll(/"([^"]+)"/g)) {
    if (nodes.has(m[1]!)) return { kind: 'node', id: m[1]! };
    if (links.has(m[1]!)) return { kind: 'link', id: m[1]! };
    if (zones.has(m[1]!)) return { kind: 'zone', id: m[1]! };
  }
  return undefined;
}

/** Locate across the whole document (the pinned panel lists problems for every
 * page): the target page comes from the `page[N]` prefix in `where`, the element
 * id from the first quoted token that names something on that page. */
function problemLocateGlobal(
  p: Problem,
):
  | { pageIndex: number; kind: 'node' | 'link' | 'zone'; id: string }
  | undefined {
  const pm = p.where.match(/page\[(\d+)\]/);
  const pageIndex = pm ? Number(pm[1]) : current;
  const page = doc.pages[pageIndex];
  if (!page) return undefined;
  const nodes = new Set(page.nodes.map((n) => n.id));
  const links = new Set(page.links.map((l) => l.id));
  const zones = new Set(page.zones.map((z) => z.id));
  for (const m of `${p.where} ${p.message}`.matchAll(/["']([^"']+)["']/g)) {
    if (nodes.has(m[1]!)) return { pageIndex, kind: 'node', id: m[1]! };
    if (links.has(m[1]!)) return { pageIndex, kind: 'link', id: m[1]! };
    if (zones.has(m[1]!)) return { pageIndex, kind: 'zone', id: m[1]! };
  }
  return undefined;
}

/**
 * Select the element a problem/badge points at — the single click-to-jump
 * path shared by the problems panel and the on-canvas badge layer (Packet
 * B1), so the two surfaces can never disagree about what a click does.
 */
function selectProblemTarget(loc: {
  kind: 'node' | 'link' | 'zone';
  id: string;
}): void {
  if (loc.kind === 'link') editor.focusLink(loc.id);
  else if (loc.kind === 'zone') editor.focusZone(loc.id);
  else editor.focusNode(loc.id);
}

/** Every element a problem names on its page, in the order it names them. */
function problemTargets(
  p: Problem,
): { kind: 'node' | 'link' | 'zone'; id: string }[] {
  const pm = p.where.match(/page\[(\d+)\]/);
  const page = doc.pages[pm ? Number(pm[1]) : current];
  if (!page) return [];
  const out: { kind: 'node' | 'link' | 'zone'; id: string }[] = [];
  const seen = new Set<string>();
  for (const m of `${p.where} ${p.message}`.matchAll(/["']([^"']+)["']/g)) {
    const id = m[1]!;
    const kind = page.nodes.some((n) => n.id === id)
      ? 'node'
      : page.links.some((l) => l.id === id)
        ? 'link'
        : page.zones.some((z) => z.id === id)
          ? 'zone'
          : null;
    if (!kind || seen.has(`${kind}:${id}`)) continue;
    seen.add(`${kind}:${id}`);
    out.push({ kind, id });
  }
  return out;
}

/**
 * A problem's message for people: element ids replaced by what the element is
 * called on the canvas (its label), and the page given by number and name.
 * Validation reports ids because that is what an agent needs; a person looking
 * at the diagram knows "Chicago-EC-01", not "nmwfa0ld0b".
 */
function problemText(p: Problem): { message: string; where: string } {
  const pm = p.where.match(/page\[(\d+)\]/);
  const pageIndex = pm ? Number(pm[1]) : -1;
  const page = doc.pages[pageIndex];
  if (!page) return { message: p.message, where: p.where };
  const nameOf = (id: string): string | undefined => {
    const el =
      page.nodes.find((n) => n.id === id) ??
      page.zones.find((z) => z.id === id) ??
      page.links.find((l) => l.id === id);
    const label = (el as { label?: unknown } | undefined)?.label;
    return typeof label === 'string' && label.trim()
      ? label.trim().replace(/\s+/g, ' ')
      : undefined;
  };
  const named = (text: string): string =>
    text.replace(/(["'])([^"']+)\1/g, (whole, _q: string, id: string) => {
      const name = nameOf(id);
      return name ? `“${name}”` : whole;
    });
  // What `where` says beyond the page (e.g. `node "n1"`, `.link 'l3'`).
  const rest = p.where
    .replace(/page\[\d+\]/, '')
    .replace(`"${page.name}"`, '')
    .replace(/^[\s.]+/, '')
    .trim();
  return {
    message: named(p.message),
    where:
      `Page ${pageIndex + 1} · ${page.name}` +
      (rest ? ` · ${named(rest)}` : ''),
  };
}

/*
 * Hidden problems: a per-browser view preference, like the badge toggle. A
 * hidden problem is still reported by `validate_topology`; it just stops
 * counting and drawing a badge here. Keyed by the problem's own text, so it
 * reappears if the underlying issue changes.
 */
const HIDDEN_PROBLEMS_KEY = 'tds-problems-hidden';
const MAX_HIDDEN_PROBLEMS = 500;
let hiddenProblems = new Set<string>();
try {
  const raw: unknown = JSON.parse(
    localStorage.getItem(HIDDEN_PROBLEMS_KEY) ?? '[]',
  );
  if (Array.isArray(raw))
    hiddenProblems = new Set(raw.filter((k) => typeof k === 'string'));
} catch {
  hiddenProblems = new Set();
}
let showHiddenProblems = false;
const problemKey = (p: Problem): string => `${p.where}|${p.message}`;
function saveHiddenProblems(): void {
  try {
    localStorage.setItem(
      HIDDEN_PROBLEMS_KEY,
      JSON.stringify([...hiddenProblems].slice(-MAX_HIDDEN_PROBLEMS)),
    );
  } catch {
    /* storage unavailable — the choice just lasts for this session */
  }
}

/**
 * On-canvas problem badges (Packet B1) — a view-state toggle, not document
 * data (DESIGN.md #2 carve-out: the underlying problems are already
 * API-reachable via `validate_topology`; only whether the GUI draws a glyph
 * for them is human-only, like pan/zoom). Persisted like the other canvas
 * view prefs; default on.
 */
const BADGES_KEY = 'tds-badges-visible';
let badgesVisible = localStorage.getItem(BADGES_KEY) !== '0';

editor.setOnBadgeClick((kind, id) => {
  selectProblemTarget({ kind, id });
  // A click on a badge asks what the problem is: open the dock on it.
  setInspectorCollapsed(false);
  setProblemsCollapsed(false);
  const row = problemsPanel.querySelector<HTMLButtonElement>(
    `[data-prob-kind="${kind}"][data-prob-id="${CSS.escape(id)}"]`,
  );
  row?.scrollIntoView({ block: 'nearest' });
});

// The dock's collapse: `applyProblemsCollapsed` is the visual-only toggle used
// during render; `setProblemsCollapsed` also records the user's preference.
// `problemsPref` is null until the user explicitly toggles.
let problemsPref: boolean | null =
  localStorage.getItem('tds-problems-collapsed') === null
    ? null
    : localStorage.getItem('tds-problems-collapsed') === '1';
function applyProblemsCollapsed(collapsed: boolean): void {
  problemsDock.classList.toggle('collapsed', collapsed);
  problemsToggle.setAttribute('aria-expanded', String(!collapsed));
  const chev = problemsToggle.querySelector('.pt-chev');
  if (chev) chev.textContent = collapsed ? '▸' : '▾';
}
function setProblemsCollapsed(collapsed: boolean): void {
  problemsPref = collapsed;
  applyProblemsCollapsed(collapsed);
  try {
    localStorage.setItem('tds-problems-collapsed', collapsed ? '1' : '0');
  } catch {
    /* storage unavailable — fine, just don't persist */
  }
}

function renderProblems(): void {
  if (!statusReady) return;
  const all = [...validateDocument(doc), ...analyzeLayout(doc)];
  // Forget hidden entries whose problem no longer exists.
  const live = new Set(all.map(problemKey));
  let pruned = false;
  for (const key of hiddenProblems)
    if (!live.has(key)) {
      hiddenProblems.delete(key);
      pruned = true;
    }
  if (pruned) saveHiddenProblems();
  const problems = all.filter((p) => !hiddenProblems.has(problemKey(p)));
  const hiddenCount = all.length - problems.length;
  const errors = problems.filter((p) => p.level === 'error').length;
  problemsView = problemsDockView({
    visible: problems.length,
    errors,
    hidden: hiddenCount,
    collapsedPref: problemsPref,
  });

  // Header: count badge, how many are hidden, severity tint on the dock.
  problemsDock.classList.toggle('has-error', problemsView.severity === 'error');
  problemsDock.classList.toggle('has-warn', problemsView.severity === 'warn');
  probCount.textContent = problemsView.count;
  probHiddenNote.textContent = problemsView.hiddenNote;

  // Keep the always-visible status-bar indicator in sync.
  renderStatus();

  const listed = showHiddenProblems ? all : problems;
  const rows = listed
    .map((p, i) => {
      const loc = problemLocateGlobal(p);
      const text = problemText(p);
      const isHidden = hiddenProblems.has(problemKey(p));
      const attrs = loc
        ? ` data-prob-page="${loc.pageIndex}" data-prob-kind="${loc.kind}" data-prob-id="${esc(loc.id)}"`
        : '';
      return (
        `<div class="prob prob-${p.level}${isHidden ? ' prob-hidden' : ''}">` +
        `<button class="prob-go${loc ? ' locatable' : ''}"${attrs} data-i="${i}" title="${esc(`${p.message} — ${p.where}`)}">` +
        `<span class="prob-dot"></span>` +
        `<span class="prob-msg">${esc(text.message)}<span class="prob-where">${esc(text.where)}</span></span>` +
        `</button>` +
        `<button class="prob-hide" data-hide="${i}" title="${isHidden ? 'Show this problem again' : 'Hide this problem (it stays in validation)'}" aria-label="${isHidden ? 'Show this problem again' : 'Hide this problem'}">${isHidden ? '↺' : '✕'}</button>` +
        `</div>`
      );
    })
    .join('');
  const footer = hiddenCount
    ? `<div class="prob-foot"><span>${hiddenCount} hidden</span>` +
      `<button class="prob-link" id="prob-show-hidden">${showHiddenProblems ? 'hide them' : 'show'}</button>` +
      `<button class="prob-link" id="prob-restore">restore all</button></div>`
    : '';
  problemsPanel.innerHTML =
    (rows ||
      `<div class="prob-empty">${
        hiddenCount
          ? 'No other problems.'
          : 'No problems — validation and layout are clean.'
      }</div>`) + footer;

  problemsPanel
    .querySelectorAll<HTMLButtonElement>('.prob-go[data-prob-id]')
    .forEach((b) =>
      b.addEventListener('click', () => {
        const kind = b.dataset.probKind as 'node' | 'link' | 'zone';
        // Switch to the referenced page first when the problem is elsewhere,
        // then select the first element and ring everything it names.
        const page = Number(b.dataset.probPage);
        if (Number.isInteger(page) && page !== current) gotoPage(page);
        selectProblemTarget({ kind, id: b.dataset.probId! });
        editor.spotlight(problemTargets(listed[Number(b.dataset.i)]!));
      }),
    );
  problemsPanel.querySelectorAll<HTMLButtonElement>('.prob-hide').forEach((b) =>
    b.addEventListener('click', () => {
      const key = problemKey(listed[Number(b.dataset.hide)]!);
      if (!hiddenProblems.delete(key)) hiddenProblems.add(key);
      saveHiddenProblems();
      renderProblems();
    }),
  );
  problemsPanel
    .querySelector('#prob-show-hidden')
    ?.addEventListener('click', () => {
      showHiddenProblems = !showHiddenProblems;
      renderProblems();
    });
  problemsPanel
    .querySelector('#prob-restore')
    ?.addEventListener('click', () => {
      hiddenProblems.clear();
      showHiddenProblems = false;
      saveHiddenProblems();
      renderProblems();
    });

  // Closed when there is nothing to list; otherwise where the user left it
  // (closed until they first open it — see problemsDockView).
  applyProblemsCollapsed(problemsView.collapsed);

  // Badge layer reuses the same (visible) `problems` list + `problemLocate`
  // mapping (the current-page locate) — one computation feeds both surfaces,
  // and badges always reflect the current page only.
  editor.setBadges(
    badgesVisible
      ? computeBadgePlacements(problems, editor.page, problemLocate)
      : [],
  );
}

problemsToggle.addEventListener('click', () =>
  setProblemsCollapsed(!problemsDock.classList.contains('collapsed')),
);

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
  // Match label / id / type / sublabel — and metadata keys AND values, so a
  // node is findable by the IP, hostname, serial, etc. stored on it. The
  // shown "type" slot carries the match reason when it came from metadata.
  const reasonFor = (n: (typeof editor.page.nodes)[number]): string | null => {
    if (!s) return n.type;
    if (
      (n.label ?? '').toLowerCase().includes(s) ||
      n.id.toLowerCase().includes(s) ||
      n.type.toLowerCase().includes(s)
    )
      return n.type;
    if (((n.sublabel as string) ?? '').toLowerCase().includes(s))
      return `${n.type} · ${String(n.sublabel)}`;
    for (const [k, v] of Object.entries(n.meta ?? {})) {
      if (k.toLowerCase().includes(s) || String(v).toLowerCase().includes(s))
        return `${n.type} · ${k}: ${String(v)}`;
    }
    return null;
  };
  findMatches = editor.page.nodes
    .map((n) => ({ n, reason: reasonFor(n) }))
    .filter(
      (x): x is { n: (typeof editor.page.nodes)[number]; reason: string } =>
        x.reason !== null,
    )
    .slice(0, 50)
    .map(({ n, reason }) => ({
      id: n.id,
      label: n.label || '(no label)',
      type: reason,
    }));
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
    `<input type="text" placeholder="Find node by label / id / type / metadata…" aria-label="Find node by label, id, type, or metadata" />` +
    `<div class="find-results scroll-slim"></div>`;
  app.appendChild(findEl);
  const input = findEl.querySelector('input')!;
  input.addEventListener('input', () => runFindQuery(input.value));
  input.addEventListener('keydown', (e) => {
    if (isImeKey(e)) return; // the key belongs to an IME composition
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
function setInspectorCollapsed(collapsed: boolean, persist = true): void {
  inspectorWrap.classList.toggle('collapsed', collapsed);
  inspectorToggle.textContent = collapsed ? 'props ◂' : 'hide ▸';
  inspectorToggle.title = collapsed
    ? 'Show properties (P)'
    : 'Hide properties (P)';
  if (!persist) return;
  try {
    localStorage.setItem('tds-inspector-collapsed', collapsed ? '1' : '0');
  } catch {
    /* storage unavailable — fine, just don't persist */
  }
}
inspectorToggle.addEventListener('click', () =>
  setInspectorCollapsed(!inspectorWrap.classList.contains('collapsed')),
);

function readCollapsedPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Open/close the node library and properties rail from stored prefs, or from
 * the phone-width default when the user has never chosen (#221). Inferred
 * defaults are not written to storage, so crossing the breakpoint can still
 * flip them; an explicit B/P toggle persists and wins on every viewport.
 */
function syncPanelLayoutFromPrefs(): void {
  const mobile = isMobileLayoutWidth(window.innerWidth);
  const palettePref = readCollapsedPref('tds-palette-collapsed');
  setPaletteCollapsed(
    defaultPanelCollapsed(palettePref, mobile),
    palettePref !== null,
  );
  const inspectorPref = readCollapsedPref('tds-inspector-collapsed');
  setInspectorCollapsed(
    defaultPanelCollapsed(inspectorPref, mobile),
    inspectorPref !== null,
  );
}

syncPanelLayoutFromPrefs();
window
  .matchMedia?.(MOBILE_LAYOUT_MQ)
  ?.addEventListener?.('change', syncPanelLayoutFromPrefs);

/* The properties panel is a docked right column (full stage height), so its
 * annotations / zones list is never clipped or overlapped.
 * A left-edge grip resizes its width (persisted). */
const inspectorResizer = app.querySelector<HTMLElement>('#inspector-resizer')!;
const INSPECTOR_W_KEY = 'tds-inspector-width';
const INSPECTOR_W_MIN = 200;
const INSPECTOR_W_MAX = 560;

try {
  const w = Number(localStorage.getItem(INSPECTOR_W_KEY));
  if (w >= INSPECTOR_W_MIN && w <= INSPECTOR_W_MAX)
    inspector.style.width = `${w}px`;
} catch {
  /* storage unavailable — use the default width */
}

// Left-edge drag-to-resize (dragging left widens the docked panel).
inspectorResizer.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const startX = e.clientX;
  const startW = inspector.offsetWidth;
  inspectorResizer.classList.add('active');
  inspectorResizer.setPointerCapture(e.pointerId);
  const onMove = (ev: PointerEvent): void => {
    const w = Math.min(
      INSPECTOR_W_MAX,
      Math.max(INSPECTOR_W_MIN, startW + (startX - ev.clientX)),
    );
    inspector.style.width = `${w}px`;
  };
  const onUp = (): void => {
    inspectorResizer.classList.remove('active');
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    try {
      localStorage.setItem(INSPECTOR_W_KEY, String(inspector.offsetWidth));
    } catch {
      /* ignore */
    }
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
});

function onLinkSelectChange(_linkId: string | null): void {
  if (statusReady) updateMiniBar();
  renderInspector();
}
function onAnchorSelectChange(_anchorId: string | null): void {
  renderInspector();
}
function onZoneSelectChange(_zoneId: string | null): void {
  renderInspector();
  renderStatus();
}

/* Align/distribute toolbar — shown when 2+ nodes are selected. */
const alignGroup = app.querySelector<HTMLElement>('#alignGroup')!;
function onSelectionChange(count: number): void {
  if (statusReady) updateMiniBar();
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
        `<button class="sw ${c === current ? 'on' : ''}" data-color="${c}" style="background:${c}" title="${c}" aria-label="Color ${c}" aria-pressed="${c === current}"></button>`,
    ).join('') +
    `</div>`
  );
}

/**
 * The hex field of a colour row, with a live preview dot. `attrs` carries the
 * data-* binding (node/link fields vs annotation fields use different keys).
 */
function hexInput(attrs: string, current: string | undefined): string {
  const c = current ?? '';
  return (
    `<span class="hexwrap"><i class="hexdot" style="background:${esc(c) || 'transparent'}"></i>` +
    `<input class="hex" ${attrs} value="${esc(c)}" placeholder="auto"/></span>`
  );
}

/** Colour row: label + hex on one line, the swatch grid beneath. */
function colorRow(label: string, hex: string, swatches: string): string {
  return `<div class="insp-row color"><span>${label}</span>${hex}${swatches}</div>`;
}

/* ── Compass placement picker ───────────────────────────────────────
 * The 3×3 grid classic Topology Studio had for label placement. Cells are
 * compass codes; the centre cell is "auto" (clears the field). Enum fields
 * store the code itself (node labelPlacement); point fields (link
 * labelOffset) store the preset offset for that cell instead. */
const COMPASS_CELLS: readonly (readonly [code: string, glyph: string])[] = [
  ['nw', '↖'],
  ['n', '↑'],
  ['ne', '↗'],
  ['w', '←'],
  ['', '·'],
  ['e', '→'],
  ['sw', '↙'],
  ['s', '↓'],
  ['se', '↘'],
];
const COMPASS_TITLES: Readonly<Record<string, string>> = {
  nw: 'Above left',
  n: 'Above',
  ne: 'Above right',
  w: 'Left',
  '': 'Auto (default)',
  e: 'Right',
  sw: 'Below left',
  s: 'Below',
  se: 'Below right',
};
/** Link centre-label presets (doc-space offset from the auto position). */
const LINK_LABEL_PRESETS: Readonly<Record<string, { x: number; y: number }>> = {
  nw: { x: -48, y: -18 },
  n: { x: 0, y: -18 },
  ne: { x: 48, y: -18 },
  w: { x: -48, y: 0 },
  e: { x: 48, y: 0 },
  sw: { x: -48, y: 18 },
  s: { x: 0, y: 18 },
  se: { x: 48, y: 18 },
};

/** The compass code a stored value maps to (`''` = auto / none). */
function compassCodeOf(f: FieldSpec, v: unknown): string {
  if (f.kind === 'point') {
    const p = v as { x?: unknown; y?: unknown } | undefined;
    if (!p || typeof p !== 'object') return '';
    for (const [code, o] of Object.entries(LINK_LABEL_PRESETS))
      if (p.x === o.x && p.y === o.y) return code;
    return '*'; // a custom (dragged) offset: no cell lit
  }
  return typeof v === 'string' && v in COMPASS_TITLES ? v : '';
}

/** What a compass cell writes: the code (enum) or its preset point. */
function compassValueOf(f: FieldSpec, code: string): unknown {
  if (f.kind === 'point') return code ? LINK_LABEL_PRESETS[code] : undefined;
  return code || undefined;
}

function compassControl(
  f: FieldSpec,
  v: unknown,
  attr: 'data-key' | 'data-akey',
): string {
  const cur = compassCodeOf(f, v);
  const cells = COMPASS_CELLS.map(
    ([code, glyph]) =>
      `<button type="button" class="cc${code === cur ? ' on' : ''}" data-cval="${code}" title="${COMPASS_TITLES[code]}${code ? ' — click to place; double-click to nudge 1 unit' : ' — reset placement and fine tuning'}" aria-label="${COMPASS_TITLES[code]}" aria-pressed="${code === cur}">${glyph}</button>`,
  ).join('');
  return (
    `<div class="insp-row"><span>${f.label}</span>` +
    `<div class="compass" ${attr}="${f.key}" data-ckind="${f.kind}" role="group" aria-label="${f.label}" aria-describedby="label-placement-hint">${cells}</div></div>` +
    `<div class="insp-hint" id="label-placement-hint">Click to place · double-click to nudge 1 unit.</div>`
  );
}

/**
 * Row class for a field: labels too long for the label column stack above
 * their control instead of wrapping into three cramped lines.
 */
function rowClass(f: FieldSpec): string {
  return f.label.length > 16 ? 'insp-row col' : 'insp-row';
}

/** A control for one catalog field, bound to the element's current value. */
function fieldControl(f: FieldSpec, cfg: Record<string, unknown>): string {
  const v = cfg[f.key];
  if (f.widget === 'compass') return compassControl(f, v, 'data-key');
  const row = rowClass(f);
  switch (f.kind) {
    case 'boolean':
      return `<label class="insp-row"><span>${f.label}${f.animation ? ' ⟳' : ''}</span><input type="checkbox" data-key="${f.key}" ${v ? 'checked' : ''}/></label>`;
    case 'enum':
      return `<label class="${row}"><span>${f.label}</span><select data-key="${f.key}">${(
        f.options ?? []
      )
        .map(
          (o) =>
            `<option value="${o}" ${String(v ?? '') === o ? 'selected' : ''}>${esc(f.optionLabels?.[o] ?? o)}</option>`,
        )
        .join('')}</select></label>`;
    case 'color':
      return colorRow(
        f.label,
        hexInput(
          `data-key="${f.key}" data-kind="color"`,
          v as string | undefined,
        ),
        swatchRow(f.key, v as string | undefined),
      );
    case 'number':
      return `<label class="${row}"><span>${f.label}</span><input type="number" data-key="${f.key}" data-kind="number" value="${esc(String(v ?? ''))}" placeholder="auto"${boundsAttrs(numberBounds(f))}/></label>`;
    case 'object': {
      // An enable switch on the field itself (checked = the object present,
      // at its defaults), then its nested fields as dotted keys
      // ("linkAttach.pad") that fieldPatch merges back into the object.
      const on = typeof v === 'object' && v !== null;
      const sub = on ? (v as Record<string, unknown>) : {};
      let html = `<label class="${row}"><span>${f.label}</span><input type="checkbox" data-key="${f.key}" data-kind="object" ${on ? 'checked' : ''}/></label>`;
      if (on)
        for (const s of f.fields ?? []) {
          const key = `${f.key}.${s.key}`;
          html += fieldControl(
            { ...s, key, label: `↳ ${s.label}` },
            { [key]: sub[s.key] },
          );
        }
      return html;
    }
    case 'point':
    case 'points':
      return `<div class="insp-row"><span>${f.label}</span><span class="insp-val">${Array.isArray(v) ? v.length : 0} pt</span></div>`;
    case 'record':
      return ''; // rendered by the dedicated metadata editor
    default:
      // Long-form strings (callout / text `body`) get a stacked textarea so
      // newlines survive; wireFields treats it like any other text control.
      if (f.multiline)
        return `<label class="insp-row col"><span>${f.label}</span><textarea data-key="${f.key}" rows="4"${f.max ? ` maxlength="${f.max}"` : ''} spellcheck="true">${esc(String(v ?? ''))}</textarea></label>`;
      return `<label class="${row}"><span>${f.label}</span><input data-key="${f.key}" value="${esc(String(v ?? ''))}"/></label>`;
  }
}

/**
 * The element patch for one inspector edit. A dotted key addresses a nested
 * `object` field ("linkAttach.pad"): the current object is copied and the
 * sub-field set (an unset / blank / NaN value clears it). A boolean on an `object`
 * field itself is its enable switch: true → `{}` (on, at the defaults),
 * false → the field cleared. Plain keys patch as before.
 */
function fieldPatch(
  info: { fields: FieldSpec[] } | undefined,
  current: Record<string, unknown> | undefined,
  key: string,
  val: unknown,
): Record<string, unknown> {
  const dot = key.indexOf('.');
  if (dot < 0) {
    const spec = info?.fields.find((f) => f.key === key);
    if (spec?.kind === 'object') return { [key]: val ? {} : undefined };
    return { [key]: val };
  }
  const parent = key.slice(0, dot);
  const child = key.slice(dot + 1);
  const cur = current?.[parent];
  const next: Record<string, unknown> =
    typeof cur === 'object' && cur !== null
      ? { ...(cur as Record<string, unknown>) }
      : {};
  if (
    val === undefined ||
    val === '' ||
    (typeof val === 'number' && Number.isNaN(val))
  )
    delete next[child];
  else next[child] = val;
  return { [parent]: next };
}

/** Node metadata key/value editor (serials, versions, hostnames, sites…). */
function metaHtml(meta?: Record<string, string | number | boolean>): string {
  const rows = Object.entries(meta ?? {})
    .map(
      ([k, v]) =>
        `<div class="meta-row" data-mk="${esc(k)}">` +
        `<input class="meta-k" value="${esc(k)}" readonly />` +
        `<input class="meta-v" value="${esc(String(v))}" />` +
        `<button class="meta-x" title="Remove" aria-label="Remove metadata ${esc(k)}">✕</button></div>`,
    )
    .join('');
  return (
    `<div class="insp-h meta-top">Metadata</div>` +
    rows +
    `<div class="meta-row meta-add">` +
    `<input class="meta-nk" placeholder="key" />` +
    `<input class="meta-nv" placeholder="value" />` +
    `<button class="meta-addbtn" title="Add" aria-label="Add metadata entry">＋</button></div>`
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
      if (e.key === 'Enter' && !isImeKey(e)) add();
    }),
  );
}

function typeRow(current: string, types: string[]): string {
  const opts = types.includes(current) ? types : [current, ...types];
  return `<label class="insp-row"><span>Type</span><select id="i-type">${opts
    .map(
      (t) =>
        `<option value="${esc(t)}" ${t === current ? 'selected' : ''}>${esc(t)}</option>`,
    )
    .join('')}</select></label>`;
}

/** A named, ordered bucket of catalog field keys for the inspector. */
interface FieldGroup {
  title: string;
  keys: string[];
  fineTune?: string[];
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
  {
    title: 'Label',
    keys: ['label', 'labelOffset', 'fromLabel', 'toLabel', 'labelScale'],
    open: true,
  },
  {
    title: 'Wiring sheet',
    keys: [
      'style',
      'fromInterface',
      'toInterface',
      'fromOptic',
      'toOptic',
      'fromBundle',
      'toBundle',
      'bandwidth',
      'transport',
    ],
  },
  {
    title: 'Routing',
    keys: [
      'lineStyle',
      'fromPort',
      'toPort',
      'fromPortOffset',
      'toPortOffset',
      'cornerRadius',
      'waypoints',
    ],
    fineTune: ['fromPortOffset', 'toPortOffset'],
    open: true,
  },
  {
    title: 'Animation',
    keys: ['dots', 'flowSpeed', 'flowParticles', 'reverseFlow'],
  },
  { title: 'Advanced', keys: ['href', 'tooltip', 'locked', 'layer', 'source'] },
];

/** Node fields, grouped the same way. */
const NODE_GROUPS: FieldGroup[] = [
  {
    title: 'Label',
    keys: [
      'label',
      'sublabel',
      'labelPlacement',
      'labelOffsetX',
      'labelOffset',
      'labelColor',
    ],
    fineTune: ['labelOffsetX', 'labelOffset'],
    open: true,
  },
  { title: 'Appearance', keys: ['color', 'opacity', 'status'], open: true },
  { title: 'Position', keys: ['x', 'y'] },
  {
    title: 'Wiring sheet',
    keys: ['tier', 'portLabels', 'portTable'],
  },
  {
    title: 'Advanced',
    keys: ['href', 'tooltip', 'locked', 'linkAttach', 'layer', 'source'],
  },
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
    fineTuneKeys: string[] = [],
  ): string => {
    if (!specs.length) return '';
    const open = groupOpen.get(title) ?? fallbackOpen;
    const fineTune = specs.filter((f) => fineTuneKeys.includes(f.key));
    const controls = specs
      .map((f) => {
        if (!fineTuneKeys.includes(f.key)) return fieldControl(f, cfg);
        return f === fineTune[0] ? section('Fine Tune', fineTune, false) : '';
      })
      .join('');
    return (
      `<details class="insp-group" data-group="${esc(title)}"${open ? ' open' : ''}>` +
      `<summary class="insp-h">${title}</summary>` +
      controls +
      `</details>`
    );
  };

  let html = '';
  for (const g of groups) {
    const specs = g.keys
      .map((k) => byKey.get(k))
      .filter((f): f is FieldSpec => Boolean(f));
    specs.forEach((f) => used.add(f.key));
    html += section(g.title, specs, g.open ?? false, g.fineTune);
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
    `<label class="insp-row"><span>Title</span><input id="p-title" value="${esc(doc.title)}"/></label>` +
    `<div class="insp-h">Page</div>` +
    `<label class="insp-row"><span>Name</span><input id="p-name" value="${esc(page.name)}"/></label>` +
    `<div class="insp-row"><span>Canvas</span><span class="insp-pair">` +
    `<input type="number" id="p-w" min="1" value="${w || 0}" aria-label="Canvas width" title="Width"/>` +
    `<input type="number" id="p-h" min="1" value="${h || 0}" aria-label="Canvas height" title="Height"/></span></div>` +
    `<div class="insp-row"><span>Size</span><span class="insp-btns"><button class="tbtn ab" id="p-fit" title="Resize the page to wrap all content (Tidy/Balance grow it automatically)">⤢ fit to content</button></span></div>` +
    `<div class="insp-h">Playback</div>` +
    `<label class="insp-row"><span>Hold (ms)</span><input type="number" id="p-dur" min="100" step="100" placeholder="${DEFAULT_PAGE_DURATION}" value="${page.duration ?? ''}"/></label>` +
    `<label class="insp-row"><span>Transition</span><select id="p-tr">` +
    `<option value="cut"${page.transition !== 'fade' ? ' selected' : ''}>cut</option>` +
    `<option value="fade"${page.transition === 'fade' ? ' selected' : ''}>fade</option>` +
    `</select></label>` +
    `<label class="insp-row" title="Draw a hop where standard line links cross others — the classic 'these wires aren't joined' notation"><span>Crossings</span><select id="p-jumps">` +
    `<option value=""${!page.lineJumps ? ' selected' : ''}>overlap (none)</option>` +
    `<option value="arc"${page.lineJumps === 'arc' ? ' selected' : ''}>jump — arc</option>` +
    `<option value="gap"${page.lineJumps === 'gap' ? ' selected' : ''}>jump — gap</option>` +
    `</select></label>` +
    `<label class="insp-row" title="How endpoint (port) labels draw: a glass chip beside the wire, or a dark pill on the node edge at the attach point (wiring-sheet style — pair with the anchor box's Distribute ends)"><span>Port labels</span><select id="p-portlabels">` +
    `<option value="chip"${page.portLabels !== 'pill' ? ' selected' : ''}>chip beside the wire</option>` +
    `<option value="pill"${page.portLabels === 'pill' ? ' selected' : ''}>pill on the node edge</option>` +
    `</select></label>` +
    // Experimental link anchor box — page-level; nodes may override it.
    `<label class="insp-row" title="Experimental: links attach to a padded box that clears the node label instead of the icon edge. Nodes can override it in their Properties."><span>Link anchor box</span><input type="checkbox" id="p-attach"${page.linkAttach ? ' checked' : ''}/></label>` +
    (page.linkAttach
      ? `<label class="insp-row"><span>Box padding</span><input type="number" id="p-attach-pad" min="0" max="200" step="any" placeholder="6" value="${page.linkAttach.pad ?? ''}"/></label>` +
        `<label class="insp-row" title="Spread every link endpoint on a node side into evenly spaced slots"><span>Distribute ends</span><input type="checkbox" id="p-attach-dist"${page.linkAttach.distribute ? ' checked' : ''}/></label>`
      : '') +
    frameStoryHtml() +
    `<div class="insp-h">Legend</div>` +
    `<label class="insp-row"><span>Show key</span><input type="checkbox" id="p-legend"${doc.legend?.show ? ' checked' : ''}/></label>` +
    `<label class="insp-row"><span>Position</span><select id="p-legend-pos">` +
    (['tl', 'tr', 'bl', 'br'] as const)
      .map(
        (p) =>
          `<option value="${p}"${(doc.legend?.position ?? 'tl') === p ? ' selected' : ''}>${
            {
              tl: 'top-left',
              tr: 'top-right',
              bl: 'bottom-left',
              br: 'bottom-right',
            }[p]
          }</option>`,
      )
      .join('') +
    `</select></label>` +
    (doc.legend?.show
      ? `<label class="insp-row" title="Lay the key out across columns, like a drawing sheet's Key strip"><span>Columns</span><input type="number" id="p-legend-cols" min="1" max="8" value="${doc.legend.columns ?? 1}"/></label>` +
        `<label class="insp-row"><span>Key title</span><input id="p-legend-title" value="${esc(doc.legend.title ?? '')}" placeholder="Key"/></label>`
      : '') +
    sheetHtml() +
    layersHtml()
  );
}

/** The Sheet section of the Document panel (W6): paper size, border, title block. */
function sheetHtml(): string {
  const sh = doc.sheet;
  const tb = sh?.titleBlock;
  const field = (label: string): string =>
    tb?.fields?.find((f) => f.label.toLowerCase() === label.toLowerCase())
      ?.value ?? '';
  return (
    `<div class="insp-h">Sheet</div>` +
    `<label class="insp-row" title="Draw the document as a drawing sheet: border, top title, bottom-right title block"><span>Sheet frame</span><input type="checkbox" id="p-sheet"${sh ? ' checked' : ''}/></label>` +
    (sh
      ? `<label class="insp-row"><span>Size</span><select id="p-sheet-size">` +
        `<option value="custom"${!sh.size || sh.size === 'custom' ? ' selected' : ''}>custom (keep canvas)</option>` +
        SHEET_SIZE_IDS.map(
          (id) =>
            `<option value="${id}"${sh.size === id ? ' selected' : ''}>${esc(SHEET_SIZE_LABELS[id])}</option>`,
        ).join('') +
        `</select></label>` +
        `<label class="insp-row"><span>Orientation</span><select id="p-sheet-orient">` +
        `<option value="landscape"${sh.orientation !== 'portrait' ? ' selected' : ''}>landscape</option>` +
        `<option value="portrait"${sh.orientation === 'portrait' ? ' selected' : ''}>portrait</option>` +
        `</select></label>` +
        `<label class="insp-row"><span>Border</span><input type="checkbox" id="p-sheet-border"${sh.border !== false ? ' checked' : ''}/></label>` +
        `<label class="insp-row"><span>Top title</span><input type="checkbox" id="p-sheet-title"${sh.title !== false ? ' checked' : ''}/></label>` +
        `<label class="insp-row"><span>Title block</span><input type="checkbox" id="p-sheet-tb"${tb && tb.show !== false ? ' checked' : ''}/></label>` +
        (tb && tb.show !== false
          ? `<label class="insp-row"><span>Subtitle</span><input id="p-sheet-sub" value="${esc(tb.subtitle ?? '')}" placeholder="sheet name"/></label>` +
            `<label class="insp-row"><span>Drawn by</span><input class="p-sheet-field" data-label="Drawn by" value="${esc(field('Drawn by'))}"/></label>` +
            `<label class="insp-row"><span>Revision</span><input class="p-sheet-field" data-label="Revision" value="${esc(field('Revision'))}"/></label>` +
            `<label class="insp-row"><span>Date</span><input class="p-sheet-field" data-label="Date" value="${esc(field('Date'))}"/></label>` +
            `<label class="insp-row"><span>Logo URL</span><input id="p-sheet-logo" value="${esc(tb.logoHref ?? '')}" placeholder="https://…"/></label>`
          : '')
      : '')
  );
}

/** The Layers section of the Document panel (B.3): per-layer eye + opacity. */
function layersHtml(): string {
  const layers = doc.layers ?? [];
  const rows = layers
    .map((l, i) => {
      const vis = l.defaultVisible !== false;
      const op = Math.round((l.opacity ?? 1) * 100);
      return (
        `<div class="layer-row" data-li="${i}">` +
        `<button class="layer-eye" data-li="${i}" title="Show / hide layer" aria-label="${vis ? 'Hide' : 'Show'} layer ${esc(l.name ?? l.id)}" aria-pressed="${vis}">${vis ? '👁' : '🚫'}</button>` +
        `<span class="layer-name">${esc(l.name ?? l.id)}</span>` +
        `<input class="layer-op" data-li="${i}" type="range" min="0" max="100" step="5" value="${op}" title="Layer opacity (${op}%)" aria-label="Opacity of layer ${esc(l.name ?? l.id)}"/>` +
        `</div>`
      );
    })
    .join('');
  return (
    `<div class="insp-h">Layers</div>` +
    (rows || `<div class="insp-hint">No layers declared.</div>`) +
    `<button class="insp-btn" id="p-layer-add">＋ Layer</button>`
  );
}

/** Frame storytelling section (2.1 caption + 2.2/2.4 emphasis picker). */
function frameStoryHtml(): string {
  const page = editor.page;
  const emph = new Set(page.emphasis ?? []);
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
    page.nodes.length + page.links.length === 0
      ? `<div class="insp-hint">No elements on this frame.</div>`
      : `<div class="emph-list scroll-slim">${nodeRows}${linkRows}</div>`;
  return (
    `<div class="insp-h">Frame</div>` +
    `<label class="insp-row"><span>Caption</span>` +
    `<input id="p-caption" value="${esc(page.caption ?? '')}" placeholder="what this frame shows"/></label>` +
    `<div class="insp-h">Emphasis (${emph.size})</div>` +
    `<div class="insp-hint">Tick elements to spotlight; the rest dim. Or right-click a selection → “Emphasize on this frame”.</div>` +
    `<div class="emph-actions">` +
    `<button class="insp-btn" id="p-emph-clear"${emph.size ? '' : ' disabled'}>Clear emphasis</button></div>` +
    picker
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
  inspector.querySelector('#p-fit')?.addEventListener('click', () => {
    editor.fitPageToContent();
    renderInspector();
  });
  // Playback timing — same fields the MCP set_page_properties tool sets.
  // Routed through updatePageProps so the edits land on the undo stack (#205).
  const dur = inspector.querySelector<HTMLInputElement>('#p-dur');
  dur?.addEventListener('change', () => {
    const v = Number(dur.value);
    editor.updatePageProps({
      duration: Number.isFinite(v) && v > 0 ? v : undefined,
    });
  });
  const tr = inspector.querySelector<HTMLSelectElement>('#p-tr');
  tr?.addEventListener('change', () => {
    editor.updatePageProps({
      transition: tr.value === 'fade' ? 'fade' : undefined,
    });
  });
  const jumps = inspector.querySelector<HTMLSelectElement>('#p-jumps');
  jumps?.addEventListener('change', () => {
    editor.updatePageProps({
      lineJumps:
        jumps.value === 'arc' || jumps.value === 'gap'
          ? jumps.value
          : undefined,
    });
  });
  const portLabels =
    inspector.querySelector<HTMLSelectElement>('#p-portlabels');
  portLabels?.addEventListener('change', () => {
    editor.updatePageProps({
      portLabels: portLabels.value === 'pill' ? 'pill' : undefined,
    });
  });
  // Link anchor box (experimental) — page-level; the art redraws on change.
  const attachOn = inspector.querySelector<HTMLInputElement>('#p-attach');
  attachOn?.addEventListener('change', () => {
    editor.updatePageProps({
      linkAttach: attachOn.checked ? { ...editor.page.linkAttach } : undefined,
    });
    renderInspector();
  });
  const attachPad = inspector.querySelector<HTMLInputElement>('#p-attach-pad');
  if (attachPad)
    wireNumberInput(
      attachPad,
      LINK_ATTACH_FIELDS.find((f) => f.key === 'pad'),
      (val) => {
        const next = { ...editor.page.linkAttach };
        if (val === undefined) delete next.pad;
        else next.pad = val;
        editor.updatePageProps({ linkAttach: next }, !editing);
        editing = true;
      },
      () => editor.page.linkAttach?.pad,
    );
  const attachDist =
    inspector.querySelector<HTMLInputElement>('#p-attach-dist');
  attachDist?.addEventListener('change', () => {
    const next = { ...editor.page.linkAttach };
    if (attachDist.checked) next.distribute = true;
    else delete next.distribute;
    editor.updatePageProps({ linkAttach: next });
  });
  // Legend (B.1) — a per-document setting; redraw the overlay so it shows live.
  const legendOn = inspector.querySelector<HTMLInputElement>('#p-legend');
  legendOn?.addEventListener('change', () => {
    doc.legend = { ...doc.legend, show: legendOn.checked };
    editor.redrawOverlay();
    markDirty();
    renderInspector(); // the key's own options appear / go with it
  });
  const legendPos = inspector.querySelector<HTMLSelectElement>('#p-legend-pos');
  legendPos?.addEventListener('change', () => {
    doc.legend = {
      ...doc.legend,
      position: legendPos.value as 'tl' | 'tr' | 'bl' | 'br',
    };
    editor.redrawOverlay();
    markDirty();
  });
  const legendCols =
    inspector.querySelector<HTMLInputElement>('#p-legend-cols');
  legendCols?.addEventListener('change', () => {
    const n = Math.max(1, Math.min(8, Math.round(Number(legendCols.value))));
    const next = { ...doc.legend };
    if (n > 1) next.columns = n;
    else delete next.columns;
    doc.legend = next;
    editor.redrawOverlay();
    markDirty();
  });
  const legendTitle =
    inspector.querySelector<HTMLInputElement>('#p-legend-title');
  legendTitle?.addEventListener('input', () => {
    const next = { ...doc.legend };
    if (legendTitle.value.trim()) next.title = legendTitle.value;
    else delete next.title;
    doc.legend = next;
    editor.redrawOverlay();
    markDirty();
  });
  wireSheet();
  wireLayers();
  wireFrameStory();
}

/** Wire the Sheet section (W6): every control writes `doc.sheet` and redraws. */
function wireSheet(): void {
  const on = inspector.querySelector<HTMLInputElement>('#p-sheet');
  const commit = (rerender = false): void => {
    editor.redrawOverlay();
    markDirty();
    if (rerender) renderInspector();
  };
  on?.addEventListener('change', () => {
    if (on.checked) doc.sheet = doc.sheet ?? {};
    else delete doc.sheet;
    commit(true);
  });
  const sh = (): SheetConfig => (doc.sheet ??= {});
  const applySize = (): void => {
    const vb = sheetViewBox(sh().size, sh().orientation);
    if (!vb) return;
    for (const p of doc.pages) p.viewBox = vb;
    showPage(doc.pages[current]!);
  };
  inspector
    .querySelector<HTMLSelectElement>('#p-sheet-size')
    ?.addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value;
      if (v === 'custom') delete sh().size;
      else sh().size = v as SheetConfig['size'];
      applySize();
      commit();
    });
  inspector
    .querySelector<HTMLSelectElement>('#p-sheet-orient')
    ?.addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value;
      if (v === 'portrait') sh().orientation = 'portrait';
      else delete sh().orientation;
      applySize();
      commit();
    });
  const bool = (id: string, key: 'border' | 'title'): void => {
    inspector
      .querySelector<HTMLInputElement>(id)
      ?.addEventListener('change', (e) => {
        if ((e.target as HTMLInputElement).checked) delete sh()[key];
        else sh()[key] = false;
        commit();
      });
  };
  bool('#p-sheet-border', 'border');
  bool('#p-sheet-title', 'title');
  inspector
    .querySelector<HTMLInputElement>('#p-sheet-tb')
    ?.addEventListener('change', (e) => {
      const tb = { ...(sh().titleBlock ?? {}) };
      if ((e.target as HTMLInputElement).checked) delete tb.show;
      else tb.show = false;
      sh().titleBlock = tb;
      commit(true);
    });
  inspector
    .querySelector<HTMLInputElement>('#p-sheet-sub')
    ?.addEventListener('input', (e) => {
      const tb = { ...(sh().titleBlock ?? {}) };
      const v = (e.target as HTMLInputElement).value;
      if (v.trim()) tb.subtitle = v;
      else delete tb.subtitle;
      sh().titleBlock = tb;
      commit();
    });
  inspector
    .querySelectorAll<HTMLInputElement>('.p-sheet-field')
    .forEach((inp) =>
      inp.addEventListener('input', () => {
        const tb = { ...(sh().titleBlock ?? {}) };
        const label = inp.dataset.label!;
        const fields = (tb.fields ?? []).filter(
          (f) => f.label.toLowerCase() !== label.toLowerCase(),
        );
        if (inp.value.trim()) fields.push({ label, value: inp.value });
        // Keep the canonical order so the block reads Drawn by / Revision / Date.
        const order = ['drawn by', 'revision', 'date'];
        fields.sort(
          (a, b) =>
            (order.indexOf(a.label.toLowerCase()) + 1 || 99) -
            (order.indexOf(b.label.toLowerCase()) + 1 || 99),
        );
        if (fields.length) tb.fields = fields;
        else delete tb.fields;
        sh().titleBlock = tb;
        commit();
      }),
    );
  inspector
    .querySelector<HTMLInputElement>('#p-sheet-logo')
    ?.addEventListener('change', (e) => {
      const tb = { ...(sh().titleBlock ?? {}) };
      const v = (e.target as HTMLInputElement).value.trim();
      if (/^https:\/\//i.test(v)) tb.logoHref = v;
      else delete tb.logoHref;
      sh().titleBlock = tb;
      commit();
    });
}

/** Wire the Frame section: caption + emphasis picker/actions (Phase 2). */
function wireFrameStory(): void {
  const cap = inspector.querySelector<HTMLInputElement>('#p-caption');
  cap?.addEventListener('input', () => {
    // Undoable via updatePageProps; a typing run snapshots once (`editing`).
    editor.updatePageProps({ caption: cap.value || undefined }, !editing);
    editing = true;
  });
  inspector.querySelector('#p-emph-clear')?.addEventListener('click', () => {
    editor.clearEmphasis();
    renderInspector();
  });
  inspector.querySelectorAll<HTMLInputElement>('.emph-cb').forEach((cb) => {
    cb.addEventListener('change', () => {
      editor.toggleEmphasis(cb.dataset.eid!);
      renderInspector();
    });
  });
}

/** Wire the Document panel's Layers controls (B.3): eye, opacity, + Layer. */
function wireLayers(): void {
  const layers = doc.layers ?? [];
  inspector.querySelectorAll<HTMLButtonElement>('.layer-eye').forEach((btn) => {
    btn.addEventListener('click', () => {
      const l = layers[Number(btn.dataset.li)];
      if (!l) return;
      l.defaultVisible = l.defaultVisible === false; // toggle (default = visible)
      editor.rerender();
      renderInspector(); // refresh the eye glyph
      markDirty();
    });
  });
  inspector
    .querySelectorAll<HTMLInputElement>('.layer-op')
    .forEach((slider) => {
      slider.addEventListener('input', () => {
        const l = layers[Number(slider.dataset.li)];
        if (!l) return;
        l.opacity = Math.max(0, Math.min(1, Number(slider.value) / 100));
        editor.rerender();
        markDirty();
      });
    });
  inspector.querySelector('#p-layer-add')?.addEventListener('click', () => {
    const n = (doc.layers ?? []).length + 1;
    const KINDS = ['underlay', 'overlay', 'policy', 'service'] as const;
    doc.layers = [
      ...(doc.layers ?? []),
      {
        id: `layer${n}`,
        name: `Layer ${n}`,
        kind: KINDS[(n - 1) % KINDS.length],
        defaultVisible: true,
      },
    ];
    editor.rerender();
    renderInspector();
    markDirty();
  });
}

/** Render the inspector for the current selection, driven entirely by the catalog. */
function renderInspector(): void {
  const link = editor.getSelectedLink();
  const node = link ? null : editor.getSelectedNode();
  const anchor = link || node ? null : editor.getSelectedAnchor();
  const zone = link || node || anchor ? null : editor.getSelectedZone();
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
      arrangeRow() +
      formatRow();
  } else if (link) {
    const info = getLinkType(link.type);
    const types = linkCatalog().map((l) => l.type);
    const linkCount = editor.selectedLinkIds().length;
    html +=
      `<div class="insp-h">Link</div>` +
      (linkCount > 1
        ? `<div class="insp-hint">${linkCount} links selected. Type, colour, style and layer changes apply to all; everything else edits this one.</div>`
        : '') +
      typeRow(link.type, types) +
      endpointRow('from', link.from, link.to) +
      endpointRow('to', link.to, link.from) +
      `<div class="insp-row"><span>Endpoints</span><span class="insp-btns"><button class="tbtn ab" id="i-swap" title="Swap from/to">⇄ swap</button>${
        editor.selectedLinkHasBends()
          ? `<button class="tbtn ab" id="i-straighten" title="Clear bends — straight line">╱ straighten</button>`
          : ''
      }</span></div>` +
      groupedFieldsHtml(info, link as Record<string, unknown>, LINK_GROUPS) +
      arrangeRow() +
      formatRow();
  } else if (anchor) {
    html +=
      `<div class="insp-h">Anchor</div>` +
      `<div class="insp-row"><span>Id</span><span class="insp-val">${esc(anchor.id)}</span></div>` +
      `<div class="insp-row"><span>Position</span><span class="insp-pair">` +
      `<input type="number" id="a-x" value="${anchor.x}" aria-label="Anchor x" title="X"/>` +
      `<input type="number" id="a-y" value="${anchor.y}" aria-label="Anchor y" title="Y"/></span></div>` +
      `<div class="insp-row"><span>Links</span><span class="insp-val">${editor.anchorLinkCount(anchor.id)}</span></div>` +
      `<div class="insp-row"><span>Anchor</span><span class="insp-btns"><button class="tbtn ab" id="a-del" title="Delete anchor">🗑 delete</button></span></div>`;
  } else if (zone) {
    // A zone region was clicked on canvas — edit it directly (the same control
    // surface as the annotations list, wired by wireAnnotations()).
    html += `<div class="insp-h">Zone</div>` + zoneEditorHtml(zone);
  } else {
    // Multi-node selection: no single-element editor, but the format painter
    // still applies (pasteFormat brushes every selected node — #211).
    if (editor.selectionCount() > 1)
      html +=
        `<div class="insp-h">Selection (${editor.selectionCount()} nodes)</div>` +
        formatRow();
    // Nothing (singly) selected — show document + page properties.
    html += propertiesHtml();
  }
  // The annotations list shows every zone/flow/marker; skip the one already
  // shown focused above to avoid a duplicate editor for the same id.
  html += annotationsHtml(zone?.id);
  inspector.innerHTML = html;

  if (node) {
    wireType((t) => {
      editor.updateNode({ type: t });
      renderInspector();
    });
    wireFields(
      (key, val, commit) => {
        const info = getNodeType(node.type, doc.customNodes);
        editor.updateNode(
          fieldPatch(
            info,
            editor.getSelectedNode() as Record<string, unknown> | undefined,
            key,
            val,
          ) as Record<string, unknown>,
          commit,
        );
        // An `object` field's enable switch shows/hides its nested rows.
        if (info?.fields.find((f) => f.key === key)?.kind === 'object')
          renderInspector();
      },
      {
        fields: () => getNodeType(node.type, doc.customNodes)?.fields,
        current: () =>
          editor.getSelectedNode() as Record<string, unknown> | null,
      },
    );
    wireMeta(node.meta);
  } else if (link) {
    wireType((t) => {
      editor.updateLink({ type: t });
      renderInspector();
    });
    wireFields(
      (key, val, commit) =>
        editor.updateLink(
          fieldPatch(
            getLinkType(link.type),
            editor.getSelectedLink() as Record<string, unknown> | undefined,
            key,
            val,
          ) as Record<string, unknown>,
          commit,
        ),
      {
        fields: () => getLinkType(link.type)?.fields,
        current: () =>
          editor.getSelectedLink() as Record<string, unknown> | null,
      },
    );
    for (const end of ['from', 'to'] as const)
      inspector
        .querySelector<HTMLSelectElement>(`#i-${end}`)
        ?.addEventListener('change', (ev) => {
          const target = (ev.target as HTMLSelectElement).value;
          editor.reconnectLink(link.id, end, target);
          renderInspector();
        });
    inspector.querySelector('#i-swap')?.addEventListener('click', () => {
      editor.swapLink();
      renderInspector();
    });
    inspector.querySelector('#i-straighten')?.addEventListener('click', () => {
      editor.straightenLink();
      renderInspector();
    });
  } else if (anchor) {
    const ax = inspector.querySelector<HTMLInputElement>('#a-x');
    const ay = inspector.querySelector<HTMLInputElement>('#a-y');
    // An anchor always has a position: a cleared field keeps the old one.
    for (const [input, axis] of [
      [ax, 'x'],
      [ay, 'y'],
    ] as const)
      if (input)
        wireNumberInput(
          input,
          { key: axis, label: axis, kind: 'number', required: true },
          (val) => {
            if (val === undefined) return;
            editor.updateAnchor({ [axis]: val }, !editing);
            editing = true;
          },
          () => editor.getSelectedAnchor()?.[axis],
        );
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
  wireFormatRow();
  wireGroups();
  wireAnnotations();
  wireHexDots();
}

/**
 * A link endpoint picker: every node (by label) and anchor on the page, except
 * the link's other end (a link can't loop back onto one element). Changing it
 * re-attaches that end — the inspector twin of dragging the end handle.
 */
function endpointRow(
  end: 'from' | 'to',
  current: string,
  other: string,
): string {
  const p = editor.page;
  const opt = (id: string, text: string): string =>
    `<option value="${esc(id)}"${id === current ? ' selected' : ''}>${esc(text)}</option>`;
  const nodes = p.nodes
    .filter((n) => n.id !== other)
    .map((n) => {
      const label = String(n.label ?? '').trim();
      return {
        id: n.id,
        text: label && label !== n.id ? `${label} (${n.id})` : n.id,
      };
    })
    .sort((a, b) => a.text.localeCompare(b.text));
  const anchors = p.anchors.filter((a) => a.id !== other);
  let opts = nodes.map((n) => opt(n.id, n.text)).join('');
  if (anchors.length)
    opts += `<optgroup label="Anchors">${anchors.map((a) => opt(a.id, `⌖ ${a.id}`)).join('')}</optgroup>`;
  // A dangling reference still shows (and stays selected) so it can be fixed.
  if (
    !p.nodes.some((n) => n.id === current) &&
    !p.anchors.some((a) => a.id === current)
  )
    opts = opt(current, `${current} (missing)`) + opts;
  const title = end === 'from' ? 'From' : 'To';
  return (
    `<label class="insp-row"><span>${title}</span>` +
    `<select id="i-${end}" aria-label="Link ${end} endpoint" title="Re-attach the ${end} end (or drag its handle on the canvas)">${opts}</select></label>`
  );
}

/** Z-order ("Arrange") controls — shown for a single node or a link. */
function arrangeRow(): string {
  return (
    `<div class="insp-row"><span>Arrange</span><span class="arrange">` +
    `<button class="tbtn ab" data-z="back" title="Send to back ([Ctrl+[)" aria-label="Send to back">⤓⤓</button>` +
    `<button class="tbtn ab" data-z="backward" title="Send backward ([)" aria-label="Send backward">⤓</button>` +
    `<button class="tbtn ab" data-z="forward" title="Bring forward (])" aria-label="Bring forward">⤒</button>` +
    `<button class="tbtn ab" data-z="front" title="Bring to front (Ctrl+])" aria-label="Bring to front">⤒⤒</button>` +
    `</span></div>`
  );
}

/** Format painter (issue #211): a touch/keyboard surface onto the same
 * `copyFormat`/`pasteFormat` commands as the context menu + shortcuts. */
function formatRow(): string {
  return (
    `<div class="insp-row"><span>Format</span><span class="insp-btns">` +
    `<button class="tbtn ab" id="i-copyfmt" title="Copy format (Ctrl/Cmd+Alt+C)"${editor.canCopyFormat() ? '' : ' disabled'}>⧉ copy</button>` +
    `<button class="tbtn ab" id="i-pastefmt" title="Paste format (Ctrl/Cmd+Alt+V)"${editor.canPasteFormat() ? '' : ' disabled'}>⤹ paste</button>` +
    `</span></div>`
  );
}

function wireFormatRow(): void {
  inspector.querySelector('#i-copyfmt')?.addEventListener('click', () => {
    editor.copyFormat();
    renderInspector(); // paste becomes available
  });
  inspector.querySelector('#i-pastefmt')?.addEventListener('click', () => {
    editor.pasteFormat();
    renderInspector();
  });
}

function wireType(onChange: (t: string) => void): void {
  inspector
    .querySelector<HTMLSelectElement>('#i-type')
    ?.addEventListener('change', (e) =>
      onChange((e.target as HTMLSelectElement).value),
    );
}

/** The value stored under an inspector key ("opacity", "linkAttach.pad"). */
function storedValue(
  el: Record<string, unknown> | null | undefined,
  key: string,
): unknown {
  let cur: unknown = el;
  for (const part of key.split('.'))
    cur =
      typeof cur === 'object' && cur !== null
        ? (cur as Record<string, unknown>)[part]
        : undefined;
  return cur;
}

/**
 * Wire one number input. Each keystroke is read by `parseNumberField`: a
 * cleared field unsets the property (`undefined`), an out-of-range number is
 * clamped, and text that is no usable number stores nothing. Leaving the
 * field then shows what is stored, so a clamped or refused entry does not
 * linger looking as if it had been accepted.
 */
function wireNumberInput(
  el: HTMLInputElement,
  spec: FieldSpec | undefined,
  set: (val: number | undefined) => void,
  stored: () => unknown,
): void {
  const bounds = spec ? numberBounds(spec) : {};
  el.addEventListener('input', () => {
    const parsed = parseNumberField(el.value, bounds, {
      required: spec?.required,
      badInput: el.validity.badInput,
    });
    if (parsed.kind === 'invalid') return;
    set(parsed.kind === 'value' ? parsed.value : undefined);
  });
  el.addEventListener('change', () => {
    el.value = numberFieldText(stored());
  });
}

/**
 * Wire every catalog-rendered field control to the given setter. `source`
 * gives the element's field specs and its current state, for number fields.
 */
function wireFields(
  set: (key: string, val: unknown, commit: boolean) => void,
  source: {
    fields: () => FieldSpec[] | undefined;
    current: () => Record<string, unknown> | null | undefined;
  },
): void {
  inspector
    .querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key]')
    .forEach((el) => {
      const key = el.dataset.key!;
      if (el instanceof HTMLSelectElement) {
        el.addEventListener('change', () => set(key, el.value, true));
      } else if (el.type === 'checkbox') {
        el.addEventListener('change', () => set(key, el.checked, true));
      } else if (el.dataset.kind === 'number') {
        wireNumberInput(
          el,
          findField(source.fields(), key),
          (val) => {
            set(key, val, !editing);
            editing = true;
          },
          () => storedValue(source.current(), key),
        );
      } else {
        el.addEventListener('input', () => {
          set(key, el.value, !editing);
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
  inspector
    .querySelectorAll<HTMLElement>('.compass[data-key]')
    .forEach((grid) => wireCompass(grid, grid.dataset.key!, set));
}

/** Keep the grid mounted so the browser can deliver both clicks and dblclick. */
function wireCompass(
  grid: HTMLElement,
  key: string,
  set: (key: string, val: unknown, commit: boolean) => void,
): void {
  const kind = grid.dataset.ckind === 'point' ? 'point' : 'enum';
  const spec: FieldSpec = { key, label: key, kind };
  const buttons = grid.querySelectorAll<HTMLButtonElement>('[data-cval]');
  let pending: ReturnType<typeof setTimeout> | undefined;

  const refresh = (): void => {
    const cfg =
      kind === 'point' ? editor.getSelectedLink() : editor.getSelectedNode();
    const cur = compassCodeOf(spec, cfg?.[key]);
    buttons.forEach((b) => {
      const on = b.dataset.cval === cur;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    for (const offset of ['labelOffsetX', 'labelOffset']) {
      const input = inspector.querySelector<HTMLInputElement>(
        `input[data-key="${offset}"]`,
      );
      if (input) input.value = String(cfg?.[offset] ?? '');
    }
  };
  const place = (code: string): void => {
    if (!grid.isConnected) return;
    if (kind === 'enum') {
      editor.updateNode({
        labelPlacement: (code || undefined) as LabelPlacement | undefined,
        labelOffsetX: undefined,
        labelOffset: undefined,
        labelY: undefined,
      });
    } else {
      set(key, compassValueOf(spec, code), true);
    }
    refresh();
  };
  const nudge = (code: LabelPlacement): void => {
    if (!grid.isConnected) return;
    const node = editor.getSelectedNode();
    const link = editor.getSelectedLink();
    if (kind === 'enum' && node) editor.updateNode(nodeLabelNudge(node, code));
    else if (kind === 'point' && link)
      editor.updateLink(linkLabelNudge(link, code));
    refresh();
  };

  grid.addEventListener('focusout', (e) => {
    if (!grid.contains(e.relatedTarget as Node | null)) clearTimeout(pending);
  });
  buttons.forEach((b) => {
    const code = b.dataset.cval ?? '';
    b.addEventListener('mousedown', (e) => {
      if (e.detail > 1) clearTimeout(pending);
    });
    b.addEventListener('click', (e) => {
      clearTimeout(pending);
      if (e.detail === 0) {
        place(code); // Keyboard activation doesn't need double-click arbitration.
      } else if (e.detail === 1) {
        // A double-click must nudge from the current position, not a new preset.
        pending = setTimeout(() => place(code), 400);
      }
    });
    b.addEventListener('dblclick', (e) => {
      e.preventDefault();
      clearTimeout(pending);
      if (code) nudge(code as LabelPlacement);
      else place('');
    });
  });
}

/** Keep each colour row's preview dot in step with its hex field as typed. */
function wireHexDots(): void {
  inspector.querySelectorAll<HTMLInputElement>('.hexwrap .hex').forEach((i) => {
    const dot = i.parentElement?.querySelector<HTMLElement>('.hexdot');
    if (!dot) return;
    i.addEventListener('input', () => {
      dot.style.background = /^#[0-9a-f]{3,8}$/i.test(i.value.trim())
        ? i.value.trim()
        : 'transparent';
    });
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
        `<button class="sw ${c === current ? 'on' : ''}" data-color="${c}" style="background:${c}" title="${c}" aria-label="Color ${c}" aria-pressed="${c === current}"></button>`,
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
    `<button type="button" class="refmv" data-refmove="-1" title="Move earlier" aria-label="Move ${esc(endpointLabel(id))} earlier">‹</button>` +
    `<span class="reflbl">${esc(endpointLabel(id))}</span>` +
    `<button type="button" class="refmv" data-refmove="1" title="Move later" aria-label="Move ${esc(endpointLabel(id))} later">›</button>` +
    `<button type="button" class="refx" data-refdel title="Remove" aria-label="Remove ${esc(endpointLabel(id))}">✕</button>` +
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
  // A point field with the compass widget (flow-path labelOffset) gets the
  // same 3×3 placement picker a link label has; wired in renderAnnotations.
  if (f.widget === 'compass') return compassControl(f, v, 'data-akey');
  switch (f.kind) {
    case 'boolean':
      // A real checkbox: typed into a text box, "false" is stored as a string,
      // which the renderer reads as on.
      return `<label class="${rowClass(f)}"><span>${f.label}${f.animation ? ' ⟳' : ''}</span><input type="checkbox" data-akey="${f.key}" ${booleanFieldChecked(f.key, v) ? 'checked' : ''}/></label>`;
    case 'enum':
      return `<label class="insp-row"><span>${f.label}${req}</span><select data-akey="${f.key}">${enumFieldOptions(
        f,
        v,
      )
        .map(
          (o) =>
            `<option value="${esc(o.value)}"${o.selected ? ' selected' : ''}>${esc(o.label)}</option>`,
        )
        .join('')}</select></label>`;
    case 'color':
      return colorRow(
        f.label,
        hexInput(
          `data-akey="${f.key}" data-akind="color"`,
          v as string | undefined,
        ),
        aswatchRow(f.key, v as string | undefined),
      );
    case 'number':
      return `<label class="insp-row"><span>${f.label}</span><input type="number" data-akey="${f.key}" data-akind="number" value="${esc(String(v ?? ''))}" placeholder="auto"${boundsAttrs(numberBounds(f))}/></label>`;
    case 'refs': {
      const ids = Array.isArray(v) ? (v as string[]) : [];
      const hint =
        f.key === 'waypoints'
          ? `<div class="refhint">Order is the route. Add nodes below or select them in order, then “＋ flow”. Reorder with ‹ ›.</div>`
          : '';
      return (
        `<div class="insp-row col"><span>${f.label}${req}</span>` +
        `<div class="refchips" data-refkey="${f.key}">` +
        ids.map(refChip).join('') +
        `<select class="refadd" title="Add by node">${refAddOptions()}</select>` +
        `</div>${hint}</div>`
      );
    }
    case 'ref':
      return `<label class="${rowClass(f)}"><span>${f.label}${req}</span><input data-akey="${f.key}" value="${esc(String(v ?? ''))}" placeholder="id"/></label>`;
    default:
      return `<label class="${rowClass(f)}"><span>${f.label}</span><input data-akey="${f.key}" value="${esc(String(v ?? ''))}"/></label>`;
  }
}

/** The focused editor for a single selected zone (reuses annotation wiring). */
function zoneEditorHtml(zone: { id: string }): string {
  const info = getAnnotationType('zone')!;
  const cfg = zone as Record<string, unknown>;
  const title = String(cfg.label ?? zone.id);
  return (
    `<details class="anno selected" data-acol="zones" data-aid="${esc(zone.id)}" open>` +
    `<summary><span class="anno-k">${info.label}</span><span class="anno-t">${esc(title)}</span>` +
    `<button class="anno-x" data-azmove title="Select members (then drag to move the zone)" aria-label="Select zone members">⤧</button>` +
    `<button class="anno-x" data-azdup title="Duplicate zone with its contents" aria-label="Duplicate zone with its contents">⧉</button>` +
    `<button class="anno-x" data-adel title="Delete" aria-label="Delete zone">✕</button></summary>` +
    info.fields.map((f) => annoFieldControl(f, cfg)).join('') +
    `</details>`
  );
}

/**
 * Which annotation editors are open, and which of their groups are closed —
 * kept across the inspector's re-renders. A swatch, compass cell or chip
 * click inside an editor re-renders the inspector; without this the editor
 * being worked in snapped shut after every click.
 */
const annoOpen = new Set<string>();
const annoGroupClosed = new Set<string>();
const annoKey = (col: string, id: string): string => `${col}:${id}`;

function annotationsHtml(skipId?: string): string {
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
    // Skip the focused (canvas-selected) zone — it's shown in its own editor above.
    const items = (page[g.col] as { id: string }[]).filter(
      (it) => it.id !== skipId,
    );
    if (!items.length) continue;
    html +=
      `<details class="anno-group"${annoGroupClosed.has(g.col) ? '' : ' open'} data-agroup="${g.col}">` +
      `<summary class="anno-group-h">${esc(info.label)}s<span class="anno-count">${items.length}</span></summary>`;
    for (const item of items) {
      const cfg = item as Record<string, unknown>;
      const title = String(cfg.label ?? cfg.type ?? item.id);
      // Zones are containers (C.2): offer move-members + duplicate-with-contents.
      const zoneBtns =
        g.col === 'zones'
          ? `<button class="anno-x" data-azmove title="Select members (then drag to move the zone)" aria-label="Select zone members">⤧</button>` +
            `<button class="anno-x" data-azdup title="Duplicate zone with its contents" aria-label="Duplicate zone with its contents">⧉</button>`
          : '';
      html +=
        `<details class="anno" data-acol="${g.col}" data-aid="${esc(item.id)}"${annoOpen.has(annoKey(g.col, item.id)) ? ' open' : ''}>` +
        `<summary><span class="anno-k">${info.label}</span><span class="anno-t">${esc(title)}</span>${zoneBtns}<button class="anno-x" data-adel title="Delete" aria-label="Delete ${esc(info.label)} ${esc(title)}">✕</button></summary>` +
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
  // Container-zone actions (C.2): move members / duplicate with contents.
  inspector.querySelectorAll<HTMLButtonElement>('[data-azmove]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.preventDefault();
      editor.selectZoneMembers(
        b.closest<HTMLElement>('[data-aid]')!.dataset.aid!,
      );
    }),
  );
  inspector.querySelectorAll<HTMLButtonElement>('[data-azdup]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.preventDefault();
      editor.duplicateZone(b.closest<HTMLElement>('[data-aid]')!.dataset.aid!);
      renderInspector();
    }),
  );
  inspector
    .querySelectorAll<HTMLDetailsElement>('details.anno-group')
    .forEach((group) =>
      group.addEventListener('toggle', () => {
        const col = group.dataset.agroup!;
        if (group.open) annoGroupClosed.delete(col);
        else annoGroupClosed.add(col);
      }),
    );
  inspector
    .querySelectorAll<HTMLDetailsElement>('details.anno')
    .forEach((host) => {
      const col = host.dataset.acol as AnnoCol;
      const id = host.dataset.aid!;
      // The focused zone editor (a zone clicked on the canvas) is always open
      // and is not part of the list; only the list's editors are remembered.
      if (!host.classList.contains('selected'))
        host.addEventListener('toggle', () => {
          if (host.open) annoOpen.add(annoKey(col, id));
          else annoOpen.delete(annoKey(col, id));
        });
      const setA = (key: string, val: unknown, commit: boolean): void =>
        editor.updateAnnotation(col, id, { [key]: val }, commit);
      const annoFields = getAnnotationType(
        ANNO_GROUPS.find((g) => g.col === col)!.kind,
      )?.fields;
      host
        .querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-akey]')
        .forEach((el) => {
          const key = el.dataset.akey!;
          if (el instanceof HTMLSelectElement) {
            // The empty choice ("None" / "Default") clears the field.
            el.addEventListener('change', () =>
              setA(key, enumFieldValue(el.value), true),
            );
          } else if (el.type === 'checkbox') {
            el.addEventListener('change', () => setA(key, el.checked, true));
          } else if (el.dataset.akind === 'number') {
            wireNumberInput(
              el,
              findField(annoFields, key),
              (val) => {
                setA(key, val, !editing);
                editing = true;
              },
              () =>
                storedValue(
                  (editor.page[col] as { id: string }[]).find(
                    (a) => a.id === id,
                  ) as Record<string, unknown> | undefined,
                  key,
                ),
            );
          } else {
            const kind = el.dataset.akind;
            el.addEventListener('input', () => {
              let val: unknown = el.value;
              if (kind === 'refs')
                val = el.value.split(/[\s,]+/).filter(Boolean);
              setA(key, val, !editing);
              editing = true;
            });
          }
        });
      // Compass placement picker on a point field (flow-path labelOffset):
      // click a cell to write its preset offset, the centre to clear it.
      host
        .querySelectorAll<HTMLElement>('.compass[data-akey]')
        .forEach((grid) => {
          const key = grid.dataset.akey!;
          const spec: FieldSpec = { key, label: key, kind: 'point' };
          grid.querySelectorAll<HTMLButtonElement>('[data-cval]').forEach((b) =>
            b.addEventListener('click', (e) => {
              e.preventDefault();
              setA(key, compassValueOf(spec, b.dataset.cval ?? ''), true);
              renderInspector();
            }),
          );
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

/* Node palette — driven by the catalog; grouped by category. Click to add.
 * A search box (Phase 4) filters the library live; the list re-renders into
 * #palette-list while the search input itself persists (keeps focus/caret). */
const paletteList = app.querySelector<HTMLElement>('#palette-list')!;
const paletteSearch = app.querySelector<HTMLInputElement>('#palette-search')!;
let paletteQuery = '';

/**
 * Open the Node Designer on a custom type (or a new one), with the name rules
 * this document imposes: never a built-in or stock type's name — registering
 * a custom type under one replaces that type's art everywhere — and another
 * custom type's name only after asking.
 */
function designNode(initial: CustomNodeSpec | null): void {
  const reserved = nodeCatalog().map((t) => t.type);
  const custom = (): string[] => doc.customNodes.map((c) => c.typeName);
  openNodeDesigner(initial, upsertCustomNode, {
    suggest: (base) => uniqueTypeName(base, [...reserved, ...custom()]),
    check: (name) =>
      checkCustomTypeName({
        name,
        editing: initial?.typeName ?? null,
        reserved,
        custom: custom(),
      }),
  });
}

/** Add or replace a custom node type, re-register it, and refresh the UI. */
function upsertCustomNode(spec: CustomNodeSpec): void {
  // The designer refuses these names; this keeps the rule for any other
  // caller, since a built-in type can not be got back once it is shadowed.
  if (getNodeType(spec.typeName)) return;
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

function nodePreviewSVG(type: string, extra?: Record<string, unknown>): string {
  const cacheKey = extra ? `${type}:${JSON.stringify(extra)}` : type;
  const cached = previewCache.get(cacheKey);
  if (cached !== undefined) return cached;
  let inner: string;
  try {
    inner = renderPageSVG({
      viewBox: '0 0 110 84',
      nodes: [{ id: 'p', type, x: 55, y: 42, ...extra }],
      links: [],
    });
  } catch {
    return ''; // unknown/unrenderable type — fall back to the label only
  }
  inner = inner.replace(/<defs[\s\S]*?<\/defs>/, '');
  const svg = `<svg class="ppreview" viewBox="0 0 110 84" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${inner}</svg>`;
  previewCache.set(cacheKey, svg);
  return svg;
}

/** A thumbnail of a stencil's whole sub-assembly (nodes + internal links). */
function stencilPreviewSVG(st: Stencil): string {
  const vb = stencilViewBox(st.nodes);
  let inner: string;
  try {
    inner = renderPageSVG({ viewBox: vb, nodes: st.nodes, links: st.links });
  } catch {
    return '';
  }
  inner = inner.replace(/<defs[\s\S]*?<\/defs>/, '');
  return `<svg class="ppreview" viewBox="${esc(vb)}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${inner}</svg>`;
}

/**
 * Save the current node selection as a reusable, named stencil (C.3). Prompts
 * for a name; no-op (with a hint) when nothing is selected. The stencil lands in
 * the palette's Stencils section, ready to re-stamp.
 */
function saveSelectionAsStencil(): void {
  const sel = editor.selectionElements();
  if (!sel || sel.nodes.length === 0) {
    savedEl.textContent = 'select node(s) first';
    return;
  }
  const suggested = `Group ${(doc.stencils?.length ?? 0) + 1}`;
  const name = window.prompt('Name this stencil', suggested)?.trim();
  if (!name) return; // cancelled or blank
  const stencil: Stencil = {
    id: genId('st'),
    ...captureStencil(name, sel.nodes, sel.links),
  };
  (doc.stencils ??= []).push(stencil);
  buildPalette();
  markDirty();
}

/** Re-stamp a saved stencil onto the current page (centred, fresh ids). */
function stampStencil(id: string): void {
  const st = doc.stencils?.find((s) => s.id === id);
  if (st) editor.stampStencil(st.nodes, st.links);
}

/** Forget a saved stencil. */
function deleteStencil(id: string): void {
  if (!doc.stencils) return;
  doc.stencils = doc.stencils.filter((s) => s.id !== id);
  buildPalette();
  markDirty();
}

function buildPalette(): void {
  const searching = paletteQuery.trim().length > 0;
  const byCat = new Map<string, NodeTypeInfo[]>();
  for (const info of filterNodeCatalog(paletteQuery, doc.customNodes)) {
    const list = byCat.get(info.category) ?? [];
    list.push(info);
    byCat.set(info.category, list);
  }
  // Palette previews reference the engine filter/gradient defs by id; those defs
  // are mounted once in the app-root #tds-defs-sprite (see app.innerHTML), so the
  // palette no longer carries its own copy — a collapse can't strip them anymore.
  let html = ``;
  for (const [cat, infos] of byCat) {
    html += `<div class="palette-h">${esc(cat)}</div>`;
    for (const info of infos) {
      const item = `<button class="pitem" data-type="${esc(info.type)}">${nodePreviewSVG(info.type)}<span class="plabel">${esc(info.label)}</span></button>`;
      html += info.custom
        ? `<div class="pcustom">${item}<button class="pedit" data-edit="${esc(info.type)}" title="Edit type" aria-label="Edit type ${esc(info.label)}">✎</button></div>`
        : item;
      // §5: surface the EC+Axis container form as its own palette entry — it
      // reads distinctly from a plain EC and from a standalone connector node.
      if (info.type === 'ec')
        html += `<button class="pitem" data-type="ec" data-variant="axis" title="EC hosting the Axis SSE/ZTNA connector as a container">${nodePreviewSVG('ec', { variant: 'axis' })}<span class="plabel">EC + Axis Connector (container)</span></button>`;
    }
  }

  // Stencils (C.3): reusable named groups. Each is a click-to-stamp entry with
  // a thumbnail of the whole sub-assembly. Filtered by the search query too.
  const stencils = (doc.stencils ?? []).filter(
    (st) =>
      !searching ||
      st.name.toLowerCase().includes(paletteQuery.trim().toLowerCase()),
  );
  if (stencils.length) {
    html += `<div class="palette-h">Stencils</div>`;
    for (const st of stencils) {
      html += `<div class="pcustom"><button class="pitem" data-stencil="${esc(st.id)}" title="Stamp '${esc(st.name)}'">${stencilPreviewSVG(st)}<span class="plabel">${esc(st.name)}</span></button><button class="pedit" data-stencil-del="${esc(st.id)}" title="Delete stencil" aria-label="Delete stencil ${esc(st.name)}">✕</button></div>`;
    }
  }

  if (searching && byCat.size === 0 && stencils.length === 0) {
    html += `<div class="palette-empty">No nodes match “${esc(paletteQuery.trim())}”</div>`;
  }

  // The library actions (design a type, save a stencil) only show when not
  // mid-search — a filtered list is for picking, not authoring.
  if (!searching) {
    html += `<button class="pitem design" id="pDesign">＋ design node</button>`;
    html += `<button class="pitem design" id="pSaveStencil" title="Save the selected node(s) as a reusable group">＋ save stencil</button>`;
  }
  paletteList.innerHTML = html;

  paletteList.querySelectorAll<HTMLButtonElement>('[data-type]').forEach((b) =>
    b.addEventListener('click', () => {
      // The Image entry opens a file picker instead of dropping a bare
      // placeholder — the common intent is "put THIS picture on the canvas".
      if (b.dataset.type === 'image') {
        imageFileInput.click();
        return;
      }
      const variant = b.dataset.variant;
      editor.addNode(
        b.dataset.type!,
        undefined,
        variant ? { variant } : undefined,
      );
    }),
  );
  paletteList.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => {
      const spec = doc.customNodes.find((c) => c.typeName === b.dataset.edit);
      if (spec) designNode(spec);
    }),
  );
  paletteList
    .querySelector('#pDesign')
    ?.addEventListener('click', () => designNode(null));
  paletteList
    .querySelectorAll<HTMLButtonElement>('[data-stencil]')
    .forEach((b) =>
      b.addEventListener('click', () => stampStencil(b.dataset.stencil!)),
    );
  paletteList
    .querySelectorAll<HTMLButtonElement>('[data-stencil-del]')
    .forEach((b) =>
      b.addEventListener('click', () => deleteStencil(b.dataset.stencilDel!)),
    );
  paletteList
    .querySelector('#pSaveStencil')
    ?.addEventListener('click', () => saveSelectionAsStencil());
}
// Live search: re-render the list on each keystroke; Esc clears.
paletteSearch.addEventListener('input', () => {
  paletteQuery = paletteSearch.value;
  buildPalette();
});
paletteSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && paletteSearch.value && !isImeKey(e)) {
    e.stopPropagation();
    paletteSearch.value = '';
    paletteQuery = '';
    buildPalette();
  }
});
buildPalette();

/* ── image upload (the palette's Image entry) ─────────────────────────
 * Reads a picture, downscales it on a canvas until the data URI fits the
 * 256KB validation cap (protecting the ~1.8MiB workspace page cap), and
 * places an `image` node sized to the picture's aspect ratio. The data URI
 * lives in the document JSON, so it travels with save/share/workspace. */
const imageFileInput = document.createElement('input');
imageFileInput.type = 'file';
imageFileInput.accept = 'image/*';
imageFileInput.hidden = true;
imageFileInput.setAttribute('aria-hidden', 'true');
document.body.appendChild(imageFileInput);
imageFileInput.addEventListener('change', () => {
  const f = imageFileInput.files?.[0];
  imageFileInput.value = '';
  if (f) void placeImageFile(f);
});
const IMAGE_DATA_CAP = 256 * 1024;
async function placeImageFile(f: File): Promise<void> {
  try {
    const { uri, w, h } = await downscaleImage(f, 512, IMAGE_DATA_CAP);
    // Display size: cap the on-canvas box while keeping the aspect ratio.
    const scale = Math.min(1, 240 / w, 200 / h);
    editor.addNode('image', f.name.replace(/\.[^.]+$/, '') || 'Image', {
      imageHref: uri,
      imageW: Math.max(16, Math.round(w * scale)),
      imageH: Math.max(16, Math.round(h * scale)),
    });
  } catch (err) {
    window.alert(`Could not load that image: ${String(err)}`);
  }
}
async function downscaleImage(
  f: File,
  maxDim: number,
  maxBytes: number,
): Promise<{ uri: string; w: number; h: number }> {
  const url = URL.createObjectURL(f);
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('not a readable image file'));
      img.src = url;
    });
    const alphaCapable = ['image/png', 'image/svg+xml', 'image/webp'].includes(
      f.type,
    );
    let scale = Math.min(1, maxDim / Math.max(img.width, img.height, 1));
    for (let attempt = 0; attempt < 6; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas
        .getContext('2d')!
        .drawImage(img, 0, 0, canvas.width, canvas.height);
      // First try keeps transparency (PNG); later passes trade it for size.
      const uri =
        alphaCapable && attempt === 0
          ? canvas.toDataURL('image/png')
          : canvas.toDataURL('image/jpeg', Math.max(0.4, 0.85 - attempt * 0.1));
      if (uri.length <= maxBytes)
        return { uri, w: canvas.width, h: canvas.height };
      scale *= 0.7;
    }
    throw new Error('image is too large even after downscaling');
  } finally {
    URL.revokeObjectURL(url);
  }
}

let dragFrom = -1;

/* A just-deleted frame, held so the strip can offer "↩ undo delete" until the
 * chip times out or another frame is deleted. Its stashed editor history is
 * kept alive with it, so restoring the frame restores its undo stack too. */
let pendingFrameDelete: { page: Page; index: number; timer: number } | null =
  null;

/* Flipbook playback: step through pages on their durations (loop). The same
 * timing model drives the MCP export_flipbook artifact (pages/playback). */
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

/** Keep the frames pill's "current/total" readout live (playback included). */
function updateFramesIndicator(): void {
  framesInd.textContent = `${current + 1}/${doc.pages.length}`;
}

/**
 * Bring the active chip into the strip's horizontal scroll window. Manual
 * scrollLeft math (not scrollIntoView) so no ancestor — in particular the
 * overflow-hidden canvas area — can ever be scrolled by a frame change.
 */
function scrollActiveFrameIntoView(): void {
  const el = strip.querySelector<HTMLElement>('.frame.on');
  if (!el) return;
  const pad = 12; // keep a sliver of the neighbour chip visible
  const left = el.offsetLeft;
  const right = left + el.offsetWidth;
  if (left - pad < strip.scrollLeft) {
    strip.scrollLeft = Math.max(0, left - pad);
  } else if (right + pad > strip.scrollLeft + strip.clientWidth) {
    strip.scrollLeft = right + pad - strip.clientWidth;
  }
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
        ${canDelete ? `<button class="frame-x" data-del="${i}" title="Delete frame" aria-label="Delete frame ${esc(p.name)}">✕</button>` : ''}
      </div>`,
      )
      .join('')}
    <button class="frame add" id="dupPage" title="Duplicate current frame">⧉ duplicate</button>
    <button class="frame add" id="addPage" title="Add blank frame">＋ frame</button>
    ${
      pendingFrameDelete
        ? `<button class="frame add" id="undoDel" title="Restore the deleted frame &quot;${esc(pendingFrameDelete.page.name)}&quot;">↩ undo delete</button>`
        : ''
    }
  `;

  strip.querySelectorAll<HTMLElement>('[data-page]').forEach((el) => {
    const i = Number(el.dataset.page);
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-del]') || t.tagName === 'INPUT') return;
      choosePage(i);
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
  strip.querySelector('#undoDel')?.addEventListener('click', undoFrameDelete);

  updateFramesIndicator();
  scrollActiveFrameIntoView();
}

/** Switch to a page AND rebuild the strip (after a structural change). */
function gotoPage(i: number): void {
  stopPlayback();
  current = i;
  showPage(doc.pages[current]!);
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
  // Once only: redrawing the strip removes this input, and a removed input
  // that had focus fires blur — which would save the text Escape just
  // cancelled.
  let done = false;
  const commit = (save: boolean): void => {
    if (done) return;
    done = true;
    if (save) page.name = input.value.trim() || page.name;
    renderFilmstrip();
    if (save) markDirty();
  };
  input.addEventListener('blur', () => commit(true));
  input.addEventListener('keydown', (e) => {
    if (isImeKey(e)) return; // the key belongs to an IME composition
    if (e.key === 'Enter') input.blur();
    else if (e.key === 'Escape') commit(false);
  });
}

/** The pending delete becomes final: forget the page and its history stash. */
function finalizeFrameDelete(): void {
  if (!pendingFrameDelete) return;
  clearTimeout(pendingFrameDelete.timer);
  editor.dropPageHistory(pendingFrameDelete.page.id);
  pendingFrameDelete = null;
}

/** Restore the just-deleted frame at its old position (the strip's undo chip). */
function undoFrameDelete(): void {
  if (!pendingFrameDelete) return;
  const { page, index, timer } = pendingFrameDelete;
  clearTimeout(timer);
  pendingFrameDelete = null;
  doc.pages.splice(Math.min(index, doc.pages.length), 0, page);
  gotoPage(doc.pages.indexOf(page));
  markDirty();
}

function deletePage(i: number): void {
  if (doc.pages.length <= 1) return;
  stopPlayback();
  const page = doc.pages[i]!;
  // Every content-bearing field counts (nodes, links, zones, anchors, flow
  // paths, markers, caption, emphasis) — an annotation-only frame must not
  // delete silently (pageHasContent, pages/model).
  if (
    pageHasContent(page) &&
    !confirm(`Delete "${page.name}"? This frame has content.`)
  )
    return;
  finalizeFrameDelete(); // only the most recent delete stays recoverable
  doc.pages.splice(i, 1);
  pendingFrameDelete = {
    page,
    index: i,
    timer: window.setTimeout(() => {
      finalizeFrameDelete();
      renderFilmstrip();
    }, 8000),
  };
  if (current >= doc.pages.length) current = doc.pages.length - 1;
  else if (i < current) current -= 1;
  showPage(doc.pages[current]!);
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

/**
 * Show the frame the user picked — a click on its chip, an arrow key, a page
 * link. A choice made by hand takes over from the flipbook player, which
 * would otherwise flip away from it a moment later.
 */
function choosePage(i: number): void {
  stopPlayback();
  selectPage(i);
}

/** Show a frame without rebuilding the strip (the player's own step too). */
function selectPage(i: number): void {
  if (i < 0 || i >= doc.pages.length) return;
  current = i;
  showPage(doc.pages[current]!);
  // Report the new page to the workspace presence socket (Packet S1).
  workspacePanelHandle.notifyPageChanged();
  // Update highlight without rebuilding the strip (so dblclick-rename survives).
  strip
    .querySelectorAll<HTMLElement>('[data-page]')
    .forEach((el) => el.classList.toggle('on', Number(el.dataset.page) === i));
  updateFramesIndicator();
  scrollActiveFrameIntoView();
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
  calmBtn.title = on
    ? 'Resume animations — glow & flow particles (C)'
    : 'Calm canvas — pause animations (C)';
  try {
    localStorage.setItem(CALM_KEY, on ? '1' : '0');
  } catch {
    // storage unavailable — non-fatal
  }
}
// Default Calm from the OS `prefers-reduced-motion` setting when the user hasn't
// chosen one — reduced-motion users get a quiet canvas by default, but the
// toggle can now still turn animation on (the engine honours it both ways).
const storedCalm = localStorage.getItem(CALM_KEY);
applyCalm(
  storedCalm === null
    ? window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    : storedCalm === '1',
);
calmBtn.addEventListener('click', () => applyCalm(!editor.calm));

/* On-canvas problem badges (Packet B1) — a view preference, persisted across
 * sessions like Calm/Grid/Snap (`badgesVisible` + `BADGES_KEY` above, next to
 * the problems panel they mirror). Toggling re-renders the panel + badges
 * together since `renderProblems()` computes both from one problem list. */
const badgesBtn = app.querySelector<HTMLButtonElement>('#tBadges')!;
function applyBadgesVisible(on: boolean): void {
  badgesVisible = on;
  badgesBtn.classList.toggle('on', on);
  badgesBtn.title = on
    ? 'Hide on-canvas problem badges'
    : 'Show on-canvas problem badges';
  badgesBtn.setAttribute('aria-label', badgesBtn.title);
  try {
    localStorage.setItem(BADGES_KEY, on ? '1' : '0');
  } catch {
    // storage unavailable — non-fatal
  }
  renderProblems();
}
badgesBtn.classList.toggle('on', badgesVisible);
badgesBtn.addEventListener('click', () => applyBadgesVisible(!badgesVisible));

/* Light / dark theme — a view preference, persisted across sessions. */
const themeBtn = app.querySelector<HTMLButtonElement>('#tTheme')!;
const THEME_KEY = 'topology-dojo:theme';
const tdsRoot = app.querySelector<HTMLElement>('.tds-root');
/** The render theme matching the editor's current light/dark toggle (#264). */
function currentTheme(): RenderTheme {
  return document.documentElement.classList.contains('light')
    ? 'light'
    : 'dark';
}
function applyTheme(light: boolean): void {
  document.documentElement.classList.toggle('light', light);
  themeBtn.classList.toggle('on', light);
  themeBtn.textContent = light ? '🌙' : '☀';
  themeBtn.title = light ? 'Switch to dark theme' : 'Switch to light theme';
  // The vendored engine ships a dark canvas. Flip the engine's own light palette
  // on the canvas container (its CSS `--tds-*` background vars) and tell the
  // editor to render a light grid/vignette in the SVG, so the canvas honours
  // the light theme instead of staying dark (#8).
  tdsRoot?.classList.toggle('tds-light', light);
  editor.setLight(light);
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

/* Display settings — embellishment controls (ambient backdrop level + panel
 * glass blur), separate from the document and persisted as view preferences.
 * Decouples the decorative ambient from the meaningful flow particles. */
const displayBtn = app.querySelector<HTMLButtonElement>('#tDisplay')!;
const AMBIENT_KEY = 'tds-ambient';
const GLASS_KEY = 'tds-glass';
const displayPop = document.createElement('div');
displayPop.className = 'display-pop';
displayPop.setAttribute('role', 'dialog');
displayPop.setAttribute('aria-label', 'Display settings');
displayPop.hidden = true;
displayPop.innerHTML =
  `<div class="dp-h">Display</div>` +
  `<label class="dp-row">Ambient backdrop<select id="dpAmbient">` +
  `<option value="animated">Animated</option><option value="static">Static</option><option value="off">Off</option>` +
  `</select></label>` +
  `<label class="dp-row dp-check"><input type="checkbox" id="dpGlass"/><span>Panel blur (glass)</span></label>` +
  `<div class="dp-note">“Off” removes the drifting bits, scan lines &amp; radar. Flow particles are separate — Calm (C) pauses those.</div>` +
  `<div class="dp-h dp-h2">Brand palette</div>` +
  `<div class="dp-swatches" id="dpPresets"></div>` +
  `<label class="dp-row">Accent<input type="color" id="dpAccent"/></label>` +
  `<label class="dp-row">Secondary<input type="color" id="dpSecondary"/></label>` +
  `<label class="dp-row">Chrome (UI)<input type="color" id="dpChrome"/></label>` +
  `<div class="dp-note">Recolours the canvas accents and the app chrome to match your brand. Saved with the document.</div>`;
document.body.appendChild(displayPop);
const dpAmbient = displayPop.querySelector<HTMLSelectElement>('#dpAmbient')!;
const dpGlass = displayPop.querySelector<HTMLInputElement>('#dpGlass')!;
const dpPresets = displayPop.querySelector<HTMLDivElement>('#dpPresets')!;
const dpAccent = displayPop.querySelector<HTMLInputElement>('#dpAccent')!;
const dpSecondary = displayPop.querySelector<HTMLInputElement>('#dpSecondary')!;
const dpChrome = displayPop.querySelector<HTMLInputElement>('#dpChrome')!;

function applyAmbient(level: 'off' | 'static' | 'animated'): void {
  editor.setAmbient(level);
  dpAmbient.value = level;
  try {
    localStorage.setItem(AMBIENT_KEY, level);
  } catch {
    // storage unavailable — non-fatal
  }
}
function applyGlass(on: boolean): void {
  document.documentElement.classList.toggle('no-glass', !on);
  dpGlass.checked = on;
  try {
    localStorage.setItem(GLASS_KEY, on ? '1' : '0');
  } catch {
    // storage unavailable — non-fatal
  }
}
const storedAmbient = localStorage.getItem(AMBIENT_KEY);
applyAmbient(
  storedAmbient === 'off' ||
    storedAmbient === 'static' ||
    storedAmbient === 'animated'
    ? storedAmbient
    : 'animated',
);
applyGlass(localStorage.getItem(GLASS_KEY) !== '0');
dpAmbient.addEventListener('change', () =>
  applyAmbient(dpAmbient.value as 'off' | 'static' | 'animated'),
);
dpGlass.addEventListener('change', () => applyGlass(dpGlass.checked));

/* ── Brand palette (#7) ──────────────────────────────────────────────
 * A document-level palette that recolours the canvas accents (via a render-time
 * remap of the engine's hardcoded brand colours) and the app chrome (--accent).
 * Stored on the document, so it round-trips through save / share. */
const PALETTE_PRESETS: BrandPalette[] = [
  { id: 'default', name: 'Default', accent: '#01a982', secondary: '#65aef9' },
  { id: 'azure', name: 'Azure', accent: '#0a84ff', secondary: '#5ac8fa' },
  { id: 'violet', name: 'Violet', accent: '#7c6cff', secondary: '#b58cff' },
  { id: 'amber', name: 'Amber', accent: '#e0922f', secondary: '#f5c16c' },
  { id: 'crimson', name: 'Crimson', accent: '#e5484d', secondary: '#ff8088' },
  { id: 'teal', name: 'Teal', accent: '#11b3b3', secondary: '#4fd1c5' },
  { id: 'slate', name: 'Slate', accent: '#6b7a8f', secondary: '#9aa7b8' },
];
const DEFAULT_ACCENT = '#01a982';
const DEFAULT_SECONDARY = '#65aef9';

// One swatch button per preset; clicking applies it.
const presetBtns = PALETTE_PRESETS.map((p) => {
  const b = document.createElement('button');
  b.className = 'dp-swatch';
  b.type = 'button';
  b.dataset.id = p.id!;
  b.title = p.name!;
  b.setAttribute('aria-label', `Brand palette ${p.name!}`);
  b.style.setProperty('--sw1', p.accent);
  b.style.setProperty('--sw2', p.secondary ?? p.accent);
  b.addEventListener('click', () => applyBrandPalette(p, true));
  dpPresets.appendChild(b);
  return b;
});

function setChromeAccent(hex: string | undefined): void {
  if (hex) document.documentElement.style.setProperty('--accent', hex);
  else document.documentElement.style.removeProperty('--accent');
}

function syncPaletteInputs(p: BrandPalette | undefined): void {
  dpAccent.value = p?.accent ?? DEFAULT_ACCENT;
  dpSecondary.value = p?.secondary ?? DEFAULT_SECONDARY;
  dpChrome.value = p?.chrome ?? p?.accent ?? DEFAULT_ACCENT;
  const activeId = p?.id ?? 'default';
  for (const b of presetBtns)
    b.classList.toggle('on', b.dataset.id === activeId);
}

/**
 * Apply a brand palette to the document, canvas, chrome and the popover inputs.
 * The 'default' preset (or undefined) clears the palette so the engine renders
 * its native colours. `persist` autosaves the document (skip on initial load).
 */
function applyBrandPalette(
  p: BrandPalette | undefined,
  persist: boolean,
): void {
  const eff = p && p.id !== 'default' ? p : undefined;
  doc.palette = eff;
  editor.setPalette(eff);
  editor.redrawOverlay(); // the key drawn over the page is recoloured too
  setChromeAccent(eff ? (eff.chrome ?? eff.accent) : undefined);
  syncPaletteInputs(eff);
  renderMinimap();
  if (persist) markDirty();
}

// Editing any colour input builds a custom palette from the three swatches.
function applyCustomPalette(): void {
  const accent = dpAccent.value;
  const chrome = dpChrome.value;
  applyBrandPalette(
    {
      id: 'custom',
      name: 'Custom',
      accent,
      secondary: dpSecondary.value,
      ...(chrome.toLowerCase() !== accent.toLowerCase() ? { chrome } : {}),
    },
    true,
  );
}
for (const inp of [dpAccent, dpSecondary, dpChrome])
  inp.addEventListener('input', applyCustomPalette);

// Reflect whatever the booted document already carries.
applyBrandPalette(doc.palette, false);

/**
 * Close a popover when a pointer is pressed anywhere outside it. Its own
 * button is left alone: that button's click toggles the popover.
 *
 * A press, not a click: a press on the canvas often never becomes a click
 * (the editor redraws what was pressed), and a popover left open keeps every
 * canvas shortcut switched off — with nothing on screen to say why.
 */
function closeOnOutsidePress(
  popover: HTMLElement,
  button: HTMLElement,
  close: () => void,
): void {
  window.addEventListener(
    'pointerdown',
    (e) => {
      const target = e.target as Node | null;
      if (
        !popover.hidden &&
        target &&
        !popover.contains(target) &&
        !button.contains(target)
      )
        close();
    },
    true,
  );
}

let releaseDisplayOverlay: (() => void) | null = null;
function closeDisplayPop(): void {
  displayPop.hidden = true;
  displayBtn.classList.remove('on');
  displayBtn.setAttribute('aria-expanded', 'false');
  releaseDisplayOverlay?.();
  releaseDisplayOverlay = null;
}
displayBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (displayPop.hidden) {
    const r = displayBtn.getBoundingClientRect();
    displayPop.style.top = `${Math.round(r.bottom + 6)}px`;
    displayPop.style.right = `${Math.round(Math.max(8, window.innerWidth - r.right))}px`;
    displayPop.style.left = 'auto';
    displayPop.hidden = false;
    displayBtn.classList.add('on');
    displayBtn.setAttribute('aria-expanded', 'true');
    releaseDisplayOverlay = registerOverlay(displayPop, {
      close: closeDisplayPop,
    });
  } else closeDisplayPop();
});
closeOnOutsidePress(displayPop, displayBtn, closeDisplayPop);

app
  .querySelector('#tDelete')
  ?.addEventListener('click', () => editor.deleteSelected());
app.querySelector('#tTidy')?.addEventListener('click', () => editor.tidy());
app
  .querySelector('#tBalance')
  ?.addEventListener('click', () => editor.balance());
const layoutSel = app.querySelector<HTMLSelectElement>('#tLayout')!;
layoutSel.addEventListener('change', () => {
  const algorithm = layoutSel.value;
  layoutSel.value = ''; // reset to the placeholder
  if (algorithm)
    editor.layout({
      algorithm: algorithm as 'grid' | 'hierarchical' | 'circular' | 'force',
    });
});
app.querySelector('#tFit')?.addEventListener('click', fitView);

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
      ['Ctrl/Cmd+Alt+C', 'Copy format (format painter)'],
      ['Ctrl/Cmd+Alt+V', 'Paste format onto selection'],
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
      ['B', 'Toggle node library'],
      ['F', 'Toggle frames strip'],
      ['C', 'Calm canvas (pause animation)'],
      ['T', 'Tidy layout'],
      ['Shift+T', 'Balance layout'],
      ['? ', 'This shortcut reference'],
    ],
  },
  {
    group: 'Dialogs & menus',
    items: [
      ['Esc', 'Close the open dialog / menu'],
      ['Tab / Shift+Tab', 'Cycle focus inside the dialog'],
      ['↑↓ · Enter', 'Navigate / run context-menu items'],
    ],
  },
];
let helpEl: HTMLElement | null = null;
let releaseHelpOverlay: (() => void) | null = null;
function closeHelp(): void {
  helpEl?.remove();
  helpEl = null;
  releaseHelpOverlay?.();
  releaseHelpOverlay = null;
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
    `<div class="help-card scroll-slim" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">` +
    `<div class="help-head"><h3>Keyboard shortcuts</h3>` +
    `<button class="tbtn ticon" id="helpClose" title="Close (Esc)" aria-label="Close">✕</button></div>` +
    `<div class="help-cols">${cols}</div></div>`;
  app.appendChild(helpEl);
  helpEl.addEventListener('click', (e) => {
    if (e.target === helpEl) closeHelp(); // click backdrop to dismiss
  });
  helpEl
    .querySelector('#helpClose')
    ?.addEventListener('click', () => closeHelp());
  // Focus trap + Escape + focus restore (issue #209).
  releaseHelpOverlay = registerOverlay(helpEl, { close: closeHelp });
}
app.querySelector('#tHelp')?.addEventListener('click', () => openHelp());

/* ── Present mode: full-screen playback of every frame ─────────────────
 * A human-only view feature (DESIGN #2 carve-out — nothing persisted): the
 * flipbook experience without leaving the editor. Reuses the SAME timing
 * model as the filmstrip player and the exported flipbook (pages/playback),
 * and the same per-frame SVG the exports produce. ←/→ step, Space toggles
 * autoplay, Esc leaves. */
let presentEl: HTMLElement | null = null;
let releasePresentOverlay: (() => void) | null = null;
let presentTimer: number | null = null;
function closePresent(): void {
  if (presentTimer !== null) clearTimeout(presentTimer);
  presentTimer = null;
  if (document.fullscreenElement) void document.exitFullscreen();
  presentEl?.remove();
  presentEl = null;
  releasePresentOverlay?.();
  releasePresentOverlay = null;
}
function openPresent(): void {
  if (presentEl) {
    closePresent();
    return;
  }
  stopPlayback();
  let frame = current;
  let playing = doc.pages.length > 1;
  const root = document.createElement('div');
  root.className = 'present-root';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Presentation');
  root.innerHTML =
    `<div class="present-stage" id="presentStage"></div>` +
    `<div class="present-bar">` +
    `<button class="tbtn" id="presentPrev" title="Previous frame (←)" aria-label="Previous frame">‹</button>` +
    `<button class="tbtn" id="presentPlay" title="Play / pause (Space)" aria-label="Play or pause">${playing ? '⏸' : '▶'}</button>` +
    `<button class="tbtn" id="presentNext" title="Next frame (→)" aria-label="Next frame">›</button>` +
    `<span class="present-count" id="presentCount"></span>` +
    `<span class="present-name" id="presentName"></span>` +
    `<button class="tbtn present-exit" id="presentExit" title="Exit (Esc)" aria-label="Exit presentation">✕ exit</button>` +
    `</div>`;
  document.body.appendChild(root);
  presentEl = root;
  const stage = root.querySelector<HTMLElement>('#presentStage')!;
  const count = root.querySelector<HTMLElement>('#presentCount')!;
  const name = root.querySelector<HTMLElement>('#presentName')!;
  const playBtn = root.querySelector<HTMLButtonElement>('#presentPlay')!;
  const show = (i: number, fade = false): void => {
    frame = ((i % doc.pages.length) + doc.pages.length) % doc.pages.length;
    const page = doc.pages[frame]!;
    stage.innerHTML = pageToSVG(
      page,
      { ...pageOpts(page), calm: editor.calm },
      pageOverlay(page),
    );
    if (fade && page.transition === 'fade') {
      stage.classList.remove('present-fade');
      void stage.offsetWidth; // restart the animation
      stage.classList.add('present-fade');
    }
    count.textContent = `${frame + 1} / ${doc.pages.length}`;
    name.textContent = page.name;
  };
  const schedule = (): void => {
    if (presentTimer !== null) clearTimeout(presentTimer);
    presentTimer = null;
    if (!playing || doc.pages.length < 2) return;
    presentTimer = window.setTimeout(() => {
      show(frame + 1, true);
      schedule();
    }, pageDuration(doc.pages[frame]!));
  };
  const setPlaying = (on: boolean): void => {
    playing = on && doc.pages.length > 1;
    playBtn.textContent = playing ? '⏸' : '▶';
    schedule();
  };
  const step = (d: number): void => {
    setPlaying(false);
    show(frame + d, true);
  };
  root.querySelector('#presentPrev')?.addEventListener('click', () => step(-1));
  root.querySelector('#presentNext')?.addEventListener('click', () => step(1));
  playBtn.addEventListener('click', () => setPlaying(!playing));
  root.querySelector('#presentExit')?.addEventListener('click', closePresent);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      e.preventDefault();
      step(1);
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      step(-1);
    } else if (e.key === ' ') {
      e.preventDefault();
      setPlaying(!playing);
    }
  });
  // Leaving browser-fullscreen (Esc) tears the presentation down too.
  root.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && presentEl) closePresent();
  });
  releasePresentOverlay = registerOverlay(root, { close: closePresent });
  show(frame);
  setPlaying(playing);
  void root.requestFullscreen?.().catch(() => {
    /* fixed-position fallback still covers the viewport */
  });
}
app.querySelector('#tPresent')?.addEventListener('click', () => openPresent());

/* ── Share dialog (hosted only): publish a public /v/:id snapshot of the
 * current document and manage (revoke) previously published links. The
 * button is revealed by showUserChip() alongside the other hosted chips;
 * the Worker enforces the session on every /api/share call. Closes finding
 * M20 for the browser surface. */
interface ShareRow {
  id: string;
  title: string;
  createdAt: number;
  expiresAt: number;
}
let shareEl: HTMLElement | null = null;
let releaseShareOverlay: (() => void) | null = null;
function closeShare(): void {
  shareEl?.remove();
  shareEl = null;
  releaseShareOverlay?.();
  releaseShareOverlay = null;
}
async function fetchShares(): Promise<ShareRow[]> {
  const res = await fetch('/api/share', {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`list failed (${res.status})`);
  return ((await res.json()) as { shares?: ShareRow[] }).shares ?? [];
}
function shareRowHtml(s: ShareRow): string {
  const url = `${location.origin}/v/${s.id}`;
  const days = Math.max(
    0,
    Math.ceil((s.expiresAt - Date.now()) / (24 * 3600 * 1000)),
  );
  return (
    `<div class="share-row" data-id="${esc(s.id)}">` +
    `<div class="share-meta"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(s.title)}</a>` +
    `<span class="share-sub">${esc(new Date(s.createdAt).toLocaleDateString())} · expires in ${days}d</span></div>` +
    `<button class="tbtn share-copy" data-url="${esc(url)}" title="Copy link">copy</button>` +
    `<button class="tbtn share-revoke" data-id="${esc(s.id)}" title="Revoke — the public link stops resolving">revoke</button>` +
    `</div>`
  );
}
function openShare(): void {
  if (shareEl) {
    closeShare();
    return;
  }
  shareEl = document.createElement('div');
  shareEl.className = 'help-backdrop';
  shareEl.innerHTML =
    `<div class="help-card share-card scroll-slim" role="dialog" aria-modal="true" aria-label="Share">` +
    `<div class="help-head"><h3>Share</h3>` +
    `<button class="tbtn ticon" id="shareClose" title="Close (Esc)" aria-label="Close">✕</button></div>` +
    `<p class="share-note">Publishing creates a <b>public</b> read-only snapshot at a /v/&lt;id&gt; link — no sign-in needed to view it. Links expire after 30 days; revoking one takes it down early (edge caches may serve it for up to about a minute). Don’t publish internal addresses or policy details unless they’re approved for public access.</p>` +
    `<div class="share-actions"><button class="tbtn" id="sharePublish">⤴ publish current document</button><span class="share-status" id="shareStatus" role="status"></span></div>` +
    `<div class="share-fresh" id="shareFresh" hidden></div>` +
    `<h4 class="share-h">Published links</h4>` +
    `<div class="share-list" id="shareList">loading…</div>` +
    `</div>`;
  app.appendChild(shareEl);
  const status = shareEl.querySelector<HTMLElement>('#shareStatus')!;
  const list = shareEl.querySelector<HTMLElement>('#shareList')!;
  const fresh = shareEl.querySelector<HTMLElement>('#shareFresh')!;
  const refresh = async (): Promise<void> => {
    try {
      const shares = await fetchShares();
      list.innerHTML = shares.length
        ? shares.map(shareRowHtml).join('')
        : `<div class="share-sub">No live links.</div>`;
    } catch (err) {
      list.innerHTML = `<div class="share-sub">Could not load published links (${esc(String(err))}).</div>`;
    }
  };
  shareEl.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === shareEl) {
      closeShare();
      return;
    }
    const copy = t.closest<HTMLButtonElement>('.share-copy');
    if (copy) {
      void navigator.clipboard?.writeText(copy.dataset.url!).then(
        () => (copy.textContent = 'copied ✓'),
        () => (copy.textContent = 'copy failed'),
      );
      return;
    }
    const revoke = t.closest<HTMLButtonElement>('.share-revoke');
    if (revoke) {
      revoke.disabled = true;
      revoke.textContent = '…';
      // The canonical revoke route (owner checked via snapshot metadata).
      void fetch(`/api/topology/${encodeURIComponent(revoke.dataset.id!)}`, {
        method: 'DELETE',
      }).then(
        (res) => {
          if (res.ok) void refresh();
          else {
            revoke.disabled = false;
            revoke.textContent = 'revoke';
            status.textContent =
              res.status === 403
                ? 'only the publisher can revoke this link'
                : `revoke failed (${res.status})`;
          }
        },
        () => {
          revoke.disabled = false;
          revoke.textContent = 'revoke';
          status.textContent = 'revoke failed (offline?)';
        },
      );
    }
  });
  shareEl
    .querySelector<HTMLButtonElement>('#sharePublish')!
    .addEventListener('click', () => {
      status.textContent = 'publishing…';
      fresh.hidden = true;
      void fetch('/api/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ document: JSON.parse(serializeDoc(doc)) }),
      }).then(
        async (res) => {
          if (!res.ok) {
            status.textContent = `publish failed (${res.status})`;
            return;
          }
          const out = (await res.json()) as { id: string; url: string };
          const url = out.url.startsWith('http')
            ? out.url
            : `${location.origin}${out.url}`;
          status.textContent = '';
          fresh.hidden = false;
          fresh.innerHTML =
            `<span class="share-sub">Published:</span> <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a> ` +
            `<button class="tbtn share-copy" data-url="${esc(url)}">copy</button>`;
          void refresh();
        },
        () => {
          status.textContent = 'publish failed (offline?)';
        },
      );
    });
  shareEl
    .querySelector('#shareClose')
    ?.addEventListener('click', () => closeShare());
  releaseShareOverlay = registerOverlay(shareEl, { close: closeShare });
  void refresh();
}
app.querySelector('#fShare')?.addEventListener('click', () => openShare());

/* Account menu. The Worker gates the app behind GitHub sign-in and reports the
 * current user at /api/me; when that succeeds we reveal a toolbar chip that opens
 * a small "Signed in as … / Sign out" menu. In Vite dev there's no Worker (auth is
 * bypassed) so the fetch 404s and the chip stays hidden — no login UI in dev. All
 * failures here are non-fatal. The doc autosaves to localStorage, so signing out
 * (a full navigation to /logout) never loses work. */
function wireAccountMenu(login: string): void {
  const chip = app.querySelector<HTMLButtonElement>('#userChip');
  const name = app.querySelector<HTMLElement>('#userName');
  const div = app.querySelector<HTMLElement>('#userDiv');
  if (!chip || !name || !div) return;
  name.textContent = login;
  chip.title = `Signed in as @${login}`;
  chip.hidden = false;
  div.hidden = false;

  // The menu is fixed-positioned on document.body so the toolbar's horizontal
  // overflow can't clip it.
  const menu = document.createElement('div');
  menu.className = 'user-menu';
  menu.id = 'userMenu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  menu.innerHTML =
    `<div class="um-head">Signed in as <b></b></div>` +
    `<a class="um-item" href="/keys" role="menuitem">API keys</a>` +
    `<a class="um-item" href="/logout" role="menuitem">Sign out</a>`;
  menu.querySelector('b')!.textContent = login;
  document.body.appendChild(menu);

  let releaseMenuOverlay: (() => void) | null = null;
  const close = (): void => {
    menu.hidden = true;
    chip.setAttribute('aria-expanded', 'false');
    releaseMenuOverlay?.();
    releaseMenuOverlay = null;
  };
  const open = (): void => {
    const r = chip.getBoundingClientRect();
    menu.style.top = `${Math.round(r.bottom + 6)}px`;
    menu.style.right = `${Math.round(Math.max(8, window.innerWidth - r.right))}px`;
    menu.style.left = 'auto';
    menu.hidden = false;
    chip.setAttribute('aria-expanded', 'true');
    // Escape close + focus move/restore (issue #209).
    releaseMenuOverlay = registerOverlay(menu, { close });
  };
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.hidden) open();
    else close();
  });
  // Dismiss on an outside press (Esc is handled by the overlay primitive).
  closeOnOutsidePress(menu, chip, close);
  // Sign out via an explicit navigation — robust even if the anchor default is
  // ever intercepted; the localStorage autosave preserves the open document.
  menu.querySelector('a[href="/logout"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    window.location.assign('/logout');
  });
}
/** Default line in the anonymous sign-in prompt. */
const SIGN_IN_PROMPT = 'Sign in to save your copy to your workspace.';
/**
 * Open the sign-in prompt under the account chip with `message`. A no-op
 * until the hosted Worker has said the visitor is anonymous (so never in Vite
 * dev, and never for a signed-in user).
 */
let promptSignIn: (message?: string) => void = () => {};

/**
 * Anonymous visitor on the hosted app (they arrived through a public share
 * link, which needs no account): put a "sign in" chip where the account chip
 * goes. Nothing is forced — the editor keeps working and autosaving to this
 * browser — but the chip, and the prompt it opens, say what an account adds.
 * Signing in returns here, where the autosaved document is waiting.
 */
function wireSignInChip(): void {
  const chip = app.querySelector<HTMLButtonElement>('#userChip');
  const name = app.querySelector<HTMLElement>('#userName');
  const div = app.querySelector<HTMLElement>('#userDiv');
  if (!chip || !name || !div) return;
  name.textContent = 'sign in';
  chip.title = 'Sign in with GitHub';
  chip.setAttribute('aria-label', 'Sign in');
  chip.setAttribute('aria-haspopup', 'dialog');
  chip.classList.add('signed-out');
  chip.hidden = false;
  div.hidden = false;

  const menu = document.createElement('div');
  menu.className = 'user-menu sign-in-prompt';
  menu.id = 'signInPrompt';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', 'Sign in');
  menu.hidden = true;
  menu.innerHTML =
    `<div class="um-head" id="signInMessage"></div>` +
    `<div class="um-note">Your work stays in this browser until you do. Signing in brings you straight back to it.</div>` +
    `<a class="um-item um-primary" id="signInGo" href="/login?go=%2F">Sign in with GitHub</a>`;
  const message = menu.querySelector<HTMLElement>('#signInMessage')!;
  document.body.appendChild(menu);

  let release: (() => void) | null = null;
  const close = (): void => {
    menu.hidden = true;
    chip.setAttribute('aria-expanded', 'false');
    release?.();
    release = null;
  };
  const open = (text: string): void => {
    message.textContent = text;
    const r = chip.getBoundingClientRect();
    menu.style.top = `${Math.round(r.bottom + 6)}px`;
    menu.style.right = `${Math.round(Math.max(8, window.innerWidth - r.right))}px`;
    menu.style.left = 'auto';
    if (!menu.hidden) return;
    menu.hidden = false;
    chip.setAttribute('aria-expanded', 'true');
    release = registerOverlay(menu, { close });
  };
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.hidden) open(SIGN_IN_PROMPT);
    else close();
  });
  closeOnOutsidePress(menu, chip, close);
  // Flush the autosave before leaving, so the document is there on return.
  menu.querySelector('#signInGo')?.addEventListener('click', () => {
    flushAutosave();
  });
  // Deferred a tick, so the prompt opens after whatever the triggering click
  // was doing (replacing the document, closing a dialog) has finished.
  promptSignIn = (text = SIGN_IN_PROMPT) => {
    setTimeout(() => open(text), 0);
  };
}

async function showUserChip(): Promise<void> {
  try {
    const res = await fetch('/api/me', {
      headers: { accept: 'application/json' },
    });
    // The hosted Worker answers 401 for a visitor with no session. (Vite dev
    // has no Worker: that is a 404 or the app shell, and shows nothing.)
    if (res.status === 401) wireSignInChip();
    if (!res.ok) return;
    const me = (await res.json()) as {
      login?: string;
      name?: string;
      admin?: boolean;
    };
    if (me.login) {
      wireAccountMenu(me.login);
      enableWorkspaceUi();
      profilePanelHandle.enable();
      // Sharing needs the hosted Worker (KV + session); reveal only here.
      const shareBtn = app.querySelector<HTMLButtonElement>('#fShare');
      if (shareBtn) shareBtn.hidden = false;
      // The Admin chip is revealed only for the deployment owner; the real gate
      // is the /api/admin routes, so this is a cosmetic reveal.
      if (me.admin) adminDashboardHandle.enable();
    }
  } catch {
    // No Worker (dev) or offline — leave the chip hidden.
  }
}
void showUserChip();

/* Keyboard. Every key press is routed by one rule (src/ui/key-routing.ts):
 * a text field has the keyboard to itself; a focused select / checkbox /
 * slider keeps the plain keys it uses; a button keeps them while the user is
 * moving around by keyboard, so Space and Enter press it; and everything else
 * — plus Escape and Ctrl/Cmd combinations from any control — is a canvas
 * shortcut. Shortcuts are also off while any overlay (dialog / panel /
 * popover / context menu) owns interaction — a Delete pressed in a modal must
 * never reach the canvas (#209). The overlay primitive handles Escape/Tab
 * itself, capture-phase. */

/** Whether the user is moving focus by keyboard: true once Tab has moved it,
 * false once a pointer is pressed. Starts true, so a control focused before
 * any input (by assistive technology, say) is treated as keyboard focus. */
let keyboardNav = true;
/** What the last key press went to, if no pointer was pressed since — tells
 * a value changed by its control's own keys from a mouse pick. */
let lastKeyTarget: EventTarget | null = null;
/** An Escape keydown reached the page and its keyup has not come yet. */
let escapeDownSeen = false;
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph']);

function focusFactsOf(el: Element): FocusFacts {
  return {
    tag: el.tagName,
    type: el instanceof HTMLInputElement ? el.type : null,
    editable: el instanceof HTMLElement && el.isContentEditable,
    role: el.getAttribute('role'),
    tabindex: el.hasAttribute('tabindex'),
    href: el.hasAttribute('href'),
  };
}
/** Take keyboard focus off a control, handing the keyboard to the canvas. */
function releaseFocus(el: EventTarget | null): void {
  if (el instanceof HTMLElement && document.activeElement === el) el.blur();
}

window.addEventListener(
  'pointerdown',
  () => {
    keyboardNav = false;
    lastKeyTarget = null;
    escapeDownSeen = false;
  },
  true,
);
window.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Tab') keyboardNav = true;
    if (e.key === 'Escape') escapeDownSeen = true;
    if (!MODIFIER_KEYS.has(e.key)) lastKeyTarget = e.target;
  },
  true,
);
// A select or checkbox changed with the pointer gives the keyboard back to the
// canvas, so the next Delete or V is a shortcut again (a select would even
// take "V" as type-ahead and pick an option). Listening on the document runs
// this after the control's own change handlers.
document.addEventListener('change', (e) => {
  const el = e.target;
  if (!(el instanceof Element)) return;
  const release = releasesFocusAfterChange({
    focus: focusFactsOf(el),
    byKeyboard: lastKeyTarget === el,
    overlayOpen: overlayActive(),
  });
  if (release) releaseFocus(el);
});

window.addEventListener('keydown', (e) => {
  if (overlayActive()) return;
  // A key that confirms or discards an IME candidate is never a shortcut.
  if (isImeKey(e)) return;
  const target = e.target instanceof Element ? e.target : null;
  const focus = target ? focusKind(focusFactsOf(target)) : 'canvas';
  if (routeKey(e, focus, keyboardNav) === 'focus') return;
  if (e.key === 'Escape' && escapeReleasesFocus(focus)) releaseFocus(target);

  // ? (Shift+/) opens the shortcut reference (Esc closes it via the overlay).
  if (e.key === '?') {
    e.preventDefault();
    openHelp();
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
    // Format painter (#211) — checked before the plain copy/paste branches.
    // Matched on e.code: Alt+letter yields a composed e.key on some layouts.
    if (e.altKey && (e.code === 'KeyC' || k === 'c')) {
      e.preventDefault();
      editor.copyFormat();
      renderInspector();
      return;
    }
    if (e.altKey && (e.code === 'KeyV' || k === 'v')) {
      e.preventDefault();
      editor.pasteFormat();
      renderInspector();
      return;
    }
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
    setMinimapCollapsed(!minimapDock.classList.contains('collapsed'));
  if (e.key === 'b' || e.key === 'B')
    setPaletteCollapsed(!paletteEl.classList.contains('collapsed'));
  if (e.key === 'p' || e.key === 'P')
    setInspectorCollapsed(!inspectorWrap.classList.contains('collapsed'));
  if (e.key === 'f' || e.key === 'F')
    setFramesCollapsed(!framesDock.classList.contains('collapsed'));
  if (e.key === 'c' || e.key === 'C') applyCalm(!editor.calm);
  if (e.key === 't') editor.tidy();
  if (e.key === 'T') editor.balance(); // Shift+T
  if (e.key === '0') fitView();
  if (e.key === 'l' || e.key === 'L') setTool('link');
  if (e.key === 'v' || e.key === 'V') setTool('select');
  if (e.key === 'a' || e.key === 'A') setTool('anchor');
  if (e.key === 'h' || e.key === 'H') setHand(!editor.isHandActive());
  if (e.key === 'Escape') {
    stopPlayback();
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
    } else if (e.key === 'ArrowRight') choosePage(current + 1);
    else if (e.key === 'ArrowLeft') choosePage(current - 1);
  }
});

/* Right-click context menu — adaptive to whatever is under the cursor. Every
 * item maps to an existing editor command (nothing UI-only here): the menu is a
 * second surface onto the same actions as the toolbar/keyboard/inspector. */
type CtxItem =
  | { sep: true }
  | { label: string; run: () => void; disabled?: boolean };

let ctxMenu: HTMLDivElement | null = null;
let releaseCtxOverlay: (() => void) | null = null;

function closeCtxMenu(): void {
  ctxMenu?.remove();
  ctxMenu = null;
  releaseCtxOverlay?.();
  releaseCtxOverlay = null;
}

function ctxItemsFor(kind: 'node' | 'link' | 'empty'): CtxItem[] {
  if (kind === 'node') {
    const lockLabel = editor.selectionLocked() ? 'Unlock' : 'Lock';
    return [
      { label: 'Duplicate', run: () => editor.duplicateSelection() },
      { label: 'Copy', run: () => editor.copySelection() },
      {
        label: 'Copy as image',
        run: () => {
          const sp = selectionAsPage();
          if (sp) copyImage(() => copyPagePNG(sp, '', selectionOpts()));
        },
      },
      {
        label: 'Copy format',
        run: () => editor.copyFormat(),
        disabled: !editor.canCopyFormat(),
      },
      {
        label: 'Paste format',
        run: () => {
          editor.pasteFormat();
          renderInspector();
        },
        disabled: !editor.canPasteFormat(),
      },
      { sep: true },
      {
        label: 'Emphasize on this frame',
        run: () => editor.emphasizeSelection(),
      },
      { label: 'Group into zone', run: () => addAnnotation('zone') },
      { label: 'Save as stencil…', run: () => saveSelectionAsStencil() },
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
      {
        label: 'Straighten (clear bends)',
        run: () => editor.straightenLink(),
        disabled: !editor.selectedLinkHasBends(),
      },
      {
        label: 'Copy format',
        run: () => editor.copyFormat(),
        disabled: !editor.canCopyFormat(),
      },
      {
        label: 'Paste format',
        run: () => {
          editor.pasteFormat();
          renderInspector();
        },
        disabled: !editor.canPasteFormat(),
      },
      {
        label: 'Emphasize on this frame',
        run: () => editor.emphasizeSelection(),
      },
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
    {
      label: 'Copy frame as image',
      run: () => {
        const page = doc.pages[current]!;
        copyImage(() => copyPagePNG(page, pageOverlay(page), pageOpts(page)));
      },
    },
    { sep: true },
    { label: 'Tidy layout', run: () => editor.tidy() },
    { label: 'Balance layout', run: () => editor.balance() },
    {
      label: 'Auto-place labels',
      run: () => editor.autoLabels(doc.customNodes),
    },
    {
      label: 'Fit page to content',
      run: () => {
        editor.fitPageToContent();
        renderInspector();
      },
    },
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
  menu.setAttribute('aria-label', 'Canvas context menu');
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
    btn.setAttribute('role', 'menuitem');
    btn.textContent = item.label;
    btn.disabled = !!item.disabled;
    btn.addEventListener('click', () => {
      closeCtxMenu();
      item.run();
      renderInspector();
    });
    menu.appendChild(btn);
  }

  // Keyboard operation (#209): ArrowUp/Down cycle the enabled items, Home/End
  // jump, Enter/Space activate the focused button natively; Escape closes and
  // restores focus via the overlay primitive.
  menu.addEventListener('keydown', (e) => {
    const enabled = [
      ...menu.querySelectorAll<HTMLButtonElement>('.ctx-item:not(:disabled)'),
    ];
    if (!enabled.length) return;
    const i = enabled.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = i < 0 ? 0 : (i + 1) % enabled.length;
    else if (e.key === 'ArrowUp')
      next =
        i < 0 ? enabled.length - 1 : (i - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next === null) return;
    e.preventDefault();
    enabled[next]!.focus();
  });

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
  releaseCtxOverlay = registerOverlay(menu, { close: closeCtxMenu });
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
// Escape-to-close is owned by the overlay primitive (src/ui/overlay.ts).

// Release hand mode when Space lifts (or the window loses focus while held).
window.addEventListener('keyup', (e) => {
  if (e.key === ' ') editor.setSpacePan(false);
  if (e.key !== 'Escape') return;
  // A select's open menu takes the Escape keydown that closes it: the page
  // gets only this keyup. A menu opened with the pointer and dismissed that
  // way must not keep the keyboard, or the next letter is type-ahead for it.
  const menuClosed = !escapeDownSeen;
  escapeDownSeen = false;
  if (
    menuClosed &&
    !keyboardNav &&
    !overlayActive() &&
    e.target instanceof HTMLSelectElement
  )
    releaseFocus(e.target);
});
window.addEventListener('blur', () => editor.setSpacePan(false));

function esc(s: string): string {
  return s.replace(/[<>&"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;',
  );
}

renderFilmstrip();
renderInspector();
inspectorReady = true;
renderStatus();
renderMinimap();
