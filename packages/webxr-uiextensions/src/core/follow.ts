/**
 * Follow - the lazy yaw follow every following window and region uses, as
 * pure tuple logic with no engine imports.
 *
 * This is IWSDK 1.0's `FollowSystem` in its `PivotY` behaviour
 * (`@iwsdk/core/dist/ui/follow.js`, `update`), restated so every platform
 * moves a window the same way. IWSDK is the reference: a platform binding
 * that follows a window runs {@link stepFollow} once per frame and places the
 * window at the pose it returns. One frame does exactly what IWSDK does:
 *
 * 1. The viewer's orientation is reduced to its yaw (the YXZ Euler Y angle,
 *    as three.js extracts it), so head pitch and roll never tilt a window.
 * 2. The STRICT target is the head position plus the offset rotated by that
 *    yaw. The offset's `y` is honoured, so the default window offset puts a
 *    window 0.15 m below eye level. IWSDK 1.0 does this; IWSDK 0.5 replaced
 *    the height with the head's and ignored the offset's `y`.
 * 3. On the first frame after entering a follow mode (`state.synced` false)
 *    the window lands on the strict target, and the settled target becomes
 *    the strict target. No lerp.
 * 4. Otherwise the settled target moves to the strict target when it is
 *    more than `tolerance` metres away from it, or when the window is more
 *    than `maxAngle` degrees off the viewer's yaw forward. The distance is
 *    measured in 3D and the angle in the horizontal plane. The angle uses the window's position BEFORE this
 *    frame's move.
 * 5. The window position lerps toward the settled target by `dt * speed`.
 *    The factor is not clamped, as on IWSDK.
 * 6. The window turns to face the viewer about the vertical axis only: its
 *    local +Z points at the head, level with the window.
 *
 * Units: metres, seconds, degrees. Poses are world space. Quaternions are
 * `[x, y, z, w]`.
 */
import type { HeadPose, PoseTuple, QuatTuple, Vec3Tuple } from '@realitycollective/webxr-input';

/** The follow parameters. Every field is a constant a master row names. */
export interface FollowOptions {
  /** Head-relative offset in the viewer's yaw frame (metres). Its `y` is honoured: a negative `y` sits the window below eye level, as on IWSDK 1.0. */
  offset: Vec3Tuple;
  /** Lerp factor per second toward the settled target. */
  speed: number;
  /** Dead zone: the settled target moves only when the strict target is farther than this (metres). */
  tolerance: number;
  /** The settled target also moves when the window is more than this far off the yaw forward (degrees). */
  maxAngle: number;
}

/**
 * A following window's defaults: the `UIWindow` component values the IWSDK
 * binding passes to its `Follower` (`iwsdk-uiextensions/src/components.ts`),
 * with IWSDK's own `Follower.maxAngle`. These are NOT IWSDK's `Follower`
 * component defaults, which are offset `[0, 0, 0]`, speed `1`, tolerance `0.4`.
 */
export const DEFAULT_WINDOW_FOLLOW: Readonly<FollowOptions> = Object.freeze({
  offset: Object.freeze([0, -0.15, -1.2]) as unknown as Vec3Tuple,
  speed: 3,
  tolerance: 0.35,
  maxAngle: 30,
});

/**
 * A following region's defaults: IWSDK's `Follower` component defaults
 * (speed `1`, tolerance `0.4`, maxAngle `30`), because `createDockRegion`
 * sets only the offset, which defaults to `[0, -0.2, -1.4]`.
 */
export const DEFAULT_REGION_FOLLOW: Readonly<FollowOptions> = Object.freeze({
  offset: Object.freeze([0, -0.2, -1.4]) as unknown as Vec3Tuple,
  speed: 1,
  tolerance: 0.4,
  maxAngle: 30,
});

/** Fill a partial set of follow options from `defaults` (the window's, unless stated). */
export function resolveFollow(
  options: Partial<FollowOptions> = {},
  defaults: Readonly<FollowOptions> = DEFAULT_WINDOW_FOLLOW,
): FollowOptions {
  return {
    offset: [...(options.offset ?? defaults.offset)] as Vec3Tuple,
    speed: options.speed ?? defaults.speed,
    tolerance: options.tolerance ?? defaults.tolerance,
    maxAngle: options.maxAngle ?? defaults.maxAngle,
  };
}

/** What a following window carries from frame to frame. */
export interface FollowState {
  /** The window's current world position. */
  position: Vec3Tuple;
  /** The settled target the window is easing toward. */
  settled: Vec3Tuple;
  /** False until the first frame in a follow mode has snapped the window. */
  synced: boolean;
}

/** A fresh follow state that snaps on its first step: IWSDK's `needsPositionSync`. */
export function enterFollow(position: Vec3Tuple = [0, 0, 0]): FollowState {
  return { position: [...position] as Vec3Tuple, settled: [...position] as Vec3Tuple, synced: false };
}

/** One frame's result: the next state, and the world pose to place the window at. */
export interface FollowStep {
  state: FollowState;
  pose: PoseTuple;
}

/**
 * The yaw of `q` about +Y, as three.js `Euler.setFromQuaternion(q, 'YXZ').y`
 * computes it, including its handling of a view straight up or down.
 */
