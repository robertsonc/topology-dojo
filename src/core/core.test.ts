import { describe, it, expect } from 'vitest';
import { resolve, validate, ResolveError } from './resolve.js';
import { diff } from './tween.js';
import type { Scene, Topology } from './model.js';

function fixture(): Scene {
  const topology: Topology = {
    nodes: {
      hub: {
        id: 'hub',
        type: 'ec',
        x: 100,
        y: 100,
        label: 'Hub',
        layerId: 'L1',
      },
      branch: {
        id: 'branch',
        type: 'ec',
        x: 300,
        y: 100,
        label: 'Branch',
        layerId: 'L1',
      },
      fw: {
        id: 'fw',
        type: 'firewall',
        x: 200,
        y: 250,
        label: 'FW',
        layerId: 'L1',
      },
    },
    links: {
      tun: {
        id: 'tun',
        type: 'tunnel3d',
        from: 'hub',
        to: 'branch',
        waypoints: [],
        layerId: 'L1',
      },
    },
    zones: {},
    layers: {
      L1: { id: 'L1', name: 'Default', hiddenInEditor: false, locked: false },
    },
    viewBox: [0, 0, 400, 350],
    title: 'Test',
  };

  return {
    topology,
    beats: [
      {
        id: 'b1',
        name: 'Reveal WAN',
        overrides: {
          // hide everything except hub/branch/tun at the start
          fw: { visible: false },
          tun: { flowActive: true },
        },
      },
      {
        id: 'b2',
        name: 'Add firewall',
        overrides: {
          fw: { visible: true, emphasis: 'focus' },
          // move the branch — should produce a tween
          branch: { x: 320, y: 120 },
        },
      },
    ],
  };
}

describe('resolve', () => {
  it('base view (beatIndex -1) shows everything at model positions', () => {
    const r = resolve(fixture(), -1);
    expect(r.beatName).toBe('Base');
    expect(r.elements.fw!.visible).toBe(true);
    expect(r.elements.branch!.x).toBe(300);
    expect(r.elements.tun!.flowActive).toBe(false);
  });

  it('beat 0 applies its delta and nothing else', () => {
    const r = resolve(fixture(), 0);
    expect(r.beatName).toBe('Reveal WAN');
    expect(r.elements.fw!.visible).toBe(false);
    expect(r.elements.tun!.flowActive).toBe(true);
    // unspecified fields inherit base
    expect(r.elements.branch!.x).toBe(300);
  });

  it('set-and-hold: beat 1 inherits beat 0 then layers its own delta', () => {
    const r = resolve(fixture(), 1);
    // flowActive set in beat 0 persists into beat 1 (inheritance)
    expect(r.elements.tun!.flowActive).toBe(true);
    // beat 1 overrides
    expect(r.elements.fw!.visible).toBe(true);
    expect(r.elements.fw!.emphasis).toBe('focus');
    expect(r.elements.branch!.x).toBe(320);
  });

  it('throws loudly on override referencing unknown element', () => {
    const scene = fixture();
    scene.beats[0]!.overrides['ghost'] = { visible: true };
    expect(() => resolve(scene, 0)).toThrow(ResolveError);
  });

  it('validate() collects all problems without throwing', () => {
    const scene = fixture();
    scene.beats[1]!.overrides['nope'] = { emphasis: 'dim' };
    const problems = validate(scene);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('nope');
  });
});

describe('diff / tween', () => {
  it('detects entering element and moved element between beats', () => {
    const scene = fixture();
    const t = diff(resolve(scene, 0), resolve(scene, 1));
    const fw = t.elements.find((e) => e.id === 'fw');
    const branch = t.elements.find((e) => e.id === 'branch');

    expect(fw?.entering).toBe(true);
    expect(fw?.emphasisChanged).toBe(true);
    expect(branch?.moved).toBe(true);
    expect(branch?.from).toEqual({ x: 300, y: 100 });
    expect(branch?.to).toEqual({ x: 320, y: 120 });
  });

  it('emits no transition for unchanged elements', () => {
    const scene = fixture();
    const t = diff(resolve(scene, 0), resolve(scene, 1));
    // hub never changes between beat 0 and 1
    expect(t.elements.find((e) => e.id === 'hub')).toBeUndefined();
  });
});
