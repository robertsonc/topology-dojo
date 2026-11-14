/**
 * What the toolbar's export status chip says for each export.
 *
 * The svg and png buttons always reported how they went; the "export…" menu
 * (PDF, flipbook, draw.io, Visio, PowerPoint, Mermaid, clipboard, selection)
 * said nothing, or left the previous export's message standing. Every export
 * now reports the same three states through this one function.
 */

export type ExportState = 'pending' | 'ok' | 'error';

/** What the chip shows: its state, its text and its tooltip. */
export interface ExportReport {
  state: ExportState;
  message: string;
  detail: string;
}

/**
 * The short name of each export, by the value the toolbar uses for it (the
 * svg / png buttons and the options of the export… menu). Short, because the
 * chip is narrow: the longest message must still fit.
 */
const EXPORT_NAMES: Readonly<Record<string, string>> = {
  svg: 'svg',
  png: 'png',
  'pdf-page': 'pdf',
  'pdf-all': 'pdf',
  flipbook: 'flipbook',
  drawio: 'draw.io',
  vsdx: 'visio',
  pptx: 'pptx',
  'pptx-layers': 'pptx',
  mermaid: 'mermaid',
  'copy-png': 'png',
  'svg-selection': 'selection',
  'png-selection': 'selection',
};

/** Exports that go to the clipboard rather than to a downloaded file. */
const CLIPBOARD_EXPORTS = new Set(['copy-png']);

/** Every export kind this module can name. */
export function exportKinds(): string[] {
  return Object.keys(EXPORT_NAMES);
}

/**
 * The chip for export `kind` in `state`. `detail` is the downloaded file's
 * name on success, or the reason on failure; it becomes the tooltip.
 */
export function exportReport(
  kind: string,
  state: ExportState,
  detail?: string,
): ExportReport {
  const name = EXPORT_NAMES[kind] ?? kind;
  const copy = CLIPBOARD_EXPORTS.has(kind);
  const message =
    state === 'pending'
      ? `… ${copy ? 'copying' : 'exporting'} ${name}`
      : state === 'ok'
        ? `✓ ${copy ? 'copied' : 'exported'} ${name}`
        : `⚠ ${name} ${copy ? 'copy' : 'export'} failed`;
  return { state, message, detail: detail || message };
}
