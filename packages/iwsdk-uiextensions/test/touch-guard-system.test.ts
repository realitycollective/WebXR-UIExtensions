/**
 * The touch guard against a REAL IWSDK world with stand-in touch pointers.
 *
 * The pointers are the slice the system drives: `getIntersection`, `down`
 * and `up`. What is asserted is which of IWSDK's own `down` / `up` calls the
 * guard lets through, from the signed distance it computes off the
 * intersection's point, fingertip position and normal.
 */
import { PerspectiveCamera, World } from '@iwsdk/core';
import { Object3D, Scene, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { UITouchGuardSystem, sampleOf } from '../src/systems/touch-guard-system.js';

interface FakeIntersection {
  object: Object3D & { isVoidObject?: boolean };
  point: Vector3;
  pointerPosition?: Vector3;
  normal?: Vector3;
  distance: number;
}

function makePointer() {
  let intersection: FakeIntersection | undefined;
  const pointer = {
    down: vi.fn(),
    up: vi.fn(),
    getIntersection: () => intersection,
    /** IWSDK's own updater would call these; they must be swallowed. */
    iwsdkDown() {
      this.down({ timeStamp: 0, button: 0 });
    },
    iwsdkUp() {
      this.up({ timeStamp: 0, button: 0 });
    },
    set(next: FakeIntersection | undefined) {
      intersection = next;
    },
  };
  return pointer;
}

/** A panel facing +Z at the origin; a fingertip `z` in front of it. */
function over(object: Object3D, z: number, x = 0): FakeIntersection {
  return {
    object,
    point: new Vector3(x, 0, 0),
    pointerPosition: new Vector3(x, 0, z),
    normal: new Vector3(0, 0, 1),
    distance: Math.abs(z),
  };
}

function makeWorld(options: Record<string, unknown> = {}) {
  const world = new World();
  world.camera = new PerspectiveCamera();
  world.scene = new Scene();
  const pointers = { left: makePointer(), right: makePointer() };
  world.input = {
    xr: {
      multiPointers: {
        left: { getPointer: () => pointers.left },
        right: { getPointer: () => pointers.right },
      },
    },
  } as unknown as World['input'];
  // The spies as IWSDK would hold them, before the guard takes them over.
  const original = {
    left: { down: pointers.left.down, up: pointers.left.up },
    right: { down: pointers.right.down, up: pointers.right.up },
  };
  world.registerSystem(UITouchGuardSystem, { priority: -3.9, configData: options });
  return { world, pointers, original };
}

describe('UITouchGuardSystem', () => {
  it("swallows IWSDK's own down/up and issues its own from the signed distance", () => {
    const { world, pointers, original } = makeWorld();
    const panel = new Object3D();
    pointers.left.iwsdkDown();
    pointers.left.iwsdkUp();
    expect(original.left.down).not.toHaveBeenCalled();
    expect(original.left.up).not.toHaveBeenCalled();

    pointers.left.set(over(panel, 0.1));
    world.update(1 / 60, 1);
    expect(original.left.down).not.toHaveBeenCalled();
    pointers.left.set(over(panel, 0.01));
    world.update(1 / 60, 2);
    expect(original.left.down).toHaveBeenCalledTimes(1);
    expect(original.left.down).toHaveBeenCalledWith({ timeStamp: 2000, button: 0 });
    pointers.left.set(over(panel, 0.05));
    world.update(1 / 60, 3);
    expect(original.left.up).toHaveBeenCalledTimes(1);
  });

  it('a push through and back is one down and one up', () => {
    const { world, pointers, original } = makeWorld();
    const panel = new Object3D();
    for (const z of [0.1, 0.01, -0.02, -0.1, -0.3, -0.05, -0.01, 0.01, 0.05]) {
      pointers.left.set(over(panel, z));
      world.update(1 / 60, 0);
    }
    expect(original.left.down).toHaveBeenCalledTimes(1);
    expect(original.left.up).toHaveBeenCalledTimes(1);
  });

  it('losing hover behind the panel releases once, and a rear approach never presses', () => {
    const { world, pointers, original } = makeWorld();
    const panel = new Object3D();
    for (const z of [0.1, 0.01, -0.1]) {
      pointers.left.set(over(panel, z));
      world.update(1 / 60, 0);
    }
    pointers.left.set(undefined); // beyond the hover sphere
    world.update(1 / 60, 0);
    expect(original.left.up).toHaveBeenCalledTimes(1);
    // Coming back from behind: no press until the finger has been in front.
    for (const z of [-0.1, -0.01, 0.01, 0.05]) {
      pointers.left.set(over(panel, z));
      world.update(1 / 60, 0);
    }
    expect(original.left.down).toHaveBeenCalledTimes(1);
    pointers.left.set(over(panel, 0.01));
    world.update(1 / 60, 0);
    expect(original.left.down).toHaveBeenCalledTimes(2);
  });

  it('keeps the two hands independent and honours the normal of a turned panel', () => {
    const { world, pointers, original } = makeWorld();
    const panel = new Object3D();
    panel.rotation.y = Math.PI; // faces -Z now
    // The right fingertip at world -Z 1 cm is IN FRONT of this panel.
    pointers.right.set({
      object: panel,
      point: new Vector3(0, 0, 0),
      pointerPosition: new Vector3(0, 0, -0.01),
      normal: new Vector3(0, 0, 1),
      distance: 0.01,
    });
    world.update(1 / 60, 0);
    expect(original.right.down).toHaveBeenCalledTimes(1);
    expect(original.left.down).not.toHaveBeenCalled();
    expect(world.getSystem(UITouchGuardSystem)?.pressFor('right')?.held).toBe(true);
    expect(world.getSystem(UITouchGuardSystem)?.pressFor('left')?.held).toBe(false);
  });

  it('applies configured thresholds', () => {
    const { world, pointers, original } = makeWorld({ pressDistance: 0.05, releaseDistance: 0.08 });
    const panel = new Object3D();
    pointers.left.set(over(panel, 0.1));
    world.update(1 / 60, 0);
    pointers.left.set(over(panel, 0.04));
    world.update(1 / 60, 0);
    expect(original.left.down).toHaveBeenCalledTimes(1);
    pointers.left.set(over(panel, 0.07));
    world.update(1 / 60, 0);
    expect(original.left.up).not.toHaveBeenCalled();
    pointers.left.set(over(panel, 0.09));
    world.update(1 / 60, 0);
    expect(original.left.up).toHaveBeenCalledTimes(1);
  });

  it('restores the pointers on destroy', () => {
    const { world, pointers, original } = makeWorld();
    world.unregisterSystem(UITouchGuardSystem);
    pointers.left.iwsdkDown();
    expect(original.left.down).toHaveBeenCalledTimes(1);
  });

  it('is inert without XR input', () => {
    const world = new World();
    world.camera = new PerspectiveCamera();
    world.scene = new Scene();
    world.registerSystem(UITouchGuardSystem);
    expect(() => world.update(1 / 60, 0)).not.toThrow();
    expect(world.getSystem(UITouchGuardSystem)?.pressFor('left')).toBeUndefined();
  });
});

describe('sampleOf', () => {
  it('signs the distance by the target normal, and falls back to the unsigned one', () => {
    const panel = new Object3D();
    const pointer = { down() {}, up() {}, getIntersection: () => over(panel, -0.02) };
    expect(sampleOf(pointer)?.signedDistance).toBeCloseTo(-0.02);
    const plain = {
      down() {},
      up() {},
      getIntersection: () => ({ object: panel, point: new Vector3(), distance: 0.015 }),
    };
    expect(sampleOf(plain)?.signedDistance).toBe(0.015);
    const nothing = { down() {}, up() {}, getIntersection: () => undefined };
    expect(sampleOf(nothing)).toBeUndefined();
    const voidObject = Object.assign(new Object3D(), { isVoidObject: true });
    const empty = { down() {}, up() {}, getIntersection: () => over(voidObject, 0.01) };
    expect(sampleOf(empty)).toBeUndefined();
  });
});
