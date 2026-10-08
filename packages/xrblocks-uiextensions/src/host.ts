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
  configureRendererForUikit,
  type UikitRenderer,
  type CreateRegionOptions,
  type CreateWindowOptions,
  type RegionHandle,
  type UixWindowHostOptions,
  type WindowHandle,
  type XrBlocksWindowHandle,
} from '@realitycollective/threejs-uiextensions';
import type { PointerArbiter } from '@realitycollective/webxr-input';
import { XrBlocksPointerBridge } from './pointer-bridge.js';
import type { XrBlocksRayInputAccess } from './ray-input.js';

export type { CreateRegionOptions, CreateWindowOptions, RegionHandle, UixWindowHostOptions, WindowHandle, XrBlocksWindowHandle };

/** Options for the XR Blocks {@link UixWindowHost}. */
export interface XrBlocksWindowHostOptions extends UixWindowHostOptions {
  /**
   * The app's shared pointer arbiter (the Interactions runtime's). Panels
   * then offer their touch, grab and ray candidates to it and act only with
   * a pointer kind it says owns the source. Omit it and the host arbitrates
   * on its own.
   */
  pointers?: PointerArbiter;
  /**
   * The engine's `WebGLRenderer` (`xb.core.renderer`, available from a
   * Script's `init()` on). The host configures it for uikit once, at
   * construction (`configureRendererForUikit`): transparent meshes sorted by
   * `renderOrder`, as uikit assigns, and local clipping on. Without it three
   * sorts panel plates and glyphs by camera distance and a plate hides its
   * own text; XR Blocks sets neither. IWSDK does the same inside its own UI
   * system. Omit it only if the app configures the renderer itself.
   */
  renderer?: UikitRenderer;
}

export class UixWindowHost extends ThreeJsWindowHost {
  /** The XR Blocks bridge, or `undefined` when the caller supplied its own `pointerBridgeFactory`. */
  private readonly xrBridge: XrBlocksPointerBridge | undefined;
  /** `xb.input`, read each frame to raycast the panels along every ray source. */
  private readonly xrRayInput: XrBlocksRayInputAccess | undefined;

  constructor(options: XrBlocksWindowHostOptions) {
    // xrblocks added `xb.input.getFrame()` in 0.20.0. Refuse an older input here, once, rather than
    // throwing from every frame's update.
    if (options.rayInput && typeof (options.rayInput as Partial<XrBlocksRayInputAccess>).getFrame !== 'function') {
      throw new Error('@realitycollective/xrblocks-uiextensions needs xrblocks 0.20 or later: the rayInput it was handed has no getFrame()');
    }
    const built: { bridge?: XrBlocksPointerBridge } = {};
    super({
      ...options,
      // Only when the caller has not already supplied one (a bare
      // `UixWindowHost` still gets the XR Blocks bridge by default, which is
      // what makes this package's own class useful to construct directly).
      pointerBridgeFactory:
        options.pointerBridgeFactory ??
        ((isLive) => {
          built.bridge = new XrBlocksPointerBridge({ isLive, ...(options.pointers ? { pointers: options.pointers } : {}) });
          return built.bridge;
        }),
    });
    this.xrBridge = built.bridge;
    this.xrRayInput = options.rayInput;
    if (options.renderer) configureRendererForUikit(options.renderer);
  }

  /** Drive per-frame from the engine loop (delta in SECONDS): the bridge reads this frame's rays and fingertips first, so hover, touch and the arbiter are current when the windows step. */
  override update(deltaSeconds: number): void {
    if (this.xrBridge && this.xrRayInput) this.xrBridge.updateFrame(this.xrRayInput.getFrame());
    super.update(deltaSeconds);
  }
}
