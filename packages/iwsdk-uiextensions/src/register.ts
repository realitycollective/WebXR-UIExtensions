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
import { UITouchGuardSystem } from './systems/touch-guard-system.js';
import { windowManagerFor } from './manager-registry.js';
import type { TouchPressOptions, WindowManager } from '@realitycollective/webxr-uiextensions';

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
  /**
   * Press / hold / release for IWSDK's near (poke) pointers, so a finger
   * pushed through a panel and pulled back is one click, and a finger
   * arriving from behind is none. On by default; pass thresholds to tune
   * (meters, signed, positive in front), or `false` to keep IWSDK's own
   * unsigned-distance behaviour. See `UITouchGuardSystem`.
   */
  touchGuard?: boolean | Partial<TouchPressOptions>;
}

export function registerUIExtensions(
  world: World,
  options: RegisterOptions = {},
): WindowManager {
  // The dock system runs first: the hand-menu palm gate it writes each frame
  // is then applied by the window system in the same frame.
  world.registerSystem(UIDockSystem, { priority: -1 }).registerSystem(UIWindowSystem);
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
  if (options.touchGuard !== false) {
    const thresholds = typeof options.touchGuard === 'object' ? options.touchGuard : {};
    // Straight after InputSystem (-4) has moved the pointers, before anything
    // reacts to the presses.
    world.registerSystem(UITouchGuardSystem, { priority: -3.9, configData: thresholds });
  }
  return windowManagerFor(world);
}
