/**
 * The follow rule: IWSDK's FollowSystem in PivotY, as pure logic. The
 * constants and the step order are IWSDK's; `iwsdk-uiextensions/test/follow-reference.test.ts`
 * proves the same trajectory against IWSDK's own system.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REGION_FOLLOW,
  DEFAULT_WINDOW_FOLLOW,
  enterFollow,
  followOffsetFromPose,
  resolveFollow,
  rotateByYaw,
  stepFollow,
  strictFollowTarget,
  yawOf,
  yawQuaternion,
  yawToward,
  type FollowState,
} from '../src/index.js';
import type { HeadPose, Vec3Tuple } from '@realitycollective/webxr-input';

const HEAD: HeadPose = { position: [0, 1.6, 0], quaternion: [0, 0, 0, 1] };
/** Where the default window offset puts a window with the head at 1.6 m: 0.15 m below eye level, as IWSDK 1.0 places it. */
const WIN_Y = 1.6 + DEFAULT_WINDOW_FOLLOW.offset[1];

function headAt(position: Vec3Tuple, yaw = 0, pitch = 0): HeadPose {
  // YXZ order: yaw about Y, then pitch about X.
  const cy = Math.cos(yaw / 2);
  const sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2);
  const sp = Math.sin(pitch / 2);
  return { position, quaternion: [cy * sp, sy * cp, -sy * sp, cy * cp] };
}

describe('follow defaults', () => {
  it('a window follows with offset [0, -0.15, -1.2], speed 3, tolerance 0.35 m and 30 degrees', () => {
    expect(DEFAULT_WINDOW_FOLLOW).toEqual({ offset: [0, -0.15, -1.2], speed: 3, tolerance: 0.35, maxAngle: 30 });
  });

  it('a region follows with IWSDK Follower defaults: speed 1, tolerance 0.4, offset [0, -0.2, -1.4]', () => {
    expect(DEFAULT_REGION_FOLLOW).toEqual({ offset: [0, -0.2, -1.4], speed: 1, tolerance: 0.4, maxAngle: 30 });
  });

  it('resolveFollow fills from the defaults and copies the offset', () => {
    const offset: Vec3Tuple = [1, 2, 3];
    const resolved = resolveFollow({ offset, speed: 5 });
    expect(resolved).toEqual({ offset: [1, 2, 3], speed: 5, tolerance: 0.35, maxAngle: 30 });
    expect(resolved.offset).not.toBe(offset);
    expect(resolveFollow({}, DEFAULT_REGION_FOLLOW).speed).toBe(1);
  });
});

describe('yaw helpers', () => {
  it('yawOf ignores pitch and roll', () => {
    expect(yawOf(headAt([0, 0, 0], 0.7, 0.4).quaternion)).toBeCloseTo(0.7, 10);
    expect(yawOf(yawQuaternion(-1.2))).toBeCloseTo(-1.2, 10);
  });

  it('yawOf handles a view straight down as three.js does', () => {
    const q = headAt([0, 0, 0], 0, -Math.PI / 2).quaternion;
    expect(Number.isFinite(yawOf(q))).toBe(true);
  });

  it('rotateByYaw turns the forward offset with the viewer', () => {
    const r = rotateByYaw([0, 0, -1], Math.PI / 2);
    expect(r[0]).toBeCloseTo(-1, 10);
    expect(r[2]).toBeCloseTo(0, 10);
  });

  it('yawToward points local +Z at the viewer and is 0 straight overhead', () => {
    expect(yawToward([0, 0, -1], [0, 0, 0])).toBeCloseTo(0, 10);
    expect(yawToward([1, 0, 0], [0, 0, 0])).toBeCloseTo(-Math.PI / 2, 10);
    expect(yawToward([0, 5, 0], [0, 0, 0])).toBe(0);
  });
});

