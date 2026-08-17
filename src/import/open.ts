/**
 * Pure "what kind of file did the user just pick?" decision for the GUI open
 * flow (`src/main.ts`'s `#fInput` change handler). Extracted so the decision
 * — legacy Topology Studio vs. native `TopologyDocument` JSON — is unit
 * testable without touching the DOM; `main.ts` itself is untestable (no jsdom
 * harness, per the R0 findings) and stays a thin caller of this helper plus
 * the existing `loadDoc` / `closeWorkspaceForDocumentReplacement` machinery.
 */
import { convertLegacyStudio, detectLegacyStudio } from './legacy.js';
import type { LegacyConvertResult } from './legacy.js';
import { convertMermaid, detectMermaid } from './mermaid.js';
import type { MermaidConvertResult } from './mermaid.js';
import { convertCsv, detectCsv } from './csv.js';
import type { CsvConvertResult } from './csv.js';

export type OpenFileClassification =
  | { kind: 'legacy'; result: LegacyConvertResult }
  /** A Mermaid flowchart (`flowchart …` / `graph …`) — converted + laid out. */
  | { kind: 'mermaid'; result: MermaidConvertResult }
  /** Tabular data (sectioned nodes/links CSV or a bare edge list). */
  | { kind: 'csv'; result: CsvConvertResult }
  /** Not a legacy-shaped document (or not parseable JSON at all) — the
   * caller's existing `parseDoc(text)` path handles it unchanged, including
   * its own "not valid JSON" failure mode. */
  | { kind: 'native' };

/**
 * Classify raw file text from the "open" file picker. Never throws: a
 * `JSON.parse` failure first sniffs the text-based formats (Mermaid, CSV),
 * then falls back to `{ kind: 'native' }` so the caller's existing
 * `parseDoc`-based error handling (which re-parses and reports "not a valid
 * Topology Dojo document") stays the single source of truth for that failure.
 */
export function classifyOpenedFile(text: string): OpenFileClassification {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    if (detectMermaid(text))
      return { kind: 'mermaid', result: convertMermaid(text) };
    if (detectCsv(text)) return { kind: 'csv', result: convertCsv(text) };
    return { kind: 'native' };
  }
  if (!detectLegacyStudio(json)) return { kind: 'native' };
  return { kind: 'legacy', result: convertLegacyStudio(json) };
}
