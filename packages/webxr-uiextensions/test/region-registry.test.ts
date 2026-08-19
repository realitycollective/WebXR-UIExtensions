import { describe, expect, it } from 'vitest';
import { RegionRegistry } from '../src/core/region-registry.js';
import type { Vec3 } from '../src/core/region-layout.js';

describe('RegionRegistry', () => {
  it('registers, gets, lists and rejects duplicates', () => {
    const registry = new RegionRegistry();
    const region = registry.register('wall', { flow: 'row' });
    expect(region.definition.flow).toBe('row');
    expect(registry.get('wall')).toBe(region);
    expect(registry.list()).toEqual([region]);
    expect(() => registry.register('wall')).toThrow(/already registered/);
  });

  it('docks windows into slot order and undocks with shift-up', () => {
    const registry = new RegionRegistry();
    registry.register('bar', { flow: 'column', pitch: 0.5 });
    expect(registry.dock('w1', 'bar')).toBe(0);
    expect(registry.dock('w2', 'bar')).toBe(1);
    expect(registry.offsetOf('w2')).toEqual([0, -0.5, 0]);

    expect(registry.undock('w1')).toBe('bar');
    // w2 shifted into slot 0.
    expect(registry.offsetOf('w2')).toEqual([0, 0, 0]);
    expect(registry.regionOf('w2')).toBe('bar');
    expect(registry.regionOf('w1')).toBeUndefined();
  });

  it('re-docking moves a window between regions', () => {
    const registry = new RegionRegistry();
    registry.register('a');
    registry.register('b');
    registry.dock('w', 'a');
    registry.dock('w', 'b');
    expect(registry.regionOf('w')).toBe('b');
    expect(registry.get('a')?.members).toEqual([]);
  });

  it('enforces capacity and unknown regions', () => {
    const registry = new RegionRegistry();
    registry.register('small', { capacity: 1 });
    registry.dock('w1', 'small');
    expect(() => registry.dock('w2', 'small')).toThrow(/full/);
    expect(() => registry.dock('w3', 'ghost')).toThrow(/unknown region/);
  });

  it('undock of an undocked window is a no-op', () => {
    const registry = new RegionRegistry();
    expect(registry.undock('loose')).toBeUndefined();
  });

  it('offsetOf returns undefined for undocked windows or vanished regions', () => {
    const registry = new RegionRegistry();
    expect(registry.offsetOf('w')).toBeUndefined();
    registry.register('r');
    registry.dock('w', 'r');
    registry.unregister('r');
    expect(registry.offsetOf('w')).toBeUndefined();
    expect(registry.regionOf('w')).toBeUndefined();
  });

  it('unregister of an unknown region is a no-op', () => {
    const registry = new RegionRegistry();
    expect(() => registry.unregister('ghost')).not.toThrow();
  });

  it('capture consults live origins and skips regions without one', () => {
    const registry = new RegionRegistry();
    registry.register('left', { snapRadius: 0.6 });
    registry.register('right', { snapRadius: 0.6 });
    const origins = new Map<string, Vec3>([
      ['left', [-1, 0, 0]],
      // 'right' has no origin this frame - not considered.
    ]);
    expect(registry.capture([-0.8, 0, 0], origins)).toBe('left');
    expect(registry.capture([5, 0, 0], origins)).toBeUndefined();
  });
});