describe('stepFollow', () => {
  it('honours the offset y, as IWSDK 1.0 does (0.5 used the head height)', () => {
    expect(strictFollowTarget(HEAD, [0, -0.15, -1.2])).toEqual([0, WIN_Y, -1.2]);
  });

  it('snaps to the strict target on the first frame, with no lerp', () => {
    const { state, pose } = stepFollow(enterFollow([5, 5, 5]), HEAD, DEFAULT_WINDOW_FOLLOW, 1 / 72);
    expect(pose.position).toEqual([0, WIN_Y, -1.2]);
    expect(state).toEqual({ position: [0, WIN_Y, -1.2], settled: [0, WIN_Y, -1.2], synced: true });
  });

  it('faces the head about the vertical axis only', () => {
    const { pose } = stepFollow(enterFollow(), headAt([0, 1.6, 0], 0, 0.5), DEFAULT_WINDOW_FOLLOW, 0.01);
    expect(pose.quaternion[0]).toBe(0);
    expect(pose.quaternion[2]).toBe(0);
    expect(pose.position[1]).toBe(WIN_Y);
  });

  it('ignores head pitch when placing the window', () => {
    const level = stepFollow(enterFollow(), headAt([0, 1.6, 0], 0.3, 0), DEFAULT_WINDOW_FOLLOW, 0.01);
    const pitched = stepFollow(enterFollow(), headAt([0, 1.6, 0], 0.3, 0.6), DEFAULT_WINDOW_FOLLOW, 0.01);
    expect(pitched.pose.position[0]).toBeCloseTo(level.pose.position[0], 10);
    expect(pitched.pose.position[2]).toBeCloseTo(level.pose.position[2], 10);
  });

  it('does not move inside the dead zone', () => {
    let state: FollowState = stepFollow(enterFollow(), HEAD, DEFAULT_WINDOW_FOLLOW, 0).state;
    // Step 0.3 m sideways: within the 0.35 m tolerance and the 30 degree limit.
    state = stepFollow(state, { ...HEAD, position: [0.3, 1.6, 0] }, DEFAULT_WINDOW_FOLLOW, 0.1).state;
    expect(state.settled).toEqual([0, WIN_Y, -1.2]);
    expect(state.position).toEqual([0, WIN_Y, -1.2]);
  });

  it('re-targets when the strict target leaves the dead zone and lerps by dt * speed', () => {
    let state: FollowState = stepFollow(enterFollow(), HEAD, DEFAULT_WINDOW_FOLLOW, 0).state;
    state = stepFollow(state, { ...HEAD, position: [0.4, 1.6, 0] }, DEFAULT_WINDOW_FOLLOW, 0.1).state;
    expect(state.settled).toEqual([0.4, WIN_Y, -1.2]);
    // 0.1 s at speed 3 covers 30 % of the way.
    expect(state.position[0]).toBeCloseTo(0.12, 10);
  });

  it('re-targets when the window drifts more than 30 degrees off the yaw forward', () => {
    let state: FollowState = stepFollow(enterFollow(), HEAD, DEFAULT_WINDOW_FOLLOW, 0).state;
    // Turn 40 degrees: the strict target moves about 0.82 m, and the angle is 40.
    const turned = headAt([0, 1.6, 0], (40 * Math.PI) / 180);
    const wide = { ...DEFAULT_WINDOW_FOLLOW, tolerance: 10 };
    state = stepFollow(state, turned, wide, 0.1).state;
    expect(state.settled[0]).toBeCloseTo(strictFollowTarget(turned, wide.offset)[0], 10);
    // 20 degrees does not, with the tolerance out of the way.
    let calm: FollowState = stepFollow(enterFollow(), HEAD, wide, 0).state;
    calm = stepFollow(calm, headAt([0, 1.6, 0], (20 * Math.PI) / 180), wide, 0.1).state;
    expect(calm.settled).toEqual([0, WIN_Y, -1.2]);
  });

  it('re-targets when the window sits at the head, where the angle is undefined', () => {
    // The window is exactly at the head, so the horizontal delta is zero and
    // the angle reads 90 degrees: past an 89 degree limit, it re-targets.
    const state: FollowState = { position: [0, 1.6, 0], settled: [0, 1.6, -2], synced: true };
    const wide = { ...DEFAULT_WINDOW_FOLLOW, tolerance: 10, maxAngle: 89 };
    const next = stepFollow(state, HEAD, wide, 0).state;
    expect(next.settled).toEqual([0, WIN_Y, -1.2]);
  });

  it('does not clamp the lerp factor, as IWSDK does not', () => {
    let state: FollowState = stepFollow(enterFollow(), HEAD, DEFAULT_WINDOW_FOLLOW, 0).state;
    state = stepFollow(state, { ...HEAD, position: [1, 1.6, 0] }, DEFAULT_WINDOW_FOLLOW, 0.5).state;
    expect(state.position[0]).toBeCloseTo(1.5, 10);
  });

  it('leaves the input state unchanged', () => {
    const state = enterFollow([1, 2, 3]);
    stepFollow(state, HEAD, DEFAULT_WINDOW_FOLLOW, 0.1);
    expect(state).toEqual({ position: [1, 2, 3], settled: [1, 2, 3], synced: false });
  });
});

describe('followOffsetFromPose', () => {
  it('expresses the window position in the head yaw frame', () => {
    const head = headAt([1, 1.6, 0], Math.PI / 2);
    const offset = followOffsetFromPose([0, 1.6, 0], head, [0, 0, -1.2]);
    expect(offset[0]).toBeCloseTo(0, 10);
    expect(offset[2]).toBeCloseTo(-1, 10);
  });

  it('keeps the fallback when the window is within 10 cm of the head', () => {
    expect(followOffsetFromPose([0, 1.65, 0], HEAD, [0, -0.15, -1.2])).toEqual([0, -0.15, -1.2]);
  });
});
