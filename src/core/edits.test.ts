import { describe, it, expect } from 'vitest';
import {
  moveNode,
  setOverrideField,
  clearOverrideField,
  cycleEmphasis,
  authoredThisBeat,
} from './edits.js';
import { resolve } from './resolve.js';
import type { Scene, Topology } from './model.js';

function fixture(): Scene {
  const topology: Topology = {
    nodes: {
      a: { id: 'a', type: 'ec', x: 100, y: 100, label: 'A', layerId: 'L1' },
      b: { id: 'b', type: 'ec', x: 300, y: 100, label: 'B', layerId: 'L1' },
    },
    links: {
      l: {
        id: 'l',
        type: 'line',
        from: 'a',
        to: 'b',
        waypoints: [],
        layerId: 'L1',
      },
    },
    zones: {},
    layers: {
      L1: { id: 'L1', name: 'Default', hiddenInEditor: false, locked: false },
    },
    viewBox: [0, 0, 400, 200],
    title: 'Test',
  };
  return {
    topology,
    beats: [
      { id: 'b1', name: 'One', overrides: {} },
      { id: 'b2', name: 'Two', overrides: { a: { emphasis: 'focus' } } },
    ],
  };
}

describe('moveNode', () => {
  it('on the base, moves the model position (structural edit)', () => {
    const s = fixture();
    moveNode(s, -1, 'a', 150.4, 175.6);
    expect(s.topology.nodes.a!.x).toBe(150); // rounded
    expect(s.topology.nodes.a!.y).toBe(176);
    expect(s.beats[0]!.overrides.a).toBeUndefined(); // no beat touched
  });

  it('on a beat, writes an x/y override and leaves the model untouched', () => {
    const s = fixture();
    moveNode(s, 0, 'a', 220, 130);
    expect(s.topology.nodes.a!.x).toBe(100); // model unchanged
    expect(s.beats[0]!.overrides.a).toEqual({ x: 220, y: 130 });
    // and it actually resolves to the new position
    expect(resolve(s, 0).elements.a!.x).toBe(220);
  });

  it('merges into an existing override rather than clobbering it', () => {
    const s = fixture();
    moveNode(s, 1, 'a', 250, 90);
    expect(s.beats[1]!.overrides.a).toEqual({
      emphasis: 'focus',
      x: 250,
      y: 90,
    });
  });
});

describe('setOverrideField / clearOverrideField', () => {
  it('sets a field on a beat', () => {
    const s = fixture();
    setOverrideField(s, 0, 'b', 'visible', false);
    expect(s.beats[0]!.overrides.b).toEqual({ visible: false });
  });

  it('clearing the last field removes the override entry entirely', () => {
    const s = fixture();
    setOverrideField(s, 0, 'b', 'visible', false);
    clearOverrideField(s, 0, 'b', 'visible');
    expect(s.beats[0]!.overrides.b).toBeUndefined();
  });

  it('clearing one field keeps the others', () => {
    const s = fixture();
    clearOverrideField(s, 1, 'a', 'emphasis'); // a also has nothing else here
    expect(s.beats[1]!.overrides.a).toBeUndefined();

    const s2 = fixture();
    setOverrideField(s2, 1, 'a', 'visible', false);
    clearOverrideField(s2, 1, 'a', 'emphasis');
    expect(s2.beats[1]!.overrides.a).toEqual({ visible: false });
  });

  it('setOverrideField is a no-op on the base', () => {
    const s = fixture();
    setOverrideField(s, -1, 'b', 'visible', false);
    expect(s.beats[0]!.overrides.b).toBeUndefined();
  });
});

describe('cycleEmphasis', () => {
  it('cycles inherit → focus → dim → neutral → inherit', () => {
    expect(cycleEmphasis(undefined)).toBe('focus');
    expect(cycleEmphasis('focus')).toBe('dim');
    expect(cycleEmphasis('dim')).toBe('neutral');
    expect(cycleEmphasis('neutral')).toBe(undefined);
  });
});

describe('authoredThisBeat', () => {
  it('returns the ids this beat overrides', () => {
    const s = fixture();
    expect(authoredThisBeat(s, 1)).toEqual(new Set(['a']));
    expect(authoredThisBeat(s, 0)).toEqual(new Set());
  });

  it('is empty for the base', () => {
    expect(authoredThisBeat(fixture(), -1)).toEqual(new Set());
  });
});
