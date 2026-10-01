/**
 * The pointer offer system against a REAL IWSDK world with stand-in
 * sub-pointers. What is asserted is what reaches the shared arbiter: which
 * intersections are offered as panel candidates, with what distance, and
 * whether a pressing pointer holds the selection lock.
 */
import { PanelUI, PerspectiveCamera, PokeInteractable, RayInteractable, Transform, World, type Entity } from '@iwsdk/core';
import { PointerArbiter } from '@realitycollective/webxr-input';
import { Object3D, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { createUIWindow } from '../src/factory.js';
import { UIWindow } from '../src/components.js';
import { registerUIExtensions } from '../src/register.js';
import { UIPointerOfferSystem, pointerOffersFor } from '../src/systems/pointer-offer-system.js';
import { UITouchGuardSystem } from '../src/systems/touch-guard-system.js';

type Kind = 'touch' | 'grab' | 'ray';
interface Hit {
  object: Object3D;
  point: { x: number; y: number; z: number };
  distance: number;
}

function makePointer(withButtons = true) {
  let current: Hit | undefined;
  let down = 0;
  const pointer: Record<string, unknown> = {
    getIntersection: () => current,
    down: () => {},
    up: () => {},
    hit(next: Hit | undefined) {
      current = next;
    },
    press(on: boolean) {
      down = on ? 1 : 0;
    },
  };
  if (withButtons) {
    pointer['getButtonsDown'] = () => new Set(down ? [0] : []);
  }
  return pointer as {
    hit(next: Hit | undefined): void;
    press(on: boolean): void;
    getIntersection(): Hit | undefined;
  };
}

function makeWorld(withButtons = true) {
  const world = new World();
  for (const component of [Transform, PanelUI, RayInteractable, PokeInteractable, UIWindow]) {
    world.registerComponent(component);
  }
  world.camera = new PerspectiveCamera();
  world.scene = new Scene();
  const pointers = {
    left: { touch: makePointer(withButtons), grab: makePointer(withButtons), ray: makePointer(withButtons) },
    right: { touch: makePointer(withButtons), grab: makePointer(withButtons), ray: makePointer(withButtons) },
  };
  const side = (hand: 'left' | 'right') => ({
    getPointer: (kind: Kind) => pointers[hand][kind],
    toggleSubPointer: () => true,
  });
  world.input = {
    xr: {
      multiPointers: { left: side('left'), right: side('right') },
      gamepads: { left: undefined, right: undefined },
      isPrimary: () => false,
      getPrimaryInputSource: () => undefined,
    },
  } as unknown as World['input'];
  return { world, pointers };
}

const hit = (object: Object3D, distance = 1, x = 0): Hit => ({ object, point: { x, y: 0.5, z: -2 }, distance });

function bareEntity(world: World, config: string): Entity {
  return world.createTransformEntity().addComponent(PanelUI, { config });
}

describe('UIPointerOfferSystem', () => {
  it('offers a ray hit on a window panel, named by its window id', () => {
    const { world, pointers } = makeWorld();
    const arbiter = new PointerArbiter();
    registerUIExtensions(world, { pointers: arbiter });
    const window = createUIWindow(world, { config: '/ui/w.uikitml', id: 'win' });
    const child = new Object3D();
    window.object3D!.add(child);
    pointers.right.ray.hit(hit(child, 2.5, 0.25));
    world.update(1 / 60, 0);
    const decision = arbiter.decision('right');
    expect(decision?.active).toBe('ray');
    expect(decision?.candidate?.targetKind).toBe('panel');
    expect(decision?.candidate?.targetId).toBe('win');
    expect(decision?.candidate?.distance).toBe(2.5);
    expect(decision?.candidate?.point).toEqual([0.25, 0.5, -2]);
    expect(arbiter.decision('left')?.active).toBeNull();
  });

  it('offers nothing for an intersection outside every panel', () => {
    const { world, pointers } = makeWorld();
    const arbiter = new PointerArbiter();
    registerUIExtensions(world, { pointers: arbiter });
    createUIWindow(world, { config: '/ui/w.uikitml', id: 'win' });
    pointers.right.ray.hit(hit(new Object3D()));
    world.update(1 / 60, 0);
    expect(arbiter.decision('right')?.active).toBeNull();
    expect(arbiter.decision('right')?.candidate).toBeNull();
  });

  it('offers touch and grab with the intersection distance, touch first', () => {
    const { world, pointers } = makeWorld();
    const arbiter = new PointerArbiter();
    registerUIExtensions(world, { pointers: arbiter });
    const window = createUIWindow(world, { config: '/ui/w.uikitml', id: 'win' });
    pointers.left.grab.hit(hit(window.object3D!, 0.03));
    world.update(1 / 60, 0);
    expect(arbiter.decision('left')?.active).toBe('grab');
    expect(arbiter.decision('left')?.candidate?.distance).toBe(0.03);
    pointers.left.touch.hit(hit(window.object3D!, 0.01));
    world.update(1 / 60, 0);
    expect(arbiter.decision('left')?.active).toBe('touch');
    expect(arbiter.decision('left')?.candidate?.distance).toBe(0.01);
    pointers.left.touch.hit(undefined);
    pointers.left.grab.hit(undefined);
    world.update(1 / 60, 0);
    expect(arbiter.decision('left')?.active).toBeNull();
  });

  it('names a bare panel by its config path', () => {
    const { world, pointers } = makeWorld();
    const arbiter = new PointerArbiter();
    registerUIExtensions(world, { pointers: arbiter });
    const bare = bareEntity(world, '/ui/bare.uikitml');
    pointers.right.ray.hit(hit(bare.object3D!));
    world.update(1 / 60, 0);
    expect(arbiter.decision('right')?.candidate?.targetId).toBe('/ui/bare.uikitml');
  });

  it('falls back to the entity index when there is no window id or config', () => {
    const { world, pointers } = makeWorld();
    const arbiter = new PointerArbiter();
    registerUIExtensions(world, { pointers: arbiter });
    const bare = bareEntity(world, '');
    pointers.right.ray.hit(hit(bare.object3D!));
    world.update(1 / 60, 0);
    expect(arbiter.decision('right')?.candidate?.targetId).toBe(String(bare.index));
  });

  it('a pressing panel ray holds the selection lock against a nearer object touch', () => {
    const { world, pointers } = makeWorld();
    const arbiter = new PointerArbiter();
    registerUIExtensions(world, { pointers: arbiter });
    const objects = arbiter.registerSet('objects', 'object');
    const window = createUIWindow(world, { config: '/ui/w.uikitml', id: 'win' });
    pointers.right.ray.hit(hit(window.object3D!, 3));
    pointers.right.ray.press(true);
    world.update(1 / 60, 0);
    expect(arbiter.decision('right')?.active).toBe('ray');
    objects.offer('right', 'touch', { targetId: 'thing', point: [0, 0, 0], distance: 0.01 });
    world.update(1 / 60, 1 / 60);
    expect(arbiter.decision('right')?.active).toBe('ray');
    expect(arbiter.decision('right')?.candidate?.targetKind).toBe('panel');
    pointers.right.ray.press(false);
    world.update(1 / 60, 2 / 60);
    expect(arbiter.decision('right')?.active).toBe('touch');
    expect(arbiter.decision('right')?.candidate?.targetId).toBe('thing');
  });

  it('treats a pointer without getButtonsDown as not pressing', () => {
    const { world, pointers } = makeWorld(false);
    const arbiter = new PointerArbiter();
    registerUIExtensions(world, { pointers: arbiter });
    const window = createUIWindow(world, { config: '/ui/w.uikitml', id: 'win' });
    pointers.right.ray.hit(hit(window.object3D!));
    world.update(1 / 60, 0);
    expect(arbiter.decision('right')?.active).toBe('ray');
  });

  it('registers at priority -3.95, before the touch guard, and exposes the offers', () => {
    const { world } = makeWorld();
    const arbiter = new PointerArbiter();
    registerUIExtensions(world, { pointers: arbiter });
    const offerSystem = world.getSystem(UIPointerOfferSystem) as unknown as { priority: number };
    const guard = world.getSystem(UITouchGuardSystem) as unknown as { priority: number };
    expect(offerSystem.priority).toBe(-3.95);
    expect(guard.priority).toBe(-3.9);
    const offers = pointerOffersFor(world);
    expect(offers.arbiter).toBe(arbiter);
    expect(offers.ownArbiter).toBe(false);
    expect(pointerOffersFor(world)).toBe(offers);
  });

  it('works without a shared arbiter, on one of its own', () => {
    const { world, pointers } = makeWorld();
    registerUIExtensions(world);
    const window = createUIWindow(world, { config: '/ui/w.uikitml', id: 'win' });
    pointers.right.ray.hit(hit(window.object3D!));
    world.update(1 / 60, 0);
    const offers = pointerOffersFor(world);
    expect(offers.ownArbiter).toBe(true);
    expect(offers.owns('right', 'ray')).toBe(true);
  });

  it('does nothing without XR input', () => {
    const { world } = makeWorld();
    world.input = {} as unknown as World['input'];
    const arbiter = new PointerArbiter();
    registerUIExtensions(world, { pointers: arbiter, touchGuard: false });
    world.update(1 / 60, 0);
    expect(arbiter.decision('right')).toBeUndefined();
  });

  it('leaves the arbiter when the system is unregistered', () => {
    const { world, pointers } = makeWorld();
    const arbiter = new PointerArbiter();
    registerUIExtensions(world, { pointers: arbiter });
    const offers = pointerOffersFor(world);
    const window = createUIWindow(world, { config: '/ui/w.uikitml', id: 'win' });
    pointers.right.ray.hit(hit(window.object3D!));
    world.update(1 / 60, 0);
    world.unregisterSystem(UIPointerOfferSystem);
    expect(offers.owns('right', 'ray')).toBe(false);
  });
});
