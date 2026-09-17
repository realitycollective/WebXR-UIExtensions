import { describe, expect, it } from 'vitest';
import type { HeadPose, Vec3Tuple } from '@realitycollective/webxr-uiextensions';
import {
  approach,
  approachAlpha,
  distanceSquared,
  followTarget,
  rotateOffsetByYaw,
  yawFromQuaternion,
} from '../src/follow-math.js';

const IDENTITY: HeadPose = { position: [0, 1.6, 0], quaternion: [0, 0, 0, 1] };

describe('yawFromQuaternion', () => {
  it('is 0 for identity', () => {
    expect(yawFromQuaternion([0, 0, 0, 1])).toBeCloseTo(0);
  });

  it('recovers a pure yaw rotation', () => {
    const half = Math.PI / 4; // 90° yaw → sin/cos of 45°
    expect(yawFromQuaternion([0, Math.sin(half), 0, Math.cos(half)])).toBeCloseTo(
      Math.PI / 2,
    );
  });

  it('ignores pitch (head tilt does not steer follow)', () => {
    const half = Math.PI / 8;
    const pitchOnly: [number, number, number, number] = [
      Math.sin(half),
      0,
      0,
      Math.cos(half),
    ];
    expect(yawFromQuaternion(pitchOnly)).toBeCloseTo(0);
  });
});

describe('rotateOffsetByYaw', () => {
  it('keeps the offset unchanged at yaw 0', () => {
    const offset: Vec3Tuple = [0.5, -0.25, -1];
    expect(rotateOffsetByYaw(offset, 0)).toEqual(offset);
  });

  it('rotates the XZ plane and leaves Y alone', () => {
    const [x, y, z] = rotateOffsetByYaw([0, -0.2, -1], Math.PI / 2);
    expect(x).toBeCloseTo(-1);
    expect(y).toBeCloseTo(-0.2);
    expect(z).toBeCloseTo(0);
  });
});

describe('followTarget', () => {
  it('places the target relative to the head at identity yaw', () => {
    const target = followTarget(IDENTITY, [0, -0.15, -1.2]);
    expect(target[0]).toBeCloseTo(0);
    expect(target[1]).toBeCloseTo(1.45);
    expect(target[2]).toBeCloseTo(-1.2);
  });

  it('swings the target around when the viewer turns', () => {
    const half = Math.PI / 4; // 90° yaw
    const pose: HeadPose = {
      position: [2, 1.6, 3],
      quaternion: [0, Math.sin(half), 0, Math.cos(half)],
    };
    const target = followTarget(pose, [0, 0, -1]);
    expect(target[0]).toBeCloseTo(1); // -Z offset now points down -X
    expect(target[2]).toBeCloseTo(3);
  });
});

describe('approach', () => {
  it('is frame-rate independent in the limit', () => {
    // Two 1/60s steps ≈ one 1/30s step.
    const speed = 3;
    let twoSteps: Vec3Tuple = [0, 0, 0];
    for (let i = 0; i < 2; i += 1) {
      twoSteps = approach(twoSteps, [1, 0, 0], approachAlpha(speed, 1 / 60));
    }
    const oneStep = approach([0, 0, 0], [1, 0, 0], approachAlpha(speed, 2 / 60));
    expect(twoSteps[0]).toBeCloseTo(oneStep[0], 5);
  });

  it('alpha is 0 for non-positive inputs and saturates toward 1', () => {
    expect(approachAlpha(0, 1)).toBe(0);
    expect(approachAlpha(3, 0)).toBe(0);
    expect(approachAlpha(100, 10)).toBeCloseTo(1);
  });

  it('distanceSquared measures straight-line distance', () => {
    expect(distanceSquared([0, 0, 0], [3, 4, 0])).toBe(25);
  });
});
