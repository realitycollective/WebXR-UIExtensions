import { describe, expect, it } from 'vitest';
import { fitScale } from '../src/scale-math.js';

describe('fitScale', () => {
  it('converts UIKit cm to meters and fits the limiting axis', () => {
    // 320cm × 200cm panel into 1m × 1m → width limits: 1 / 3.2
    expect(fitScale(1, 1, 320, 200)).toBeCloseTo(1 / 3.2);
    // Tall panel: height limits.
    expect(fitScale(1, 0.5, 100, 200)).toBeCloseTo(0.25);
  });

  it('preserves aspect ratio (uniform scale, min of both axes)', () => {
    const scale = fitScale(0.8, 0.9, 320, 200)!;
    expect(scale).toBeCloseTo(Math.min(0.8 / 3.2, 0.9 / 2));
  });

  it('returns undefined until layout has measured the panel', () => {
    expect(fitScale(1, 1, undefined, 200)).toBeUndefined();
    expect(fitScale(1, 1, 320, undefined)).toBeUndefined();
    expect(fitScale(1, 1, 0, 200)).toBeUndefined();
  });

  it('returns undefined for non-positive targets', () => {
    expect(fitScale(0, 1, 320, 200)).toBeUndefined();
    expect(fitScale(1, -1, 320, 200)).toBeUndefined();
  });
});
