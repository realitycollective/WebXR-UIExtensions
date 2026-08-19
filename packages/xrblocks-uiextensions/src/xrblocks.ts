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
import type { HeadPose, HeadPoseSource } from '@realitycollective/webxr-uiextensions';
import type { Kit } from '@pmndrs/uikitml';
import { UixWindowHost } from './host.js';

/** The slice of an XR Blocks Script / three.js app the host binds to. */
export interface EngineContext {
  /** Where windows are parented — an XR Blocks Script IS an Object3D. */
  scene: Object3D;
  /** The rendering camera; in XR the engine keeps it at the viewer pose. */
  camera: Pick<PerspectiveCamera, 'getWorldPosition' | 'getWorldQuaternion'>;
  /** Optional UIKitML component kit(s). */
  kit?: Kit;
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
    ...(context.kit ? { kit: context.kit } : {}),
  });
}
