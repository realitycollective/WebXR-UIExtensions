import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REGION,
  captureDrop,
  hasCapacity,
  normalizeRegion,
  slotOffset,
} from '../src/core/region-layout.js';

describe('region-layout', () => {
  it('normalizes partial definitions onto defaults and validates', () => {
    expect(normalizeRegion({})).toEqual(DEFAULT_REGION);
    expect(normalizeRegion({ flow: 'row', pitch: 0.5 })).toMatchObject({
      flow: 'row',
      pitch: 0.5,
      columns: DEFAULT_REGION.columns,
    });
    expect(() => normalizeRegion({ pitch: 0 })).toThrow(/pitch/);
    expect(() => normalizeRegion({ columns: 0 })).toThrow(/columns/);
    expect(() => normalizeRegion({ capacity: -1 })).toThrow(/capacity/);
    expect(() => normalizeRegion({ snapRadius: 0 })).toThrow(/snapRadius/);
  });

  it('lays slots out along +X for row and -Y for column', () => {
    const row = normalizeRegion({ flow: 'row', pitch: 0.4 });
    expect(slotOffset(row, 0)).toEqual([0, 0, 0]);
    expect(slotOffset(row, 2)).toEqual([0.8, 0, 0]);

    const column = normalizeRegion({ flow: 'column', pitch: 0.3 });
    expect(slotOffset(column, 1)).toEqual([0, -0.3, 0]);
  });

  it('lays grid slots in rows of `columns`', () => {
    const grid = normalizeRegion({ flow: 'grid', pitch: 1, columns: 2 });
    expect(slotOffset(grid, 0)).toEqual([0, 0, 0]);
    expect(slotOffset(grid, 1)).toEqual([1, 0, 0]);
    expect(slotOffset(grid, 2)).toEqual([0, -1, 0]);
    expect(slotOffset(grid, 5)).toEqual([1, -2, 0]);
  });

  it('rejects invalid slot indices', () => {
    expect(() => slotOffset(DEFAULT_REGION, -1)).toThrow(/slot index/);
    expect(() => slotOffset(DEFAULT_REGION, 1.5)).toThrow(/slot index/);
  });

  it('capacity 0 means unlimited', () => {
    expect(hasCapacity(normalizeRegion({ capacity: 0 }), 999)).toBe(true);
    expect(hasCapacity(normalizeRegion({ capacity: 2 }), 1)).toBe(true);
    expect(hasCapacity(normalizeRegion({ capacity: 2 }), 2)).toBe(false);
  });

  describe('captureDrop', () => {
    const region = normalizeRegion({ snapRadius: 1 });

    it('captures the nearest in-radius region with capacity', () => {
      const near = { id: 'near', origin: [0, 0, 0] as const, region, occupancy: 0 };
      const far = { id: 'far', origin: [0.9, 0, 0] as const, region, occupancy: 0 };
      expect(captureDrop([0.1, 0, 0], [far, near])?.id).toBe('near');
    });

    it('ignores out-of-radius and full regions', () => {
      const fullRegion = normalizeRegion({ snapRadius: 1, capacity: 1 });
      const full = { id: 'full', origin: [0, 0, 0] as const, region: fullRegion, occupancy: 1 };
      const away = { id: 'away', origin: [5, 5, 5] as const, region, occupancy: 0 };
      expect(captureDrop([0, 0, 0], [full, away])).toBeUndefined();
    });

    it('returns undefined with no candidates', () => {
      expect(captureDrop([0, 0, 0], [])).toBeUndefined();
    });
  });
});
