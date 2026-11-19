/**
 * Topology Dojo — flipbook editor shell.
 *
 * The shell (header, stage, status bar) is built once; the Editor owns the
 * canvas (art + interaction overlay) and the filmstrip — a hideable overlay
 * floating at the canvas's bottom-left — is re-rendered on page changes.
 */
// Self-hosted JetBrains Mono (data, canvas) and Inter (labels), bundled by
// Vite: no external font fetch at runtime.
// Latin-only subset: the UI is latin, and the aggregate weight CSS ships six
// @font-face subsets (cyrillic/greek/vietnamese/…) per weight, bloating the
// deployed bundle 6x for glyphs this app never draws.
import { pageFramedForExport } from './render/content-bounds.js';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import { Editor, type InlineEditRequest } from './editor/editor.js';
import { clientToUser } from './editor/coords.js';
import {
  applyPalette,
  engineDefs,
  renderPageSVG,
  type LinkConfig,
  type NodeConfig,
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
import { pageDuration } from './pages/playback.js';
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
import { placeSelectionBar, type EdgeBox } from './ui/selection-bar-place.js';
import { nodeBounds } from './api/geometry.js';
import { documentOverlaySVG } from './render/overlays.js';
import { sheetPaperPt } from './api/sheet.js';
import { captionSVG } from './editor/caption.js';
import { applyRenderTheme, type RenderTheme } from './render/theme.js';
import { buildTemplate, listTemplates } from './api/templates.js';
import { openSdwanWizard } from './ui/sdwan-wizard.js';
import { openTemplateWizard } from './ui/template-wizard.js';
import { pageLinkTarget } from './api/page-link.js';
import { registerCustomNode, registerCustomNodes } from './nodes/render.js';
import {
  markBaselineNodeTypes,
  useDocumentNodeTypes,
} from './nodes/document-types.js';
import { STOCK_NODE_SPECS } from './nodes/stock.js';
import { registerBackdrops } from './render/backdrops.js';
import { openNodeDesigner } from './nodes/designer.js';
import { sanitizeCustomNode } from './nodes/sanitize.js';
import type { CustomNodeSpec } from './nodes/spec.js';
import { mountWorkspacePanel } from './ui/workspace-panel.js';
import { mountProfilePanel } from './ui/profile-panel.js';
import { mountAdminDashboard } from './ui/admin-dashboard.js';
import {
  attachMenuButton,
  attachMenubar,
  closeAllMenus,
  openMenu,
  type MenuEntry,
} from './ui/menu.js';
import {
  MENUBAR,
  accountMenu,
  contextMenu,
  exportMenu,
  moreMenu,
  tidyMenu,
  type MenuContext,
} from './ui/menus.js';
import { overlayActive, registerOverlay } from './ui/overlay.js';
import { paletteEntries } from './ui/palette-sources.js';
import { icon, iconSprite, type IconName } from './ui/icons.js';
import { nodeLabelNudge, linkLabelNudge } from './ui/label-position.js';
import type { LabelPlacement } from './render/label-placement.js';
import {
  COMPACT_LAYOUT_MQ,
  PHONE_LAYOUT_MQ,
  defaultPanelCollapsed,
  isCompactAbovePhone,
  drawersCrowd,
  drawersCrowdAtRest,
  isCompactLayoutWidth,
} from './ui/compact-layout.js';
import {
  editorInsets,
  fitInsets,
  leftInsetShift,
  type PanelBox,
} from './ui/fit-insets.js';
import {
  escapeReleasesFocus,
  focusKind,
  isContextMenuKey,
  releasesFocusAfterChange,
  routeKey,
  type FocusFacts,
} from './ui/key-routing.js';
import { boundsAttrs, findField, numberBounds } from './ui/number-field.js';
import { isImeKey } from './ui/ime.js';
import type { SelectionCounts } from './ui/inspector-tabs.js';
import {
  SWATCHES,
  closeColourPopover,
  colourRowHtml,
  wireColourControls,
} from './ui/inspector/color-control.js';
import type { InspectorContext } from './ui/inspector/context.js';
import { adoptSharedControls } from './ui/inspector/controls.js';
import { markFocus, restoreFocus } from './ui/inspector/focus-keep.js';
import {
  documentTabHtml,
  wireDocumentTab,
} from './ui/inspector/document-tab.js';
import {
  LINK_GROUPS,
  NODE_GROUPS,
  planSections,
  type FieldGroup,
  type PlannedItem,
} from './ui/inspector/field-groups.js';
import { linkAttachSummary } from './ui/inspector/link-attachment.js';
import { wireNumberInput } from './ui/inspector/number-input.js';
import {
  leavePageTab,
  pageTabHtml,
  wirePageTab,
} from './ui/inspector/page-tab.js';
import { watchPanelWidth } from './ui/inspector/panel-width.js';
import {
  SectionMemory,
  sectionHtml,
  wireSections,
} from './ui/inspector/sections.js';
import {
  selectionHeaderHtml,
  wireSelectionHeader,
  type SelectionHeader,
} from './ui/inspector/selection-header.js';
import { browserStorage } from './ui/inspector/storage.js';
import { mountInspectorTabs } from './ui/inspector/tabs.js';
import {
  commandArg,
  COMMAND_SPECS,
  commandVariant,
  createCommandRegistry,
  HELP_GESTURES,
  isPoint,
  KEYS_SEPARATOR,
  matchKey,
  oneOf,
  PRESENT_KEYS,
  templateCommandSpecs,
  variantArgs,
  type CommandHandlers,
  type CommandId,
} from './ui/commands.js';
import {
  openCommandPalette,
  type PaletteHandle,
} from './ui/command-palette.js';
import { enablePaletteDrag } from './ui/palette-drag.js';
import { findInDocument, type FindMatch } from './ui/find.js';
import type { WheelMode } from './editor/wheel.js';
import { importConfirmText } from './ui/replace-document.js';
import { problemField, problemsDockView } from './ui/problems-dock.js';
import {
  typeOptionGroups,
  type TypeChoice,
  type TypeOption,
} from './ui/type-options.js';
import { saveChip, type SaveChip } from './ui/save-status.js';
import { checkCustomTypeName, uniqueTypeName } from './ui/custom-type-name.js';
import {
  booleanFieldChecked,
  enumFieldOptions,
  enumFieldValue,
  recordFieldText,
} from './ui/annotation-fields.js';
import { exportRenderOptions } from './ui/export-options.js';
import { exportReport, type ExportState } from './ui/export-status.js';
import { classifyOpenedFile } from './import/open.js';
import { validateDocument, type Problem } from './api/validate.js';
import { analyzeLayout } from './api/layout.js';
import { DEFAULT_LINK_ATTACH, genId } from './api/builder.js';
import {
  analyzePath,
  pathCaption,
  pathEmphasis,
  pathFlow,
  pathLabel,
} from './api/path.js';
import { TEXT_LIMITS } from './api/text.js';
import { pathPanelView } from './ui/path-panel.js';
import { computeBadgePlacements } from './editor/problem-badges.js';
import {
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
import {
  accentTextGrounds,
  hexOf,
  parseColour,
  readableAccentText,
  readableInkOn,
} from './ui/contrast.js';
import {
  mountShellNote,
  SHELL_NOTE_KEY,
  shellNoteStart,
  storageKeys,
  type ShellNote,
} from './ui/shell-note.js';

// The "what moved" note is for a browser that used the editor before: read
// what is in storage now, before anything below writes to it.
const shellNoteAtStart = (() => {
  try {
    return shellNoteStart(
      storageKeys(localStorage),
      localStorage.getItem(SHELL_NOTE_KEY),
    );
  } catch {
    return 'none' as const;
  }
})();

// Restore the last session from localStorage, else start from the sample.
const restoredDoc = loadLocal();
const doc: TopologyDocument = restoredDoc ?? sampleDocument();
// Register the shipped cloud-native types, then the document's custom types,
// with the engine before any render.
registerCustomNodes(STOCK_NODE_SPECS);
registerBackdrops(window.TopologyDesigner);
// Everything registered from here on belongs to the open document, and is
// taken away again when another document is loaded (loadDoc).
markBaselineNodeTypes(window.TopologyDesigner);
useDocumentNodeTypes(doc.customNodes);
let current = 0;

/* Commands. Every command of the editor is declared in src/ui/commands.ts
 * (its title, its keys). This is the one registry of them: each control of
 * the shell runs its command through it, the window key handler runs what
 * `matchKey` finds, and tooltips take their shortcut text from it. What each
 * command DOES is bound in one place, "Command bindings" further down, once
 * the functions they call exist. */
const ALL_COMMAND_SPECS = [
  ...COMMAND_SPECS,
  ...templateCommandSpecs(listTemplates()),
];
const commands = createCommandRegistry(ALL_COMMAND_SPECS);
/** A command's tooltip with its shortcut ("Undo (Ctrl/Cmd+Z)"), escaped for
 * an attribute; `label` words it differently for one control. */
function tip(id: CommandId, label?: string): string {
  return esc(commands.titleWithShortcut(id, label));
}
/** Run the variant of a parameterised command that a control's value names:
 * the export of a menu option, the alignment of a button. */
function runVariant(prefix: string, value: string | undefined): void {
  const spec = commandVariant(prefix, value, ALL_COMMAND_SPECS);
  if (!spec) throw new Error(`no "${prefix}" command for "${value}"`);
  commands.run(spec.id);
}
/** Throw unless a set of controls offers exactly the variants of the
 * command under `prefix`, each once: the controls and the table cannot
 * drift apart. Returns the variants' arguments in table order. */
function checkVariantControls(
  prefix: string,
  offered: readonly (string | undefined)[],
): string[] {
  const values = variantArgs(prefix, ALL_COMMAND_SPECS);
  const stray = offered.filter((v) => v === undefined || !values.includes(v));
  const missing = values.filter((v) => !offered.includes(v));
  if (stray.length || missing.length || offered.length !== values.length)
    throw new Error(
      `the "${prefix}" controls and commands differ: offered ${offered.join(', ')}; commands ${values.join(', ')}`,
    );
  return values;
}
/** The <option>s of a menu of a parameterised command's variants, in table
 * order: the value of each is its variant's argument, and its text the
 * menu's own wording, from `labels`. */
function variantOptions(
  prefix: string,
  labels: Readonly<Record<string, string>>,
): string {
  return checkVariantControls(prefix, Object.keys(labels))
    .map((v) => `<option value="${esc(v)}">${esc(labels[v]!)}</option>`)
    .join('');
}
const app = document.getElementById('app')!;

app.innerHTML = `
  <!-- Shared engine SVG defs (glow/bloom/gradient filters) mounted ONCE at the
       app root, ahead of every consumer in DOM order, so canvas nodes, palette
       previews, and the minimap all resolve url(#tds-*) references here. It must
       live outside any collapsible container and stay in the render tree — hence
       width/height 0 + position:absolute + aria-hidden rather than display:none,
       which would break paint-server resolution in several browsers. -->
  <svg id="tds-defs-sprite" class="svg-defs-sprite" width="0" height="0" aria-hidden="true" focusable="false"></svg>
  <!-- The chrome's icon symbols (src/ui/icons.ts), mounted once by the same
       rules: every icon in the shell, the panels and the dialogs is a
       <use href="#i-…"> that resolves here. -->
  <svg id="ui-icon-sprite" class="svg-defs-sprite" width="0" height="0" aria-hidden="true" focusable="false">${iconSprite()}</svg>
  <!-- The top bar is the document: the menus, its title and save state,
       history, tidy, then presenting, exporting and sharing it, and who is
       signed in. Nothing in it scrolls. -->
  <header class="bar topbar" id="topbar">
    <span class="brand" title="Topology Dojo">
      <svg class="logo-mark" viewBox="0 0 32 32" width="22" height="22" aria-label="Topology Dojo" role="img">
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
    <!-- Five menus, folded into one (#menuMore) in a narrow window. -->
    <div class="menubar" id="menubar" role="menubar" aria-label="Main menu">
      ${MENUBAR.map((m) => `<button type="button" class="menubar-item" role="menuitem" data-menu="${m.id}">${m.label}</button>`).join('')}
      <button type="button" class="menubar-item menubar-more" role="menuitem" data-menu="more" id="menuMore" aria-label="Menu">${icon('menu')}<span class="menubar-more-label">Menu</span></button>
    </div>
    <span class="vr"></span>
    <div class="doc-title">
      <input class="doc-title-input" id="docTitle" type="text" aria-label="Document title" placeholder="Untitled" spellcheck="false" autocomplete="off" />
      <span class="saved" id="saved"></span>
      <!-- Spoken when a save fails or another tab's version arrives: the
           chip is a button then, so the alert has to be a region of its own. -->
      <span class="visually-hidden" id="saveAlert" role="alert"></span>
    </div>
    <button type="button" class="icon-btn" id="tUndo" title="${tip('edit.undo')}" aria-label="Undo">${icon('undo')}</button>
    <button type="button" class="icon-btn" id="tRedo" title="${tip('edit.redo')}" aria-label="Redo">${icon('redo')}</button>
    <span class="vr"></span>
    <span class="split">
      <button type="button" class="btn btn-ghost" id="tTidy" title="${tip('arrange.tidy', 'Tidy layout — grid-snap + de-overlap')}" aria-label="Tidy layout">${icon('tidy')}<span class="btn-label">Tidy</span></button>
      <button type="button" class="icon-btn" id="tTidyMenu" title="Tidy, balance and auto-arrange" aria-label="Tidy, balance and auto-arrange">${icon('chevron-down')}</button>
    </span>
    <span class="vr"></span>
    <span class="export-status" id="exportStatus" role="status" aria-live="polite"></span>
    <button type="button" class="btn btn-ghost" id="tPresent" title="${tip('view.present', 'Present all pages full screen')}" aria-label="Present">${icon('present')}<span class="btn-label">Present</span></button>
    <button type="button" class="btn" id="fExportBtn" title="Export the page or the document" aria-label="Export">${icon('export')}<span class="btn-label">Export</span>${icon('chevron-down', { size: 12, className: 'btn-caret' })}</button>
    <button type="button" class="btn btn-primary" id="fShare" title="Publish a public share link / manage published links" aria-label="Share" hidden>${icon('share')}<span class="btn-label">Share</span></button>
    <span class="vr" id="workspaceDiv" hidden></span>
    <button class="chip workspace-chip" id="workspaceChip" type="button" aria-haspopup="dialog" aria-expanded="false" title="Agent Workspace" hidden><span class="ws-dot" aria-hidden="true"></span><span id="workspaceLabel">agent · local</span></button>
    <span class="vr" id="userDiv" hidden></span>
    <button class="chip user-chip" id="userChip" type="button" aria-haspopup="menu" aria-expanded="false" title="Account" aria-label="Account menu" hidden><span class="uc-dot" aria-hidden="true">${icon('account')}</span><span class="uc-name" id="userName"></span><span class="uc-caret" aria-hidden="true">${icon('chevron-down')}</span></button>
    <input type="file" id="fInput" accept="application/json,.json,.drawio,.xml,.mmd,.mermaid,.csv,.txt" hidden />
  </header>
  <!-- Shown while the document on canvas is a /v/<id> shared snapshot: edits
       autosave to a separate slot so the user's own document stays intact
       until they explicitly adopt the copy (#202). -->
  <div class="shared-banner" id="sharedBanner" role="status" hidden>
    <span class="shared-banner-text">${SHARE_PUBLIC_WARNING} Viewing a shared copy — your own document is untouched.</span>
    <button type="button" class="btn btn-sm" id="sharedKeep" title="Replace your locally saved document with this shared copy">Keep this copy</button>
    <button type="button" class="btn btn-sm btn-ghost" id="sharedBack" title="Return to your own locally saved document">Back to my document</button>
    <button type="button" class="btn btn-sm btn-danger" id="sharedUnpublish" title="Remove the public snapshot so this link stops working" hidden>Unpublish link</button>
  </div>

  <!-- The stage, by scope: the rail (making: the tools, the library), the
       node library docked beside it, the canvas over the pages bar, and the
       properties panel. Only the page chips scroll. -->
  <div class="stage">
    <div class="rail scroll-slim" id="rail">
      <div class="rail-tools" role="group" aria-label="Tools">
      <button type="button" class="icon-btn icon-btn-lg on" id="tSelect" title="${tip('tool.select')}" aria-label="Select/move tool" aria-pressed="true">${icon('tool-select')}</button>
      <button type="button" class="icon-btn icon-btn-lg" id="ccHand" title="${tip('tool.hand')} — or hold Space to pan anytime" aria-label="Hand / pan tool" aria-pressed="false">${icon('hand')}</button>
      <button type="button" class="icon-btn icon-btn-lg" id="tLink" title="${tip('tool.link')}" aria-label="Draw link tool" aria-pressed="false">${icon('tool-link')}</button>
      <button type="button" class="icon-btn icon-btn-lg" id="tAnchor" title="${tip('tool.anchor')} — free-floating link endpoints" aria-label="Drop anchor tool" aria-pressed="false">${icon('anchor')}</button>
      </div>
      <span class="rail-sep" aria-hidden="true"></span>
      <button type="button" class="icon-btn icon-btn-lg" id="palette-toggle" title="${tip('view.toggleLibrary', 'Hide node library')}" aria-label="Node library" aria-pressed="true">${icon('panel-left-close')}</button>
      <span class="rail-space"></span>
      <button type="button" class="icon-btn icon-btn-lg" id="tCommand" title="${tip('help.commandPalette')}" aria-label="Command palette">${icon('search')}</button>
      <button type="button" class="icon-btn icon-btn-lg" id="tHelp" title="${tip('help.shortcuts')}" aria-label="Keyboard shortcuts">${icon('shortcuts')}</button>
    </div>
    <aside class="palette" id="palette" aria-label="Node library">
      <div class="palette-head">Library</div>
      <input id="palette-search" class="field palette-search" type="search" placeholder="Search nodes…" autocomplete="off" aria-label="Search node library">
      <div class="palette-list scroll-slim" id="palette-list"></div>
    </aside>
    <div class="canvas-col">
      <div class="canvas-area" id="canvas-area">
        <div class="tds-root">
          <div class="tds-canvas-row">
            <div class="tds-canvas canvas-host">
              <svg id="page-canvas" preserveAspectRatio="xMidYMid meet"></svg>
              <svg id="overlay" class="overlay" preserveAspectRatio="xMidYMid meet"></svg>
            </div>
          </div>
        </div>
        <!-- What floats over the canvas: the minimap card, and under it the
             zoom control in the bottom-right corner. -->
        <div class="minimap-dock" id="minimap-dock">
          <svg id="minimap" class="minimap" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Minimap: click or drag to move the view"></svg>
        </div>
        <div class="canvas-ctrls" id="canvasCtrls" role="group" aria-label="Zoom">
          <button type="button" class="icon-btn" id="ccZoomOut" title="${tip('view.zoomOut')}" aria-label="Zoom out">${icon('zoom-out')}</button>
          <button type="button" class="cc-zoom" id="ccZoom" title="${tip('view.fit')}" aria-label="Zoom 100% — fit view">100%</button>
          <button type="button" class="icon-btn" id="ccZoomIn" title="${tip('view.zoomIn')}" aria-label="Zoom in">${icon('zoom-in')}</button>
          <button type="button" class="icon-btn" id="ccFit" title="${tip('view.fit', 'Fit to content')}" aria-label="Fit to content">${icon('fit-view')}</button>
        </div>
      </div>
      <!-- The pages bar, docked under the canvas: the pages toggle and its
           chips, then the canvas options at the right end. -->
      <div class="pages-bar" id="pagesBar">
        <div class="frames-dock" id="frames-dock" role="region" aria-label="Pages">
          <button class="frames-toggle" id="frames-toggle" type="button" aria-expanded="true" title="${tip('view.toggleFrames', 'Hide pages')}"><span class="frames-word">Pages</span> <span class="frames-ind" id="frames-ind">1/1</span> <span class="frames-chev" aria-hidden="true">${icon('chevron-left')}</span></button>
          <!-- Play, the chips, then duplicate, add and undo delete. Only the
               chips scroll; the buttons on either side stay put. -->
          <div class="frames-reveal">
            <span class="pages-lead" id="pagesLead"></span>
            <div class="filmstrip scroll-slim" id="filmstrip"></div>
            <span class="pages-tail" id="pagesTail"></span>
          </div>
        </div>
        <div class="view-opts" role="group" aria-label="Canvas options">
          <button type="button" class="icon-btn on" id="tGrid" title="${tip('view.toggleGrid')}" aria-label="Toggle grid" aria-pressed="true">${icon('grid')}</button>
          <button type="button" class="icon-btn on" id="tSnap" title="${tip('view.toggleSnap')}" aria-label="Toggle snap" aria-pressed="true">${icon('snap')}</button>
          <button type="button" class="icon-btn" id="tCalm" title="${tip('view.toggleCalm', 'Calm canvas — pause animations')}" aria-label="Calm canvas — pause animations" aria-pressed="false">${icon('calm')}</button>
          <button type="button" class="icon-btn" id="tDisplay" title="Display settings — ambient backdrop, wheel, brand palette" aria-label="Display settings" aria-haspopup="dialog" aria-expanded="false">${icon('settings')}</button>
          <span class="vr"></span>
          <button type="button" class="icon-btn" id="minimap-toggle" title="${tip('view.toggleMinimap', 'Hide minimap')}" aria-label="Minimap" aria-pressed="true">${icon('minimap')}</button>
        </div>
      </div>
    </div>
    <div class="inspector-wrap" id="inspector-wrap">
      <div class="inspector-resizer" id="inspector-resizer" title="Drag to resize"></div>
      <div class="inspector-col">
        <button type="button" class="btn btn-sm btn-ghost inspector-toggle" id="inspector-toggle" aria-controls="inspector-wrap" aria-expanded="true" title="${tip('view.toggleProperties', 'Hide properties')}" aria-label="Hide properties"><span class="toggle-word">Hide</span> ${icon('panel-right-close')}</button>
        <div class="inspector-body" id="inspector-body">
          <aside class="inspector scroll-slim" id="inspector"></aside>
        </div>
        <div class="problems-dock collapsed" id="problems-dock">
          <button class="problems-toggle" id="problems-toggle" title="Validation + layout problems">
            <span class="pt-label">Problems</span>
            <span class="badge data prob-count" id="prob-count">0</span>
            <span class="hint prob-hidden-note" id="prob-hidden-note"></span>
            <span class="pt-chev" aria-hidden="true">${icon('chevron-right')}</span>
          </button>
          <div class="problems scroll-slim" id="problems"></div>
        </div>
      </div>
    </div>
  </div>

  <footer class="statusbar" id="statusbar"></footer>
`;

// Populate the root defs sprite once. These are the engine's static shared
// filters/gradients (brand-independent), identical to the copy the palette used
// to inline into #palette-list — but here they can never be unmounted or hidden
// by a panel collapse.
app.querySelector<SVGSVGElement>('#tds-defs-sprite')!.innerHTML = engineDefs();

const artSvg = app.querySelector<SVGSVGElement>('#page-canvas')!;
const overlaySvg = app.querySelector<SVGSVGElement>('#overlay')!;
const strip = app.querySelector<HTMLElement>('#filmstrip')!;
// The pages bar's buttons on either side of the chips (play; duplicate, add,
// undo delete), outside the strip so that they never scroll away.
const pagesLead = app.querySelector<HTMLElement>('#pagesLead')!;
const pagesTail = app.querySelector<HTMLElement>('#pagesTail')!;
const framesDock = app.querySelector<HTMLDivElement>('#frames-dock')!;
const framesToggle = app.querySelector<HTMLButtonElement>('#frames-toggle')!;
const framesInd = app.querySelector<HTMLElement>('#frames-ind')!;
// The pages bar's height, kept on the stage as --pages-bar-h: below 1,024px
// the drawers end above the bar (which takes two rows on a phone) instead of
// covering its page toggle.
{
  const pagesBar = app.querySelector<HTMLElement>('#pagesBar')!;
  const stageEl = app.querySelector<HTMLElement>('.stage')!;
  new ResizeObserver(() =>
    stageEl.style.setProperty('--pages-bar-h', `${pagesBar.offsetHeight}px`),
  ).observe(pagesBar);
}
const savedEl = app.querySelector<HTMLElement>('#saved')!;
const saveAlertEl = app.querySelector<HTMLElement>('#saveAlert')!;
/* The document title in the top bar. It writes what the Title field of the
 * page properties writes (doc.title, then the autosave), and the two show
 * the same text: each updates the other, and a loaded document sets both. */
const docTitleEl = app.querySelector<HTMLInputElement>('#docTitle')!;
docTitleEl.value = doc.title;
docTitleEl.addEventListener('input', () => {
  doc.title = docTitleEl.value;
  const field = app.querySelector<HTMLInputElement>('#p-title');
  if (field) field.value = doc.title;
  markDirty();
});
// Enter is done with the title; the canvas has the keyboard again.
docTitleEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !isImeKey(e)) docTitleEl.blur();
});

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
  if (savedEl.classList.contains('save-failed')) commands.run('file.download');
  else if (savedEl.classList.contains('save-stale'))
    commands.run('file.loadOtherTab');
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
  // A path on show is traced again: the edit may have changed the answer.
  if (pathSession) renderPathBar();
  markDirty();
}

