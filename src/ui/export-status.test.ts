import { describe, expect, it } from 'vitest';
import { exportKinds, exportReport } from './export-status.js';

describe('exportReport', () => {
  it('keeps the wording the svg and png buttons always had', () => {
    expect(exportReport('svg', 'ok', 'Doc_Frame.svg')).toEqual({
      state: 'ok',
      icon: 'check',
      message: 'exported svg',
      detail: 'Doc_Frame.svg',
    });
    expect(exportReport('png', 'pending').message).toBe('exporting png');
    expect(exportReport('svg', 'error', 'object URL blocked')).toEqual({
      state: 'error',
      icon: 'warning',
      message: 'svg export failed',
      detail: 'object URL blocked',
    });
  });

  it('marks each state with its own icon, and says it in words too', () => {
    // The icon is decorative (aria-hidden): the words carry the state.
    expect(exportReport('png', 'pending')).toMatchObject({
      icon: 'busy',
      message: 'exporting png',
    });
    expect(exportReport('png', 'ok')).toMatchObject({
      icon: 'check',
      message: 'exported png',
    });
    expect(exportReport('png', 'error')).toMatchObject({
      icon: 'warning',
      message: 'png export failed',
    });
    // No glyph is left in the text: it would be read out, and drawn by
    // whatever fallback font has it.
    for (const kind of exportKinds())
      for (const state of ['pending', 'ok', 'error'] as const)
        expect(exportReport(kind, state).message).toMatch(/^[a-z. ]+$/);
  });

  it('reports every state for the export menu items', () => {
    expect(exportReport('pdf-all', 'pending').message).toBe('exporting pdf');
    expect(exportReport('drawio', 'ok').message).toBe('exported draw.io');
    expect(exportReport('vsdx', 'ok').message).toBe('exported visio');
    expect(exportReport('pptx-layers', 'ok').message).toBe('exported pptx');
    expect(exportReport('mermaid', 'error').message).toBe(
      'mermaid export failed',
    );
    expect(exportReport('png-selection', 'error').message).toBe(
      'selection export failed',
    );
  });

  it('says "copied" for the clipboard export', () => {
    expect(exportReport('copy-png', 'pending').message).toBe('copying png');
    expect(exportReport('copy-png', 'ok').message).toBe('copied png');
    expect(exportReport('copy-png', 'error').message).toBe('png copy failed');
  });

  it('uses the message as the tooltip when there is no detail', () => {
    expect(exportReport('flipbook', 'ok').detail).toBe('exported flipbook');
    expect(exportReport('flipbook', 'ok', '').detail).toBe('exported flipbook');
  });

  it('still reports an export it has no name for', () => {
    expect(exportReport('gif', 'ok').message).toBe('exported gif');
  });

  it('fits the chip: no message is longer than 23 characters', () => {
    // The chip is 160px of 10px monospace (26 characters); the icon and the
    // space after it take three of them. Longer text is cut with an ellipsis.
    for (const kind of exportKinds())
      for (const state of ['pending', 'ok', 'error'] as const)
        expect(exportReport(kind, state).message.length).toBeLessThanOrEqual(
          23,
        );
  });
});