export function yawOf(q: QuatTuple): number {
  const [x, y, z, w] = q;
  const m13 = 2 * (x * z + w * y);
  const m33 = 1 - 2 * (x * x + y * y);
  const m23 = 2 * (y * z - w * x);
  if (Math.abs(Math.min(1, Math.max(-1, m23))) < 0.9999999) {
    return Math.atan2(m13, m33);
  }
  const m31 = 2 * (x * z - w * y);
  const m11 = 1 - 2 * (y * y + z * z);
  return Math.atan2(-m31, m11);
}

/** The quaternion for a rotation of `yaw` radians about +Y. */
export function yawQuaternion(yaw: number): QuatTuple {
  return [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
}

/** Rotate `v` by `yaw` radians about +Y. */
export function rotateByYaw(v: Vec3Tuple, yaw: number): Vec3Tuple {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return [v[0] * cos + v[2] * sin, v[1], -v[0] * sin + v[2] * cos];
}

/**
 * The yaw that turns an object's local +Z toward `viewer`, level with the
 * object: three.js `Object3D.lookAt` on a non-camera object with the target
 * at the object's own height. Yaw 0 when the viewer is directly above or
 * below, as `lookAt` degenerates there.
 */
export function yawToward(position: Vec3Tuple, viewer: Vec3Tuple): number {
  const dx = viewer[0] - position[0];
  const dz = viewer[2] - position[2];
  if (dx === 0 && dz === 0) {
    return 0;
  }
  return Math.atan2(dx, dz);
}

/** The strict follow target for this head pose: IWSDK 1.0's `strictFollowTarget`, the head position plus the offset rotated by the head's yaw. */
export function strictFollowTarget(head: HeadPose, offset: Vec3Tuple): Vec3Tuple {
  const rotated = rotateByYaw(offset, yawOf(head.quaternion));
  return [head.position[0] + rotated[0], head.position[1] + rotated[1], head.position[2] + rotated[2]];
}

/**
 * Degrees between the yaw forward (always a unit horizontal vector) and the
 * horizontal direction from the head to the window.
 */
function horizontalAngleDegrees(forward: Vec3Tuple, delta: Vec3Tuple): number {
  // three.js `normalize()` leaves a zero vector at zero, so the dot is 0 and
  // the angle 90 degrees - IWSDK then re-targets, and so does this.
  const dl = Math.hypot(delta[0], delta[2]);
  const dx = dl === 0 ? 0 : delta[0] / dl;
  const dz = dl === 0 ? 0 : delta[2] / dl;
  const dot = Math.min(1, Math.max(-1, forward[0] * dx + forward[2] * dz));
  return (Math.acos(dot) * 180) / Math.PI;
}

/**
 * Advance a following window by one frame of `dt` seconds. Pure: `state` is
 * not modified; the returned state replaces it. See the file comment for the
 * rule, step by step.
 */
export function stepFollow(
  state: FollowState,
  head: HeadPose,
  options: FollowOptions,
  dt: number,
): FollowStep {
  const yaw = yawOf(head.quaternion);
  const strict = strictFollowTarget(head, options.offset);
  const forward: Vec3Tuple = [-Math.sin(yaw), 0, -Math.cos(yaw)];
  const delta: Vec3Tuple = [
    state.position[0] - head.position[0],
    0,
    state.position[2] - head.position[2],
  ];

  let position: Vec3Tuple;
  let settled: Vec3Tuple;
  if (!state.synced) {
    position = [...strict] as Vec3Tuple;
    settled = [...strict] as Vec3Tuple;
  } else {
    settled = [...state.settled] as Vec3Tuple;
    const distance = Math.hypot(
      strict[0] - settled[0],
      strict[1] - settled[1],
      strict[2] - settled[2],
    );
    if (distance > options.tolerance || horizontalAngleDegrees(forward, delta) > options.maxAngle) {
      settled = [...strict] as Vec3Tuple;
    }
    const alpha = dt * options.speed;
    position = [
      state.position[0] + (settled[0] - state.position[0]) * alpha,
      state.position[1] + (settled[1] - state.position[1]) * alpha,
      state.position[2] + (settled[2] - state.position[2]) * alpha,
    ];
  }

  const facing = yawQuaternion(yawToward(position, head.position));
  return {
    state: { position, settled, synced: true },
    pose: { position: [...position] as Vec3Tuple, quaternion: facing },
  };
}

/**
 * The offset that keeps a window where it is when it starts following: its
 * position relative to the head, in the head's yaw frame. IWSDK's dock system
 * does this on unpin (`addFollower({ fromCurrentPose: true })`), so a window
 * resumes following from the bearing and distance it was released at. When
 * the window is within 10 cm of the head (squared length at most 0.01) the
 * `fallback` offset is kept, as there.
 */
export function followOffsetFromPose(
  windowPosition: Vec3Tuple,
  head: HeadPose,
  fallback: Vec3Tuple,
): Vec3Tuple {
  const relative: Vec3Tuple = [
    windowPosition[0] - head.position[0],
    windowPosition[1] - head.position[1],
    windowPosition[2] - head.position[2],
  ];
  const local = rotateByYaw(relative, -yawOf(head.quaternion));
  const lengthSq = local[0] * local[0] + local[1] * local[1] + local[2] * local[2];
  return lengthSq > 0.01 ? local : ([...fallback] as Vec3Tuple);
}
