/**
 * One `RegionRegistry` per IWSDK `World` (same pattern as the window
 * manager) so the drag and region systems share region state.
 */
import type { World } from '@iwsdk/core';
import { RegionRegistry } from '@realitycollective/webxr-uiextensions';

const registries = new WeakMap<World, RegionRegistry>();

export function regionRegistryFor(world: World): RegionRegistry {
  let registry = registries.get(world);
  if (!registry) {
    registry = new RegionRegistry();
    registries.set(world, registry);
  }
  return registry;
}
