/**
 * One-call setup: register every UI Extensions system on a world.
 *
 * ```ts
 * const world = await World.create(container, { features: { spatialUI: true } });
 * const windows = registerUIExtensions(world);
 * ```
 *
 * The returned `WindowManager` is the API for changing window state from
 * app code (a hand menu, a keyboard shortcut): `hide`/`show`, `dockTo`/
 * `undock`/`returnHome`, `togglePin`/`setDockMode`, `minimize`/`restore`,
 * `setChrome` and `close`. The systems registered here apply every one of
 * those to the entities.
 */
import type { World } from '@iwsdk/core';
import { UIWindowSystem } from './systems/window-system.js';
import { UIDockSystem } from './systems/dock-system.js';
import { UIDragSystem } from './systems/drag-system.js';
import { UIDockRegionSystem } from './systems/dock-region-system.js';
import { UIControlsSystem } from './systems/controls-system.js';
import { windowManagerFor } from './manager-registry.js';
import type { WindowManager } from '@realitycollective/webxr-uiextensions';

export interface RegisterOptions {
  /** Disable the title-bar drag system. */
  drag?: boolean;
  /**
   * Disable near dragging (controller squeeze or hand pinch on the title
   * bar), leaving the far ray as the only way to move a window. On by
   * default; see `UIDragSystem` for what it does to IWSDK's pointers.
   */
  nearDrag?: boolean;
  /** Disable dock regions. */
  regions?: boolean;
  /** Disable the `data-uix` control upgrades. */
  controls?: boolean;
}

export function registerUIExtensions(
  world: World,
  options: RegisterOptions = {},
): WindowManager {
  world.registerSystem(UIWindowSystem).registerSystem(UIDockSystem);
  if (options.drag !== false) {
    world.registerSystem(UIDragSystem, {
      configData: { nearDrag: options.nearDrag !== false },
    });
  }
  if (options.regions !== false) {
    world.registerSystem(UIDockRegionSystem);
  }
  if (options.controls !== false) {
    world.registerSystem(UIControlsSystem);
  }
  return windowManagerFor(world);
}
