/**
 * The core's `stepFollow` IS IWSDK's FollowSystem in PivotY.
 *
 * The follow rule used to live only in IWSDK's `Follower`, so any platform
 * without IWSDK had to re-derive it (the native host got it slightly wrong
 * twice). It now lives in the core as pure logic. This test is what makes
 * that move safe: it drives IWSDK's real `FollowSystem` in a headless world
 * and the core function side by side over the same head motion, frame by
 * frame, and requires the same window pose from both. If either changes,
 * this fails, and the web stays the reference.
 */
import {
  FollowBehavior,
  FollowSystem,
  Follower,
  PerspectiveCamera,
  Transform,
  World,
} from '@iwsdk/core';
import {
  DEFAULT_WINDOW_FOLLOW,
  enterFollow,
  stepFollow,
  type FollowOptions,
  type FollowState,
} from '@realitycollective/webxr-uiextensions';
import type { HeadPose, Vec3Tuple } from '@realitycollective/webxr-input';
import { Euler, Quaternion, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

interface Frame {
  head: HeadPose;
  dt: number;
}

/** A head that walks, turns past the angle limit, looks down and turns back. */
function script(): Frame[] {
  const frames: Frame[] = [];
  const euler = new Euler(0, 0, 0, 'YXZ');
  const q = new Quaternion();
  for (let i = 0; i < 240; i += 1) {
    const t = i / 72;
    const yaw = i < 80 ? 0 : i < 160 ? Math.min(1.1, (i - 80) * 0.02) : 1.1 - (i - 160) * 0.015;
    const pitch = i >= 120 && i < 140 ? -0.6 : 0.1 * Math.sin(t);
    euler.set(pitch, yaw, 0.05 * Math.sin(t * 3));
    q.setFromEuler(euler);
    const position: Vec3Tuple = [0.6 * Math.sin(t * 0.7), 1.6 + 0.02 * Math.sin(t * 5), -0.4 * t];
    // A dropped frame now and then, as a headset produces.
    const dt = i % 37 === 0 ? 3 / 72 : 1 / 72;
    frames.push({ head: { position, quaternion: [q.x, q.y, q.z, q.w] }, dt });
  }
  return frames;
}

interface Sample {
  position: Vec3Tuple;
  quaternion: [number, number, number, number];
}

function runIWSDK(options: FollowOptions, frames: Frame[]): Sample[] {
  const world = new World();
  world.registerComponent(Transform);
  world.registerComponent(Follower);
  world.scene = new Scene();
  const camera = new PerspectiveCamera();
  world.scene.add(camera);
  world.camera = camera;
  world.registerSystem(FollowSystem);

  const entity = world.createTransformEntity();
  const object = entity.object3D!;
  if (!object.parent) world.scene.add(object);
  entity.addComponent(Follower, {
    target: camera,
    offsetPosition: [...options.offset],
    behavior: FollowBehavior.PivotY,
    speed: options.speed,
    tolerance: options.tolerance,
    maxAngle: options.maxAngle,
  });

  const out: Sample[] = [];
  let time = 0;
  for (const frame of frames) {
    camera.position.set(...frame.head.position);
    camera.quaternion.set(...frame.head.quaternion);
    camera.updateMatrixWorld(true);
    time += frame.dt;
    world.update(frame.dt, time);
    object.updateMatrixWorld(true);
    const p = object.getWorldPosition(new Vector3());
    const q = object.getWorldQuaternion(new Quaternion());
    out.push({ position: [p.x, p.y, p.z], quaternion: [q.x, q.y, q.z, q.w] });
  }
  return out;
}

function runCore(options: FollowOptions, frames: Frame[]): Sample[] {
  let state: FollowState = enterFollow();
  return frames.map((frame) => {
    const step = stepFollow(state, frame.head, options, frame.dt);
    state = step.state;
    return { position: step.pose.position, quaternion: step.pose.quaternion };
  });
}

/** Same rotation, allowing for q and -q. */
function sameRotation(a: Sample['quaternion'], b: Sample['quaternion']): boolean {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 1 - dot < 1e-9;
}

describe('stepFollow matches IWSDK FollowSystem (PivotY)', () => {
  const cases: Array<[string, FollowOptions]> = [
    ['window defaults', { ...DEFAULT_WINDOW_FOLLOW, offset: [...DEFAULT_WINDOW_FOLLOW.offset] as Vec3Tuple }],
    ['tight follow', { offset: [0.3, 0.2, -0.8], speed: 6, tolerance: 0.05, maxAngle: 10 }],
    ['lazy follow', { offset: [-0.2, 0, -1.5], speed: 1, tolerance: 0.6, maxAngle: 45 }],
  ];

  for (const [name, options] of cases) {
    it(`${name}: the same pose every frame`, () => {
      const frames = script();
      const reference = runIWSDK(options, frames);
      const core = runCore(options, frames);
      expect(core).toHaveLength(reference.length);
      // The reference really moves, so agreement is not two idle windows.
      const first = reference[0]!.position;
      const last = reference[reference.length - 1]!.position;
      expect(Math.hypot(last[0] - first[0], last[2] - first[2])).toBeGreaterThan(0.5);
      for (let i = 0; i < frames.length; i += 1) {
        for (let axis = 0; axis < 3; axis += 1) {
          expect(Math.abs(core[i]!.position[axis]! - reference[i]!.position[axis]!)).toBeLessThan(1e-5);
        }
        expect(sameRotation(core[i]!.quaternion, reference[i]!.quaternion)).toBe(true);
      }
    });
  }
});
