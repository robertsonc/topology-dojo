import { describe, expect, it } from 'vitest';
import { exportKinds, exportReport } from './export-status.js';

describe('exportReport', () => {
  it('keeps the wording the svg and png buttons always had', () => {
    expect(exportReport('svg', 'ok', 'Doc_Frame.svg')).toEqual({
      state: 'ok',
      message: '✓ exported svg',
      detail: 'Doc_Frame.svg',
    });
    expect(exportReport('png', 'pending').message).toBe('… exporting png');
    expect(exportReport('svg', 'error', 'object URL blocked')).toEqual({
      state: 'error',
      message: '⚠ svg export failed',
      detail: 'object URL blocked',
    });
  });

  it('reports every state for the export menu items', () => {
    expect(exportReport('pdf-all', 'pending').message).toBe('… exporting pdf');
    expect(exportReport('drawio', 'ok').message).toBe('✓ exported draw.io');
    expect(exportReport('vsdx', 'ok').message).toBe('✓ exported visio');
    expect(exportReport('pptx-layers', 'ok').message).toBe('✓ exported pptx');
    expect(exportReport('mermaid', 'error').message).toBe(
      '⚠ mermaid export failed',
    );
    expect(exportReport('png-selection', 'error').message).toBe(
      '⚠ selection export failed',
    );
  });

  it('says "copied" for the clipboard export', () => {
    expect(exportReport('copy-png', 'pending').message).toBe('… copying png');
    expect(exportReport('copy-png', 'ok').message).toBe('✓ copied png');
    expect(exportReport('copy-png', 'error').message).toBe('⚠ png copy failed');
  });

  it('uses the message as the tooltip when there is no detail', () => {
    expect(exportReport('flipbook', 'ok').detail).toBe('✓ exported flipbook');
    expect(exportReport('flipbook', 'ok', '').detail).toBe(
      '✓ exported flipbook',
    );
  });

  it('still reports an export it has no name for', () => {
    expect(exportReport('gif', 'ok').message).toBe('✓ exported gif');
  });

  it('fits the chip: no message is longer than 26 characters', () => {
    // The chip is 160px of 10px monospace; longer text is cut with an ellipsis.
    for (const kind of exportKinds())
      for (const state of ['pending', 'ok', 'error'] as const)
        expect(exportReport(kind, state).message.length).toBeLessThanOrEqual(
          26,
        );
  });
});
