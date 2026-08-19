/**
 * Laser-drag math — pure vector logic for title-bar window dragging.
 *
 * The interaction model matches the Quest system shell: grab the title bar
 * with the ray, and the window rides the ray at the distance it was grabbed
 * at, yawing to keep facing the user. All math is on plain `[x, y, z]`
 * tuples so it is trivially unit-testable; the ECS `DragSystem` shuttles
 * three.js vectors in and out.
 */
import type { Vec3 } from './region-layout.js';

export interface DragSession {
  /** Ray-hit distance at grab time; the window keeps riding at this range. */
  distance: number;
  /** Window origin minus grab point, world space, captured at grab time. */
  holdOffset: Vec3;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
const length = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);

export function normalize(v: Vec3): Vec3 {
  const len = length(v);
  if (len === 0) {
    throw new Error('[uix] cannot normalize a zero-length vector');
  }
  return scale(v, 1 / len);
}

/**
 * Begin a drag: capture how far along the ray the grab landed and where the
 * window origin sits relative to the grab point.
 */
export function beginDrag(rayOrigin: Vec3, grabPoint: Vec3, windowPosition: Vec3): DragSession {
  return {
    distance: length(sub(grabPoint, rayOrigin)),
    holdOffset: sub(windowPosition, grabPoint),
  };
}

/**
 * Window position for the current ray. `rayDirection` must be normalized
 * (pointer rays from the input layer already are).
 */
export function dragPosition(session: DragSession, rayOrigin: Vec3, rayDirection: Vec3): Vec3 {
  const point = add(rayOrigin, scale(rayDirection, session.distance));
  return add(point, session.holdOffset);
}

/**
 * Yaw (radians, three.js Y-up convention) that turns the window's -Z face
 * toward `viewer` — the "PivotY" billboard used while dragging so a window
 * never gets parked edge-on. Returns `current` when the viewer is directly
 * above/below (degenerate on the Y axis).
 */
export function faceViewerYaw(windowPosition: Vec3, viewer: Vec3, current: number): number {
  const dx = viewer[0] - windowPosition[0];
  const dz = viewer[2] - windowPosition[2];
  if (dx === 0 && dz === 0) {
    return current;
  }
  return Math.atan2(dx, dz);
}