// Guards the status bar from rendering before `editor`/`statusbar` are set up
// (the Editor constructor fires onView during construction).
let statusReady = false;
/** The path analysis on show, if any (see "Path analysis" further down).
 * Declared here because `onDocChange` reads it and runs during start-up. */
let pathSession: {
  from: string;
  to: string;
  /** Which of the routes found is on show. */
  index: number;
  /** The frame it was asked on; it does not follow to another frame. */
  pageId: string;
} | null = null;
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
    `<input type="search" class="field qa-input" placeholder="Add node… (type to search)" aria-label="Search node types" autocomplete="off">` +
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
 * inspector actions — color swatches + page emphasis for nodes, plus
 * link type / routing for a selected link. Pure convenience over the
 * inspector (same update paths); view state only, nothing persisted.
 * After them come commands of the registry, as icon buttons: align and
 * distribute for two or more nodes, then bring to front, send to back and
 * lock for any node or link selection. Each runs its command and is
 * greyed out when the command cannot run (distribute below three nodes,
 * z-order for more than one node). */
const miniBar = document.createElement('div');
miniBar.className = 'mini-bar';
miniBar.hidden = true;
document.querySelector('.canvas-host')?.appendChild(miniBar);

function miniBarHtml(kind: 'node' | 'link'): string {
  const swatches = SWATCHES.map(
    (c) =>
      `<button class="mb-sw" data-mbcolor="${c}" style="background:${c}" title="${c}" aria-label="Color ${c}"></button>`,
  ).join('');
  const emph = `<button type="button" class="icon-btn mb-btn" id="mbEmph" title="Emphasize on this page" aria-label="Emphasize on this page" aria-pressed="false">${icon('star')}</button>`;
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
      `<select class="field mb-sel" id="mbType" title="Link type" aria-label="Link type">${typeOpts}</select>` +
      `<select class="field mb-sel" id="mbStyle" title="Routing" aria-label="Link routing">${styleOpts}</select>` +
      `<span class="mb-div"></span>${swatches}<span class="mb-div"></span>${emph}` +
      miniBarCommandsHtml(MINI_BAR_ORDER)
    );
  }
  const multi = (editor.selectionElements()?.nodes.length ?? 0) >= 2;
  return (
    `${swatches}<span class="mb-div"></span>${emph}` +
    (multi
      ? miniBarCommandsHtml(MINI_BAR_ALIGN) +
        miniBarCommandsHtml(MINI_BAR_DISTRIBUTE)
      : '') +
    miniBarCommandsHtml(MINI_BAR_ORDER)
  );
}

const MINI_BAR_ALIGN = [
  'arrange.alignLeft',
  'arrange.alignCenterH',
  'arrange.alignRight',
  'arrange.alignTop',
  'arrange.alignMiddleV',
  'arrange.alignBottom',
] as const satisfies readonly CommandId[];
const MINI_BAR_DISTRIBUTE = [
  'arrange.distributeH',
  'arrange.distributeV',
] as const satisfies readonly CommandId[];
const MINI_BAR_ORDER = [
  'arrange.bringToFront',
  'arrange.sendToBack',
  'edit.toggleLock',
] as const satisfies readonly CommandId[];

/** A divider, then one icon button per command; their state is set by
 * `syncMiniBarCommands`. */
function miniBarCommandsHtml(ids: readonly CommandId[]): string {
  return (
    `<span class="mb-div"></span>` +
    ids
      .map((id) => {
        const spec = commands.get(id)!;
        return `<button type="button" class="icon-btn mb-cmd" data-command="${id}">${spec.icon ? icon(spec.icon) : ''}</button>`;
      })
      .join('')
  );
}

/** Name, tooltip, enabled and pressed state of the bar's command buttons,
 * as the registry has them now. */
function syncMiniBarCommands(): void {
  for (const b of miniBar.querySelectorAll<HTMLButtonElement>('.mb-cmd')) {
    const id = b.dataset.command as CommandId;
    const lock = id === 'edit.toggleLock';
    const label = lock
      ? commands.isChecked(id)
        ? 'Unlock'
        : 'Lock'
      : commands.get(id)!.title;
    b.setAttribute('aria-label', label);
    b.title = commands.titleWithShortcut(id, label);
    b.disabled = !commands.isEnabled(id);
    if (lock) b.setAttribute('aria-pressed', String(commands.isChecked(id)));
  }
}

/**
 * The selection's box on screen (client coordinates), which the selection
 * bar keeps clear of: for a link what is drawn of it (its route, markers and
 * labels: the handles that bend it sit on that route), for nodes their
 * bounds and, for a sole node, its quick-connect arrows.
 */
function miniBarSelectionBox(): EdgeBox | null {
  const link = editor.getSelectedLink();
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const add = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  if (link) {
    const drawn = artSvg
      .querySelector(`g[data-tds-link="${CSS.escape(link.id)}"]`)
      ?.getBoundingClientRect();
    if (drawn && drawn.width + drawn.height > 0)
      return {
        left: drawn.left,
        top: drawn.top,
        right: drawn.right,
        bottom: drawn.bottom,
      };
    // Not drawn: its endpoints and bends stand in for the route.
    for (const id of [link.from, link.to]) {
      const n = editor.page.nodes.find((m) => m.id === id);
      const a = n ?? editor.page.anchors.find((m) => m.id === id);
      if (a) add(a.x, a.y);
    }
    for (const p of link.waypoints ?? []) add(p.x, p.y);
  } else {
    const sel = editor.selectionElements();
    for (const n of sel?.nodes ?? []) {
      const b = nodeBounds(n);
      add(b.x, b.y);
      add(b.x + b.w, b.y + b.h);
    }
    // A sole node's quick-connect arrows sit outside its box, on all four
    // sides: the bar keeps clear of them too.
    const arrows = editor.quickConnectBox();
    if (arrows) {
      add(arrows.left, arrows.top);
      add(arrows.right, arrows.bottom);
    }
  }
  if (minX === Infinity) return null;
  const a = userToClient(overlaySvg, minX, minY);
  const b = userToClient(overlaySvg, maxX, maxY);
  return { left: a.x, top: a.y, right: b.x, bottom: b.y };
}

