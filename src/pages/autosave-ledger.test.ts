import { describe, expect, it } from 'vitest';
import { AutosaveLedger } from './autosave-ledger.js';

describe('AutosaveLedger', () => {
  it('an idle tab has nothing to save', () => {
    const ledger = new AutosaveLedger();
    ledger.record('{"title":"A"}');
    expect(ledger.hasUnsaved('{"title":"A"}')).toBe(false);
  });

  it('a tab that changed its document has', () => {
    const ledger = new AutosaveLedger();
    ledger.record('{"title":"A"}');
    expect(ledger.hasUnsaved('{"title":"B"}')).toBe(true);
    ledger.record('{"title":"B"}');
    expect(ledger.hasUnsaved('{"title":"B"}')).toBe(false);
  });

  it('a tab that never loaded or saved anything has', () => {
    expect(new AutosaveLedger().hasUnsaved('{}')).toBe(true);
  });

  it("another tab's different save is news; an echo or a removal is not", () => {
    const ledger = new AutosaveLedger();
    ledger.record('{"title":"A"}');
    expect(ledger.isForeignChange('{"title":"B"}')).toBe(true);
    expect(ledger.isForeignChange('{"title":"A"}')).toBe(false);
    expect(ledger.isForeignChange(null)).toBe(false);
  });
});
