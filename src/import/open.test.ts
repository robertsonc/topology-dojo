/**
 * `classifyOpenedFile` — the pure decision seam extracted from the GUI
 * "open" file-input handler in `src/main.ts` (main.ts itself has no test
 * harness, per the R0 findings, so this is where the open-flow branching
 * logic is actually verified).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { classifyOpenedFile } from './open.js';

function readFixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../fixtures/legacy/${name}`, import.meta.url)),
    'utf8',
  );
}

describe('classifyOpenedFile', () => {
  it('detects and converts a real legacy Topology Studio fixture', () => {
    const text = readFixture('sdwan-branch.json');
    const c = classifyOpenedFile(text);
    expect(c.kind).toBe('legacy');
    if (c.kind !== 'legacy') return;
    expect(c.result.ok).toBe(true);
    if (!c.result.ok) return;
    expect(c.result.document.pages.length).toBe(3);
    expect(c.result.warnings.length).toBeGreaterThan(0);
  });

  it('classifies a native TopologyDocument (has a pages array) as native', () => {
    const text = JSON.stringify({
      title: 'Native doc',
      pages: [
        {
          id: 'p1',
          name: 'Frame 1',
          viewBox: '0 0 1050 700',
          nodes: [],
          links: [],
          anchors: [],
        },
      ],
      customNodes: [],
    });
    expect(classifyOpenedFile(text)).toEqual({ kind: 'native' });
  });

  it("classifies unparseable JSON as native, deferring to parseDoc's own error path", () => {
    expect(classifyOpenedFile('{not json')).toEqual({ kind: 'native' });
  });

  it('classifies unrelated JSON (no legacy markers) as native', () => {
    expect(classifyOpenedFile(JSON.stringify({ foo: 'bar' }))).toEqual({
      kind: 'native',
    });
  });

  it('surfaces a typed conversion failure for legacy-shaped-but-hopeless input', () => {
    // Detected as legacy (empty array collections still satisfy the
    // "pairish" shape sniff, plus a `viewBox` marker), but there is nothing
    // resolvable inside `nodes`/`links` for `convertLegacyStudio` to convert.
    const text = JSON.stringify({
      nodes: [],
      links: [],
      viewBox: '0 0 1050 700',
    });
    const c = classifyOpenedFile(text);
    expect(c.kind).toBe('legacy');
    if (c.kind !== 'legacy') return;
    expect(c.result.ok).toBe(false);
    if (c.result.ok) return;
    expect(c.result.error.code).toBe('invalid-input');
  });
});

describe('an imported document passes the same gate as a native one', () => {
  // parseDoc bounds free text, checks types and drops what is not usable; an
  // importer's output must get exactly that, whatever format it read.
  it('CSV', () => {
    const long = 'L'.repeat(900);
    const c = classifyOpenedFile(
      `[nodes]\nid,label\na,${long}\nb,Core\n[links]\nfrom,to\na,b\n`,
    );
    expect(c.kind).toBe('csv');
    if (c.kind !== 'csv' || !c.result.ok) throw new Error('csv not converted');
    const label = c.result.document!.pages[0]!.nodes[0]!.label ?? '';
    expect(label.length).toBeLessThanOrEqual(200);
  });

  it('Mermaid', () => {
    const long = 'L'.repeat(900);
    const c = classifyOpenedFile(`flowchart LR\n  a[${long}] --> b[Core]\n`);
    expect(c.kind).toBe('mermaid');
    if (c.kind !== 'mermaid' || !c.result.ok)
      throw new Error('mermaid not converted');
    const labels = c.result.document!.pages[0]!.nodes.map((n) => n.label ?? '');
    expect(Math.max(...labels.map((l) => l.length))).toBeLessThanOrEqual(200);
  });
});