let miniBarSuppressed = false;
function updateMiniBar(): void {
  const link = editor.getSelectedLink();
  const nodeCount = link ? 0 : (editor.selectionElements()?.nodes.length ?? 0);
  if (miniBarSuppressed || (!link && nodeCount === 0)) {
    miniBar.hidden = true;
    return;
  }
  const selection = miniBarSelectionBox();
  const host = document.querySelector<HTMLElement>('.canvas-host');
  if (!selection || !host) {
    miniBar.hidden = true;
    return;
  }
  const kind = link ? 'link' : 'node';
  // Two or more nodes add the align and distribute buttons.
  const layout = kind === 'node' && nodeCount >= 2 ? 'nodes' : kind;
  if (miniBar.dataset.layout !== layout || miniBar.hidden) {
    miniBar.dataset.kind = kind;
    miniBar.dataset.layout = layout;
    miniBar.innerHTML = miniBarHtml(kind);
  } else if (kind === 'link') {
    // Keep the selects in sync when a different link is picked.
    const info = editor.selectedLinkInfo();
    const t = miniBar.querySelector<HTMLSelectElement>('#mbType');
    const s = miniBar.querySelector<HTMLSelectElement>('#mbStyle');
    if (t && info) t.value = info.type;
    if (s && info) s.value = info.style;
  }
  syncMiniBarCommands();
  miniBar.hidden = false;
  const hostRect = host.getBoundingClientRect();
  // Below 1,024px (above a phone) open drawers cover the canvas's edges and
  // are drawn over the bar: it keeps to the canvas they leave showing.
  let bandLeft = 0;
  let bandRight = hostRect.width;
  if (isCompactAbovePhone(window.innerWidth)) {
    const drawer = (id: string): DOMRect | null => {
      const el = document.getElementById(id);
      return el && !el.classList.contains('collapsed')
        ? el.getBoundingClientRect()
        : null;
    };
    const lib = drawer('palette');
    const props = drawer('inspector-wrap');
    if (lib) bandLeft = Math.max(0, lib.right - hostRect.left);
    if (props)
      bandRight = Math.max(
        bandLeft,
        Math.min(hostRect.width, props.left - hostRect.left),
      );
  }
  // In a narrow strip the bar takes more rows rather than run under a
  // drawer, down to a width where its rows would stack too tall.
  miniBar.style.maxWidth =
    bandRight - bandLeft < hostRect.width
      ? `${Math.max(160, bandRight - bandLeft - 8)}px`
      : '';
  // Measured from the canvas's left edge, so the room to its right does not
  // decide whether the bar wraps onto a second row.
  miniBar.style.left = '0px';
  // Clear of the selection: above it, or below it when there is no room
  // above. The bar's own size (one row or two) decides what fits.
  const at = placeSelectionBar(
    {
      left: selection.left - hostRect.left - bandLeft,
      top: selection.top - hostRect.top,
      right: selection.right - hostRect.left - bandLeft,
      bottom: selection.bottom - hostRect.top,
    },
    { width: miniBar.offsetWidth || 200, height: miniBar.offsetHeight || 34 },
    { width: bandRight - bandLeft, height: hostRect.height },
  );
  miniBar.style.left = `${at.left + bandLeft}px`;
  miniBar.style.top = `${at.top}px`;
  const emph = miniBar.querySelector<HTMLButtonElement>('#mbEmph');
  if (emph) {
    const ids = link ? [link.id] : (editor.selectedNodeIds() ?? []);
    const on = ids.length > 0 && ids.every((id) => editor.isEmphasized(id));
    emph.classList.toggle('on', on);
    emph.setAttribute('aria-pressed', String(on));
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
  const cmd = t.closest<HTMLButtonElement>('.mb-cmd');
  if (cmd) {
    commands.run(cmd.dataset.command as CommandId);
    renderInspector();
    updateMiniBar();
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
 * Tell the editor how much of the canvas the panels cover, so fit-to-content
 * frames the *visible* area and never tucks edge content behind the node
 * library, the zoom control and minimap in the canvas's corner, or the
 * properties drawer. Recomputed on each fit (panels collapse/expand).
 */
/** A floating panel's box, or null while it is collapsed or not laid out. */
const openPanelBox = (id: string): PanelBox | null => {
  const el = document.getElementById(id);
  if (!el || el.classList.contains('collapsed')) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
};
/** The smallest box that holds both, or the one that is there. */
function unionBox(a: PanelBox | null, b: PanelBox | null): PanelBox | null {
  if (!a || !b) return a ?? b;
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}
/** The left inset the editor's latest fit was computed with (see fitView). */
let fitLeftInset = 0;
editor.setViewInsets(() => {
  const insets = fitInsets({
    canvas: overlaySvg.getBoundingClientRect(),
    palette: openPanelBox('palette'),
    inspector: openPanelBox('inspector-wrap'),
    // The zoom control is always there; the minimap card above it only
    // while it is open.
    corner: unionBox(openPanelBox('canvasCtrls'), openPanelBox('minimap-dock')),
    drawers: isCompactAbovePhone(window.innerWidth),
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
  closePathBar(); // a path belongs to the frame it was traced on
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
  docTitleEl.value = doc.title;
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
  // The previous document's custom types go; this document's are registered.
  useDocumentNodeTypes(doc.customNodes);
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
/* Authoring Preferences (Packet P3, observe-only) and the owner-only admin
 * dashboard open from the account menu (account.preferences, account.admin),
 * which offers them under the conditions their chips were revealed by: a
 * signed-in user, and for the dashboard the owner flag from `/api/me`. The
 * panels (fetching, pause/forget wiring, panel DOM) live in
 * `src/ui/profile-panel.ts` and `src/ui/admin-dashboard.ts`. */
const profilePanelHandle = mountProfilePanel();
const adminDashboardHandle = mountAdminDashboard();
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
function keepSharedCopy(): void {
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
}
function backToMyDocument(): void {
  activeShareId = undefined;
  loadDoc(loadLocal() ?? sampleDocument());
}
function unpublishSharedLink(): void {
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
}
sharedBanner
  .querySelector('#sharedKeep')
  ?.addEventListener('click', () => commands.run('shared.keepCopy'));
sharedBanner
  .querySelector('#sharedBack')
  ?.addEventListener('click', () => commands.run('shared.backToMine'));
sharedUnpublish.addEventListener('click', () =>
  commands.run('shared.unpublish'),
);

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
}
// Not on a share link: a shared copy left open resumes at the end of start-up
// (see the bottom of this module).

/* File actions: new / save (download) / open (upload). */
function newDocument(): void {
  if (!confirm('Start a new document? Unsaved changes to this one are lost.'))
    return;
  if (!closeWorkspaceForDocumentReplacement()) return;
  loadDoc({
    title: 'Untitled',
    // A new document starts with the link anchor box on, like one an agent
    // creates (DEFAULT_LINK_ATTACH); the page's Properties turn it off.
    pages: [
      { ...blankPage('Frame 1'), linkAttach: { ...DEFAULT_LINK_ATTACH } },
    ],
    customNodes: [],
  });
  // An anonymous visitor (in from a share link) has just started a document
  // of their own: say, without blocking, what signing in would add.
  promptSignIn();
}

/* Image export: SVG (vector, honors calm) and PNG (always a static raster).
 * #222: the click used to fire a detached <a download> and revoke the blob
 * URL in the same turn, which Chrome can drop silently. downloadBlob now
 * inserts the anchor and keeps the URL alive; this chip reports success or
 * failure so a swallowed download is never the only outcome. */
const exportStatus = app.querySelector<HTMLElement>('#exportStatus')!;
/** Show how export `kind` is going in the status chip (and to a screen
 * reader: the chip is a polite live region). */
function reportExport(kind: string, state: ExportState, detail?: string): void {
  const report = exportReport(kind, state, detail);
  exportStatus.innerHTML = `${icon(report.icon)} ${esc(report.message)}`;
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
function exportSvg(): void {
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
}
/** A PNG export is being drawn; another waits until it is done. */
let pngExportInFlight = false;
function exportPng(): void {
  if (pngExportInFlight) return;
  const page = framed(doc.pages[current]!);
  const filename = `${exportBase()}.png`;
  pngExportInFlight = true;
  reportExport('png', 'pending', filename);
  void exportPagePNG(filename, page, 2, pageOverlay(page), pageOpts(page))
    .then(() => reportExport('png', 'ok', filename))
    .catch((err: unknown) => {
      const detail = err instanceof Error ? err.message : 'PNG export failed.';
      reportExport('png', 'error', detail);
    })
    .finally(() => {
      pngExportInFlight = false;
    });
}
/* More export formats: PDF (raster @2× through the same pipeline as PNG, so
 * it always matches the canvas), the standalone flipbook HTML (same generator
 * as the MCP tool — no fork), clipboard PNG, and selection-only crops. */
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
/** Run one of the export menu's formats, reporting how it goes. */
function exportFromMenu(kind: string): void {
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
}
/* New from a starter template (File ▸ New from template). */
/** Open the SD-WAN generator; what it creates replaces the document. */
function generateSdwan(): void {
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
}
/** Start a new document from the starter template `id`. */
function newFromTemplate(id: string): void {
  // A parametric template asks for its parameters first (and confirms on
  // Create); one without parameters falls through to the plain path below.
  if (
    openTemplateWizard(id, {
      mount: app,
      render: (generated) =>
        pageToSVG(generated.pages[0]!, {
          layers: generated.layers,
          calm: true,
          theme: currentTheme(),
        }),
      onCreate: (generated) => {
        if (!confirm('Start from this template? Unsaved changes are lost.'))
          return;
        if (!closeWorkspaceForDocumentReplacement()) return;
        loadDoc(generated);
      },
    })
  )
    return;
  if (!confirm('Start from this template? Unsaved changes are lost.')) return;
  if (!closeWorkspaceForDocumentReplacement()) return;
  loadDoc(buildTemplate(id));
}

const fileInput = app.querySelector<HTMLInputElement>('#fInput')!;
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

/** Show a toggle button's state: its `on` class and `aria-pressed`. */
function setPressed(button: HTMLElement, on: boolean): void {
  button.classList.toggle('on', on);
  button.setAttribute('aria-pressed', String(on));
}

/* Tool toggle (select / link) */
const selectBtn = app.querySelector<HTMLButtonElement>('#tSelect')!;
const linkBtn = app.querySelector<HTMLButtonElement>('#tLink')!;
const anchorBtn = app.querySelector<HTMLButtonElement>('#tAnchor')!;
function setTool(t: 'select' | 'link' | 'anchor'): void {
  editor.setTool(t);
  if (editor.isHandActive()) setHand(false); // picking a tool exits Hand mode
  setPressed(selectBtn, t === 'select');
  setPressed(linkBtn, t === 'link');
  setPressed(anchorBtn, t === 'anchor');
  renderStatus();
}
selectBtn.addEventListener('click', () => commands.run('tool.select'));
linkBtn.addEventListener('click', () => commands.run('tool.link'));
anchorBtn.addEventListener('click', () => commands.run('tool.anchor'));

/* Undo / Redo buttons (mirror Ctrl/Cmd+Z) + History readout. */
const undoBtn = app.querySelector<HTMLButtonElement>('#tUndo')!;
const redoBtn = app.querySelector<HTMLButtonElement>('#tRedo')!;
undoBtn.addEventListener('click', () => commands.run('edit.undo'));
redoBtn.addEventListener('click', () => commands.run('edit.redo'));

/* On-canvas controls: hand/pan, zoom +/−, zoom %, fit. */
const handBtn = app.querySelector<HTMLButtonElement>('#ccHand')!;
const ccZoom = app.querySelector<HTMLButtonElement>('#ccZoom')!;
/** Hand mode sits on top of the current tool: while it is on, Hand is the
 * one tool shown pressed; when it goes off, the tool underneath is again. */
function setHand(on: boolean): void {
  editor.setHandTool(on);
  setPressed(handBtn, on);
  setPressed(selectBtn, !on && editor.tool === 'select');
  setPressed(linkBtn, !on && editor.tool === 'link');
  setPressed(anchorBtn, !on && editor.tool === 'anchor');
}
handBtn.addEventListener('click', () => commands.run('tool.hand'));
app
  .querySelector('#ccZoomIn')!
  .addEventListener('click', () => commands.run('view.zoomIn'));
app
  .querySelector('#ccZoomOut')!
  .addEventListener('click', () => commands.run('view.zoomOut'));
ccZoom.addEventListener('click', () => commands.run('view.fit'));
app
  .querySelector('#ccFit')!
  .addEventListener('click', () => commands.run('view.fit'));

/** Reflect undo/redo availability + live zoom % in the chrome. */
function refreshChrome(): void {
  undoBtn.disabled = !editor.canUndo();
  redoBtn.disabled = !editor.canRedo();
  const pct = Math.round(editor.zoom() * 100);
  ccZoom.textContent = `${pct}%`;
  // Its name holds the figure it shows, then what a press does.
  ccZoom.setAttribute('aria-label', `Zoom ${pct}% — fit view`);
}

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
  const { severity, statusIcon, statusLabel, statusTitle } = problemsView;
  const cls =
    severity === 'error' ? 'has-error' : severity === 'warn' ? 'has-warn' : '';
  return `<button class="sb-problems ${cls}" id="sb-problems" title="${esc(statusTitle)}" aria-label="${esc(statusTitle)}">${icon(statusIcon)}${statusLabel ? ` ${esc(statusLabel)}` : ''}</button>`;
}
function renderStatus(): void {
  if (!statusReady) return; // editor / statusbar not wired yet
  const p = editor.page;
  const sel = editor.selectionCount();
  const cur = cursor ? `${cursor.x}, ${cursor.y}` : '–';
  statusbar.innerHTML =
    `<span><span class="sb-k">tool</span> ${editor.tool}</span>` +
    `<span class="sb-minor"><span class="sb-k">x,y</span> ${cur}</span>` +
    `<span><span class="sb-k">nodes</span> ${p.nodes.length}</span>` +
    `<span><span class="sb-k">links</span> ${p.links.length}</span>` +
    `<span class="sb-minor"><span class="sb-k">anchors</span> ${p.anchors.length}</span>` +
    `<span class="sb-minor"><span class="sb-k">zones</span> ${p.zones.length}</span>` +
    `<span><span class="sb-k">selected</span> ${sel}</span>` +
    `<span class="sb-minor"><span class="sb-k">history</span> ${editor.historyDepth()}</span>` +
    `<span><span class="sb-k">zoom</span> ${Math.round(editor.zoom() * 100)}%</span>` +
    statusProblemsHTML() +
    `<span class="sb-hint">drag move · wheel zoom · space/middle-drag pan · ? shortcuts</span>`;
  refreshChrome();
}
// Delegated: the status-bar problems indicator opens the right rail (if hidden)
// and expands the pinned Problems section.
function showProblems(): void {
  setInspectorCollapsed(false);
  setProblemsCollapsed(false);
  problemsPanel.scrollIntoView({ block: 'nearest' });
}
statusbar.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('#sb-problems'))
    commands.run('view.showProblems');
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
    .map((n) =>
      // A node's own colour is the document's; the rest is the theme's
      // (the mm-* rules in shell.css), so it follows light and dark and
      // the brand accent.
      n.color
        ? `<circle class="mm-node" cx="${mx(n.x)}" cy="${my(n.y)}" r="2" fill="${esc(n.color)}"/>`
        : `<circle class="mm-node" cx="${mx(n.x)}" cy="${my(n.y)}" r="2"/>`,
    )
    .join('');
  const v = editor.getView();
  minimap.setAttribute('viewBox', `0 0 ${MM_W} ${MM_H}`);
  const html =
    `<rect class="mm-page" x="${ox}" y="${oy}" width="${pw * s}" height="${ph * s}"/>` +
    dots +
    `<rect class="mm-view" x="${mx(v.x)}" y="${my(v.y)}" width="${v.w * s}" height="${v.h * s}"/>`;
  // Mirror the canvas brand remap so a node's own colour matches (#7).
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

// Show / hide the minimap card above the zoom control. Its toggle is at the
// right end of the pages bar.
const minimapDock = app.querySelector<HTMLDivElement>('#minimap-dock')!;
const minimapToggle = app.querySelector<HTMLButtonElement>('#minimap-toggle')!;
function setMinimapCollapsed(collapsed: boolean): void {
  minimapDock.classList.toggle('collapsed', collapsed);
  minimapToggle.setAttribute('aria-pressed', String(!collapsed));
  minimapToggle.title = commands.titleWithShortcut(
    'view.toggleMinimap',
    collapsed ? 'Show minimap' : 'Hide minimap',
  );
  try {
    localStorage.setItem('tds-minimap-collapsed', collapsed ? '1' : '0');
  } catch {
    /* storage unavailable — fine, just don't persist */
  }
}
minimapToggle.addEventListener('click', () =>
  commands.run('view.toggleMinimap'),
);
// Closed until asked for: open, the card floats over the canvas's corner and
// every fit gives up a strip of the canvas to it.
setMinimapCollapsed(localStorage.getItem('tds-minimap-collapsed') !== '0');

// Collapse / restore the node library docked beside the rail (a drawer over
// the canvas below 1,024px). Its toggle is the rail's Library button.
const paletteEl = app.querySelector<HTMLElement>('#palette')!;
const paletteToggle = app.querySelector<HTMLButtonElement>('#palette-toggle')!;
function setPaletteCollapsed(collapsed: boolean, persist = true): void {
  paletteEl.classList.toggle('collapsed', collapsed);
  paletteToggle.innerHTML = icon(
    collapsed ? 'panel-left-open' : 'panel-left-close',
  );
  paletteToggle.setAttribute('aria-pressed', String(!collapsed));
  paletteToggle.title = commands.titleWithShortcut(
    'view.toggleLibrary',
    collapsed ? 'Show node library' : 'Hide node library',
  );
  if (!persist) return;
  try {
    localStorage.setItem('tds-palette-collapsed', collapsed ? '1' : '0');
  } catch {
    /* storage unavailable — fine, just don't persist */
  }
}
paletteToggle.addEventListener('click', () =>
  commands.run('view.toggleLibrary'),
);

/* Collapse / restore the page chips in the pages bar. The bar itself stays,
 * so toggling never resizes the canvas or moves the viewport. Collapsed, the
 * toggle's current/total readout stays live (playback keeps running and
 * updating it without forcing the chips open). */
function setFramesCollapsed(collapsed: boolean): void {
  framesDock.classList.toggle('collapsed', collapsed);
  framesToggle.setAttribute('aria-expanded', String(!collapsed));
  const chev = framesToggle.querySelector('.frames-chev');
  if (chev) chev.innerHTML = icon(collapsed ? 'chevron-right' : 'chevron-left');
  framesToggle.title = commands.titleWithShortcut(
    'view.toggleFrames',
    collapsed ? 'Show pages' : 'Hide pages',
  );
  try {
    localStorage.setItem('tds-frames-collapsed', collapsed ? '1' : '0');
  } catch {
    /* storage unavailable — fine, just don't persist */
  }
  // Re-opening should land with the active frame in view (incl. mid-playback).
  if (!collapsed) scrollActiveFrameIntoView();
}
framesToggle.addEventListener('click', () => commands.run('view.toggleFrames'));
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
  // A jump shows the element, even when it was selected already and the
  // Page or Document tab had been picked since.
  inspectorTabs.showSelection();
}

/**
 * After a jump from the Problems dock: open the section of the field at fault
 * (and any section it is nested in) and put the focus on it.
 */
function revealProblemField(selector: string | undefined): void {
  if (!selector) return;
  const field = inspector.querySelector<HTMLElement>(selector);
  if (!field) return;
  for (
    let section = field.closest('details');
    section;
    section = section.parentElement?.closest('details') ?? null
  )
    section.open = true;
  field.focus();
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
  if (chev) chev.innerHTML = icon(collapsed ? 'chevron-right' : 'chevron-down');
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
  probCount.classList.toggle('badge-error', problemsView.severity === 'error');
  probCount.classList.toggle('badge-warn', problemsView.severity === 'warn');
  probHiddenNote.textContent = problemsView.hiddenNote;

  // Keep the always-visible status-bar indicator in sync.
  renderStatus();

  const listed = showHiddenProblems ? all : problems;
  const rows = listed
    .map((p, i) => {
      const loc = problemLocateGlobal(p);
      const text = problemText(p);
      const isHidden = hiddenProblems.has(problemKey(p));
      // Where it is fixed: the element's tab, or the Page or Document tab,
      // and the field at fault when there is one.
      const fix = problemField(p);
      const pageAt = /^page\[(\d+)\]/.exec(p.where);
      const tabOnly = !loc && fix && fix.tab !== 'selection';
      const attrs =
        (loc
          ? ` data-prob-page="${loc.pageIndex}" data-prob-kind="${loc.kind}" data-prob-id="${esc(loc.id)}"`
          : tabOnly
            ? ` data-prob-tab="${fix.tab}"${pageAt ? ` data-prob-page="${pageAt[1]}"` : ''}`
            : '') +
        ((loc || tabOnly) && fix?.field
          ? ` data-prob-field="${esc(fix.field)}"`
          : '');
      return (
        `<div class="prob prob-${p.level}${isHidden ? ' prob-hidden' : ''}">` +
        `<button type="button" class="prob-go${loc || tabOnly ? ' locatable' : ''}"${attrs} data-i="${i}" title="${esc(`${p.message} — ${p.where}`)}">` +
        `<span class="prob-dot"></span>` +
        `<span class="prob-msg">${esc(text.message)}<span class="prob-where">${esc(text.where)}</span></span>` +
        `</button>` +
        `<button type="button" class="icon-btn prob-hide" data-hide="${i}" title="${isHidden ? 'Show this problem again' : 'Hide this problem (it stays in validation)'}" aria-label="${isHidden ? 'Show this problem again' : 'Hide this problem'}">${icon(isHidden ? 'eye' : 'eye-off')}</button>` +
        `</div>`
      );
    })
    .join('');
  const footer = hiddenCount
    ? `<div class="prob-foot"><span>${hiddenCount} hidden</span>` +
      `<button type="button" class="btn btn-sm btn-ghost prob-link" id="prob-show-hidden">${showHiddenProblems ? 'Hide them' : 'Show them'}</button>` +
      `<button type="button" class="btn btn-sm btn-ghost prob-link" id="prob-restore">Restore all</button></div>`
    : '';
  problemsPanel.innerHTML =
    (rows ||
      `<div class="hint prob-empty">${
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
        revealProblemField(b.dataset.probField);
      }),
    );
  // A problem about a page or the document shows that tab.
  problemsPanel
    .querySelectorAll<HTMLButtonElement>('.prob-go[data-prob-tab]')
    .forEach((b) =>
      b.addEventListener('click', () => {
        const page = Number(b.dataset.probPage);
        if (Number.isInteger(page) && page !== current) gotoPage(page);
        inspectorTabs.reveal(b.dataset.probTab as 'page' | 'document');
        revealProblemField(b.dataset.probField);
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
    ?.addEventListener('click', () => commands.run('problems.showHidden'));
  problemsPanel
    .querySelector('#prob-restore')
    ?.addEventListener('click', () => commands.run('problems.restoreAll'));

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
  commands.run('view.toggleProblems'),
);

statusReady = true;
renderProblems();

/* ── Bars over the canvas: Find and the path analysis bar ────────────────
 * Centred over the canvas, under its top edge (the top bar, and the shared
 * copy's banner when it shows), and never wider than the canvas: they never
 * cover the rail, the library or the properties panel. They follow the
 * canvas as the panels open and close. */
const canvasArea = app.querySelector<HTMLElement>('#canvas-area')!;
const overCanvasEls = new Set<HTMLElement>();
function placeOverCanvas(el: HTMLElement): void {
  const r = canvasArea.getBoundingClientRect();
  el.style.left = `${Math.round(r.left + r.width / 2)}px`;
  el.style.top = `${Math.round(r.top + 12)}px`;
  el.style.maxWidth = `${Math.max(160, Math.floor(r.width - 24))}px`;
}
function overCanvas(el: HTMLElement): void {
  overCanvasEls.add(el);
  placeOverCanvas(el);
}
new ResizeObserver(() => {
  for (const el of overCanvasEls)
    if (el.isConnected) placeOverCanvas(el);
    else overCanvasEls.delete(el);
}).observe(canvasArea);
window.addEventListener('resize', () => {
  for (const el of overCanvasEls) if (el.isConnected) placeOverCanvas(el);
});

/* Find / jump-to-element (Ctrl+F): nodes, links and zones on every frame
 * (see src/ui/find.ts for what matches). Choosing a match goes to its frame
 * and selects it. */
let findEl: HTMLDivElement | null = null;
let findMatches: FindMatch[] = [];
let findSel = 0;

function closeFind(): void {
  findEl?.remove();
  findEl = null;
}
function jumpFind(match: FindMatch): void {
  closeFind();
  if (match.pageIndex !== current) choosePage(match.pageIndex);
  editor.selectElement(match.kind, match.id, { center: true });
}
function renderFindResults(): void {
  const list = findEl?.querySelector<HTMLElement>('.find-results');
  if (!list) return;
  if (findMatches.length === 0) {
    list.innerHTML = `<div class="find-empty">Nothing matches</div>`;
    return;
  }
  list.innerHTML = findMatches
    .map((m, i) => {
      // A match on another frame says which.
      const where =
        m.pageIndex === current
          ? ''
          : ` · ${doc.pages[m.pageIndex]?.name ?? `Frame ${m.pageIndex + 1}`}`;
      return `<div class="find-item ${i === findSel ? 'on' : ''}" data-i="${i}"><span>${esc(m.label)}</span><span class="fi-type">${esc(m.detail + where)}</span></div>`;
    })
    .join('');
  list.querySelectorAll<HTMLElement>('.find-item').forEach((el) =>
    el.addEventListener('click', () => {
      const m = findMatches[Number(el.dataset.i)];
      if (m) jumpFind(m);
    }),
  );
}
function runFindQuery(q: string): void {
  findMatches = findInDocument(doc.pages, q, current);
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
    `<input type="text" class="field find-input" placeholder="Find a node, link or zone on any page…" aria-label="Find a node, link or zone on any page, by label, id, type or metadata" />` +
    `<div class="find-results scroll-slim"></div>`;
  app.appendChild(findEl);
  overCanvas(findEl);
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
      if (m) jumpFind(m);
    }
  });
  input.focus();
  runFindQuery('');
}

/* Inspector — properties of the selection, the page and the document, on
 * three tabs (src/ui/inspector/). */
const inspector = app.querySelector<HTMLElement>('#inspector')!;
/** Which sections of the panel are open, remembered per title. */
const inspectorSections = new SectionMemory(browserStorage());
const inspectorTabs = mountInspectorTabs(
  inspector,
  browserStorage(),
  renderInspector,
  // The tab row heads the column, above the panel's body (which is hidden
  // while the column is collapsed).
  app.querySelector<HTMLElement>('#inspector-body')!,
);
const inspectorContext: InspectorContext = {
  root: inspector,
  editor,
  doc,
  sections: inspectorSections,
  run: (id) => commands.run(id),
  rerender: renderInspector,
  markDirty,
  titleChanged: () => {
    docTitleEl.value = doc.title;
  },
  firstEdit: () => {
    const first = !editing;
    editing = true;
    return first;
  },
  showCurrentPage: () => showPage(doc.pages[current]!),
};

/* Collapse / restore the properties panel (mirrors the minimap toggle). */
const inspectorWrap = app.querySelector<HTMLDivElement>('#inspector-wrap')!;
const inspectorToggle =
  app.querySelector<HTMLButtonElement>('#inspector-toggle')!;
// The toggle is drawn at the end of the tab row: it follows the tab list in
// the markup as well, so keyboard focus meets the tabs first.
inspectorTabs.tabList.after(inspectorToggle);
function setInspectorCollapsed(collapsed: boolean, persist = true): void {
  inspectorWrap.classList.toggle('collapsed', collapsed);
  inspectorToggle.innerHTML = collapsed
    ? `<span class="toggle-word">Properties</span> ${icon('panel-right-open')}`
    : `<span class="toggle-word">Hide</span> ${icon('panel-right-close')}`;
  inspectorToggle.title = commands.titleWithShortcut(
    'view.toggleProperties',
    collapsed ? 'Show properties' : 'Hide properties',
  );
  // Its name says what it does, and holds the word it shows (Hide, or
  // Properties), so a speech user can say what they see.
  inspectorToggle.setAttribute(
    'aria-label',
    collapsed ? 'Show properties' : 'Hide properties',
  );
  // And it says whether the panel it shows and hides is open.
  inspectorToggle.setAttribute('aria-expanded', String(!collapsed));
  // The zoom control and the minimap move with the drawer at once, not a
  // frame later when the resize is observed.
  syncInspectorDrawerWidth();
  if (!persist) return;
  try {
    localStorage.setItem('tds-inspector-collapsed', collapsed ? '1' : '0');
  } catch {
    /* storage unavailable — fine, just don't persist */
  }
}
inspectorToggle.addEventListener('click', () =>
  commands.run('view.toggleProperties'),
);

function readCollapsedPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Open/close the node library and properties panel from stored prefs, or from
 * the default when the person has never chosen: below 1,024px the panels are
 * drawers and start closed, from 1,024px up they dock and start open (#221).
 * Inferred defaults are not written to storage, so crossing the breakpoint
 * can still flip them; an explicit B/P toggle persists and wins at every
 * width. Crossing the breakpoint only toggles the panels' classes, so the
 * selection, the panel's tab and its sections are untouched. A panel with a
 * field being typed in is not closed under it; a panel that closes while it
 * holds the focus hands the focus to its toggle, not to the page.
 */
function syncPanelLayoutFromPrefs(): void {
  const compact = isCompactLayoutWidth(window.innerWidth);
  // A field being typed in, not a button or a section heading with focus.
  const isField = (el: Element | null): boolean =>
    el instanceof HTMLElement &&
    (el.matches('input, textarea, select') || el.isContentEditable);
  // The resize that crossed the breakpoint may already have moved the focus
  // (the colour popover closes on a resize and gives it back to its button),
  // so what had it when the resize began counts too.
  const editing = (el: HTMLElement): boolean =>
    [document.activeElement, focusAtResize].some(
      (f) => isField(f) && el.contains(f),
    );
  const close = (
    el: HTMLElement,
    toggle: HTMLElement,
    shut: boolean,
    apply: () => void,
  ): void => {
    if (shut && editing(el)) return;
    const held = shut && el.contains(document.activeElement);
    apply();
    if (held && document.activeElement !== toggle)
      toggle.focus({ preventScroll: true });
  };
  const palettePref = readCollapsedPref('tds-palette-collapsed');
  const paletteShut = defaultPanelCollapsed(palettePref, compact);
  close(paletteEl, paletteToggle, paletteShut, () =>
    setPaletteCollapsed(paletteShut, palettePref !== null),
  );
  const inspectorPref = readCollapsedPref('tds-inspector-collapsed');
  const inspectorShut = defaultPanelCollapsed(inspectorPref, compact);
  close(inspectorWrap, inspectorToggle, inspectorShut, () =>
    setInspectorCollapsed(inspectorShut, inspectorPref !== null),
  );
  settleCrowdedDrawers();
}

/**
 * At load, or as the window narrows to a phone, with both drawers open (a
 * browser that stored both open on a wider window): the properties drawer
 * closes, so the library and some canvas show. As with opening a drawer,
 * that is not the person's choice, so neither stored choice changes.
 */
function settleCrowdedDrawers(): void {
  if (!drawersCrowdAtRest(window.innerWidth)) return;
  if (paletteEl.classList.contains('collapsed')) return;
  if (inspectorWrap.classList.contains('collapsed')) return;
  const held = inspectorWrap.contains(document.activeElement);
  setInspectorCollapsed(true, false);
  if (held) inspectorToggle.focus({ preventScroll: true });
}

/**
 * After a drawer opens: on a phone, or where the two open drawers would leave
 * under 160px of canvas between them, the other one closes. That is not the
 * person's choice, so its stored choice is left as it was.
 */
function makeRoomForDrawer(opened: 'palette' | 'inspector'): void {
  const other = opened === 'palette' ? inspectorWrap : paletteEl;
  if (paletteEl.classList.contains('collapsed')) return;
  if (inspectorWrap.classList.contains('collapsed')) return;
  const between =
    inspectorWrap.getBoundingClientRect().left -
    paletteEl.getBoundingClientRect().right;
  if (!drawersCrowd(window.innerWidth, between)) return;
  const toggle = other === paletteEl ? paletteToggle : inspectorToggle;
  const held = other.contains(document.activeElement);
  if (other === paletteEl) setPaletteCollapsed(true, false);
  else setInspectorCollapsed(true, false);
  if (held) toggle.focus({ preventScroll: true });
}

/** What had the focus as the latest resize began: a capture listener on the
 * window runs before the ones that react to the resize. */
let focusAtResize: Element | null = null;
window.addEventListener(
  'resize',
  () => {
    focusAtResize = document.activeElement;
  },
  { capture: true },
);

syncPanelLayoutFromPrefs();
window
  .matchMedia?.(COMPACT_LAYOUT_MQ)
  ?.addEventListener?.('change', syncPanelLayoutFromPrefs);
window
  .matchMedia?.(PHONE_LAYOUT_MQ)
  ?.addEventListener?.('change', settleCrowdedDrawers);

/* From 1,024px up the properties panel is a docked right column (full stage
 * height), so its annotations / zones list is never clipped or overlapped;
 * below it, a drawer over the canvas's right side. A left-edge grip resizes
 * its width (persisted) in both: the drawer is anchored to the window's right
 * edge, so it widens to the left as the docked column does. */
const inspectorResizer = app.querySelector<HTMLElement>('#inspector-resizer')!;
const INSPECTOR_W_KEY = 'tds-inspector-width';
// The default width (300px) is the stylesheet's; a stored width wins.
const INSPECTOR_W_MIN = 240;
const INSPECTOR_W_MAX = 480;

try {
  const w = Number(localStorage.getItem(INSPECTOR_W_KEY));
  // A width stored under the old limits is brought inside the new ones.
  if (w > 0)
    inspector.style.width = `${Math.min(INSPECTOR_W_MAX, Math.max(INSPECTOR_W_MIN, w))}px`;
} catch {
  /* storage unavailable — use the default width */
}

watchPanelWidth(inspector, inspectorWrap);

// Below 1,024px the drawers float over the canvas. The open properties
// drawer's width is kept on the stage as --insp-drawer-w, so the zoom control
// and the minimap card move left of it instead of being covered (shell.css);
// and the selection's mini bar moves into the canvas the drawers leave.
function syncInspectorDrawerWidth(): void {
  const open = !inspectorWrap.classList.contains('collapsed');
  app
    .querySelector<HTMLElement>('.stage')
    ?.style.setProperty(
      '--insp-drawer-w',
      `${open ? inspectorWrap.offsetWidth : 0}px`,
    );
}
{
  new ResizeObserver(() => {
    syncInspectorDrawerWidth();
    if (statusReady) updateMiniBar();
  }).observe(inspectorWrap);
  new ResizeObserver(() => {
    if (statusReady) updateMiniBar();
  }).observe(paletteEl);
}

// Left-edge drag-to-resize (dragging left widens the docked panel). A drawer
// below 1,024px can be narrower than the stored width (it leaves canvas
// showing beside it): the drag starts from the width drawn and stops where
// the drawer does, so the grip always moves the edge it shows, and the panel's
// own width never runs past what is drawn. Only a drag that changes the
// width stores it: a press on the grip, or a drag held at the drawer's limit,
// keeps the width the person chose, for the windows where it fits.
inspectorResizer.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const startX = e.clientX;
  const startW = inspector.offsetWidth;
  const startStyle = inspector.style.width;
  let w = startW;
  inspectorResizer.classList.add('active');
  inspectorResizer.setPointerCapture(e.pointerId);
  const onMove = (ev: PointerEvent): void => {
    const want = Math.min(
      INSPECTOR_W_MAX,
      Math.max(INSPECTOR_W_MIN, startW + (startX - ev.clientX)),
    );
    inspector.style.width = `${want}px`;
    // The drawer's limit: what it draws of the width asked for.
    w = Math.min(want, inspector.offsetWidth);
    if (w !== startW) inspector.style.width = `${w}px`;
    else inspector.style.width = startStyle;
  };
  const onUp = (): void => {
    inspectorResizer.classList.remove('active');
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    if (w === startW) return;
    try {
      localStorage.setItem(INSPECTOR_W_KEY, String(w));
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

function onSelectionChange(_count: number): void {
  if (statusReady) updateMiniBar();
  renderInspector();
  renderStatus();
}

/* ── Inspector ──────────────────────────────────────────────────── */
// One snapshot per edit "session": reset on each focus into the inspector.
let editing = false;
inspector.addEventListener('focusin', () => (editing = false));

/* ── Compass placement picker ───────────────────────────────────────
 * The 3×3 grid classic Topology Studio had for label placement. Cells are
 * compass codes; the centre cell is "auto" (clears the field). Enum fields
 * store the code itself (node labelPlacement); point fields (link
 * labelOffset) store the preset offset for that cell instead. */
const COMPASS_CELLS: readonly (readonly [code: string, icon: IconName])[] = [
  ['nw', 'arrow-up-left'],
  ['n', 'arrow-up'],
  ['ne', 'arrow-up-right'],
  ['w', 'arrow-left'],
  ['', 'dot'],
  ['e', 'arrow-right'],
  ['sw', 'arrow-down-left'],
  ['s', 'arrow-down'],
  ['se', 'arrow-down-right'],
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
    ([code, cellIcon]) =>
      `<button type="button" class="cc${code === cur ? ' on' : ''}" data-cval="${code}" title="${COMPASS_TITLES[code]}${code ? ' — click to place; double-click to nudge 1 unit' : ' — reset placement and fine tuning'}" aria-label="${COMPASS_TITLES[code]}" aria-pressed="${code === cur}">${icon(cellIcon)}</button>`,
  ).join('');
  return (
    `<div class="insp-row"><span>${f.label}</span><span class="compass-ctl">` +
    `<div class="compass" ${attr}="${f.key}" data-ckind="${f.kind}" role="group" aria-label="${f.label}" aria-describedby="label-placement-hint">${cells}</div>` +
    `<span class="insp-hint compass-hint" id="label-placement-hint">Click to place · double-click to nudge 1 unit.</span></span></div>`
  );
}

/**
 * A mark inside a field label (nested under its parent, drives motion): the
 * label's 11px text takes a smaller icon than a button does.
 */
function labelMark(name: IconName): string {
  return icon(name, { size: 12 });
}

/**
 * Row class for a field: labels too long for the label column stack above
 * their control instead of wrapping into three cramped lines.
 */
function rowClass(f: FieldSpec, nested = false): string {
  // A nested field's mark takes about two characters of the label column.
  const length = f.label.length + (nested ? 2 : 0);
  return length > 16 ? 'insp-row col' : 'insp-row';
}

/**
 * Row class for an on/off field: a long label takes the row's width with the
 * switch at its end, rather than stacking above a switch.
 */
function switchRowClass(f: FieldSpec, nested = false): string {
  const length = f.label.length + (nested ? 2 : 0);
  return length > 16 ? 'insp-row wide' : 'insp-row';
}

/**
 * A control for one catalog field, bound to the element's current value.
 * `nested` marks a sub-field of an object field, shown under its parent.
 */
function fieldControl(
  f: FieldSpec,
  cfg: Record<string, unknown>,
  nested = false,
): string {
  const v = cfg[f.key];
  if (f.widget === 'compass') return compassControl(f, v, 'data-key');
  const row = rowClass(f, nested);
  const label = nested ? `${labelMark('nested')} ${f.label}` : f.label;
  switch (f.kind) {
    case 'boolean':
      return `<label class="${switchRowClass(f, nested)}"><span>${label}${f.animation ? ` ${labelMark('motion')}` : ''}</span><input type="checkbox" data-key="${f.key}" ${v ? 'checked' : ''}/></label>`;
    case 'enum':
      return `<label class="${row}"><span>${label}</span><select data-key="${f.key}">${(
        f.options ?? []
      )
        .map(
          (o) =>
            `<option value="${o}" ${String(v ?? '') === o ? 'selected' : ''}>${esc(f.optionLabels?.[o] ?? o)}</option>`,
        )
        .join('')}</select></label>`;
    case 'color':
      return colourRowHtml(
        { attr: 'data-key', key: f.key, label: f.label },
        v as string | undefined,
        label,
      );
    case 'number':
      return `<label class="${row}"><span>${label}</span><input type="number" data-key="${f.key}" data-kind="number" value="${esc(String(v ?? ''))}" placeholder="auto"${boundsAttrs(numberBounds(f))}/></label>`;
    case 'object': {
      // An enable switch on the field itself (checked = the object present,
      // at its defaults), then its nested fields as dotted keys
      // ("linkAttach.pad") that fieldPatch merges back into the object.
      const on = typeof v === 'object' && v !== null;
      const sub = on ? (v as Record<string, unknown>) : {};
      let html = `<label class="${switchRowClass(f, nested)}"><span>${label}</span><input type="checkbox" data-key="${f.key}" data-kind="object" ${on ? 'checked' : ''}/></label>`;
      if (on)
        for (const s of f.fields ?? []) {
          const key = `${f.key}.${s.key}`;
          html += fieldControl({ ...s, key }, { [key]: sub[s.key] }, true);
        }
      return html;
    }
    case 'point':
    case 'points':
      return `<div class="insp-row"><span>${label}</span><span class="insp-val">${Array.isArray(v) ? v.length : 0} pt</span></div>`;
    case 'record':
      return ''; // rendered by the dedicated metadata editor
    default:
      // Long-form strings (callout / text `body`) get a stacked textarea so
      // newlines survive; wireFields treats it like any other text control.
      if (f.multiline)
        return `<label class="insp-row col"><span>${label}</span><textarea data-key="${f.key}" rows="4"${f.max ? ` maxlength="${f.max}"` : ''} spellcheck="true">${esc(String(v ?? ''))}</textarea></label>`;
      return `<label class="${row}"><span>${label}</span><input data-key="${f.key}" value="${esc(String(v ?? ''))}"/></label>`;
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
        `<input class="meta-k" value="${esc(k)}" readonly aria-label="Metadata key ${esc(k)}" />` +
        `<input class="meta-v" value="${esc(String(v))}" aria-label="Metadata value of ${esc(k)}" />` +
        `<button type="button" class="icon-btn meta-x" title="Remove" aria-label="Remove metadata ${esc(k)}">${icon('x')}</button></div>`,
    )
    .join('');
  return (
    `<div class="insp-sublabel">Metadata</div>` +
    rows +
    `<div class="meta-row meta-add">` +
    `<input class="meta-nk" placeholder="key" aria-label="New metadata key" />` +
    `<input class="meta-nv" placeholder="value" aria-label="New metadata value" />` +
    `<button type="button" class="icon-btn meta-addbtn" title="Add" aria-label="Add metadata entry">${icon('plus')}</button></div>`
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

/** The Type dropdown of the selection header: types by their library label,
 * under the library's category headings (see typeOptionGroups). */
function typeSelect(current: string, choices: readonly TypeChoice[]): string {
  const option = (o: TypeOption): string =>
    `<option value="${esc(o.value)}"${o.selected ? ' selected' : ''}>${esc(o.label)}</option>`;
  const body = typeOptionGroups(current, choices)
    .map((g) =>
      g.group === null
        ? g.options.map(option).join('')
        : `<optgroup label="${esc(g.group)}">${g.options.map(option).join('')}</optgroup>`,
    )
    .join('');
  return `<select id="i-type" aria-label="Type" title="Type">${body}</select>`;
}

/**
 * Render an element's catalog fields in the sections NODE_GROUPS /
 * LINK_GROUPS lay out (src/ui/inspector/field-groups.ts). `control` draws one
 * field (by default its catalog control); `extras` adds rows at the end of a
 * section, by title.
 */
function groupedFieldsHtml(
  info: NodeTypeInfo | LinkTypeInfo | undefined,
  cfg: Record<string, unknown>,
  groups: readonly FieldGroup[],
  control: (f: FieldSpec) => string = (f) => fieldControl(f, cfg),
  extras: Readonly<Record<string, string>> = {},
): string {
  const item = (it: PlannedItem): string => {
    if (it.kind === 'field') return control(it.field);
    if (it.kind === 'pair')
      return pairControl(it.label, it.fields, cfg, it.placeholders, it);
    return sectionHtml(
      inspectorSections,
      it.title,
      it.items.map(item).join(''),
      {
        open: false,
      },
    );
  };
  return planSections(info?.fields ?? [], groups, info?.label ?? 'Type')
    .map((s) =>
      sectionHtml(
        inspectorSections,
        s.title,
        s.items.map(item).join('') + (extras[s.title] ?? ''),
        {
          open: s.open,
          // How many values are set; no count while none is.
          count:
            s.title === 'Data'
              ? setValueCount(s.fields, cfg) || undefined
              : undefined,
        },
      ),
    )
    .join('');
}

/**
 * Two fields in one row ("Position: X Y", "Sides: from to"), each its own
 * control, named by its own label.
 */
function pairControl(
  label: string,
  fields: readonly [FieldSpec, FieldSpec],
  cfg: Record<string, unknown>,
  placeholders?: readonly [string, string],
  look: {
    stack?: boolean;
    shortOptions?: Readonly<Record<string, string>>;
  } = {},
): string {
  const input = (f: FieldSpec, i: number): string => {
    const v = cfg[f.key];
    const hint = esc(
      placeholders?.[i] || (f.kind === 'number' ? 'auto' : f.label),
    );
    const name = `aria-label="${esc(f.label)}" title="${esc(f.label)}"`;
    if (f.kind === 'enum')
      return `<select data-key="${f.key}" ${name}>${(f.options ?? [])
        .map((o) =>
          look.shortOptions?.[o] !== undefined
            ? `<option value="${o}" ${String(v ?? '') === o ? 'selected' : ''} title="${esc(f.optionLabels?.[o] ?? o)}">${esc(look.shortOptions[o])}</option>`
            : `<option value="${o}" ${String(v ?? '') === o ? 'selected' : ''}>${esc(f.optionLabels?.[o] ?? o)}</option>`,
        )
        .join('')}</select>`;
    if (f.kind === 'number')
      return `<input type="number" data-key="${f.key}" data-kind="number" value="${esc(String(v ?? ''))}" placeholder="${hint}" ${name}${boundsAttrs(numberBounds(f))}/>`;
    return `<input data-key="${f.key}" value="${esc(String(v ?? ''))}" placeholder="${hint}" ${name}/>`;
  };
  return (
    `<div class="insp-row${look.stack ? ' col' : ''}"><span>${esc(label)}</span>` +
    `<span class="insp-pair">${input(fields[0], 0)}${input(fields[1], 1)}</span></div>`
  );
}

/** How many of these fields hold a value (metadata counts each entry). */
function setValueCount(
  fields: readonly FieldSpec[],
  cfg: Record<string, unknown>,
): number {
  let n = 0;
  for (const f of fields) {
    const v = cfg[f.key];
    if (f.key === 'meta' && v && typeof v === 'object')
      n += Object.keys(v).length;
    else if (v !== undefined && v !== null && v !== '' && v !== false) n += 1;
  }
  return n;
}

/**
 * A node's catalog field in the Selection tab: the metadata editor, the
 * read-only source reference, and the Link attachment override have their
 * own controls; every other field its catalog control.
 */
function nodeFieldControl(node: NodeConfig): (f: FieldSpec) => string {
  const cfg = node as Record<string, unknown>;
  return (f) => {
    if (f.key === 'meta') return metaHtml(node.meta);
    if (f.key === 'source') return readOnlyFieldRow(f, cfg.source);
    if (f.key === 'linkAttach') return linkAttachControl(f, node);
    return fieldControl(f, cfg);
  };
}

/**
 * A link's catalog field: the source reference is shown, not edited, and the
 * bends count carries the Straighten button while there are bends.
 */
function linkFieldControl(link: LinkConfig): (f: FieldSpec) => string {
  const cfg = link as Record<string, unknown>;
  return (f) => {
    if (f.key === 'source') return readOnlyFieldRow(f, cfg.source);
    if (f.key === 'waypoints') {
      const n = Array.isArray(cfg.waypoints) ? cfg.waypoints.length : 0;
      const straighten = editor.selectedLinkHasBends()
        ? `<button type="button" class="btn btn-sm" id="i-straighten" title="Clear bends — straight line">${icon('slash')} Straighten</button>`
        : '';
      return `<div class="insp-row"><span>${esc(f.label)}</span><span class="insp-btns"><span class="insp-val data">${n} pt</span>${straighten}</span></div>`;
    }
    return fieldControl(f, cfg);
  };
}

/**
 * Link attachment of one node: what applies now, then the override switch
 * (the node carries its own `linkAttach`) and, while on, its two fields.
 * The switch and the fields are the catalog's `linkAttach` object field, so
 * they write the document exactly as that field always did.
 */
function linkAttachControl(f: FieldSpec, node: NodeConfig): string {
  // The switch alone; its two fields share one row under it, so the
  // section is no taller than a row more with the override on.
  const override: FieldSpec = {
    ...f,
    label: 'Override for this node',
    fields: [],
  };
  let html =
    `<div class="insp-hint" data-link-attach-summary>${esc(linkAttachSummary(editor.page.linkAttach, node))}</div>` +
    fieldControl(override, node as Record<string, unknown>);
  const own = node.linkAttach;
  const pad = f.fields?.find((s) => s.key === 'pad');
  const distribute = f.fields?.find((s) => s.key === 'distribute');
  if (typeof own === 'object' && own !== null && pad && distribute) {
    const v = own as Record<string, unknown>;
    html +=
      `<div class="insp-row insp-attach-sub"><span>${labelMark('nested')} ${esc(pad.label)}</span>` +
      `<span class="insp-attach-pair">` +
      `<input type="number" data-key="${f.key}.pad" data-kind="number" value="${esc(String(v.pad ?? ''))}" placeholder="auto" aria-label="${esc(pad.label)}"${boundsAttrs(numberBounds(pad))}/>` +
      `<label class="insp-attach-dist"><span>Distribute ends</span><input type="checkbox" data-key="${f.key}.distribute" ${v.distribute ? 'checked' : ''}/></label>` +
      `</span></div>`;
  }
  return html;
}

/** Keep the Link attachment line in step while its fields are typed in. */
function refreshLinkAttachSummary(): void {
  const line = inspector.querySelector<HTMLElement>(
    '[data-link-attach-summary]',
  );
  const node = editor.getSelectedNode();
  if (line && node)
    line.textContent = linkAttachSummary(editor.page.linkAttach, node);
}

/** The command behind each "Annotate" button of the Selection tab. */
const ANNOTATE_COMMANDS: Readonly<Record<string, CommandId>> = {
  zone: 'selection.groupIntoZone',
  flowPath: 'selection.addFlow',
  policyMarker: 'selection.addPolicyMarker',
};

/**
 * Annotate: make a zone, flow path or marker from what is selected. `bare`
 * draws the buttons as a group of their own across the panel's width (a
 * node's last row), without the plus marks (`plus` puts them back), so the
 * two fit on one line.
 */
function annotateRow(
  kinds: readonly AnnotationKind[],
  bare = false,
  plus = !bare,
): string {
  const buttons = kinds
    .map((kind) => {
      const id = ANNOTATE_COMMANDS[kind]!;
      return `<button type="button" class="btn btn-sm" data-annotate="${kind}" title="${tip(id)}">${plus ? `${icon('plus')} ` : ''}${esc(commands.get(id)!.title)}</button>`;
    })
    .join('');
  return bare
    ? `<div class="insp-btns" role="group" aria-label="Annotate">${buttons}</div>`
    : `<div class="insp-row"><span>Annotate</span><span class="insp-btns">${buttons}</span></div>`;
}

/** Align and distribute, for two or more nodes (distribute needs three). */
function alignRows(count: number): string {
  const button = (prefix: string, attr: string, arg: string): string => {
    const spec = commandVariant(prefix, arg, ALL_COMMAND_SPECS)!;
    const off = attr === 'dist' && count < 3 ? ' disabled' : '';
    return `<button type="button" class="icon-btn" data-${attr}="${arg}" title="${tip(spec.id)}" aria-label="${esc(spec.title)}"${off}>${spec.icon ? icon(spec.icon) : ''}</button>`;
  };
  const row = (label: string, prefix: string, attr: string): string =>
    `<div class="insp-row"><span>${label}</span><span class="arrange">` +
    variantArgs(prefix, ALL_COMMAND_SPECS)
      .map((arg) => button(prefix, attr, arg))
      .join('') +
    `</span></div>`;
  return (
    row('Align', 'arrange.align', 'align') +
    row('Distribute', 'arrange.distribute', 'dist') +
    (count < 3
      ? `<div class="insp-hint">Select three or more nodes to distribute.</div>`
      : '')
  );
}

function wireSelectionActions(): void {
  inspector
    .querySelectorAll<HTMLButtonElement>('[data-annotate]')
    .forEach((b) =>
      b.addEventListener('click', () => {
        const id = ANNOTATE_COMMANDS[b.dataset.annotate ?? ''];
        if (!id) throw new Error(`no command for "${b.dataset.annotate}"`);
        commands.run(id);
      }),
    );
  inspector
    .querySelectorAll<HTMLButtonElement>('[data-align]')
    .forEach((b) =>
      b.addEventListener('click', () =>
        runVariant('arrange.align', b.dataset.align),
      ),
    );
  inspector
    .querySelectorAll<HTMLButtonElement>('[data-dist]')
    .forEach((b) =>
      b.addEventListener('click', () =>
        runVariant('arrange.distribute', b.dataset.dist),
      ),
    );
}

/**
 * What is selected, as one string that changes when the selection does (the
 * Selection tab comes forward then), or null when nothing is.
 */
function inspectorSelection(): {
  key: string | null;
  counts: SelectionCounts;
} {
  const nodes = editor.selectedNodeIds();
  const links = editor.selectedLinkIds();
  const anchor = editor.getSelectedAnchor()?.id ?? '';
  const zone = editor.getSelectedZone()?.id ?? '';
  const count = editor.selectionCount();
  const counts: SelectionCounts = {
    nodes: nodes.length,
    links: links.length,
    anchors: Math.max(anchor ? 1 : 0, count - nodes.length - links.length),
    zones: zone ? 1 : 0,
  };
  const none = !nodes.length && !links.length && !anchor && !zone && !count;
  return {
    key: none
      ? null
      : JSON.stringify([editor.page.id, nodes, links, anchor, zone, count]),
    counts,
  };
}

/** Render the inspector for the current selection, driven entirely by the catalog. */
function renderInspector(): void {
  const link = editor.getSelectedLink();
  const node = link ? null : editor.getSelectedNode();
  const anchor = link || node ? null : editor.getSelectedAnchor();
  const zone = link || node || anchor ? null : editor.getSelectedZone();
  inspector.hidden = false;
  const selection = inspectorSelection();
  const tab = inspectorTabs.sync(selection.key, selection.counts);

  let html = '';
  if (tab === 'page') {
    const page = editor.page;
    html = pageTabHtml(inspectorContext, {
      html: annotationsHtml(),
      count:
        page.zones.length + page.flowPaths.length + page.policyMarkers.length,
    });
  } else if (tab === 'document') {
    html = documentTabHtml(inspectorContext);
  } else if (node) {
    const info = getNodeType(node.type, doc.customNodes);
    html +=
      headerHtml({
        kind: 'node',
        kindLabel: 'Node',
        title: String(node.label ?? '').trim() || node.id,
        id: node.id,
        typeSelect: typeSelect(node.type, nodeCatalog(doc.customNodes)),
        locked: editor.selectionLocked(),
      }) +
      groupedFieldsHtml(
        info,
        node as Record<string, unknown>,
        NODE_GROUPS,
        nodeFieldControl(node),
        { 'Position and order': arrangeRow() },
      ) +
      // Copy and paste format are in the header's "more" menu.
      `<div class="insp-rows insp-foot">` +
      annotateRow(['zone', 'policyMarker'], true) +
      `</div>`;
  } else if (link) {
    const info = getLinkType(link.type);
    const linkCount = editor.selectedLinkIds().length;
    html +=
      headerHtml({
        kind: 'link',
        kindLabel: 'Link',
        title: `${endpointLabel(link.from)} → ${endpointLabel(link.to)}`,
        id: link.id,
        typeSelect: typeSelect(link.type, linkCatalog()),
        locked: editor.selectionLocked(),
      }) +
      `<div class="insp-rows insp-top">` +
      (linkCount > 1
        ? `<div class="insp-hint">${linkCount} links selected. Type, colour, style and layer changes apply to all; everything else edits this one.</div>`
        : '') +
      `<div class="insp-ends">` +
      endpointSelect('from', link.from, link.to) +
      `<button type="button" class="icon-btn" id="i-swap" title="Swap from/to" aria-label="Swap from and to">${icon('reverse')}</button>` +
      endpointSelect('to', link.to, link.from) +
      `</div></div>` +
      groupedFieldsHtml(
        info,
        link as Record<string, unknown>,
        LINK_GROUPS,
        linkFieldControl(link),
      );
  } else if (anchor) {
    html +=
      headerHtml({ kind: 'anchor', kindLabel: 'Anchor', title: anchor.id }) +
      `<div class="insp-rows insp-top">` +
      `<div class="insp-row"><span>Position</span><span class="insp-pair">` +
      `<input type="number" id="a-x" value="${anchor.x}" aria-label="Anchor x" title="X"/>` +
      `<input type="number" id="a-y" value="${anchor.y}" aria-label="Anchor y" title="Y"/></span></div>` +
      `<div class="insp-row"><span>Links</span><span class="insp-val data">${editor.anchorLinkCount(anchor.id)}</span></div>` +
      `<div class="insp-row"><span>Anchor</span><span class="insp-btns"><button type="button" class="btn btn-sm btn-danger" id="a-del" title="Delete anchor" aria-label="Delete anchor">${icon('delete')} Delete</button></span></div></div>`;
  } else if (zone) {
    // A zone region was clicked on canvas — edit it directly (the same control
    // surface as the annotations list, wired by wireAnnotations()).
    const label = String((zone as { label?: unknown }).label ?? '').trim();
    html +=
      headerHtml({
        kind: 'zone',
        kindLabel: 'Zone',
        title: label || zone.id,
        id: zone.id,
      }) + zoneEditorHtml(zone);
  } else {
    // Several nodes: no single-element editor, but arranging, annotating and
    // the format painter apply to all of them (pasteFormat brushes every
    // selected node — #211).
    const count = editor.selectionCount();
    const names = editor.selectedNodeIds().map(endpointLabel);
    html +=
      headerHtml({
        kind: 'nodes',
        kindLabel: `Selection (${count} nodes)`,
        title:
          names.slice(0, 3).join(', ') +
          (names.length > 3 ? ` and ${names.length - 3} more` : ''),
        locked: editor.selectionLocked(),
      }) +
      sectionHtml(inspectorSections, 'Arrange', alignRows(count), {
        open: true,
      }) +
      sectionHtml(
        inspectorSections,
        'Annotate',
        // Across the panel: the section's title is the row's label.
        annotateRow(['zone', 'flowPath'], true, true),
        { open: true },
      ) +
      sectionHtml(inspectorSections, 'Format', formatRow(), { open: true }) +
      (canAnalyzePath()
        ? `<div class="insp-rows insp-top"><div class="insp-row"><span>Path</span><span class="insp-btns"><button type="button" class="btn btn-sm" id="i-path" title="Trace the routes between these two nodes over the links this page draws">${icon('route')} Analyze path</button></span></div></div>`
        : '');
  }
  closeColourPopover();
  const focusMark = markFocus(inspector);
  if (tab !== 'page') leavePageTab();
  inspector.innerHTML = html;
  adoptSharedControls(inspector);

  if (tab === 'page') {
    wirePageTab(inspectorContext);
  } else if (tab === 'document') {
    wireDocumentTab(inspectorContext);
  } else if (node) {
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
        else if (key.startsWith('linkAttach.')) refreshLinkAttachSummary();
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
      commands.run('link.swapEndpoints');
      renderInspector();
    });
    inspector.querySelector('#i-straighten')?.addEventListener('click', () => {
      commands.run('link.straighten');
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
      commands.run('edit.delete');
      renderInspector();
    });
  }
  for (const [z, command] of Z_ORDER_COMMANDS)
    inspector
      .querySelector(`[data-z="${z}"]`)
      ?.addEventListener('click', () => {
        commands.run(command);
        renderInspector();
      });
  wireFormatRow();
  wireSelectionActions();
  wireSelectionHeader(inspector, commands, renderInspector);
  wireSections(inspector, inspectorSections);
  wireAnnotations();
  wireColourControls(inspector);
  restoreFocus(inspector, focusMark, () =>
    document.querySelector<HTMLElement>(
      '#inspector-wrap [role="tab"][aria-selected="true"]',
    ),
  );
}

/** The Selection tab's header, with the shell's command registry. */
function headerHtml(h: SelectionHeader): string {
  return selectionHeaderHtml(h, commands);
}

/**
 * A link endpoint picker (the two sit side by side under the header, with
 * Swap between them): every node (by label) and anchor on the page, except
 * the link's other end (a link can't loop back onto one element). Changing it
 * re-attaches that end — the inspector twin of dragging the end handle.
 */
function endpointSelect(
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
    opts += `<optgroup label="Anchors">${anchors.map((a) => opt(a.id, a.id)).join('')}</optgroup>`;
  // A dangling reference still shows (and stays selected) so it can be fixed.
  if (
    !p.nodes.some((n) => n.id === current) &&
    !p.anchors.some((a) => a.id === current)
  )
    opts = opt(current, `${current} (missing)`) + opts;
  return `<select id="i-${end}" aria-label="Link ${end} endpoint" title="Re-attach the ${end} end (or drag its handle on the canvas)">${opts}</select>`;
}

/** The z-order command behind each button of the Arrange row. */
const Z_ORDER_COMMANDS = [
  ['back', 'arrange.sendToBack'],
  ['backward', 'arrange.sendBackward'],
  ['forward', 'arrange.bringForward'],
  ['front', 'arrange.bringToFront'],
] as const;

/** Z-order ("Arrange") controls — shown for a single node or a link. */
function arrangeRow(): string {
  return (
    `<div class="insp-row"><span>Arrange</span><span class="arrange">` +
    `<button type="button" class="icon-btn" data-z="back" title="${tip('arrange.sendToBack')}" aria-label="Send to back">${icon('send-to-back')}</button>` +
    `<button type="button" class="icon-btn" data-z="backward" title="${tip('arrange.sendBackward')}" aria-label="Send backward">${icon('arrow-down')}</button>` +
    `<button type="button" class="icon-btn" data-z="forward" title="${tip('arrange.bringForward')}" aria-label="Bring forward">${icon('arrow-up')}</button>` +
    `<button type="button" class="icon-btn" data-z="front" title="${tip('arrange.bringToFront')}" aria-label="Bring to front">${icon('bring-to-front')}</button>` +
    `</span></div>`
  );
}

/** Format painter (issue #211): a touch/keyboard surface onto the same
 * `copyFormat`/`pasteFormat` commands as the context menu + shortcuts. */
function formatRow(): string {
  const buttons =
    `<button type="button" class="btn btn-sm" id="i-copyfmt" title="${tip('edit.copyFormat')}" aria-label="Copy format"${editor.canCopyFormat() ? '' : ' disabled'}>${icon('copy-format')} Copy</button>` +
    `<button type="button" class="btn btn-sm" id="i-pastefmt" title="${tip('edit.pasteFormat')}" aria-label="Paste format"${editor.canPasteFormat() ? '' : ' disabled'}>${icon('paste-format')} Paste</button>`;
  // Across the panel: the Format section's title is the row's label.
  return `<div class="insp-btns" role="group" aria-label="Format">${buttons}</div>`;
}

function wireFormatRow(): void {
  inspector
    .querySelector('#i-path')
    ?.addEventListener('click', () => commands.run('selection.analyzePath'));
  // Both redraw the inspector themselves: after a copy, paste is available.
  inspector
    .querySelector('#i-copyfmt')
    ?.addEventListener('click', () => commands.run('edit.copyFormat'));
  inspector
    .querySelector('#i-pastefmt')
    ?.addEventListener('click', () => commands.run('edit.pasteFormat'));
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

/* ── Annotations (zones / flow paths / policy markers) ──────────────
 * A page-level layer, edited from the same inspector. "Add" seeds the new
 * element from the current node selection (members / waypoints / target). */
const ANNO_GROUPS: { kind: AnnotationKind; col: AnnoCol }[] = [
  { kind: 'zone', col: 'zones' },
  { kind: 'flowPath', col: 'flowPaths' },
  { kind: 'policyMarker', col: 'policyMarkers' },
];
type AnnoCol = 'zones' | 'flowPaths' | 'policyMarkers';

/** Whether a waypoint/member ref points at a free-floating anchor. */
function isAnchorRef(id: string): boolean {
  return editor.page.anchors.some((a) => a.id === id);
}

/**
 * Human label for a waypoint/member ref, as plain text for accessible names:
 * the node's label, "anchor <id>", or the raw id.
 */
function endpointLabel(id: string): string {
  const n = editor.page.nodes.find((m) => m.id === id);
  if (n) {
    const label = (n as { label?: unknown }).label;
    return typeof label === 'string' && label ? label : n.id;
  }
  if (isAnchorRef(id)) return `anchor ${id}`;
  return id; // dangling ref — surface the id so it can be fixed
}

/** One removable, reorderable chip in a refs editor. */
function refChip(id: string): string {
  const name = esc(endpointLabel(id));
  // An anchor shows its icon and id; its accessible names spell it out. The
  // icon is 14px, the height of the label's line, which clips its overflow.
  const shown = isAnchorRef(id)
    ? `${icon('anchor', { size: 14 })} ${esc(id)}`
    : name;
  return (
    `<span class="refchip" data-id="${esc(id)}">` +
    `<button type="button" class="refmv" data-refmove="-1" title="Move earlier" aria-label="Move ${name} earlier">${icon('arrow-left')}</button>` +
    `<span class="reflbl">${shown}</span>` +
    `<button type="button" class="refmv" data-refmove="1" title="Move later" aria-label="Move ${name} later">${icon('arrow-right')}</button>` +
    `<button type="button" class="refx" data-refdel title="Remove" aria-label="Remove ${name}">${icon('x')}</button>` +
    `</span>`
  );
}

/** "add…" picker options: every node (by label), then the anchors as a group. */
function refAddOptions(): string {
  const nodes = editor.page.nodes
    .map((n) => {
      const label = (n as { label?: unknown }).label;
      const text = typeof label === 'string' && label ? label : n.id;
      return `<option value="${esc(n.id)}">${esc(text)}</option>`;
    })
    .join('');
  const anchors = editor.page.anchors
    .map((a) => `<option value="${esc(a.id)}">${esc(a.id)}</option>`)
    .join('');
  return (
    `<option value="">add…</option>${nodes}` +
    (anchors ? `<optgroup label="Anchors">${anchors}</optgroup>` : '')
  );
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
      return `<label class="${switchRowClass(f)}"><span>${f.label}${f.animation ? ` ${labelMark('motion')}` : ''}</span><input type="checkbox" data-akey="${f.key}" ${booleanFieldChecked(f.key, v) ? 'checked' : ''}/></label>`;
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
      return colourRowHtml(
        { attr: 'data-akey', key: f.key, label: f.label },
        v as string | undefined,
      );
    case 'number':
      return `<label class="insp-row"><span>${f.label}</span><input type="number" data-akey="${f.key}" data-akind="number" value="${esc(String(v ?? ''))}" placeholder="auto"${boundsAttrs(numberBounds(f))}/></label>`;
    case 'refs': {
      const ids = Array.isArray(v) ? (v as string[]) : [];
      const hint =
        f.key === 'waypoints'
          ? `<div class="refhint">Order is the route. Add nodes below or select them in order, then “+ flow”. Reorder with the arrows.</div>`
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
    case 'record':
      return readOnlyFieldRow(f, v);
    default:
      // A text field whose stored value is an object is shown, not edited:
      // a text box would read "[object Object]" and overwrite it when typed in.
      if (typeof v === 'object' && v !== null) return readOnlyFieldRow(f, v);
      return `<label class="${rowClass(f)}"><span>${f.label}</span><input data-akey="${f.key}" value="${esc(String(v ?? ''))}"/></label>`;
  }
}

/**
 * A field that holds an object (an element's `source` reference, set by the
 * import it came from): its value is displayed, with nothing to type into.
 * No row at all while the field is unset.
 */
function readOnlyFieldRow(f: FieldSpec, v: unknown): string {
  const text = recordFieldText(v);
  if (text === null) return '';
  return (
    `<div class="${rowClass(f)}"><span>${f.label}</span>` +
    `<span class="insp-val" data-asource title="Set by the import this element came from; not editable here">${esc(text)}</span></div>`
  );
}

/**
 * The editor for a single selected zone (reuses annotation wiring). The
 * Selection tab's header already names the zone, so its rows sit straight
 * on the panel's grid, without the list's card and title row; the card's
 * actions come first.
 */
function zoneEditorHtml(zone: { id: string }): string {
  const info = getAnnotationType('zone')!;
  const cfg = zone as Record<string, unknown>;
  return (
    `<div class="insp-rows insp-top anno-solo" data-acol="zones" data-aid="${esc(zone.id)}">` +
    `<div class="insp-row"><span>Zone</span><span class="arrange">` +
    `<button type="button" class="icon-btn" data-azmove title="Select members (then drag to move the zone)" aria-label="Select zone members">${icon('select-members')}</button>` +
    `<button type="button" class="icon-btn" data-azdup title="Duplicate zone with its contents" aria-label="Duplicate zone with its contents">${icon('duplicate')}</button>` +
    `<button type="button" class="icon-btn" data-adel title="Delete" aria-label="Delete zone">${icon('delete')}</button></span></div>` +
    info.fields.map((f) => annoFieldControl(f, cfg)).join('') +
    `</div>`
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

function annotationsHtml(): string {
  const page = editor.page;
  const counts =
    page.zones.length + page.flowPaths.length + page.policyMarkers.length;
  // Each plus is an icon, which a screen reader skips: the names say "Add".
  let html =
    `<div class="anno-add">` +
    `<button type="button" class="btn btn-sm" data-add="zone" title="Group selected nodes into a zone" aria-label="Add zone">${icon('plus')} zone</button>` +
    `<button type="button" class="btn btn-sm" data-add="flowPath" title="Route a flow path through selected nodes" aria-label="Add flow path">${icon('plus')} flow</button>` +
    `<button type="button" class="btn btn-sm" data-add="policyMarker" title="Badge the selected node" aria-label="Add marker">${icon('plus')} marker</button>` +
    `</div>`;
  if (counts === 0)
    html += `<div class="insp-hint anno-empty">Select node(s), then add a zone, flow path, or marker.</div>`;
  // Group by type into collapsible sections with counts, so a frame with many
  // zones/flows/markers stays scannable instead of one long flat list.
  for (const g of ANNO_GROUPS) {
    const info = getAnnotationType(g.kind)!;
    const items = page[g.col] as { id: string }[];
    if (!items.length) continue;
    html +=
      `<details class="anno-group"${annoGroupClosed.has(g.col) ? '' : ' open'} data-agroup="${g.col}">` +
      `<summary class="anno-group-h">${esc(info.label)}s<span class="badge data anno-count">${items.length}</span></summary>`;
    for (const item of items) {
      const cfg = item as Record<string, unknown>;
      const title = String(cfg.label ?? cfg.type ?? item.id);
      // Zones are containers (C.2): offer move-members + duplicate-with-contents.
      const zoneBtns =
        g.col === 'zones'
          ? `<button type="button" class="icon-btn anno-x" data-azmove title="Select members (then drag to move the zone)" aria-label="Select zone members">${icon('select-members')}</button>` +
            `<button type="button" class="icon-btn anno-x" data-azdup title="Duplicate zone with its contents" aria-label="Duplicate zone with its contents">${icon('duplicate')}</button>`
          : '';
      html +=
        // Named for its annotation, so its controls (several "Label" fields
        // on one tab) are told apart by the group they are in.
        `<details class="anno" data-acol="${g.col}" data-aid="${esc(item.id)}" aria-label="${esc(info.label)} ${esc(title)}"${annoOpen.has(annoKey(g.col, item.id)) ? ' open' : ''}>` +
        `<summary><span class="badge anno-k">${info.label}</span><span class="anno-t">${esc(title)}</span>${zoneBtns}<button type="button" class="icon-btn anno-x" data-adel title="Delete" aria-label="Delete ${esc(info.label)} ${esc(title)}">${icon('delete')}</button></summary>` +
        // The rows in their own column, so they keep the panel's row gap
        // (a gap set on a <details> does not reach its content).
        `<div class="insp-rows anno-rows">` +
        info.fields.map((f) => annoFieldControl(f, cfg)).join('') +
        `</div></details>`;
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

/** The command behind each "add" button of the Annotations section. */
const ADD_ANNOTATION: Readonly<Record<AnnotationKind, CommandId>> = {
  zone: 'selection.groupIntoZone',
  flowPath: 'selection.addFlow',
  policyMarker: 'selection.addPolicyMarker',
};

function wireAnnotations(): void {
  inspector.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((b) =>
    b.addEventListener('click', () => {
      const kind = b.dataset.add;
      if (!kind || !Object.hasOwn(ADD_ANNOTATION, kind))
        throw new Error(`no "add" command for "${kind}"`);
      commands.run(ADD_ANNOTATION[kind as AnnotationKind]);
    }),
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
    .querySelectorAll<HTMLElement>('details.anno, .anno-solo')
    .forEach((host) => {
      const col = host.dataset.acol as AnnoCol;
      const id = host.dataset.aid!;
      // The editor of a zone clicked on the canvas has no card to open and
      // is not part of the list; only the list's editors are remembered.
      if (host instanceof HTMLDetailsElement)
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
      // with the arrows, remove with the x — all by chip position so duplicates
      // behave.
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
function upsertCustomNode(designed: CustomNodeSpec): void {
  // Stored as the parse gate would keep it, like every other way in.
  const spec = sanitizeCustomNode(designed);
  if (!spec) return;
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
    html += `<div class="section-label palette-h">${esc(cat)}</div>`;
    for (const info of infos) {
      const item = `<button class="pitem" data-type="${esc(info.type)}">${nodePreviewSVG(info.type)}<span class="plabel">${esc(info.label)}</span></button>`;
      html += info.custom
        ? `<div class="pcustom">${item}<button class="pedit" data-edit="${esc(info.type)}" title="Edit type" aria-label="Edit type ${esc(info.label)}">${icon('pencil')}</button></div>`
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
    html += `<div class="section-label palette-h">Stencils</div>`;
    for (const st of stencils) {
      html += `<div class="pcustom"><button class="pitem" data-stencil="${esc(st.id)}" title="Stamp '${esc(st.name)}'">${stencilPreviewSVG(st)}<span class="plabel">${esc(st.name)}</span></button><button class="pedit" data-stencil-del="${esc(st.id)}" title="Delete stencil" aria-label="Delete stencil ${esc(st.name)}">${icon('delete')}</button></div>`;
    }
  }

  if (searching && byCat.size === 0 && stencils.length === 0) {
    html += `<div class="palette-empty">No nodes match “${esc(paletteQuery.trim())}”</div>`;
  }

  // The library actions (design a type, save a stencil) only show when not
  // mid-search — a filtered list is for picking, not authoring.
  if (!searching) {
    html += `<button class="pitem design" id="pDesign"><span>${icon('plus')} Design node</span></button>`;
    html += `<button class="pitem design" id="pSaveStencil" title="Save the selected node(s) as a reusable group"><span>${icon('plus')} Save stencil</span></button>`;
  }
  paletteList.innerHTML = html;

  paletteList
    .querySelectorAll<HTMLButtonElement>('[data-type]')
    .forEach((b) => {
      const type = b.dataset.type!;
      const variant = b.dataset.variant;
      const extra = variant ? { variant } : undefined;
      b.addEventListener('click', () => {
        // The Image entry opens a file picker instead of dropping a bare
        // placeholder — the common intent is "put THIS picture on the canvas".
        if (type === 'image') {
          imageFileInput.click();
          return;
        }
        editor.addNode(type, undefined, extra);
      });
      // Dragged onto the canvas, the node lands where it is dropped; onto a
      // link, it is inserted into the link. (An image needs its file first.)
      if (type !== 'image')
        enablePaletteDrag(b, {
          overCanvas: (x, y) => {
            const el = document.elementFromPoint(x, y);
            return el !== null && canvasHost.contains(el);
          },
          linkAt: (x, y) => editor.linkAtClient(x, y),
          markLink: (id) => editor.setDropLink(id),
          drop: (x, y, linkId) => {
            const at = editor.clientToPage(x, y);
            const inserted =
              linkId !== null &&
              editor.insertNodeOnLink(linkId, type, at, extra) !== null;
            // A locked link takes no insert: the node lands beside it.
            if (!inserted) editor.addNodeAt(type, at, undefined, extra);
          },
        });
    });
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
    ?.addEventListener('click', () => commands.run('selection.saveAsStencil'));
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

/* A just-deleted page, held so the bar can offer "Undo delete" until the
 * chip times out or another frame is deleted. Its stashed editor history is
 * kept alive with it, so restoring the frame restores its undo stack too. */
let pendingFrameDelete: { page: Page; index: number; timer: number } | null =
  null;

/** What the pages bar's play button shows while playing, or while stopped. */
function playFlipLabel(playing: boolean): string {
  return playing
    ? `${icon('pause')}<span class="pages-label">Pause</span>`
    : `${icon('play')}<span class="pages-label">Play</span>`;
}
/** Show on the play button whether the player is running. */
function setPlayFlip(playing: boolean): void {
  const b = pagesLead.querySelector<HTMLButtonElement>('#playFlip');
  if (!b) return;
  b.innerHTML = playFlipLabel(playing);
  b.setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

/* Flipbook playback: step through pages on their durations (loop). The same
 * timing model drives the MCP export_flipbook artifact (pages/playback). */
function stopPlayback(): void {
  if (playTimer === null) return;
  clearTimeout(playTimer);
  playTimer = null;
  setPlayFlip(false);
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
  setPlayFlip(true);
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
  // A chip already wholly in view stays put: a press on it must not slide
  // it from under the pointer between the two presses of a double-click.
  if (left >= strip.scrollLeft && right <= strip.scrollLeft + strip.clientWidth)
    return;
  if (left - pad < strip.scrollLeft) {
    strip.scrollLeft = Math.max(0, left - pad);
  } else if (right + pad > strip.scrollLeft + strip.clientWidth) {
    strip.scrollLeft = right + pad - strip.clientWidth;
  }
}

/**
 * Where the keyboard focus is in the pages bar, so a redraw (which replaces
 * its buttons) can put it back: the button's id, or a page chip's index and
 * which of its two buttons it was.
 */
type PagesBarFocus =
  | { id: string }
  | { page: number; part: 'sel' | 'del' }
  | null;

function pagesBarFocus(): PagesBarFocus {
  const el = document.activeElement;
  if (!(el instanceof HTMLButtonElement)) return null;
  if (!pagesLead.contains(el) && !strip.contains(el) && !pagesTail.contains(el))
    return null;
  if (el.id) return { id: el.id };
  const chip = el.closest<HTMLElement>('[data-page]');
  if (!chip) return null;
  return {
    page: Number(chip.dataset.page),
    part: el.classList.contains('frame-x') ? 'del' : 'sel',
  };
}

function restorePagesBarFocus(was: PagesBarFocus): void {
  // Only when the redraw dropped it: a control elsewhere that took the focus
  // meanwhile keeps it.
  if (
    !was ||
    (document.activeElement && document.activeElement !== document.body)
  )
    return;
  const chipButton = (i: number): HTMLElement | null =>
    strip.querySelector<HTMLElement>(`[data-page="${i}"] .frame-sel`);
  let target: HTMLElement | null = null;
  if ('id' in was)
    // The same button if it is still there; Undo delete, once used, gives
    // way to the page it brought back.
    target =
      app.querySelector<HTMLElement>(`#pagesBar #${was.id}`) ??
      chipButton(current);
  else if (was.part === 'sel')
    target = chipButton(was.page) ?? chipButton(current);
  else
    // The chip whose delete button it was is gone: its neighbour, which now
    // holds its place in the bar.
    target =
      chipButton(Math.min(was.page, doc.pages.length - 1)) ??
      chipButton(current);
  target?.focus();
}

function renderFilmstrip(): void {
  const hadFocus = pagesBarFocus();
  const canDelete = doc.pages.length > 1;
  const playing = playTimer !== null;
  pagesLead.innerHTML =
    doc.pages.length > 1
      ? `<button type="button" class="btn btn-ghost" id="playFlip" title="Play the pages on the canvas (each page holds for its duration)" aria-label="${playing ? 'Pause' : 'Play'}">${playFlipLabel(playing)}</button>`
      : '';
  // Each chip is a button that goes to its page (Enter or a click; F2 or a
  // double-click renames it), with its delete button beside it, not in it.
  strip.innerHTML = doc.pages
    .map(
      (p, i) => `
      <div class="frame ${i === current ? 'on' : ''}" data-page="${i}" draggable="true" title="${esc(p.name)} — double-click to rename, drag to reorder">
        <button type="button" class="frame-sel"${i === current ? ' aria-current="page"' : ''}><span class="visually-hidden">Page </span><span class="frame-n">${i + 1}</span> <span class="frame-name" data-name="${i}">${esc(p.name)}</span></button>
        ${canDelete ? `<button type="button" class="frame-x" data-del="${i}" title="Delete page" aria-label="Delete page ${esc(p.name)}">${icon('x')}</button>` : ''}
      </div>`,
    )
    .join('');
  pagesTail.innerHTML = `
    <button type="button" class="btn btn-ghost" id="dupPage" title="Duplicate current page" aria-label="Duplicate page">${icon('duplicate')}<span class="pages-label">Duplicate page</span></button>
    <button type="button" class="btn btn-ghost" id="addPage" title="Add blank page" aria-label="Add page">${icon('plus')}<span class="pages-label">Add page</span></button>
    ${
      pendingFrameDelete
        ? `<button type="button" class="btn btn-ghost" id="undoDel" title="Restore the deleted page &quot;${esc(pendingFrameDelete.page.name)}&quot;" aria-label="Undo delete">${icon('restore')}<span class="pages-label">Undo delete</span></button>`
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
  // F2 renames the focused chip: the keyboard's double-click.
  strip.querySelectorAll<HTMLButtonElement>('.frame-sel').forEach((b) =>
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'F2' || e.ctrlKey || e.metaKey || e.altKey) return;
      const name = b.querySelector<HTMLElement>('[data-name]');
      if (!name) return;
      e.preventDefault();
      e.stopPropagation();
      startRename(Number(name.dataset.name), name, true);
    }),
  );
  strip.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      commands.run('page.delete', Number(b.dataset.del));
    }),
  );
  pagesLead
    .querySelector('#playFlip')
    ?.addEventListener('click', () => commands.run('page.playPause'));
  pagesTail
    .querySelector('#addPage')
    ?.addEventListener('click', () => commands.run('page.add'));
  pagesTail
    .querySelector('#dupPage')
    ?.addEventListener('click', () => commands.run('page.duplicate'));
  pagesTail
    .querySelector('#undoDel')
    ?.addEventListener('click', () => commands.run('page.undoDelete'));

  restorePagesBarFocus(hadFocus);
  updateFramesIndicator();
  scrollActiveFrameIntoView();
}

/** Start the flipbook player, or stop it. */
function togglePlayback(): void {
  if (playTimer !== null) stopPlayback();
  else startPlayback();
}

/** Add a blank frame at the end and go to it. */
function addBlankPage(): void {
  // A new frame attaches links the way the frame you are on does, so one
  // document does not mix the two attachment styles by accident.
  const attach = doc.pages[current]?.linkAttach;
  doc.pages.push({
    ...blankPage(`Frame ${doc.pages.length + 1}`),
    ...(attach ? { linkAttach: { ...attach } } : {}),
  });
  gotoPage(doc.pages.length - 1);
  markDirty();
}

/** Copy the current frame into a new one after it and go to it. */
function duplicateCurrentPage(): void {
  doc.pages.splice(
    current + 1,
    0,
    duplicatePage(doc.pages[current]!, `Frame ${doc.pages.length + 1}`),
  );
  gotoPage(current + 1);
  markDirty();
}

/** Switch to a page AND rebuild the strip (after a structural change). */
function gotoPage(i: number): void {
  stopPlayback();
  current = i;
  showPage(doc.pages[current]!);
  renderFilmstrip();
  renderProblems();
}

/**
 * Rename page `i` in place: its name becomes a field. `refocus` (a rename
 * started from the keyboard): Enter or Escape puts focus back on the chip.
 */
function startRename(i: number, span: HTMLElement, refocus = false): void {
  const page = doc.pages[i];
  if (!page) return;
  const input = document.createElement('input');
  input.className = 'frame-rename';
  input.value = page.name;
  input.setAttribute('aria-label', `Rename page ${i + 1}`);
  // A field cannot sit inside the chip's button: while it is open, the
  // number and the field take the button's place.
  const chip = span.closest<HTMLElement>('.frame-sel');
  if (chip) {
    const box = document.createElement('span');
    box.className = 'frame-sel frame-editing';
    const n = chip.querySelector('.frame-n');
    if (n) box.append(n.cloneNode(true), ' ');
    box.append(input);
    chip.replaceWith(box);
  } else span.replaceWith(input);
  input.focus();
  input.select();
  // Once only: redrawing the strip removes this input, and a removed input
  // that had focus fires blur — which would save the text Escape just
  // cancelled.
  let done = false;
  let byKey = false;
  const commit = (save: boolean): void => {
    if (done) return;
    done = true;
    if (save) page.name = input.value.trim() || page.name;
    renderFilmstrip();
    if (save) markDirty();
    if (refocus && byKey)
      strip
        .querySelector<HTMLElement>(`[data-page="${i}"] .frame-sel`)
        ?.focus();
  };
  input.addEventListener('blur', () => commit(true));
  input.addEventListener('keydown', (e) => {
    if (isImeKey(e)) return; // the key belongs to an IME composition
    if (e.key === 'Enter') {
      byKey = true;
      input.blur();
    } else if (e.key === 'Escape') {
      byKey = true;
      commit(false);
    }
  });
}

/** The pending delete becomes final: forget the page and its history stash. */
function finalizeFrameDelete(): void {
  if (!pendingFrameDelete) return;
  clearTimeout(pendingFrameDelete.timer);
  editor.dropPageHistory(pendingFrameDelete.page.id);
  pendingFrameDelete = null;
}

/** Restore the just-deleted page at its old position (the bar's Undo delete). */
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
    !confirm(`Delete "${page.name}"? This page has content.`)
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
  strip.querySelectorAll<HTMLElement>('[data-page]').forEach((el) => {
    const on = Number(el.dataset.page) === i;
    el.classList.toggle('on', on);
    const chip = el.querySelector('.frame-sel');
    if (on) chip?.setAttribute('aria-current', 'page');
    else chip?.removeAttribute('aria-current');
  });
  updateFramesIndicator();
  scrollActiveFrameIntoView();
}

/* Toolbar */
const gridBtn = app.querySelector<HTMLButtonElement>('#tGrid')!;
const snapBtn = app.querySelector<HTMLButtonElement>('#tSnap')!;
function toggleGrid(): void {
  editor.toggleGrid();
  setPressed(gridBtn, editor.gridVisible);
}
function toggleSnap(): void {
  editor.toggleSnap();
  setPressed(snapBtn, editor.snap);
}
gridBtn.addEventListener('click', () => commands.run('view.toggleGrid'));
snapBtn.addEventListener('click', () => commands.run('view.toggleSnap'));

/* Calm canvas — pause animations (glow/particles) for a quieter editing view.
 * A view preference (not document data), persisted across sessions. */
const calmBtn = app.querySelector<HTMLButtonElement>('#tCalm')!;
const CALM_KEY = 'topology-dojo:calm';
function applyCalm(on: boolean): void {
  editor.setCalm(on);
  setPressed(calmBtn, on);
  calmBtn.title = commands.titleWithShortcut(
    'view.toggleCalm',
    on
      ? 'Resume animations — glow & flow particles'
      : 'Calm canvas — pause animations',
  );
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
calmBtn.addEventListener('click', () => commands.run('view.toggleCalm'));

/* On-canvas problem badges (Packet B1) — a view preference, persisted across
 * sessions like Calm/Grid/Snap (`badgesVisible` + `BADGES_KEY` above, next to
 * the problems panel they mirror). Toggling re-renders the panel + badges
 * together since `renderProblems()` computes both from one problem list. */
function applyBadgesVisible(on: boolean): void {
  badgesVisible = on;
  try {
    localStorage.setItem(BADGES_KEY, on ? '1' : '0');
  } catch {
    // storage unavailable — non-fatal
  }
  renderProblems();
}

/* Light / dark theme — a view preference, persisted across sessions. */
const THEME_KEY = 'topology-dojo:theme';
const tdsRoot = app.querySelector<HTMLElement>('.tds-root');
/** The render theme matching the editor's current light/dark toggle (#264). */
function currentTheme(): RenderTheme {
  return document.documentElement.classList.contains('light')
    ? 'light'
    : 'dark';
}
/** The document's brand accent on the chrome, if it sets one. */
let chromeAccentHex: string | undefined;
function applyTheme(light: boolean): void {
  document.documentElement.classList.toggle('light', light);
  // Accent text is worked out against this theme's surface.
  syncAccentText();
  // The browser's own UI (a phone's address bar, an installed app's title
  // bar) follows the chrome: the theme's back surface, read from the tokens.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      'content',
      getComputedStyle(document.documentElement)
        .getPropertyValue('--surface-back')
        .trim(),
    );
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

/* Display settings — embellishment controls (ambient backdrop level),
 * separate from the document and persisted as view preferences.
 * Decouples the decorative ambient from the meaningful flow particles. */
const displayBtn = app.querySelector<HTMLButtonElement>('#tDisplay')!;
const AMBIENT_KEY = 'tds-ambient';
const displayPop = document.createElement('div');
displayPop.className = 'display-pop';
displayPop.setAttribute('role', 'dialog');
displayPop.setAttribute('aria-label', 'Display settings');
displayPop.hidden = true;
displayPop.innerHTML =
  `<h3 class="section-label dp-h">Display</h3>` +
  `<label class="dp-row">Ambient backdrop<select class="field dp-field" id="dpAmbient">` +
  variantOptions('view.ambient.', {
    animated: 'Animated',
    static: 'Static',
    off: 'Off',
  }) +
  `</select></label>` +
  `<p class="hint dp-note">“Off” removes the drifting bits, scan lines &amp; radar. Flow particles are separate — Calm (${esc(commands.shortcutLabel('view.toggleCalm') ?? '')}) pauses those.</p>` +
  `<label class="dp-row">Wheel<select class="field dp-field" id="dpWheel">` +
  variantOptions('view.wheel.', {
    auto: 'Auto',
    zoom: 'Always zoom',
    pan: 'Always pan',
  }) +
  `</select></label>` +
  `<p class="hint dp-note">Auto: a mouse wheel zooms, a trackpad’s two-finger slide pans. Pinch or Ctrl/Cmd+wheel always zooms; Shift+wheel pans sideways.</p>` +
  `<h3 class="section-label dp-h dp-h2">Brand palette</h3>` +
  `<div class="dp-swatches" id="dpPresets"></div>` +
  `<label class="dp-row">Accent<input type="color" id="dpAccent"/></label>` +
  `<label class="dp-row">Secondary<input type="color" id="dpSecondary"/></label>` +
  `<label class="dp-row">Chrome (UI)<input type="color" id="dpChrome"/></label>` +
  `<p class="hint dp-note">Recolours the canvas accents and the app chrome to match your brand. Saved with the document.</p>`;
document.body.appendChild(displayPop);
const dpAmbient = displayPop.querySelector<HTMLSelectElement>('#dpAmbient')!;
const dpWheel = displayPop.querySelector<HTMLSelectElement>('#dpWheel')!;
const dpPresets = displayPop.querySelector<HTMLDivElement>('#dpPresets')!;
const dpAccent = displayPop.querySelector<HTMLInputElement>('#dpAccent')!;
const dpSecondary = displayPop.querySelector<HTMLInputElement>('#dpSecondary')!;
const dpChrome = displayPop.querySelector<HTMLInputElement>('#dpChrome')!;

type AmbientLevel = Parameters<typeof editor.setAmbient>[0];
const isAmbientLevel = oneOf<AmbientLevel>(['off', 'static', 'animated']);
/** The ambient backdrop as last applied. */
let ambientLevel: AmbientLevel = 'animated';
function applyAmbient(level: AmbientLevel): void {
  ambientLevel = level;
  editor.setAmbient(level);
  dpAmbient.value = level;
  try {
    localStorage.setItem(AMBIENT_KEY, level);
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
dpAmbient.addEventListener('change', () =>
  runVariant('view.ambient.', dpAmbient.value),
);

/* What a plain wheel event does on the canvas. The default guesses the device
 * (a mouse wheel zooms, a trackpad's two-finger slide pans); the guess cannot
 * be right for every device, so the user can pin it. A view preference of
 * this browser, like the theme: not part of the document. */
const WHEEL_KEY = 'tds-wheel-mode';
const isWheelMode = (v: unknown): v is WheelMode =>
  v === 'auto' || v === 'zoom' || v === 'pan';
/** What a plain wheel event does, as last applied. */
let wheelMode: WheelMode = 'auto';
function applyWheelMode(mode: WheelMode): void {
  wheelMode = mode;
  editor.setWheelMode(mode);
  dpWheel.value = mode;
  try {
    localStorage.setItem(WHEEL_KEY, mode);
  } catch {
    // storage unavailable — non-fatal
  }
}
const storedWheel = localStorage.getItem(WHEEL_KEY);
applyWheelMode(isWheelMode(storedWheel) ? storedWheel : 'auto');
dpWheel.addEventListener('change', () =>
  runVariant('view.wheel.', dpWheel.value),
);

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
  const style = document.documentElement.style;
  // Text and icons drawn on the accent (a primary button's label, a switch's
  // knob) take whichever ink reads on the brand colour; with no brand colour
  // both properties fall back to the theme's own values in tokens.css.
  const ink = hex ? readableInkOn(hex) : null;
  if (hex) style.setProperty('--accent', hex);
  else style.removeProperty('--accent');
  if (ink) style.setProperty('--on-accent', ink);
  else style.removeProperty('--on-accent');
  chromeAccentHex = hex;
  syncAccentText();
}

/**
 * Accent text and icons (`--accent-fg`) under a brand accent: the accent,
 * mixed toward the theme's strongest text until it reads (4.5:1) on every
 * surface and every tint it can sit on. A dark brand on the dark theme, or a pale one on the light
 * theme, would otherwise be unreadable as text. With no brand accent the
 * theme's own value in tokens.css stands.
 */
function syncAccentText(): void {
  const root = document.documentElement;
  root.style.removeProperty('--accent-fg');
  if (!chromeAccentHex) return;
  // Each token as the browser computes it (the tints are color-mix() of the
  // brand accent, or translucent white or black), read through a probe.
  const probe = document.createElement('span');
  probe.hidden = true;
  document.body.append(probe);
  const computed = (token: string): string => {
    probe.style.color = `var(${token})`;
    return getComputedStyle(probe).color;
  };
  // Accent text sits on the three surfaces, and on the tints laid over them:
  // a hovered or pressed control, a selected row (--accent-soft), the
  // compass's chosen side (--accent-soft-strong).
  const grounds = accentTextGrounds(
    ['--surface-back', '--surface-front', '--surface-float'].map(computed),
    [
      '--surface-field',
      '--surface-hover',
      '--surface-press',
      '--accent-soft',
      '--accent-soft-strong',
    ].map(computed),
  );
  const ink = computed('--fg-strong');
  probe.remove();
  const inkRgb = parseColour(ink);
  const fg = inkRgb
    ? readableAccentText(chromeAccentHex, grounds, hexOf(inkRgb))
    : null;
  if (fg) root.style.setProperty('--accent-fg', fg);
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
function toggleDisplayPop(): void {
  if (displayPop.hidden) {
    // It opens upward from its button at the right end of the pages bar.
    const r = displayBtn.getBoundingClientRect();
    displayPop.style.top = 'auto';
    const bottom = Math.round(window.innerHeight - r.top + 6);
    displayPop.style.bottom = `${bottom}px`;
    // In a short window it keeps below the top bar and scrolls within
    // itself, so Tidy, Present and Export stay in sight.
    const ceiling = Math.round(
      (document.getElementById('topbar')?.getBoundingClientRect().bottom ?? 0) +
        8,
    );
    displayPop.style.maxHeight = `${Math.max(120, window.innerHeight - bottom - ceiling)}px`;
    displayPop.style.right = `${Math.round(Math.max(8, window.innerWidth - r.right))}px`;
    displayPop.style.left = 'auto';
    displayPop.hidden = false;
    displayBtn.classList.add('on');
    displayBtn.setAttribute('aria-expanded', 'true');
    releaseDisplayOverlay = registerOverlay(displayPop, {
      close: closeDisplayPop,
    });
  } else closeDisplayPop();
}
displayBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  commands.run('view.displaySettings');
});
closeOnOutsidePress(displayPop, displayBtn, closeDisplayPop);

app
  .querySelector('#tTidy')
  ?.addEventListener('click', () => commands.run('arrange.tidy'));

/* ── Keyboard-shortcut help overlay (?) ────────────────────────────── */
/* The sheet lists every command that has a key, group by group, from the
 * command table, then the gestures and the keys of the dialogs, menus and
 * other surfaces (HELP_GESTURES): one source for what the keys do. */
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
  const cols = [...commands.helpSections(), ...HELP_GESTURES]
    .map(
      (s) =>
        `<div class="help-col"><h4 class="section-label">${esc(s.title)}</h4>` +
        s.rows
          .map(
            ([k, d]) =>
              // What it does, then each shortcut as its own key cap, so a
              // command with two shortcuts wraps instead of overflowing.
              `<div class="help-row"><span class="help-what">${esc(d)}</span><span class="help-keys">${k
                .split(KEYS_SEPARATOR)
                .map((key) => `<kbd>${esc(key)}</kbd>`)
                .join('')}</span></div>`,
          )
          .join('') +
        `</div>`,
    )
    .join('');
  helpEl.innerHTML =
    `<div class="dialog help-card help-sheet" role="dialog" aria-modal="true" aria-labelledby="helpTitle">` +
    `<div class="dialog-head help-head"><h3 class="dialog-title" id="helpTitle">Keyboard shortcuts</h3>` +
    `<button type="button" class="icon-btn" id="helpClose" title="Close (Esc)" aria-label="Close">${icon('x')}</button></div>` +
    `<div class="dialog-body scroll-slim"><div class="help-cols">${cols}</div></div></div>`;
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
app
  .querySelector('#tHelp')
  ?.addEventListener('click', () => commands.run('help.shortcuts'));
app
  .querySelector('#tCommand')
  ?.addEventListener('click', () => commands.run('help.commandPalette'));

/* ── Present mode: full-screen playback of every frame ─────────────────
 * A human-only view feature (DESIGN #2 carve-out — nothing persisted): the
 * flipbook experience without leaving the editor. Reuses the SAME timing
 * model as the filmstrip player and the exported flipbook (pages/playback),
 * and the same per-frame SVG the exports produce. ←/→ step, Space toggles
 * autoplay, Esc leaves. */
let presentEl: HTMLElement | null = null;
// The "what moved" note (mounted with the Help commands): out of sight while
// presenting.
let shellNote: ShellNote | null = null;
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
  shellNote?.hold(false);
}
function openPresent(): void {
  if (presentEl) {
    closePresent();
    return;
  }
  stopPlayback();
  shellNote?.hold(true);
  let frame = current;
  let playing = doc.pages.length > 1;
  const root = document.createElement('div');
  root.className = 'present-root dark-scope';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Presentation');
  root.innerHTML =
    `<div class="present-stage" id="presentStage"></div>` +
    `<div class="present-bar">` +
    `<button type="button" class="icon-btn" id="presentPrev" title="Previous page (${PRESENT_KEYS.prev})" aria-label="Previous page">${icon('frame-prev')}</button>` +
    `<button type="button" class="icon-btn" id="presentPlay" title="Play / pause (${PRESENT_KEYS.playPause})" aria-label="Play or pause">${icon(playing ? 'pause' : 'play')}</button>` +
    `<button type="button" class="icon-btn" id="presentNext" title="Next page (${PRESENT_KEYS.next})" aria-label="Next page">${icon('frame-next')}</button>` +
    `<span class="present-count data" id="presentCount"></span>` +
    `<span class="present-name" id="presentName"></span>` +
    `<button type="button" class="btn btn-ghost present-exit" id="presentExit" title="Exit (${PRESENT_KEYS.exit})" aria-label="Exit presentation">${icon('x')}Exit</button>` +
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
    playBtn.innerHTML = icon(playing ? 'pause' : 'play');
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
app
  .querySelector('#tPresent')
  ?.addEventListener('click', () => commands.run('view.present'));

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
    `<button type="button" class="btn btn-sm btn-ghost share-copy" data-url="${esc(url)}" title="Copy the public link">Copy link</button>` +
    `<button type="button" class="btn btn-sm btn-danger share-revoke" data-id="${esc(s.id)}" title="Revoke — the public link stops resolving">Revoke link</button>` +
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
    `<div class="dialog help-card share-card" role="dialog" aria-modal="true" aria-labelledby="shareTitle">` +
    `<div class="dialog-head help-head"><h3 class="dialog-title" id="shareTitle">Share</h3>` +
    `<button type="button" class="icon-btn" id="shareClose" title="Close (Esc)" aria-label="Close">${icon('x')}</button></div>` +
    `<div class="dialog-body scroll-slim">` +
    `<p class="share-note hint">Publishing creates a <b>public</b> read-only snapshot at a /v/&lt;id&gt; link — no sign-in needed to view it. Links expire after 30 days; revoking one takes it down early (edge caches may serve it for up to about a minute). Don’t publish internal addresses or policy details unless they’re approved for public access.</p>` +
    `<div class="share-actions"><button type="button" class="btn btn-primary" id="sharePublish">${icon('publish')}Publish this document</button><span class="share-status hint" id="shareStatus" role="status"></span></div>` +
    `<div class="share-fresh" id="shareFresh" hidden></div>` +
    `<h4 class="section-label share-h">Published links</h4>` +
    `<div class="share-list" id="shareList"><span class="hint">Loading…</span></div>` +
    `</div></div>`;
  app.appendChild(shareEl);
  const status = shareEl.querySelector<HTMLElement>('#shareStatus')!;
  const list = shareEl.querySelector<HTMLElement>('#shareList')!;
  const fresh = shareEl.querySelector<HTMLElement>('#shareFresh')!;
  const refresh = async (): Promise<void> => {
    try {
      const shares = await fetchShares();
      list.innerHTML = shares.length
        ? shares.map(shareRowHtml).join('')
        : `<div class="hint">No live links.</div>`;
    } catch (err) {
      list.innerHTML = `<div class="hint">Could not load published links (${esc(String(err))}).</div>`;
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
        () => (copy.innerHTML = `${icon('check')}Copied`),
        () => (copy.textContent = 'Copy failed'),
      );
      return;
    }
    const revoke = t.closest<HTMLButtonElement>('.share-revoke');
    if (revoke) {
      revoke.disabled = true;
      // Busy: the icon, with the word for a screen reader.
      revoke.innerHTML = `${icon('busy')}<span class="visually-hidden">revoking</span>`;
      // The canonical revoke route (owner checked via snapshot metadata).
      void fetch(`/api/topology/${encodeURIComponent(revoke.dataset.id!)}`, {
        method: 'DELETE',
      }).then(
        (res) => {
          if (res.ok) void refresh();
          else {
            revoke.disabled = false;
            revoke.textContent = 'Revoke link';
            status.textContent =
              res.status === 403
                ? 'Only the publisher can revoke this link.'
                : `Revoke failed (${res.status}).`;
          }
        },
        () => {
          revoke.disabled = false;
          revoke.textContent = 'Revoke link';
          status.textContent = 'Revoke failed (offline?)';
        },
      );
    }
  });
  shareEl
    .querySelector<HTMLButtonElement>('#sharePublish')!
    .addEventListener('click', () => {
      status.textContent = 'Publishing…';
      fresh.hidden = true;
      void fetch('/api/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ document: JSON.parse(serializeDoc(doc)) }),
      }).then(
        async (res) => {
          if (!res.ok) {
            status.textContent = `Publish failed (${res.status}).`;
            return;
          }
          const out = (await res.json()) as { id: string; url: string };
          const url = out.url.startsWith('http')
            ? out.url
            : `${location.origin}${out.url}`;
          status.textContent = '';
          fresh.hidden = false;
          fresh.innerHTML =
            `<span class="share-sub">Published:</span> <a class="data" href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>` +
            `<button type="button" class="btn btn-sm share-copy" data-url="${esc(url)}" title="Copy the public link">Copy link</button>`;
          void refresh();
        },
        () => {
          status.textContent = 'Publish failed (offline?)';
        },
      );
    });
  shareEl
    .querySelector('#shareClose')
    ?.addEventListener('click', () => closeShare());
  releaseShareOverlay = registerOverlay(shareEl, { close: closeShare });
  void refresh();
}
/** Hidden until the hosted Worker reports a signed-in user. */
const shareBtn = app.querySelector<HTMLButtonElement>('#fShare');
/** Sharing is offered: the hosted Worker reported a signed-in user. */
let shareAvailable = false;
/** Who the hosted Worker reports as signed in (null: nobody, or no Worker),
 * and whether they own the deployment: what the account commands ask. */
let signedInLogin: string | null = null;
let signedInAdmin = false;
shareBtn?.addEventListener('click', () => commands.run('file.share'));

/* Menus. The menu bar, the Tidy and Export buttons and the account chip open
 * the menus of src/ui/menus.ts. Each is built when it opens, from the
 * registry and from what is true now (who is signed in, whether sharing is
 * offered), and every item runs its command through the registry. */
function menuContext(): MenuContext {
  return {
    commands,
    templates: listTemplates(),
    shareAvailable,
    account: signedInLogin
      ? { login: signedInLogin, admin: signedInAdmin }
      : null,
    icon,
  };
}
const MENU_OF: Readonly<Record<string, (ctx: MenuContext) => MenuEntry[]>> =
  Object.fromEntries([
    ...MENUBAR.map((m) => [m.id, m.entries] as const),
    ['more', moreMenu] as const,
  ]);
attachMenubar(app.querySelector<HTMLElement>('#menubar')!, (key) => {
  const entries = MENU_OF[key];
  if (!entries) throw new Error(`no menu "${key}" in the menu bar`);
  return entries(menuContext());
});
attachMenuButton(
  app.querySelector<HTMLElement>('#tTidyMenu')!,
  () => tidyMenu(menuContext()),
  { placement: 'below-end' },
);
attachMenuButton(
  app.querySelector<HTMLElement>('#fExportBtn')!,
  () => exportMenu(menuContext()),
  { placement: 'below-end' },
);

/* Account menu. The Worker gates the app behind GitHub sign-in and reports the
 * current user at /api/me; when that succeeds we reveal the account chip, whose
 * menu says who is signed in and holds API keys, Authoring preferences, Admin
 * (the owner only), Theme and Sign out. In Vite dev there's no Worker (auth is
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
  // Its name starts with the login it shows, then says what it opens.
  chip.setAttribute('aria-label', `${login}, account menu`);
  chip.hidden = false;
  div.hidden = false;

  // Its menu (src/ui/menus.ts accountMenu) says who is signed in and holds
  // the account's commands and the theme.
  attachMenuButton(chip, () => accountMenu(menuContext()), {
    placement: 'below-end',
    label: 'Account',
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
  name.textContent = 'Sign in';
  chip.title = 'Sign in with GitHub';
  chip.setAttribute('aria-label', 'Sign in');
  chip.setAttribute('aria-haspopup', 'dialog');
  chip.classList.add('signed-out');
  chip.hidden = false;
  div.hidden = false;

  const menu = document.createElement('div');
  menu.className = 'sign-in-prompt';
  menu.id = 'signInPrompt';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', 'Sign in');
  menu.hidden = true;
  menu.innerHTML =
    `<p class="sip-title" id="signInMessage"></p>` +
    `<p class="hint">Your work stays in this browser until you do. Signing in brings you straight back to it.</p>` +
    `<a class="btn btn-primary sip-go" id="signInGo" href="/login?go=%2F">Sign in with GitHub</a>`;
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
      signedInLogin = me.login;
      signedInAdmin = !!me.admin;
      wireAccountMenu(me.login);
      enableWorkspaceUi();
      // Sharing needs the hosted Worker (KV + session); reveal only here.
      // The account menu offers Admin for the owner alone (signedInAdmin);
      // the real gate is the /api/admin routes.
      shareAvailable = !!shareBtn;
      if (shareBtn) shareBtn.hidden = false;
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

/** Frame the selection clear of the panels; the whole content when nothing
 * is selected. */
function zoomToSelection(): void {
  fitLeftInset = 0;
  if (editor.zoomToSelection()) settleFit();
  else fitView();
}

/* ── Command palette ───────────────────────────────────────────────────
 * Ctrl/Cmd+K, the rail's search button and Help ▸ Command palette: the
 * commands that can run now, "Add <node type>" for the library's types,
 * "Go to <label>" for the elements of every page and "Go to page N"
 * (src/ui/palette-sources.ts says what is listed and why). */
let paletteHandle: PaletteHandle | null = null;

/** A new node of `type` at the centre of the view, placed as quick-add
 * places one (on the grid when snap is on). */
function addNodeAtViewCentre(type: string): void {
  const host = document.querySelector<HTMLElement>('.canvas-host');
  if (!host) return;
  const r = host.getBoundingClientRect();
  const at = editor.clientToPage(r.left + r.width / 2, r.top + r.height / 2);
  const g = editor.grid;
  const x = editor.snap ? Math.round(at.x / g) * g : Math.round(at.x);
  const y = editor.snap ? Math.round(at.y / g) * g : Math.round(at.y);
  editor.addNode(type, undefined, { x, y });
}

function openPalette(): void {
  paletteHandle = openCommandPalette({
    entries: () =>
      paletteEntries({
        commands,
        open: {
          pathAnalysis: pathSession !== null,
          sharedCopy: activeSlot === 'shared',
          otherTabVersion: savedEl.classList.contains('save-stale'),
        },
        nodeTypes: nodeCatalog(doc.customNodes),
        pages: doc.pages,
        current,
        addNode: addNodeAtViewCentre,
        goToElement: (pageIndex, kind, id) => {
          if (pageIndex !== current) choosePage(pageIndex);
          editor.selectElement(kind, id, { center: true });
        },
        goToPage: (i) => choosePage(i),
        icon,
      }),
  });
}

/* ── Command bindings ──────────────────────────────────────────────────
 * What each command of src/ui/commands.ts does, bound once to the functions
 * above. Every surface runs a command through the registry: the toolbar and
 * panel controls, the window key handler, the context menu. `enabled` is the
 * rule a surface greys the command out by (the context menu's, a button's
 * `disabled`); the keyboard does not ask it (see RunOptions.ignoreEnabled).
 * `checked` says whether a toggle or a choice is on now. */
const bind = (id: CommandId, handlers: CommandHandlers): void =>
  commands.bind(id, handlers);
const pageIndexArg = (args: unknown): number =>
  typeof args === 'number' ? args : current;

// File
bind('file.new', { run: newDocument });
bind('file.open', { run: () => fileInput.click() });
bind('file.download', { run: downloadDocJSON });
bind('file.loadOtherTab', { run: loadFromOtherTab });
bind('file.share', {
  run: openShare,
  // Revealed only once the hosted Worker reports a signed-in user.
  enabled: () => shareAvailable,
});
bind('file.export.svg', { run: exportSvg });
bind('file.export.png', {
  run: exportPng,
  enabled: () => !pngExportInFlight,
});
for (const spec of COMMAND_SPECS)
  if (spec.id.startsWith('file.export.') && spec.args !== undefined)
    bind(spec.id, { run: (kind) => exportFromMenu(String(kind)) });
bind('file.generateSdwan', { run: generateSdwan });
for (const spec of ALL_COMMAND_SPECS)
  if (spec.id.startsWith('file.template.'))
    bind(spec.id, { run: (id) => newFromTemplate(String(id)) });
const signedIn = (): boolean => signedInLogin !== null;
bind('account.preferences', {
  run: () => profilePanelHandle.toggle(),
  enabled: signedIn,
});
// The real gate is the /api/admin routes; this one only hides the way in.
bind('account.admin', {
  run: () => adminDashboardHandle.toggle(),
  enabled: () => signedIn() && signedInAdmin,
});
bind('account.apiKeys', {
  run: () => window.location.assign('/keys'),
  enabled: signedIn,
});
// The autosave keeps the open document, so leaving loses nothing.
bind('account.signOut', {
  run: () => window.location.assign('/logout'),
  enabled: signedIn,
});
bind('shared.keepCopy', { run: keepSharedCopy });
bind('shared.backToMine', { run: backToMyDocument });
bind('shared.unpublish', {
  run: unpublishSharedLink,
  enabled: () => !!activeShareId,
});

// Edit
bind('edit.undo', {
  run: () => editor.undo(),
  enabled: () => editor.canUndo(),
});
bind('edit.redo', {
  run: () => editor.redo(),
  enabled: () => editor.canRedo(),
});
bind('edit.cut', { run: () => editor.cut() });
bind('edit.copy', { run: () => editor.copySelection() });
bind('edit.paste', {
  run: () => editor.paste(),
  enabled: () => editor.canPaste(),
});
bind('edit.pasteHere', {
  // Run with the page point to paste at, centred on it.
  run: (at) => editor.paste({ at: commandArg('edit.pasteHere', at, isPoint) }),
  enabled: () => editor.canPaste(),
});
bind('edit.pasteInPlace', {
  run: () => editor.paste({ inPlace: true }),
  enabled: () => editor.canPaste(),
});
bind('edit.duplicate', { run: () => editor.duplicateSelection() });
bind('edit.delete', { run: () => editor.deleteSelected() });
bind('edit.rename', { run: () => void editor.beginRename() });
// Both redraw the inspector: after a copy its paste button is available.
bind('edit.copyFormat', {
  run: () => {
    editor.copyFormat();
    renderInspector();
  },
  enabled: () => editor.canCopyFormat(),
});
bind('edit.pasteFormat', {
  run: () => {
    editor.pasteFormat();
    renderInspector();
  },
  enabled: () => editor.canPasteFormat(),
});
bind('edit.toggleLock', {
  run: () => editor.toggleLock(),
  checked: () => editor.selectionLocked(),
});
bind('edit.find', { run: openFind, checked: () => !!findEl });
bind('edit.copyAsImage', {
  run: () => {
    const sp = selectionAsPage();
    if (sp) copyImage(() => copyPagePNG(sp, '', selectionOpts()));
  },
});
bind('edit.copyFrameAsImage', {
  run: () => {
    const page = doc.pages[current]!;
    copyImage(() => copyPagePNG(page, pageOverlay(page), pageOpts(page)));
  },
});

// Selection
bind('selection.all', { run: () => editor.selectAll() });
bind('selection.sameType', { run: () => editor.selectSameType() });
bind('selection.sameColor', { run: () => editor.selectSameColor() });
bind('selection.growConnected', { run: () => editor.growConnected() });
bind('selection.invert', { run: () => editor.invertSelection() });
bind('selection.clear', {
  run: () => {
    stopPlayback();
    closePathBar();
    editor.clearSelection();
    setTool('select');
  },
});
// Run with how far to move (Shift+arrow runs them with 10).
const nudgeBy = (args: unknown): number =>
  typeof args === 'number' ? args : 1;
bind('selection.nudgeLeft', { run: (s) => editor.nudge(-nudgeBy(s), 0) });
bind('selection.nudgeRight', { run: (s) => editor.nudge(nudgeBy(s), 0) });
bind('selection.nudgeUp', { run: (s) => editor.nudge(0, -nudgeBy(s)) });
bind('selection.nudgeDown', { run: (s) => editor.nudge(0, nudgeBy(s)) });
bind('selection.emphasize', { run: () => editor.emphasizeSelection() });
bind('selection.analyzePath', {
  run: analyzeSelectedPath,
  enabled: canAnalyzePath,
  checked: () => !!pathSession,
});
bind('selection.groupIntoZone', { run: () => addAnnotation('zone') });
bind('selection.addFlow', { run: () => addAnnotation('flowPath') });
bind('selection.addPolicyMarker', {
  run: () => addAnnotation('policyMarker'),
});
bind('selection.saveAsStencil', { run: () => saveSelectionAsStencil() });
bind('link.swapEndpoints', { run: () => editor.swapLink() });
bind('link.straighten', {
  run: () => editor.straightenLink(),
  enabled: () => editor.selectedLinkHasBends(),
});
// The path analysis bar's buttons, while a path is on show.
bind('path.prev', { run: () => runPathAction('prev') });
bind('path.next', { run: () => runPathAction('next') });
bind('path.swap', { run: () => runPathAction('swap') });
bind('path.keepEmphasis', { run: () => runPathAction('keep') });
bind('path.addFlow', { run: () => runPathAction('flow') });
bind('path.newFrame', { run: () => runPathAction('frame') });
bind('path.close', { run: () => runPathAction('close') });

// Arrange. Z-order acts on one node or a link (canArrange); with anything
// else it does nothing.
const canArrange = (): boolean => editor.canArrange();
bind('arrange.bringToFront', {
  run: () => editor.bringToFront(),
  enabled: canArrange,
});
bind('arrange.bringForward', {
  run: () => editor.bringForward(),
  enabled: canArrange,
});
bind('arrange.sendBackward', {
  run: () => editor.sendBackward(),
  enabled: canArrange,
});
bind('arrange.sendToBack', {
  run: () => editor.sendToBack(),
  enabled: canArrange,
});
type AlignMode = Parameters<typeof editor.alignSelection>[0];
const ALIGN_MODES = [
  'left',
  'centerH',
  'right',
  'top',
  'middleV',
  'bottom',
] as const satisfies readonly AlignMode[];
type LayoutAlgorithmArg = Parameters<typeof editor.layout>[0]['algorithm'];
const LAYOUT_ALGORITHMS = [
  'hierarchical',
  'grid',
  'circular',
  'force',
] as const satisfies readonly LayoutAlgorithmArg[];
for (const id of [
  'arrange.alignLeft',
  'arrange.alignCenterH',
  'arrange.alignRight',
  'arrange.alignTop',
  'arrange.alignMiddleV',
  'arrange.alignBottom',
] as const)
  bind(id, {
    run: (mode) =>
      editor.alignSelection(commandArg(id, mode, oneOf(ALIGN_MODES))),
    // Aligning lines up two or more nodes; with fewer it does nothing.
    enabled: () => editor.selectedNodeIds().length >= 2,
  });
for (const id of ['arrange.distributeH', 'arrange.distributeV'] as const)
  bind(id, {
    run: (axis) =>
      editor.distributeSelection(commandArg(id, axis, oneOf(['h', 'v']))),
    // Spacing evenly needs a node between two others.
    enabled: () => editor.selectedNodeIds().length >= 3,
  });
bind('arrange.tidy', { run: () => editor.tidy() });
bind('arrange.balance', { run: () => editor.balance() });
for (const id of [
  'arrange.layout.hierarchical',
  'arrange.layout.grid',
  'arrange.layout.circular',
  'arrange.layout.force',
] as const)
  bind(id, {
    run: (algorithm) =>
      editor.layout({
        algorithm: commandArg(id, algorithm, oneOf(LAYOUT_ALGORITHMS)),
      }),
  });
bind('arrange.autoPlaceLabels', {
  run: () => editor.autoLabels(doc.customNodes),
});
bind('page.fitToContent', {
  run: () => {
    editor.fitPageToContent();
    renderInspector();
  },
});

// Tools
bind('tool.select', {
  run: () => setTool('select'),
  checked: () => editor.tool === 'select' && !editor.isHandActive(),
});
bind('tool.link', {
  run: () => setTool('link'),
  checked: () => editor.tool === 'link' && !editor.isHandActive(),
});
bind('tool.anchor', {
  run: () => setTool('anchor'),
  checked: () => editor.tool === 'anchor' && !editor.isHandActive(),
});
bind('tool.hand', {
  run: () => setHand(!editor.isHandActive()),
  checked: () => editor.isHandActive(),
});

// View
bind('view.zoomIn', { run: () => editor.zoomIn() });
bind('view.zoomOut', { run: () => editor.zoomOut() });
bind('view.zoom100', { run: () => editor.zoomTo(1) });
bind('view.fit', { run: fitView });
bind('view.zoomToSelection', { run: zoomToSelection });
bind('view.toggleGrid', { run: toggleGrid, checked: () => editor.gridVisible });
bind('view.toggleSnap', { run: toggleSnap, checked: () => editor.snap });
bind('view.toggleCalm', {
  run: () => applyCalm(!editor.calm),
  checked: () => editor.calm,
});
bind('view.toggleBadges', {
  run: () => applyBadgesVisible(!badgesVisible),
  checked: () => badgesVisible,
});
bind('view.displaySettings', {
  run: toggleDisplayPop,
  checked: () => !displayPop.hidden,
});
for (const id of [
  'view.ambient.animated',
  'view.ambient.static',
  'view.ambient.off',
] as const)
  bind(id, {
    run: (level) => applyAmbient(commandArg(id, level, isAmbientLevel)),
    checked: () => ambientLevel === commands.get(id)?.args,
  });
for (const id of [
  'view.wheel.auto',
  'view.wheel.zoom',
  'view.wheel.pan',
] as const)
  bind(id, {
    run: (mode) => applyWheelMode(commandArg(id, mode, isWheelMode)),
    checked: () => wheelMode === commands.get(id)?.args,
  });
bind('view.toggleTheme', {
  run: () => applyTheme(!document.documentElement.classList.contains('light')),
  checked: () => document.documentElement.classList.contains('light'),
});
for (const id of ['view.theme.dark', 'view.theme.light'] as const)
  bind(id, {
    run: (theme) =>
      applyTheme(commandArg(id, theme, oneOf(['dark', 'light'])) === 'light'),
    checked: () =>
      document.documentElement.classList.contains('light') ===
      (commands.get(id)?.args === 'light'),
  });
bind('view.present', { run: openPresent, checked: () => !!presentEl });
bind('view.toggleLibrary', {
  run: () => {
    const opening = paletteEl.classList.contains('collapsed');
    setPaletteCollapsed(!opening);
    if (opening) makeRoomForDrawer('palette');
  },
  checked: () => !paletteEl.classList.contains('collapsed'),
});
bind('view.toggleMinimap', {
  run: () => setMinimapCollapsed(!minimapDock.classList.contains('collapsed')),
  checked: () => !minimapDock.classList.contains('collapsed'),
});
bind('view.toggleProperties', {
  run: () => {
    const opening = inspectorWrap.classList.contains('collapsed');
    setInspectorCollapsed(!opening);
    if (opening) makeRoomForDrawer('inspector');
  },
  checked: () => !inspectorWrap.classList.contains('collapsed'),
});
bind('view.toggleFrames', {
  run: () => setFramesCollapsed(!framesDock.classList.contains('collapsed')),
  checked: () => !framesDock.classList.contains('collapsed'),
});
bind('view.toggleProblems', {
  run: () =>
    setProblemsCollapsed(!problemsDock.classList.contains('collapsed')),
  checked: () => !problemsDock.classList.contains('collapsed'),
});
bind('view.showProblems', { run: showProblems });
// The problems panel's footer, while any problem is hidden.
bind('problems.showHidden', {
  run: () => {
    showHiddenProblems = !showHiddenProblems;
    renderProblems();
  },
  enabled: () => hiddenProblems.size > 0,
  checked: () => showHiddenProblems,
});
bind('problems.restoreAll', {
  run: () => {
    hiddenProblems.clear();
    showHiddenProblems = false;
    saveHiddenProblems();
    renderProblems();
  },
  enabled: () => hiddenProblems.size > 0,
});

// Pages. Delete runs with a page's index, or deletes the current page.
bind('page.add', { run: addBlankPage });
bind('page.duplicate', { run: duplicateCurrentPage });
bind('page.delete', {
  run: (i) => deletePage(pageIndexArg(i)),
  enabled: () => doc.pages.length > 1,
});
bind('page.undoDelete', {
  run: undoFrameDelete,
  enabled: () => pendingFrameDelete !== null,
});
bind('page.next', { run: () => choosePage(current + 1) });
bind('page.prev', { run: () => choosePage(current - 1) });
bind('page.playPause', {
  run: togglePlayback,
  checked: () => playTimer !== null,
});
bind('page.emphasis.clear', {
  run: () => {
    editor.clearEmphasis();
    renderInspector();
  },
});

// Help
bind('help.shortcuts', { run: openHelp, checked: () => !!helpEl });
bind('help.commandPalette', {
  run: openPalette,
  checked: () => !!paletteHandle?.isOpen(),
});
// The one-time "what moved" note, over the canvas's bottom-left corner. A
// shared link opens on its banner: the note waits for a later visit.
shellNote = mountShellNote(
  {
    host: app.querySelector<HTMLElement>('#canvas-area')!,
    storage: localStorage,
    paletteKey: commands.shortcutLabel('help.commandPalette') ?? 'Ctrl/Cmd+K',
    showShortcuts: () => commands.run('help.shortcuts'),
  },
  shareMatch && shellNoteAtStart === 'show' ? 'none' : shellNoteAtStart,
);
bind('help.whatMoved', { run: () => shellNote?.show() });

{
  // A command nothing does would be a menu item or a key that does nothing.
  const unbound = commands.unbound();
  if (unbound.length)
    throw new Error(`commands with nothing bound: ${unbound.join(', ')}`);
}

window.addEventListener('keydown', (e) => {
  if (overlayActive()) return;
  // A key that confirms or discards an IME candidate is never a shortcut.
  if (isImeKey(e)) return;
  const target = e.target instanceof Element ? e.target : null;
  const focus = target ? focusKind(focusFactsOf(target)) : 'canvas';
  if (routeKey(e, focus, keyboardNav) === 'focus') return;
  if (e.key === 'Escape' && escapeReleasesFocus(focus)) releaseFocus(target);

  // The keyboard's right-click: the context menu for the selection.
  if (focus === 'canvas' && isContextMenuKey(e)) {
    e.preventDefault();
    openCtxMenuFromKeyboard();
    return;
  }

  // Hold Space: hand mode while it is down (a gesture, not a command; the
  // keyup handler below releases it). Prevent page scroll.
  if (e.key === ' ') {
    e.preventDefault();
    editor.setSpacePan(true);
    return;
  }

  // Every other key is a command or nothing: src/ui/commands.ts decides
  // which. A bound key is taken from the browser (when its binding says so)
  // whether or not the command has anything to act on, and the command is
  // run without asking whether it is enabled, as the keys always were.
  const hit = matchKey(e, {
    focusOnCanvas: focus === 'canvas',
    selectionCount: editor.selectionCount(),
  });
  if (!hit) return;
  if (hit.preventDefault) e.preventDefault();
  commands.run(hit.id, hit.args, { ignoreEnabled: true });
});

/* ── Path analysis ("visual traceroute") ──────────────────────────────
 * Two selected nodes → the routes between them over the links this frame
 * draws, by `analyzePath`: the function behind the `analyze_path` tool, so a
 * person and an agent get the same answer from the same page.
 *
 * Asking is a read. The route is spotlit as a PREVIEW (the editor draws the
 * frame as if it were emphasized; nothing is stored), and the bar offers the
 * three ways to keep it, each the tool's `show` option of the same name:
 * emphasize this frame, add a flow along the route, or copy the frame with
 * the route spotlit and captioned. While the bar is open the path is traced
 * again after every edit, so removing a link shows what the route becomes. */

/** Exactly two nodes are selected (and so there is a path to ask about). */
function canAnalyzePath(): boolean {
  return editor.selectedNodeIds().length === 2 && editor.selectionCount() === 2;
}

function analyzeSelectedPath(): void {
  if (!canAnalyzePath()) return;
  const [from, to] = editor.selectedNodeIds() as [string, string];
  pathSession = { from, to, index: 0, pageId: editor.page.id };
  renderPathBar();
}

let pathBar: {
  el: HTMLDivElement;
  title: HTMLDivElement;
  notes: HTMLDivElement;
  count: HTMLSpanElement;
  buttons: Record<string, HTMLButtonElement>;
} | null = null;

function closePathBar(): void {
  if (!pathSession && !pathBar) return;
  pathSession = null;
  pathBar?.el.remove();
  pathBar = null;
  editor.previewEmphasis(null);
}

/** The route on show, traced now (null when there is none). */
function shownPath(): ReturnType<typeof pathPanelView> | null {
  if (!pathSession || editor.page.id !== pathSession.pageId) return null;
  const analysis = analyzePath(editor.page, pathSession.from, pathSession.to, {
    layers: doc.layers,
  });
  // An end that is no longer on the frame (deleted since): nothing to show.
  if (analysis.status === 'unknown') return null;
  return pathPanelView(editor.page, analysis, pathSession.index);
}

const PATH_ACTIONS: {
  key: string;
  /** What the button runs. */
  command: CommandId;
  icon: IconName;
  /** Words after the icon; an action without them is the icon alone. */
  text?: string;
  title: string;
  /** Needs a route to act on. */
  route: boolean;
}[] = [
  {
    key: 'prev',
    command: 'path.prev',
    icon: 'chevron-left',
    title: 'Previous route',
    route: true,
  },
  {
    key: 'next',
    command: 'path.next',
    icon: 'chevron-right',
    title: 'Next route',
    route: true,
  },
  {
    key: 'swap',
    command: 'path.swap',
    icon: 'reverse',
    title: 'Trace the other way (the flow runs from the first node)',
    route: false,
  },
  {
    key: 'keep',
    command: 'path.keepEmphasis',
    icon: 'star',
    text: 'Emphasize',
    title: 'Keep this spotlight on the page',
    route: true,
  },
  {
    key: 'flow',
    command: 'path.addFlow',
    icon: 'flow',
    text: 'Add flow',
    title: 'Add a flow along this route',
    route: true,
  },
  {
    key: 'frame',
    command: 'path.newFrame',
    icon: 'duplicate',
    text: 'New page',
    title: 'Copy this page with the route spotlit and captioned',
    route: true,
  },
  {
    key: 'close',
    command: 'path.close',
    icon: 'x',
    title: 'Close path analysis',
    route: false,
  },
];

function runPathAction(key: string): void {
  const session = pathSession;
  if (!session) return;
  if (key === 'close') return closePathBar();
  if (key === 'swap') {
    pathSession = { ...session, from: session.to, to: session.from, index: 0 };
    return renderPathBar();
  }
  const view = shownPath();
  const route = view?.route;
  if (!view || !route) return;
  const page = editor.page;
  if (key === 'prev' || key === 'next') {
    session.index = view.index + (key === 'next' ? 1 : -1);
    renderPathBar();
  } else if (key === 'keep') {
    editor.setEmphasis(pathEmphasis(route));
  } else if (key === 'flow') {
    editor.addFlowPath({ id: genId('fp'), ...pathFlow(page, route) });
    renderInspector();
  } else if (key === 'frame') {
    const copy = duplicatePage(
      page,
      `Path: ${pathLabel(page, route)}`.slice(0, TEXT_LIMITS.name),
    );
    copy.emphasis = pathEmphasis(route);
    copy.caption = pathCaption(page, route);
    doc.pages.splice(current + 1, 0, copy);
    gotoPage(current + 1); // closes the bar: the new frame carries the route
    markDirty();
  }
}

function renderPathBar(): void {
  const view = shownPath();
  if (!view || !pathSession) return closePathBar();
  pathSession.index = view.index;
  editor.previewEmphasis(view.route ? pathEmphasis(view.route) : null);

  if (!pathBar) {
    const el = document.createElement('div');
    el.className = 'path-bar';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Path analysis');
    const text = document.createElement('div');
    text.className = 'path-text';
    text.setAttribute('role', 'status');
    const title = document.createElement('div');
    title.className = 'path-title';
    const notes = document.createElement('div');
    notes.className = 'path-notes';
    text.append(title, notes);
    const actions = document.createElement('div');
    actions.className = 'path-actions';
    const count = document.createElement('span');
    count.className = 'path-count';
    const buttons: Record<string, HTMLButtonElement> = {};
    for (const a of PATH_ACTIONS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = a.text ? 'btn btn-sm btn-ghost' : 'icon-btn';
      b.dataset.path = a.key;
      b.innerHTML = a.text ? `${icon(a.icon)}${a.text}` : icon(a.icon);
      b.title = a.title;
      b.setAttribute('aria-label', a.title);
      b.addEventListener('click', () => commands.run(a.command));
      buttons[a.key] = b;
      actions.append(b);
      if (a.key === 'prev') actions.append(count);
    }
    el.append(text, actions);
    // Escape closes it from anywhere, a focused button of the bar included:
    // Escape reaches the canvas's handler from every control (key-routing).
    app.appendChild(el);
    overCanvas(el);
    pathBar = { el, title, notes, count, buttons };
  }

  // Text only, never markup: labels come from the document.
  pathBar.el.classList.toggle('none', !view.found);
  pathBar.title.textContent = view.title;
  pathBar.notes.textContent = view.notes.join(' ');
  pathBar.notes.hidden = view.notes.length === 0;
  const many = view.count > 1;
  pathBar.count.textContent = many ? `${view.index + 1} / ${view.count}` : '';
  pathBar.count.hidden = !many;
  for (const a of PATH_ACTIONS) {
    const b = pathBar.buttons[a.key]!;
    b.hidden = a.route && !view.found;
    if (a.key === 'prev' || a.key === 'next') {
      b.hidden = !many;
      b.disabled =
        a.key === 'prev' ? view.index === 0 : view.index === view.count - 1;
    }
  }
}

/* Right-click context menu — adaptive to whatever is under the cursor. Its
 * items are listed in src/ui/menus.ts (`contextMenu`) and opened with the
 * shell's menu component at the pointer: each is a command of the registry,
 * labelled with the command's title (Lock / Unlock says what a press would
 * do), greyed out when the command is not enabled, and run through it. The
 * component closes it on Escape, a press outside, a blur and a resize. */
function openCtxMenu(
  clientX: number,
  clientY: number,
  kind?: 'node' | 'link' | 'empty',
): void {
  closeAllMenus();
  const fromKeyboard = kind !== undefined;
  // From the pointer, the menu is for what is under it (which it selects);
  // from the keyboard, for the selection as it is.
  const hit = kind ? { kind } : editor.pickAt(clientX, clientY);
  renderInspector();
  const ctx = menuContext();
  // What a command does to the selection shows in the properties at once.
  const runThenInspect: MenuContext['commands'] = {
    get: (id) => commands.get(id),
    isEnabled: (id) => commands.isEnabled(id),
    isChecked: (id) => commands.isChecked(id),
    shortcutLabel: (id) => commands.shortcutLabel(id),
    run: (id, args, options) => {
      const ran = commands.run(id, args, options);
      renderInspector();
      return ran;
    },
  };
  const entries = contextMenu(
    { ...ctx, commands: runThenInspect },
    {
      kind: hit.kind,
      at: editor.clientToPage(clientX, clientY),
      singleNode: !!editor.getSelectedNode(),
      canAnalyzePath: canAnalyzePath(),
    },
  );
  openMenu(entries, {
    anchor: { x: clientX, y: clientY },
    label: 'Canvas context menu',
    // Opened from the keyboard, it starts on its first item.
    ...(fromKeyboard ? { focus: 'first' as const } : {}),
  });
}

/**
 * Shift+F10 or the menu key: the context menu of the selection, opened at the
 * middle of its box (kept inside the canvas), or of the empty canvas at the
 * canvas's middle when nothing is selected. Escape closes it and gives the
 * keyboard back to the canvas, where it was.
 */
function openCtxMenuFromKeyboard(): void {
  const box = overlaySvg.getBoundingClientRect();
  const nodes = editor.selectedNodeIds();
  const link = nodes.length === 0 ? editor.getSelectedLink() : null;
  const kind = nodes.length > 0 ? 'node' : link ? 'link' : 'empty';
  // The points the selection is drawn through, in page units.
  const pts: { x: number; y: number }[] = [];
  if (nodes.length > 0) {
    for (const n of editor.page.nodes) {
      if (!nodes.includes(n.id)) continue;
      const b = nodeBounds(n);
      pts.push({ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h });
    }
  } else if (link) {
    for (const id of [link.from, link.to]) {
      const end =
        editor.page.nodes.find((m) => m.id === id) ??
        editor.page.anchors.find((m) => m.id === id);
      if (end) pts.push({ x: end.x, y: end.y });
    }
    pts.push(...(link.waypoints ?? []));
  }
  let x = box.left + box.width / 2;
  let y = box.top + box.height / 2;
  if (pts.length > 0) {
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const mid = userToClient(
      overlaySvg,
      (Math.min(...xs) + Math.max(...xs)) / 2,
      (Math.min(...ys) + Math.max(...ys)) / 2,
    );
    const pad = 8;
    x = Math.min(Math.max(mid.x, box.left + pad), box.right - pad);
    y = Math.min(Math.max(mid.y, box.top + pad), box.bottom - pad);
  }
  openCtxMenu(x, y, kind);
}

// Attached to the canvas host (an HTML box) rather than the overlay <svg>,
// because an svg root only dispatches contextmenu over painted geometry — a
// right-click on empty canvas would otherwise be missed.
const canvasHost = app.querySelector<HTMLElement>('.canvas-host')!;
canvasHost.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  openCtxMenu(e.clientX, e.clientY);
});
// Find closes on a press outside it.
window.addEventListener('pointerdown', (e) => {
  if (findEl && !findEl.contains(e.target as Node)) closeFind();
});
window.addEventListener('resize', () => editor.resync());

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

// A tab closed (or refreshed) while viewing a shared copy resumes it — edits
// made to the copy survive, and the local document stays parked. This runs
// last, once the editor is fully built: `loadDoc` reaches the palette, the
// preview cache and the inspector, which are set up further down than the
// share-link check above.
if (!shareMatch) {
  const sharedResume = loadLocal('shared');
  if (sharedResume) loadDoc(sharedResume, false, 'shared');
}
