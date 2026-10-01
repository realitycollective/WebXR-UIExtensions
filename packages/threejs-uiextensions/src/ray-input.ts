/**
 * Per-frame ray input, read structurally - the same shape
 * `@realitycollective/xrblocks-uiextensions`'s `XrBlocksRayInputAccess` uses
 * (mirroring `@realitycollective/xrblocks-interactions`' `XRBlocksInputProvider`
 * in the sibling Interactions family), so a caller driving either binding's
 * `rayInput` option writes one shape of code. Each `RaySourceLike` carries
 * `controller` (the same object identity a pointer's `{ controller }` extra
 * uses) and `ray: { origin, direction }` - a REAL ray. This is what lets a
 * title-bar ray drag use the same laser-distance math as IWSDK and native
 * (`beginDrag`/`dragPosition`), rather than a point-delta approximation.
 */
import { Quaternion, Vector3, type Object3D } from 'three';
import type { RayTuple } from '@realitycollective/webxr-uiextensions';

/** Structural slice of THREE.Vector3 - a ray's origin/direction. */
export interface RayVec3Like {
  x: number;
  y: number;
  z: number;
}

/** Structural slice of THREE.Ray. */
export interface RayLike {
  origin: RayVec3Like;
  direction: RayVec3Like;
}

/** One input source's live ray, addressed by controller identity. */
export interface RaySourceLike {
  /** The same controller identity a pointer's `{ controller }` extra uses - matched by `===`. */
  controller: object;
  ray: RayLike;
}

/** A frame's worth of ray sources. Only `raySources` is read here. */
export interface RayInputFrameLike {
  raySources: readonly RaySourceLike[];
}

/** The one method `UixWindowHost.rayInput` calls. */
export interface RayInputAccess {
  getFrame(): RayInputFrameLike;
}

/**
 * This frame's ray for `controller`, or `undefined` when the input frame has
 * no ray source for it (outside a session, or between frames as sources come
 * and go).
 */
export function rayOf(frame: RayInputFrameLike, controller: object): RayTuple | undefined {
  const source = frame.raySources.find((candidate) => candidate.controller === controller);
  if (!source) return undefined;
  const { origin, direction } = source.ray;
  return { origin: [origin.x, origin.y, origin.z], direction: [direction.x, direction.y, direction.z] };
}

const scratchPosition = new Vector3();
const scratchQuaternion = new Quaternion();
const scratchDirection = new Vector3();

/**
 * `RayInputAccess` backed by live three.js controller objects
 * (`renderer.xr.getController(i)`), each already kept at the session's
 * target-ray pose by three.js's own `WebXRManager` every frame - only a
 * controller currently `visible` (three sets this false with no matching
 * input source this frame) contributes a ray source. The ray points along
 * the controller's local `-Z`, three's standard target-ray convention (the
 * same axis `XRTargetRaySpace` uses).
 */
export function webxrRayInputAccess(controllers: readonly Object3D[]): RayInputAccess {
  return {
    getFrame(): RayInputFrameLike {
      const raySources: RaySourceLike[] = [];
      for (const controller of controllers) {
        if (!controller.visible) continue;
        controller.getWorldPosition(scratchPosition);
        controller.getWorldQuaternion(scratchQuaternion);
        scratchDirection.set(0, 0, -1).applyQuaternion(scratchQuaternion);
        raySources.push({
          controller,
          ray: {
            origin: { x: scratchPosition.x, y: scratchPosition.y, z: scratchPosition.z },
            direction: { x: scratchDirection.x, y: scratchDirection.y, z: scratchDirection.z },
          },
        });
      }
      return { raySources };
    },
  };
}
