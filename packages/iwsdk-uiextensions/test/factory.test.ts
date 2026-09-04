/**
 * Factory behaviour against a REAL IWSDK world.
 *
 * `new World()` from `@iwsdk/core` constructs headlessly: no renderer, no
 * WebGL, no XR session. That is enough for the ECS half of the SDK, which is
 * all these factories touch, so the components and values asserted here are
 * the ones a running app would carry rather than a fake's idea of them.
 */
import {
  Follower,
  FollowBehavior,
  PanelUI,
  PerspectiveCamera,
  PokeInteractable,
  RayInteractable,
  World,
} from '@iwsdk/core';
import { DockMode } from '@realitycollective/webxr-uiextensions';
import { describe, expect, it } from 'vitest';
import {
  RegionFlowType,
  UIDockRegion,
  UIDockedTo,
  UIWindow,
} from '../src/components.js';
import { createDockRegion, createUIWindow } from '../src/factory.js';

function makeWorld(): World {
  const world = new World();
  for (const component of [
    PanelUI,
    RayInteractable,
    PokeInteractable,
    Follower,
    UIWindow,
    UIDockRegion,
    UIDockedTo,
  ]) {
    world.registerComponent(component);
  }
  world.camera = new PerspectiveCamera();
  return world;
}

/**
 * A world whose entities carry no `object3D`, to prove the factories' guard
 * on it holds. IWSDK's own `createTransformEntity` always attaches one.
 */
