import { describe, expect, it } from 'vitest';
import type { PoseTuple, QuatTuple, Vec3Tuple } from '@realitycollective/webxr-input';
import {
  DEFAULT_HAND_MENU,
  anchorOffset,
  evaluateHandMenu,
  faceViewer,
  handMenuPose,
  isPalmFacing,
  palmFacing,
  pickHand,
  quaternionFromBasis,
  resolveHandMenu,
  rotate,
} from '../src/core/hand-menu.js';

const IDENTITY: QuatTuple = [0, 0, 0, 1];
/** 180° about Z: +Y becomes -Y, so the palm (-Y) faces +Y; fingertips stay along -Z, X mirrors. */
const PALM_UP: QuatTuple = [0, 0, 1, 0];

const hand = (position: Vec3Tuple, quaternion: QuatTuple = IDENTITY): PoseTuple => ({
  position,
  quaternion,
});

const close = (actual: Vec3Tuple, expected: Vec3Tuple): void => {
  expect(actual[0]).toBeCloseTo(expected[0], 6);
  expect(actual[1]).toBeCloseTo(expected[1], 6);
  expect(actual[2]).toBeCloseTo(expected[2], 6);
};

describe('hand menu options', () => {
  it('fills defaults and copies the offset', () => {
    const resolved = resolveHandMenu();
    expect(resolved).toEqual(DEFAULT_HAND_MENU);
    expect(resolved.offset).not.toBe(DEFAULT_HAND_MENU.offset);
    const offset: Vec3Tuple = [0.01, 0.02, 0.03];
    const custom = resolveHandMenu({ hand: 'right', anchor: 'wrist', offset, palmGate: false });
    expect(custom).toMatchObject({ hand: 'right', anchor: 'wrist', palmGate: false, palmAngle: 60 });
    expect(custom.offset).toEqual(offset);
    expect(custom.offset).not.toBe(offset);
  });

  it('places each anchor in the hand frame, mirrored for the other hand', () => {
    expect(anchorOffset('above', 'right', 0.1)).toEqual([0, 0, -0.1]);
    expect(anchorOffset('above', 'left', 0.1)).toEqual([0, 0, -0.1]);
    expect(anchorOffset('wrist', 'left', 0.1)).toEqual([0, 0, 0.1]);
    // Thumb side: -X on the right hand, +X on the left.
    expect(anchorOffset('inside', 'right', 0.1)).toEqual([-0.1, 0, 0]);
    expect(anchorOffset('inside', 'left', 0.1)).toEqual([0.1, 0, 0]);
    expect(anchorOffset('outside', 'right', 0.1)).toEqual([0.1, 0, 0]);
    expect(anchorOffset('outside', 'left', 0.1)).toEqual([-0.1, 0, 0]);
  });
});

describe('palm gate', () => {
  it('reads the palm normal as -Y of the hand frame', () => {
    // Identity hand at the origin: the palm points down, so a viewer below is
    // square on and a viewer above sees the back of the hand.
    expect(palmFacing(hand([0, 0, 0]), [0, -1, 0])).toBeCloseTo(1);
    expect(palmFacing(hand([0, 0, 0]), [0, 1, 0])).toBeCloseTo(-1);
    expect(palmFacing(hand([0, 0, 0]), [1, 0, 0])).toBeCloseTo(0);
    // Turned palm-up, a viewer above is square on.
    expect(palmFacing(hand([0, 0, 0], PALM_UP), [0, 1, 0])).toBeCloseTo(1);
    // The viewer at the hand has no direction to judge: treated as facing.
    expect(palmFacing(hand([1, 1, 1]), [1, 1, 1])).toBe(1);
  });

  it('opens within the angle and closes outside it', () => {
    const raised = hand([0, 0, 0], PALM_UP);
    expect(isPalmFacing(raised, [0, 1, 0], 60)).toBe(true);
    // 45° off: inside a 60° gate, outside a 30° one.
    expect(isPalmFacing(raised, [1, 1, 0], 60)).toBe(true);
    expect(isPalmFacing(raised, [1, 1, 0], 30)).toBe(false);
    expect(isPalmFacing(raised, [0, -1, 0], 60)).toBe(false);
  });
});

describe('placement', () => {
  it('anchors in the hand frame, applies the offset, and faces the viewer', () => {
    const options = resolveHandMenu({ anchor: 'above', anchorDistance: 0.1, offset: [0, 0.05, 0] });
    const pose = handMenuPose(hand([1, 1, 1]), 'left', [1, 1.05, 5], options);
    close(pose.position, [1, 1.05, 0.9]);
    // The panel's +Z points at the viewer, and it stays upright.
    close(rotate(pose.quaternion, [0, 0, 1]), [0, 0, 1]);
    close(rotate(pose.quaternion, [0, 1, 0]), [0, 1, 0]);
  });

  it('rotates the anchor with the hand', () => {
    const options = resolveHandMenu({ anchor: 'above', anchorDistance: 0.1 });
    // Palm-up hand: its -Z (fingertips) is still -Z, but +X is mirrored, so
    // the right hand's thumb side (-X locally) lands at world +X.
    const above = handMenuPose(hand([0, 0, 0], PALM_UP), 'right', [0, 2, 0], options);
    close(above.position, [0, 0, -0.1]);
    const inside = handMenuPose(
      hand([0, 0, 0], PALM_UP),
      'right',
      [0, 2, 0],
      resolveHandMenu({ anchor: 'inside', anchorDistance: 0.1 }),
    );
    close(inside.position, [0.1, 0, 0]);
    // The panel's +Z points from its own position to the viewer.
    const length = Math.hypot(0, 2, 0.1);
    close(rotate(above.quaternion, [0, 0, 1]), [0, 2 / length, 0.1 / length]);
  });
});

