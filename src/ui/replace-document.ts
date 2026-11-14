/**
 * What the editor asks before a document that was just imported or converted
 * takes the place of the one on the canvas.
 *
 * The question has to be true and complete: it used to count the nodes and
 * links of the first page only, however many pages the file had, and "Load
 * it?" never said that loading means the current diagram is replaced.
 */

/** As many warnings as are listed before the rest are only counted. */
const MAX_WARNINGS_SHOWN = 8;

/** "1 node", "2 nodes" — and "1 link", "0 links". */
function counted(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** The parts of an imported document the summary counts. */
export interface ImportedPages {
  pages: readonly {
    nodes: readonly unknown[];
    links: readonly unknown[];
  }[];
}

/**
 * The confirmation text for replacing the current diagram with an imported
 * one. `source` names what the file was, as it reads after "this": "Mermaid
 * flowchart", "draw.io diagram", "CSV data".
 */
export function importConfirmText(
  source: string,
  document: ImportedPages,
  warnings: readonly string[],
): string {
  const pages = document.pages.length;
  const nodes = document.pages.reduce((sum, p) => sum + p.nodes.length, 0);
  const links = document.pages.reduce((sum, p) => sum + p.links.length, 0);
  const contents =
    (pages > 1 ? `${counted(pages, 'page')}, ` : '') +
    `${counted(nodes, 'node')} and ${counted(links, 'link')}` +
    (pages > 1 ? ' in total' : '');

  let text =
    `Replace the current diagram with this ${source}?\n\n` +
    `It has ${contents}.`;
  if (warnings.length) {
    const shown = warnings.slice(0, MAX_WARNINGS_SHOWN);
    text +=
      `\n\n${counted(warnings.length, 'warning')} from the import:\n` +
      shown.map((w) => `- ${w}`).join('\n');
    if (warnings.length > shown.length)
      text += `\n+ ${warnings.length - shown.length} more`;
  }
  return text;
}
