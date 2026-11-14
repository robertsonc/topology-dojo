import { describe, expect, it } from 'vitest';
import { saveChip } from './save-status.js';

describe('saveChip', () => {
  it('reports a plain save quietly', () => {
    expect(saveChip('saved')).toEqual({
      state: 'saved',
      text: '✓ saved',
      title: 'Autosaved to this browser',
      actionable: false,
      announcement: '',
    });
  });

  it('says when it is a shared copy that was saved', () => {
    const chip = saveChip('saved', { shared: true });
    expect(chip.text).toBe('✓ saved · shared copy');
    expect(chip.title).toMatch(/your own document is untouched/);
  });

  it('uses the wording given for a load or a sync', () => {
    expect(saveChip('saved', { okText: '✓ synced' }).text).toBe('✓ synced');
    expect(
      saveChip('saved', { shared: true, okText: '👁 shared copy' }).text,
    ).toBe('👁 shared copy');
  });

  it('makes a failed save a button that is announced', () => {
    const chip = saveChip('failed');
    expect(chip.text).toBe('⚠ not saved — download JSON');
    expect(chip.actionable).toBe(true);
    expect(chip.announcement).toMatch(/^Not saved/);
    // The announcement names the control that rescues the work.
    expect(chip.announcement).toContain('not saved — download JSON');
  });

  it('makes a version from another tab a button that is announced', () => {
    const chip = saveChip('stale');
    expect(chip.text).toBe('⚠ changed in another tab — load it');
    expect(chip.actionable).toBe(true);
    expect(chip.announcement).toMatch(/^Another tab saved/);
  });

  it('has nothing to announce once a save lands', () => {
    expect(saveChip('saved').announcement).toBe('');
  });
});
