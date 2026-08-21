/**
 * One `WindowManager` per IWSDK `World`, lazily created. App code and the
 * systems in this package resolve the same instance through this registry,
 * so window state has a single home without a global singleton.
 */
import type { World } from '@iwsdk/core';
import { WindowManager } from '@realitycollective/webxr-uiextensions';

const managers = new WeakMap<World, WindowManager>();

export function windowManagerFor(world: World): WindowManager {
  let manager = managers.get(world);
  if (!manager) {
    manager = new WindowManager();
    managers.set(world, manager);
  }
  return manager;
}
