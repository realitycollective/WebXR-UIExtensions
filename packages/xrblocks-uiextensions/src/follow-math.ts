/**
 * Follow-mode math - pure tuple arithmetic (no three.js) so it is fully
 * unit-testable. Windows in `body-follow` mode chase a target point that is
 * the viewer's head position plus a yaw-rotated offset (pitch/roll are
 * deliberately ignored so panels never tilt with the viewer's head).
 */
import type { HeadPose, Vec3Tuple } from '@realitycollective/webxr-uiextensions';

/** Extract the yaw (rotation about +Y) from a quaternion [x, y, z, w]. */
export function yawFromQuaternion(q: readonly [number, number, number, number]): number {
  const [x, y, z, w] = q;
  // Yaw of the quaternion's forward vector, projected onto the XZ plane.
  const forwardX = 2 * (x * z + w * y);
  const forwardZ = 1 - 2 * (x * x + y * y);
  return Math.atan2(forwardX, forwardZ);
}

/** Rotate an offset by a yaw angle (about +Y). */
export function rotateOffsetByYaw(offset: Vec3Tuple, yaw: number): Vec3Tuple {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const [x, y, z] = offset;
  return [x * cos + z * sin, y, -x * sin + z * cos];
}

/** World-space target position for a following window. */
export function followTarget(pose: HeadPose, offset: Vec3Tuple): Vec3Tuple {
  const rotated = rotateOffsetByYaw(offset, yawFromQuaternion(pose.quaternion));
  return [
    pose.position[0] + rotated[0],
    pose.position[1] + rotated[1],
    pose.position[2] + rotated[2],
  ];
}

/**
 * Frame-rate-independent exponential approach: fraction of the remaining
 * distance to cover this frame, for smoothing speed `speed` (1/s) over
 * `delta` seconds. 0 when delta/speed are non-positive, approaches 1 for
 * large steps.
 */
export function approachAlpha(speed: number, delta: number): number {
  if (!(speed > 0) || !(delta > 0)) {
    return 0;
  }
  return 1 - Math.exp(-speed * delta);
}

/** Move `current` toward `target` by `alpha`, returning the new position. */
export function approach(current: Vec3Tuple, target: Vec3Tuple, alpha: number): Vec3Tuple {
  return [
    current[0] + (target[0] - current[0]) * alpha,
    current[1] + (target[1] - current[1]) * alpha,
    current[2] + (target[2] - current[2]) * alpha,
  ];
}

/** Squared distance between two points (cheap tolerance checks). */
export function distanceSquared(a: Vec3Tuple, b: Vec3Tuple): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}
