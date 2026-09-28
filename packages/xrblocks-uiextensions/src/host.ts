/**
 * UixWindowHost - the XR Blocks binding.
 *
 * Every window/panel/region rule (spawn, chrome, follow, dock regions, hand
 * menus, drag, focus bias) lives in
 * `@realitycollective/threejs-uiextensions`'s own `UixWindowHost`, which this
 * class extends unchanged - "one behaviour, every platform": XR Blocks IS a
 * three.js WebXR scene, so it runs the same host as the plain three.js
 * binding. The only thing added here is XR Blocks' own interaction surface:
 * `XrBlocksPointerBridge` (`pointer-bridge.ts`) turns its select/touch/grab/
 * hover callbacks into the pointer events and touch samples the shared host
 * already knows how to apply, in place of `threejs-uiextensions`'s own
 * WebXR-session raycasting bridge (`ScenePointerBridge`), which XR Blocks
 * does not need - its own interaction manager already resolves hit-testing.
 */
import {
  UixWindowHost as ThreeJsWindowHost,
  type CreateRegionOptions,
  type CreateWindowOptions,
  type RegionHandle,
  type UixWindowHostOptions,
  type WindowHandle,
  type XrBlocksWindowHandle,
} from '@realitycollective/threejs-uiextensions';
import { XrBlocksPointerBridge } from './pointer-bridge.js';

export type { CreateRegionOptions, CreateWindowOptions, RegionHandle, UixWindowHostOptions, WindowHandle, XrBlocksWindowHandle };

export class UixWindowHost extends ThreeJsWindowHost {
  constructor(options: UixWindowHostOptions) {
    super({
      ...options,
      // Only when the caller has not already supplied one (a bare
      // `UixWindowHost` still gets the XR Blocks bridge by default, which is
      // what makes this package's own class useful to construct directly).
      pointerBridgeFactory: options.pointerBridgeFactory ?? ((isLive) => new XrBlocksPointerBridge({ isLive })),
    });
  }
}
