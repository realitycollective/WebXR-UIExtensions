import { describe, expect, it } from 'vitest';
import { DEFAULT_CURSOR_OFFSET, cursorPlacement } from '../src/core/cursor.js';
import type { QuatTuple } from '@realitycollective/webxr-input';

const IDENTITY: QuatTuple = [0, 0, 0, 1];

describe('DEFAULT_CURSOR_OFFSET', () => {
  it('matches IWSDK CursorVisual’s own zOffset base value (0.004 m)', () => {
    expect(DEFAULT_CURSOR_OFFSET).toBe(0.004);
  });
});

describe('cursorPlacement', () => {
  it('nudges the hit point along the facing quaternion’s local +Z by the default offset', () => {
    const placement = cursorPlacement([0, 1.5, -1], IDENTITY);
    expect(placement.position).toEqual([0, 1.5, -1 + DEFAULT_CURSOR_OFFSET]);
    expect(placement.quaternion).toBe(IDENTITY);
  });

  it('accepts an explicit offset', () => {
    const placement = cursorPlacement([0, 0, 0], IDENTITY, 0.01);
    expect(placement.position[2]).toBeCloseTo(0.01, 9);
  });

  it('an offset of zero leaves the point exactly where the ray hit', () => {
    const placement = cursorPlacement([1, 2, 3], IDENTITY, 0);
    expect(placement.position).toEqual([1, 2, 3]);
  });

  it('the nudge follows a rotated facing, not the world axes', () => {
    // 90 degree yaw about Y: local +Z rotates to world +X.
    const yaw90: QuatTuple = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
    const placement = cursorPlacement([0, 0, 0], yaw90, 0.004);
    expect(placement.position[0]).toBeCloseTo(0.004, 9);
    expect(placement.position[1]).toBeCloseTo(0, 9);
    expect(placement.position[2]).toBeCloseTo(0, 9);
  });

  it('the returned quaternion is the facing given, unchanged', () => {
    const facing: QuatTuple = [0.5, 0.5, 0.5, 0.5];
    expect(cursorPlacement([0, 0, 0], facing).quaternion).toBe(facing);
  });
});
