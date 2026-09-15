/**
 * Hand menu - pure placement and visibility logic, no engine imports.
 *
 * A hand menu is a window in the `hand-locked` dock mode: a small panel that
 * rides on one hand and shows while that hand is raised with the palm toward
 * the viewer, in the manner of MRTK 2's hand menu. The developer picks the
 * hand, where the panel sits relative to the palm, and whether the palm gate
 * applies; this module turns those choices plus this frame's hand and head
 * poses into "is it visible, and where".
 *
 * Hand frame. Every adapter delivers a hand pose in the WebXR grip / hand
 * convention, so the offsets here mean the same thing on every engine:
 *
 * - origin at the palm (controller grip, or the hand's grip / wrist space)
 * - `-Z` points along the hand toward the fingertips
 * - `+Y` points out of the BACK of the hand, so the palm normal is `-Y`
 * - `+X` completes the right-handed frame; for a hand held palm-down it
 *   points to the wearer's right, which is the little-finger side of the
 *   right hand and the thumb side of the left
 *
 * Anchors are named from the hand's point of view so a menu reads the same
 * whichever hand carries it: `above` is beyond the fingertips, `wrist` is
 * back past the wrist, `inside` is the thumb side and `outside` the
 * little-finger side. The panel always turns to face the viewer.
 */
import type { PoseTuple, QuatTuple, Vec3Tuple } from '@realitycollective/webxr-input';

export type Hand = 'left' | 'right';

/** Where the panel sits relative to the palm. */
export type HandMenuAnchor = 'above' | 'inside' | 'outside' | 'wrist';

export interface HandMenuOptions {
  /** Which hand carries the menu; `either` shows on whichever palm is raised. */
  hand: Hand | 'either';
  anchor: HandMenuAnchor;
  /** Distance from the palm to the anchor point (meters). */
  anchorDistance: number;
  /** Extra hand-local offset added after the anchor (meters). */
  offset: Vec3Tuple;
  /** Show only while the palm faces the viewer. Off means always shown while tracked. */
  palmGate: boolean;
  /** Largest angle, in degrees, between the palm normal and the viewer for the gate to open. */
  palmAngle: number;
}

export const DEFAULT_HAND_MENU: Readonly<HandMenuOptions> = Object.freeze({
  hand: 'left',
  anchor: 'above',
  anchorDistance: 0.12,
  offset: [0, 0, 0] as Vec3Tuple,
  palmGate: true,
  palmAngle: 60,
});

/** Fill a partial set of options from the defaults. */
export function resolveHandMenu(options: Partial<HandMenuOptions> = {}): HandMenuOptions {
  return {
    ...DEFAULT_HAND_MENU,
    ...options,
    offset: [...(options.offset ?? DEFAULT_HAND_MENU.offset)] as Vec3Tuple,
  };
}

/** This frame's tracked hands; a hand that is not tracked is absent. */
export type HandPoses = Partial<Record<Hand, PoseTuple>>;

/** What the adapter applies this frame. */
export interface HandMenuPlacement {
  /** The hand the menu is riding, or `undefined` when none qualifies. */
  hand: Hand | undefined;
  /** Whether the menu should be shown (and hittable) this frame. */
  visible: boolean;
  /** World pose to apply while visible; kept at the last hand while hidden. */
  pose: PoseTuple | undefined;
}

/** Hand-local offset for an anchor, mirrored so both hands read the same. */
export function anchorOffset(anchor: HandMenuAnchor, hand: Hand, distance: number): Vec3Tuple {
  // Thumb side is -X on the right hand and +X on the left (see the frame note).
  const thumb = hand === 'right' ? -distance : distance;
  switch (anchor) {
    case 'above':
      return [0, 0, -distance];
    case 'wrist':
      return [0, 0, distance];
    case 'inside':
      return [thumb, 0, 0];
    case 'outside':
      return [-thumb, 0, 0];
  }
}

/**
 * Cosine of the angle between the palm normal and the direction to the
 * viewer: 1 is palm square on to the viewer, -1 is the back of the hand.
 */
