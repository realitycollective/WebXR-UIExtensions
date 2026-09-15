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
  palmNormal,
  pickHand,
  quaternionFromBasis,
  resolveHandMenu,
  rotate,
} from '../src/core/hand-menu.js';

const IDENTITY: QuatTuple = [0, 0, 0, 1];
const HALF = Math.SQRT1_2;
/**
 * Grip-frame rotations that turn each hand's palm normal to world +Y (a palm
 * raised toward a viewer overhead): the right palm is -X, so -90° about Z
 * takes it to +Y; the left palm is +X, so +90° about Z does.
 */
const RIGHT_PALM_UP: QuatTuple = [0, 0, -HALF, HALF];
const LEFT_PALM_UP: QuatTuple = [0, 0, HALF, HALF];

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

  it('places each anchor in the grip frame, the same for both hands', () => {
    // Fingertips are -Y (the arm is +Y), the thumb is -Z.
    expect(anchorOffset('above', 'right', 0.1)).toEqual([0, -0.1, 0]);
    expect(anchorOffset('above', 'left', 0.1)).toEqual([0, -0.1, 0]);
    expect(anchorOffset('wrist', 'left', 0.1)).toEqual([0, 0.1, 0]);
    expect(anchorOffset('inside', 'right', 0.1)).toEqual([0, 0, -0.1]);
    expect(anchorOffset('inside', 'left', 0.1)).toEqual([0, 0, -0.1]);
    expect(anchorOffset('outside', 'right', 0.1)).toEqual([0, 0, 0.1]);
    expect(anchorOffset('outside', 'left', 0.1)).toEqual([0, 0, 0.1]);
  });

  it('knows which way each palm faces', () => {
    expect(palmNormal('right')).toEqual([-1, 0, 0]);
    expect(palmNormal('left')).toEqual([1, 0, 0]);
  });
});

describe('palm gate', () => {
  it('reads the palm normal as -X on the right hand and +X on the left', () => {
    // Identity grip at the origin: the right palm faces -X, the left +X.
    expect(palmFacing(hand([0, 0, 0]), 'right', [-1, 0, 0])).toBeCloseTo(1);
    expect(palmFacing(hand([0, 0, 0]), 'right', [1, 0, 0])).toBeCloseTo(-1);
    expect(palmFacing(hand([0, 0, 0]), 'left', [1, 0, 0])).toBeCloseTo(1);
    expect(palmFacing(hand([0, 0, 0]), 'left', [0, 1, 0])).toBeCloseTo(0);
    // Turned palm-up, a viewer above is square on, for either hand.
    expect(palmFacing(hand([0, 0, 0], RIGHT_PALM_UP), 'right', [0, 1, 0])).toBeCloseTo(1);
    expect(palmFacing(hand([0, 0, 0], LEFT_PALM_UP), 'left', [0, 1, 0])).toBeCloseTo(1);
    // The viewer at the hand has no direction to judge: treated as facing.
    expect(palmFacing(hand([1, 1, 1]), 'right', [1, 1, 1])).toBe(1);
  });

  it('opens within the angle and closes outside it', () => {
    const raised = hand([0, 0, 0], LEFT_PALM_UP);
    expect(isPalmFacing(raised, 'left', [0, 1, 0], 60)).toBe(true);
    // 45° off: inside a 60° gate, outside a 30° one.
    expect(isPalmFacing(raised, 'left', [1, 1, 0], 60)).toBe(true);
    expect(isPalmFacing(raised, 'left', [1, 1, 0], 30)).toBe(false);
    expect(isPalmFacing(raised, 'left', [0, -1, 0], 60)).toBe(false);
  });
});

describe('placement', () => {
  it('anchors in the hand frame, applies the offset, and faces the viewer', () => {
    // Identity grip: fingertips are -Y, so "above" is below in world terms
    // and the extra offset nudges along +Z toward a viewer at +Z.
    const options = resolveHandMenu({ anchor: 'above', anchorDistance: 0.1, offset: [0, 0, 0.05] });
    const pose = handMenuPose(hand([1, 1, 1]), 'left', [1, 0.9, 5], options);
    close(pose.position, [1, 0.9, 1.05]);
    // The panel's +Z points at the viewer, and it stays upright.
    close(rotate(pose.quaternion, [0, 0, 1]), [0, 0, 1]);
    close(rotate(pose.quaternion, [0, 1, 0]), [0, 1, 0]);
  });

  it('rotates the anchor with the hand', () => {
    const options = resolveHandMenu({ anchor: 'above', anchorDistance: 0.1 });
    // Right palm turned up (-90° about Z): -Y (fingertips) lands at world -X,
    // and -Z (thumb) stays -Z.
    const above = handMenuPose(hand([0, 0, 0], RIGHT_PALM_UP), 'right', [0, 2, 0], options);
    close(above.position, [-0.1, 0, 0]);
    const inside = handMenuPose(
      hand([0, 0, 0], RIGHT_PALM_UP),
      'right',
      [0, 2, 0],
      resolveHandMenu({ anchor: 'inside', anchorDistance: 0.1 }),
    );
    close(inside.position, [0, 0, -0.1]);
    // The panel's +Z points from its own position to the viewer.
    const length = Math.hypot(0.1, 2, 0);
    close(rotate(above.quaternion, [0, 0, 1]), [0.1 / length, 2 / length, 0]);
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
  const raisedLeft = hand([-0.3, 0, 0], LEFT_PALM_UP);
  const raisedRight = hand([0.3, 0, 0], RIGHT_PALM_UP);
  // An identity grip: the right palm faces -X, level with the viewer overhead.
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
    // Right palm up: fingertips (-Y) point to world -X.
    close(placed.pose!.position, [0.2, 0, 0]);
  });
});
