/**
 * Placement rules the IWSDK systems apply each frame, as pure logic: the
 * UI Extensions master's "Focus bias" row and the region slot placement.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BILLBOARD_WHILE_DRAGGING,
  DEFAULT_DRAG_DELAY,
  DEFAULT_FOCUS_BIAS,
  DEFAULT_REGION,
  applyFocusBias,
  focusBiasAmount,
  normalizeRegion,
  regionSlotPose,
  yawQuaternion,
} from '../src/index.js';

describe('window placement defaults', () => {
  it('match the IWSDK UIWindow component: focus bias 0.02 m, drag delay 0.3 s, billboard on', () => {
    expect(DEFAULT_FOCUS_BIAS).toBe(0.02);
    expect(DEFAULT_DRAG_DELAY).toBe(0.3);
    expect(DEFAULT_BILLBOARD_WHILE_DRAGGING).toBe(true);
  });
});

describe('focus bias', () => {
  it('brings the focused window forward one step per window behind it', () => {
    expect(focusBiasAmount(0.02, 3, 0)).toBeCloseTo(0.04, 10);
    expect(focusBiasAmount(0.02, 3, 1)).toBeCloseTo(0.02, 10);
    expect(focusBiasAmount(0.02, 3, 2)).toBe(0);
    expect(focusBiasAmount(0.02, 1, 0)).toBe(0);
  });

  it('moves the window straight toward the viewer by the amount', () => {
    expect(applyFocusBias([0, 1.6, -1], [0, 1.6, 0], 0.04)).toEqual([0, 1.6, -0.96]);
  });

  it('leaves the window alone with no amount or with the viewer at the window', () => {
    expect(applyFocusBias([1, 2, 3], [0, 0, 0], 0)).toEqual([1, 2, 3]);
    expect(applyFocusBias([1, 2, 3], [1, 2, 3], 0.1)).toEqual([1, 2, 3]);
  });
});

describe('regionSlotPose', () => {
  it('places a slot in the region frame and copies the region orientation', () => {
    const region = normalizeRegion({ flow: 'row', pitch: 0.5 });
    const turned = yawQuaternion(Math.PI / 2);
    const pose = regionSlotPose({ position: [0, 1, -2], quaternion: turned }, region, 1);
    expect(pose.position[0]).toBeCloseTo(0, 10);
    expect(pose.position[1]).toBeCloseTo(1, 10);
    expect(pose.position[2]).toBeCloseTo(-2.5, 10);
    expect(pose.quaternion).toEqual(turned);
  });

  it('uses the core default region, a column of 0.35 m slots', () => {
    const pose = regionSlotPose({ position: [0, 0, 0], quaternion: [0, 0, 0, 1] }, DEFAULT_REGION, 2);
    expect(pose.position).toEqual([0, -0.7, 0]);
  });
});