describe('faceViewer', () => {
  const forward = (q: QuatTuple): Vec3Tuple => rotate(q, [0, 0, 1]);

  it('points +Z at the viewer from every side', () => {
    close(forward(faceViewer([0, 0, 0], [0, 0, 5])), [0, 0, 1]);
    close(forward(faceViewer([0, 0, 0], [0, 0, -5])), [0, 0, -1]);
    close(forward(faceViewer([0, 0, 0], [5, 0, 0])), [1, 0, 0]);
    close(forward(faceViewer([0, 0, 0], [-3, 0, 4])), [-0.6, 0, 0.8]);
    // Straight above and below use the world-Z fallback for "up".
    close(forward(faceViewer([0, 0, 0], [0, 5, 0])), [0, 1, 0]);
    close(forward(faceViewer([0, 0, 0], [0, -5, 0])), [0, -1, 0]);
    // Viewer at the position: no direction, keep facing +Z.
    close(forward(faceViewer([1, 2, 3], [1, 2, 3])), [0, 0, 1]);
  });

  it('keeps the panel upright when the viewer is level', () => {
    close(rotate(faceViewer([0, 0, 0], [3, 0, -4]), [0, 1, 0]), [0, 1, 0]);
  });
});

describe('quaternionFromBasis', () => {
  const axes = (q: QuatTuple): [Vec3Tuple, Vec3Tuple, Vec3Tuple] => [
    rotate(q, [1, 0, 0]),
    rotate(q, [0, 1, 0]),
    rotate(q, [0, 0, 1]),
  ];

  it('recovers every rotation, whichever diagonal term dominates', () => {
    const cases: Array<[Vec3Tuple, Vec3Tuple, Vec3Tuple]> = [
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]], // identity: positive trace
      [[1, 0, 0], [0, -1, 0], [0, 0, -1]], // 180° about X: m00 dominates
      [[-1, 0, 0], [0, 1, 0], [0, 0, -1]], // 180° about Y: m11 dominates
      [[-1, 0, 0], [0, -1, 0], [0, 0, 1]], // 180° about Z: m22 dominates
    ];
    for (const [x, y, z] of cases) {
      const [rx, ry, rz] = axes(quaternionFromBasis(x, y, z));
      close(rx, x);
      close(ry, y);
      close(rz, z);
    }
  });
});

describe('hand selection', () => {
  const viewer: Vec3Tuple = [0, 2, 0];
  const raisedLeft = hand([-0.3, 0, 0], PALM_UP);
  const raisedRight = hand([0.3, 0, 0], PALM_UP);
  const loweredRight = hand([0.3, 0, 0]);

  it('uses the configured hand only while it is tracked and facing', () => {
    const left = resolveHandMenu({ hand: 'left' });
    expect(pickHand({ left: raisedLeft, right: raisedRight }, viewer, left)).toBe('left');
    expect(pickHand({ right: raisedRight }, viewer, left)).toBeUndefined();
    expect(pickHand({ left: hand([-0.3, 0, 0]) }, viewer, left)).toBeUndefined();
    // Gate off: tracked is enough.
    expect(pickHand({ left: hand([-0.3, 0, 0]) }, viewer, resolveHandMenu({ hand: 'left', palmGate: false }))).toBe('left');
  });

  it('either picks the hand whose palm faces the viewer most', () => {
    const either = resolveHandMenu({ hand: 'either' });
    expect(pickHand({}, viewer, either)).toBeUndefined();
    expect(pickHand({ left: raisedLeft }, viewer, either)).toBe('left');
    expect(pickHand({ right: raisedRight }, viewer, either)).toBe('right');
    expect(pickHand({ left: raisedLeft, right: loweredRight }, viewer, either)).toBe('left');
    // Both raised: the more squarely facing one wins; the right is closer to
    // square on when the viewer sits over it.
    expect(pickHand({ left: raisedLeft, right: raisedRight }, [0.3, 2, 0], either)).toBe('right');
    expect(pickHand({ left: raisedLeft, right: raisedRight }, [-0.3, 2, 0], either)).toBe('left');
  });

  it('evaluateHandMenu hides when no hand qualifies and places when one does', () => {
    const options = resolveHandMenu({ hand: 'right', anchor: 'above', anchorDistance: 0.1 });
    expect(evaluateHandMenu({}, viewer, options)).toEqual({ hand: undefined, visible: false, pose: undefined });
    const placed = evaluateHandMenu({ right: raisedRight }, viewer, options);
    expect(placed.hand).toBe('right');
    expect(placed.visible).toBe(true);
    close(placed.pose!.position, [0.3, 0, -0.1]);
  });
});
