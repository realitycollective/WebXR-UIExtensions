/**
 * XR Blocks' per-frame ray input, read structurally - no `xrblocks` import.
 *
 * `xb.input.getFrame()` returns `{ raySources, directTouches }` (verified
 * against xrblocks v0.21.1 source; the same contract
 * `@realitycollective/xrblocks-interactions`' `XRBlocksInputProvider` reads,
 * in the sibling Interactions family, so this mirrors its `XBRayLike` /
 * `XBRaySourceLike` / `XBFrameLike` shapes rather than inventing a second
 * one). Each `RaySourceInput` carries `controller` (the same object identity
 * `SelectEvent.target` and `ObjectGrabEvent.hand`'s owning controller use)
 * and `ray: { origin, direction }` - a REAL ray, already resolved by the
 * SDK. This is what lets a title-bar ray drag use the same laser-distance
 * math as IWSDK and native (`beginDrag`/`dragPosition`), rather than a
 * point-delta approximation: XR Blocks' own `SelectEvent` carries no hit
 * point (`{ target: Controller }` only), but its INPUT FRAME does carry the
 * ray, every frame, for exactly this purpose.
 */
import type { RayTuple } from '@realitycollective/webxr-uiextensions';

/** Structural slice of THREE.Vector3 - an XR Blocks ray's origin/direction. */
export interface XBVec3Like {
  x: number;
  y: number;
  z: number;
}

/** Structural slice of THREE.Ray. */
export interface XBRayLike {
  origin: XBVec3Like;
  direction: XBVec3Like;
}

/** Structural `RaySourceInput` (xrblocks `src/interaction/InteractionTypes.ts`). Only the fields this binding reads. */
export interface XBRaySourceLike {
  /** The same controller identity a `SelectEvent`'s `target` or an `ObjectGrabEvent`'s owning controller uses - matched by `===`. */
  controller: object;
  ray: XBRayLike;
}

/** Structural `xb.input.getFrame()`'s return shape. Only `raySources` is read here. */
export interface XBInputFrameLike {
  raySources: readonly XBRaySourceLike[];
}

/** `xb.input` itself - the one method this binding calls on it. */
export interface XrBlocksRayInputAccess {
  getFrame(): XBInputFrameLike;
}

/**
 * This frame's ray for `controller`, or `undefined` when the input frame has
 * no ray source for it (outside a session, or between frames as sources
 * come and go).
 */
export function rayOf(frame: XBInputFrameLike, controller: object): RayTuple | undefined {
  const source = frame.raySources.find((candidate) => candidate.controller === controller);
  if (!source) return undefined;
  const { origin, direction } = source.ray;
  return { origin: [origin.x, origin.y, origin.z], direction: [direction.x, direction.y, direction.z] };
}