function withoutTransforms(world: World): World {
  return new Proxy(world, {
    get(target, key) {
      if (key === 'createTransformEntity') {
        return () => target.createEntity();
      }
      const value = Reflect.get(target, key) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** Booleans live in a Uint8Array, so read them back as booleans. */
function flag(store: unknown, index: number): boolean {
  return Boolean((store as Uint8Array)[index]);
}

/** Read one Vec3 out of a component's flat storage, at float32 precision. */
function vec3(store: unknown, index: number): number[] {
  const array = store as Float32Array;
  return [...array.slice(index * 3, index * 3 + 3)].map(
    (value) => Math.round(value * 1000) / 1000,
  );
}

describe('createUIWindow', () => {
  it('applies the documented defaults', () => {
    const world = makeWorld();
    const entity = createUIWindow(world, { config: '/ui/clicker.uikitml' });

    expect(PanelUI.data.config[entity.index]).toBe('/ui/clicker.uikitml');
    expect(entity.hasComponent(UIWindow)).toBe(true);
    expect(entity.hasComponent(RayInteractable)).toBe(true);
    expect(entity.hasComponent(PokeInteractable)).toBe(true);
    expect(entity.hasComponent(UIDockedTo)).toBe(false);

    expect(UIWindow.data.windowId[entity.index]).toBe('');
    expect(UIWindow.data.title[entity.index]).toBe('');
    expect(UIWindow.data.dockMode[entity.index]).toBe(DockMode.WorldLocked);
    expect(flag(UIWindow.data.movable, entity.index)).toBe(true);
    expect(flag(UIWindow.data.closable, entity.index)).toBe(true);
    expect(flag(UIWindow.data.minimizable, entity.index)).toBe(true);
    expect(flag(UIWindow.data.pinnable, entity.index)).toBe(true);
    expect(flag(UIWindow.data.billboardWhileDragging, entity.index)).toBe(true);
    expect(UIWindow.data.targetWidth[entity.index]).toBe(0);
    expect(UIWindow.data.targetHeight[entity.index]).toBe(0);
    expect(UIWindow.data.followSpeed[entity.index]).toBe(3);
    expect(UIWindow.data.followTolerance[entity.index]).toBeCloseTo(0.35, 5);
    expect(vec3(UIWindow.data.followOffset, entity.index)).toEqual([0, -0.15, -1.2]);
    // No position given, so the entity stays at the origin.
    expect(entity.object3D?.position.toArray()).toEqual([0, 0, 0]);
  });

  it('applies every option it is given', () => {
    const world = makeWorld();
    const entity = createUIWindow(world, {
      config: '/ui/log.uikitml',
      id: 'log',
      title: 'Event log',
      dockMode: DockMode.BodyFollow,
      position: [1, 1.4, -2],
      maxWidth: 0.8,
      maxHeight: 0.6,
      movable: false,
      closable: false,
      minimizable: false,
      pinnable: false,
      billboardWhileDragging: false,
      followOffset: [0.1, -0.2, -1],
      followSpeed: 5,
      followTolerance: 0.1,
      region: 'left-rail',
    });

    expect(UIWindow.data.windowId[entity.index]).toBe('log');
    expect(UIWindow.data.title[entity.index]).toBe('Event log');
    expect(UIWindow.data.dockMode[entity.index]).toBe(DockMode.BodyFollow);
    expect(flag(UIWindow.data.movable, entity.index)).toBe(false);
    expect(flag(UIWindow.data.closable, entity.index)).toBe(false);
    expect(flag(UIWindow.data.minimizable, entity.index)).toBe(false);
    expect(flag(UIWindow.data.pinnable, entity.index)).toBe(false);
    expect(flag(UIWindow.data.billboardWhileDragging, entity.index)).toBe(false);
    expect(UIWindow.data.targetWidth[entity.index]).toBeCloseTo(0.8, 5);
    expect(UIWindow.data.targetHeight[entity.index]).toBeCloseTo(0.6, 5);
    expect(UIWindow.data.followSpeed[entity.index]).toBe(5);
    expect(UIWindow.data.followTolerance[entity.index]).toBeCloseTo(0.1, 5);
    expect(vec3(UIWindow.data.followOffset, entity.index)).toEqual([0.1, -0.2, -1]);
    expect(entity.object3D?.position.toArray()).toEqual([1, 1.4, -2]);
    expect(entity.hasComponent(UIDockedTo)).toBe(true);
    expect(UIDockedTo.data.regionId[entity.index]).toBe('left-rail');
  });

  it('skips positioning an entity that has no transform', () => {
    const world = makeWorld();
    const entity = createUIWindow(withoutTransforms(world), {
      config: '/ui/clicker.uikitml',
      position: [1, 2, 3],
    });
    expect(entity.object3D).toBeUndefined();
    expect(PanelUI.data.config[entity.index]).toBe('/ui/clicker.uikitml');
  });
});

describe('createDockRegion', () => {
  it('applies the documented defaults and adds no follower', () => {
    const world = makeWorld();
    const entity = createDockRegion(world, { id: 'rail' });

    expect(UIDockRegion.data.regionId[entity.index]).toBe('rail');
    expect(UIDockRegion.data.flow[entity.index]).toBe(RegionFlowType.Column);
    expect(UIDockRegion.data.pitch[entity.index]).toBeCloseTo(0.35, 5);
    expect(UIDockRegion.data.columns[entity.index]).toBe(2);
    expect(UIDockRegion.data.capacity[entity.index]).toBe(0);
    expect(UIDockRegion.data.snapRadius[entity.index]).toBeCloseTo(0.5, 5);
    expect(entity.hasComponent(Follower)).toBe(false);
    expect(entity.object3D?.position.toArray()).toEqual([0, 0, 0]);
  });

  it('applies every option it is given', () => {
    const world = makeWorld();
    const entity = createDockRegion(world, {
      id: 'grid',
      flow: RegionFlowType.Grid,
      pitch: 0.5,
      columns: 3,
      capacity: 6,
      snapRadius: 0.8,
      position: [0, 1.2, -1.5],
      follow: true,
      followOffset: [0, -0.4, -1.8],
    });

    expect(UIDockRegion.data.flow[entity.index]).toBe(RegionFlowType.Grid);
    expect(UIDockRegion.data.pitch[entity.index]).toBeCloseTo(0.5, 5);
    expect(UIDockRegion.data.columns[entity.index]).toBe(3);
    expect(UIDockRegion.data.capacity[entity.index]).toBe(6);
    expect(UIDockRegion.data.snapRadius[entity.index]).toBeCloseTo(0.8, 5);
    expect(entity.object3D?.position.toArray()).toEqual([0, 1.2, -1.5]);
    expect(entity.hasComponent(Follower)).toBe(true);
    // The camera, not player.head - the head rig is origin-locked outside XR.
    expect(Follower.data.target[entity.index]).toBe(world.camera);
    expect(Follower.data.behavior[entity.index]).toBe(FollowBehavior.PivotY);
    expect(vec3(Follower.data.offsetPosition, entity.index)).toEqual([0, -0.4, -1.8]);
  });

  it('body-locks at the default offset when follow is on without one', () => {
    const world = makeWorld();
    const entity = createDockRegion(world, { id: 'rail', follow: true });
    expect(vec3(Follower.data.offsetPosition, entity.index)).toEqual([0, -0.2, -1.4]);
  });

  it('skips positioning an entity that has no transform', () => {
    const world = makeWorld();
    const entity = createDockRegion(withoutTransforms(world), {
      id: 'rail',
      position: [1, 2, 3],
    });
    expect(entity.object3D).toBeUndefined();
    expect(UIDockRegion.data.regionId[entity.index]).toBe('rail');
  });
});
