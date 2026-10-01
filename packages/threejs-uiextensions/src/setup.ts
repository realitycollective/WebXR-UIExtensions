/**
 * The one setup entry point for a plain three.js / WebXR app:
 * {@link connectUIExtensions} builds a `UixWindowHost` bound to a scene and a
 * camera, and, when a renderer is supplied, wires its pointer input straight
 * from the live WebXR session (`webxr-input.ts`) with no engine SDK beyond
 * three.js itself.
 *
 * Typical usage:
 *
 *   import { WebGLRenderer, PerspectiveCamera, Scene, Clock } from 'three';
 *   import { configureRendererForUikit, connectUIExtensions } from '@realitycollective/threejs-uiextensions';
 *
 *   const renderer = new WebGLRenderer({ antialias: true });
 *   configureRendererForUikit(renderer);
 *   renderer.xr.enabled = true;
 *
 *   const uix = connectUIExtensions({ scene, camera, renderer });
 *   const clock = new Clock();
 *   renderer.setAnimationLoop(() => {
 *     uix.update(clock.getDelta());
 *     renderer.render(scene, camera);
 *   });
 */
import type { Object3D, PerspectiveCamera } from 'three';
import type { Kit } from '@pmndrs/uikitml';
import type { PointerArbiter } from '@realitycollective/webxr-input';
import type { CursorVisualOptions } from './cursor-visual.js';
import { UixWindowHost, type UixWindowHostOptions } from './host.js';
import { ScenePointerBridge } from './pointer-bridge.js';
import { webxrRayInputAccess } from './ray-input.js';
import {
  cameraHeadPoseSource,
  connectWebXrPointerInput,
  webxrHandPoseSource,
  type WebXRManagerLike,
  type WebXrPointerInput,
} from './webxr-input.js';

export interface EngineContext {
  /** Where windows are parented. */
  scene: Object3D;
  /** The rendering camera; in XR the engine keeps it at the viewer pose. */
  camera: Pick<PerspectiveCamera, 'getWorldPosition' | 'getWorldQuaternion'>;
  /**
   * `renderer.xr` (three's `WebXRManager`). Supplied, this host wires its own
   * pointer input straight from the live WebXR session (ray/grab
   * press-release from select/squeeze events, touch from tracked hand
   * joints, hand poses for hand menus) - see `webxr-input.ts`. Left out on a
   * desktop preview with no session; drive the returned host's own
   * `pointerBridge` calls, or a bare raycaster via `pointer-forward.ts`-style
   * code, against its panels instead.
   */
  renderer?: { xr: WebXRManagerLike };
  /** Optional UIKitML component kit(s). */
  kit?: Kit;
  /** How many controller/hand slots to read from the session. Default 2. */
  controllerCount?: number;
  /** Meters within which a tracked fingertip is probed for a touch. Default 0.08 - see `connectWebXrPointerInput`. */
  touchDistance?: number;
  /** Meters within which a grip presses (near/grab). Default 0.12. */
  grabDistance?: number;
  /**
   * Cursor disc options (`ui/pointer-cursor`) - radius/offset for the disc
   * `connectWebXrPointerInput` draws at each ray's current hit. Ignored with
   * no `renderer`.
   */
  cursor?: CursorVisualOptions;
  /**
   * The pointer arbiter shared with `createThreeInteractions({ pointers })`,
   * so one decision per source covers panels and interactables, as IWSDK's
   * `MultiPointer` does. With it the Interactions binding draws every
   * cursor, panels included, and this host draws none. Omit for a UI-only app.
   */
  pointers?: PointerArbiter;
}

export interface ConnectedUIExtensions extends UixWindowHost {
  /** `UixWindowHost.update`, already combined with the WebXR pointer poll when `renderer` was supplied. Call once per render frame. */
  update(deltaSeconds: number): void;
  /** Stop the WebXR pointer wiring (its session event listeners). Also called by `dispose()`. Safe with no `renderer` supplied. */
  disconnect(): void;
}

/** Create a window host bound to a three.js scene, camera and (optionally) a live WebXR session - the one entry point this package's setup needs. */
export function connectUIExtensions(context: EngineContext): ConnectedUIExtensions {
  let bridge: ScenePointerBridge | undefined;
  const controllerCount = context.controllerCount ?? 2;

  const hostOptions: UixWindowHostOptions = {
    scene: context.scene,
    headPose: cameraHeadPoseSource(context.camera),
    // Captured here so `connectWebXrPointerInput` below drives the SAME
    // bridge instance every `createWindow` wires its panels onto.
    pointerBridgeFactory: (isLive) => {
      bridge = new ScenePointerBridge({ isLive });
      return bridge;
    },
    ...(context.kit ? { kit: context.kit } : {}),
    ...(context.renderer ? { handPose: webxrHandPoseSource(context.renderer.xr) } : {}),
    ...(context.renderer
      ? {
          rayInput: webxrRayInputAccess(
            Array.from({ length: controllerCount }, (_, index) => context.renderer!.xr.getController(index)),
          ),
        }
      : {}),
  };

  const host = new UixWindowHost(hostOptions);
  // The factory above runs synchronously inside the UixWindowHost
  // constructor, so `bridge` is always set by the time it returns.
  const scenePointerBridge = bridge!;

  let pointerInput: WebXrPointerInput | undefined;
  if (context.renderer) {
    pointerInput = connectWebXrPointerInput({
      renderer: context.renderer,
      bridge: scenePointerBridge,
      controllerCount,
      scene: context.scene,
      ...(context.touchDistance !== undefined ? { touchDistance: context.touchDistance } : {}),
      ...(context.grabDistance !== undefined ? { grabDistance: context.grabDistance } : {}),
      ...(context.cursor !== undefined ? { cursor: context.cursor } : {}),
      ...(context.pointers !== undefined ? { pointers: context.pointers } : {}),
    });
  }

  const connected = host as ConnectedUIExtensions;
  const baseUpdate = host.update.bind(host);
  const baseDispose = host.dispose.bind(host);
  connected.update = (deltaSeconds: number): void => {
    pointerInput?.update();
    baseUpdate(deltaSeconds);
  };
  connected.disconnect = (): void => {
    pointerInput?.dispose();
  };
  connected.dispose = (): void => {
    connected.disconnect();
    baseDispose();
  };
  return connected;
}