export function palmFacing(hand: PoseTuple, viewer: Vec3Tuple): number {
  const normal = rotate(hand.quaternion, [0, -1, 0]);
  const toViewer = normalize(sub(viewer, hand.position));
  if (!toViewer) {
    return 1; // viewer at the hand: no direction to judge, treat as facing
  }
  return dot(normal, toViewer);
}

export function isPalmFacing(hand: PoseTuple, viewer: Vec3Tuple, angleDegrees: number): boolean {
  return palmFacing(hand, viewer) >= Math.cos((angleDegrees * Math.PI) / 180);
}

/** The menu's world pose for a hand: anchored in the hand frame, turned to face the viewer. */
export function handMenuPose(
  hand: PoseTuple,
  which: Hand,
  viewer: Vec3Tuple,
  options: HandMenuOptions,
): PoseTuple {
  const local = add(anchorOffset(options.anchor, which, options.anchorDistance), options.offset);
  const position = add(hand.position, rotate(hand.quaternion, local));
  return { position, quaternion: faceViewer(position, viewer) };
}

/**
 * Pick the hand for this frame: the configured one when it is tracked, or
 * for `either` the tracked hand whose palm faces the viewer most. The gate
 * is applied here too, so a fixed hand that is tracked but turned away still
 * yields `undefined`.
 */
export function pickHand(poses: HandPoses, viewer: Vec3Tuple, options: HandMenuOptions): Hand | undefined {
  const open = (pose: PoseTuple | undefined): boolean =>
    pose !== undefined && (!options.palmGate || isPalmFacing(pose, viewer, options.palmAngle));
  if (options.hand !== 'either') {
    return open(poses[options.hand]) ? options.hand : undefined;
  }
  const left = open(poses.left) ? palmFacing(poses.left!, viewer) : -Infinity;
  const right = open(poses.right) ? palmFacing(poses.right!, viewer) : -Infinity;
  if (left === -Infinity && right === -Infinity) {
    return undefined;
  }
  return right > left ? 'right' : 'left';
}

/** The per-frame entry point an adapter calls for each hand-locked window. */
export function evaluateHandMenu(
  poses: HandPoses,
  viewer: Vec3Tuple,
  options: HandMenuOptions,
): HandMenuPlacement {
  const hand = pickHand(poses, viewer, options);
  if (hand === undefined) {
    return { hand: undefined, visible: false, pose: undefined };
  }
  return { hand, visible: true, pose: handMenuPose(poses[hand]!, hand, viewer, options) };
}

// --- tuple maths --------------------------------------------------------------

function add(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3Tuple, b: Vec3Tuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v: Vec3Tuple): Vec3Tuple | undefined {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length === 0 ? undefined : [v[0] / length, v[1] / length, v[2] / length];
}

/** Rotate a vector by a unit quaternion [x, y, z, w]. */
export function rotate(q: QuatTuple, v: Vec3Tuple): Vec3Tuple {
  const [qx, qy, qz, qw] = q;
  // t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  return [
    v[0] + qw * tx + (qy * tz - qz * ty),
    v[1] + qw * ty + (qz * tx - qx * tz),
    v[2] + qw * tz + (qx * ty - qy * tx),
  ];
}

/**
 * Orientation whose local +Z (the face of a panel) points from `position`
 * to `viewer`, upright against world +Y. Straight above or below the viewer
 * there is no upright, so world +Z stands in for "up" there.
 */
export function faceViewer(position: Vec3Tuple, viewer: Vec3Tuple): QuatTuple {
  const z = normalize(sub(viewer, position)) ?? [0, 0, 1];
  let x = normalize(cross([0, 1, 0], z));
  if (!x) {
    x = normalize(cross([0, 0, 1], z))!;
  }
  const y = cross(z, x);
  return quaternionFromBasis(x, y, z);
}

/** Quaternion for the rotation whose columns are the given orthonormal axes. */
export function quaternionFromBasis(x: Vec3Tuple, y: Vec3Tuple, z: Vec3Tuple): QuatTuple {
  // Matrix (row-major) m[r][c] with columns x, y, z.
  const m00 = x[0], m01 = y[0], m02 = z[0];
  const m10 = x[1], m11 = y[1], m12 = z[1];
  const m20 = x[2], m21 = y[2], m22 = z[2];
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}
