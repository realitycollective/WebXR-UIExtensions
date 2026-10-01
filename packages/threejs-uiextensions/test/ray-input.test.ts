import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { rayOf, webxrRayInputAccess } from '../src/ray-input.js';

describe('rayOf', () => {
  it('finds the ray source matching a controller by identity', () => {
    const controllerA = {};
    const controllerB = {};
    const frame = {
      raySources: [
        { controller: controllerA, ray: { origin: { x: 1, y: 2, z: 3 }, direction: { x: 0, y: 0, z: -1 } } },
        { controller: controllerB, ray: { origin: { x: 4, y: 5, z: 6 }, direction: { x: 1, y: 0, z: 0 } } },
      ],
    };
    expect(rayOf(frame, controllerB)).toEqual({ origin: [4, 5, 6], direction: [1, 0, 0] });
  });

  it('is undefined for a controller with no ray source this frame', () => {
    expect(rayOf({ raySources: [] }, {})).toBeUndefined();
  });
});

describe('webxrRayInputAccess', () => {
  it('reports a ray for every visible controller, along its local -Z axis', () => {
    const controller = new Object3D();
    controller.position.set(1, 2, 3);
    controller.visible = true;
    controller.updateMatrixWorld(true);
    const access = webxrRayInputAccess([controller]);
    const frame = access.getFrame();
    expect(frame.raySources).toHaveLength(1);
    expect(frame.raySources[0]!.controller).toBe(controller);
    expect(frame.raySources[0]!.ray.origin).toEqual({ x: 1, y: 2, z: 3 });
    expect(frame.raySources[0]!.ray.direction.x).toBeCloseTo(0, 9);
    expect(frame.raySources[0]!.ray.direction.y).toBeCloseTo(0, 9);
    expect(frame.raySources[0]!.ray.direction.z).toBeCloseTo(-1, 9);
  });

  it('a rotated controller reports the rotated ray direction', () => {
    const controller = new Object3D();
    controller.rotation.set(0, Math.PI / 2, 0); // yaw +90deg: local -Z -> world -X
    controller.updateMatrixWorld(true);
    const access = webxrRayInputAccess([controller]);
    const { direction } = access.getFrame().raySources[0]!.ray;
    expect(direction.x).toBeCloseTo(-1, 5);
    expect(direction.z).toBeCloseTo(0, 5);
  });

  it('omits a controller three has marked not visible (no matching input source this frame)', () => {
    const visibleController = new Object3D();
    visibleController.visible = true;
    const hiddenController = new Object3D();
    hiddenController.visible = false;
    const access = webxrRayInputAccess([visibleController, hiddenController]);
    const sources = access.getFrame().raySources;
    expect(sources).toHaveLength(1);
    expect(sources[0]!.controller).toBe(visibleController);
  });
});
