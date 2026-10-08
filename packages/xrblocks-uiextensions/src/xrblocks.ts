/**
 * XR Blocks glue.
 *
 * XR Blocks (https://github.com/google/xrblocks) is three.js-based: a
 * Script's `scene`/`camera` are ordinary three.js objects, and `update()`
 * runs per frame. This module binds a {@link UixWindowHost} to that shape
 * WITHOUT importing `xrblocks` (loose structural types), so the package
 * works identically in an XR Blocks Script and in any hand-rolled three.js
 * WebXR app.
 *
 * Typical XR Blocks usage:
 *
 *   import * as xb from 'xrblocks';
 *   import { connectUIExtensions } from '@realitycollective/xrblocks-uiextensions';
 *
 *   class MyScript extends xb.Script {
 *     init() { this.uix = connectUIExtensions({ scene: this, camera: xb.core.camera }); }
 *     update() { this.uix.update(xb.core.timer.getDelta()); }
 *   }
 */
import { Quaternion, Vector3, type Object3D, type PerspectiveCamera } from 'three';
import type { HandPoseSource, HeadPose, HeadPoseSource } from '@realitycollective/webxr-uiextensions';
import type { Kit } from '@pmndrs/uikitml';
import type { PointerArbiter } from '@realitycollective/webxr-input';
import { UixWindowHost } from './host.js';
import type { XrBlocksRayInputAccess } from './ray-input.js';
import type { UikitRenderer } from './renderer-setup.js';

/** The slice of an XR Blocks Script / three.js app the host binds to. */
export interface EngineContext {
  /** Where windows are parented - an XR Blocks Script IS an Object3D. */
  scene: Object3D;
  /** The rendering camera; in XR the engine keeps it at the viewer pose. */
  camera: Pick<PerspectiveCamera, 'getWorldPosition' | 'getWorldQuaternion'>;
  /** Optional UIKitML component kit(s). */
  kit?: Kit;
  /**
   * `renderer.xr`, so hand menus can ride the tracked hands in a session.
   * Leave it out on a desktop; a hand-locked window is then hidden, the same
   * as it is anywhere with no hand tracked (see `HandPoseSource`).
   */
  xr?: WebXRFrameAccess;
  /**
   * `xb.input`, so a title-bar RAY drag rides the actual controller ray
   * (laser-distance math, as IWSDK and native) rather than the controller's
   * own position (point-delta). Leave it out and a ray drag falls back to
   * point-delta - see `pointer-bridge.ts`'s `beginTitlebarDrag`.
   */
  input?: XrBlocksRayInputAccess;
  /**
   * The app's shared pointer arbiter (the Interactions runtime's). Panels
   * offer their touch, grab and ray candidates to it and act only with a
   * pointer kind it says owns the source. Also needs `input` for rays.
   */
  pointers?: PointerArbiter;
  /**
   * The engine's renderer (`xb.core.renderer`), configured for uikit once
   * at connection: transparent meshes sorted by `renderOrder` and local
   * clipping on. Leave it out and panel plates hide their own text, as XR
   * Blocks sets neither (see `configureRendererForUikit`).
   */
  renderer?: UikitRenderer;
}

/**
 * The slice of three's `WebXRManager` (`renderer.xr`) a hand pose source
 * needs. Structural, so anything with the same three methods will do.
 */
export interface WebXRFrameAccess {
  getFrame(): XRFrame | null | undefined;
  getReferenceSpace(): XRReferenceSpace | null;
  getSession(): XRSession | null;
}

/**
 * HandPoseSource backed by a live WebXR session: each hand's pose is its
 * input source's `gripSpace` (a controller's grip, or the tracked hand),
 * falling back to the target ray space when a runtime gives a hand none.
 * Returns `undefined` for a hand with no input source this frame, or with no
 * frame at all (outside a session), so hand menus stay hidden there.
 */
export function webxrHandPoseSource(xr: WebXRFrameAccess): HandPoseSource {
  return {
    getHandPose(hand) {
      const frame = xr.getFrame();
      const referenceSpace = xr.getReferenceSpace();
      const session = xr.getSession();
      if (!frame || !referenceSpace || !session) {
        return undefined;
      }
      for (const source of session.inputSources) {
        if (source.handedness !== hand) {
          continue;
        }
        const space = source.gripSpace ?? source.targetRaySpace;
        const pose = frame.getPose(space, referenceSpace);
        if (!pose) {
          return undefined;
        }
        const { position, orientation } = pose.transform;
        return {
          position: [position.x, position.y, position.z],
          quaternion: [orientation.x, orientation.y, orientation.z, orientation.w],
        };
      }
      return undefined;
    },
  };
}

/** HeadPoseSource backed by a three.js camera. */
export function cameraHeadPoseSource(
  camera: EngineContext['camera'],
): HeadPoseSource {
  const position = new Vector3();
  const quaternion = new Quaternion();
  return {
    getHeadPose(): HeadPose {
      camera.getWorldPosition(position);
      camera.getWorldQuaternion(quaternion);
      return {
        position: [position.x, position.y, position.z],
        quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
      };
    },
  };
}

/** Create a window host bound to an XR Blocks Script / three.js context. */
export function connectUIExtensions(context: EngineContext): UixWindowHost {
  return new UixWindowHost({
    scene: context.scene,
    headPose: cameraHeadPoseSource(context.camera),
    ...(context.xr ? { handPose: webxrHandPoseSource(context.xr) } : {}),
    ...(context.kit ? { kit: context.kit } : {}),
    ...(context.input ? { rayInput: context.input } : {}),
    ...(context.pointers ? { pointers: context.pointers } : {}),
    ...(context.renderer ? { renderer: context.renderer } : {}),
  });
}
