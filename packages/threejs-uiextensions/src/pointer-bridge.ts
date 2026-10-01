/**
 * ScenePointerBridge - turns a resolved WebXR interaction (a ray that hit an
 * element, a grip near the title bar, a fingertip in front of a panel) into
 * the portable `pointerdown` / `pointerup` / `click` / `pointerenter` /
 * `pointerleave` events every `data-uix` control and window chrome listener
 * already reads (`UixElement.addEventListener`), and into per-frame samples
 * for the core `TouchPress`.
 *
 * Unlike `@realitycollective/xrblocks-uiextensions`'s `XrBlocksPointerBridge`,
 * nothing here resolves WHICH element was hit - that is XR Blocks' own
 * interaction manager's job there. This bridge is driven by
 * `webxr-input.ts`'s `connectWebXrPointerInput`, which does its own
 * raycasting (`rayHit`) and proximity probing (`touchHit`) against the panels
 * registered with `wire()`, straight from the browser's WebXR session - no
 * engine SDK beyond three.js itself.
 *
 * Click timing. A ray press is `pointerdown` on `pointerDown()` (the
 * session's `selectstart`) and `pointerup` + `click` on `pointerUp()` (its
 * `selectend`) - clicking on release, never on intersection, the same rule
 * `ui/ray-click-on-release` states. A touch (poke) IS a continuous per-frame
 * signal, so it drives the core `TouchPress` every frame through `touch()`,
 * exactly as the XR Blocks and native bridges do.
 *
 * Bubbling. `pointerDown`/`pointerUp`/`hoverEnter`/`hoverExit` dispatch on the
 * hit object and walk up through `Object3D.parent`, exactly as
 * `NativeWindowHost.dispatch` and `XrBlocksPointerBridge.bubble` do - so it
 * does not matter whether a raycast resolves to a leaf mesh (a glyph, a
 * background quad) or a coarser ancestor: any listener on an ancestor of the
 * hit object still receives the event during the bubble walk.
 */
import { Matrix3, Quaternion, Raycaster, Vector3, type Intersection, type Object3D } from 'three';
import {
  TouchPress,
  dispatchTouchUpdate,
  resolveTouchPress,
  type PointerEventType,
  type TouchPressOptions,
  type Vec3Tuple,
} from '@realitycollective/webxr-uiextensions';

/** A node dispatch reaches - loosely typed like the XR Blocks bridge's `Dispatchable`, so no `Object3D` cast is needed at call sites. */
interface Dispatchable {
  dispatchEvent(event: { type: string; [key: string]: unknown }): void;
  parent: Dispatchable | null;
}

export interface ScenePointerBridgeOptions {
  /** Whether `element` should currently receive pointer events (a hidden or gated window says no). Omit to allow everything - a bare, unmanaged panel. */
  isLive?(element: Object3D): boolean;
  /** Touch press thresholds. Default `DEFAULT_TOUCH_PRESS`. */
  touchOptions?: Partial<TouchPressOptions>;
}

const scratchPosition = new Vector3();
const scratchQuaternion = new Quaternion();

/** This object's current WORLD position, as a plain tuple. */
export function worldPositionOf(object: Object3D): Vec3Tuple {
  object.getWorldPosition(scratchPosition);
  return [scratchPosition.x, scratchPosition.y, scratchPosition.z];
}

/** This object's local +Z axis, rotated to world space - its "front" normal, unit length. Used both for a touch's signed distance and a title-bar ray drag's grab plane. */
export function worldForwardOf(object: Object3D): Vec3Tuple {
  object.getWorldQuaternion(scratchQuaternion);
  const forward = new Vector3(0, 0, 1).applyQuaternion(scratchQuaternion);
  return [forward.x, forward.y, forward.z];
}

/** Signed distance from `plane` (a point + a unit normal) to `point`, positive in front - the same convention `NativePointerSample.signedDistance` uses. */
function signedDistanceToPlane(planePoint: Vec3Tuple, planeNormal: Vec3Tuple, point: Vec3Tuple): number {
  const dx = point[0] - planePoint[0];
  const dy = point[1] - planePoint[1];
  const dz = point[2] - planePoint[2];
  return dx * planeNormal[0] + dy * planeNormal[1] + dz * planeNormal[2];
}

/** A touch or grab proximity hit: the specific descendant a probe ray found, and the point's signed distance to the panel's own front plane. */
export interface ProximityHit {
  target: Object3D;
  signedDistance: number;
}

/** A resolved ray hit: the descendant it struck, the world-space hit point, and - when the geometry reports one - the world-space unit surface normal there. Feeds both hover/press resolution and `ui/pointer-cursor`'s disc placement. */
export interface RayHit {
  target: Object3D;
  point: Vec3Tuple;
  /** `undefined` for geometry that reports no face (only a `Mesh`'s triangles do), so a cursor falls back to the ray's own orientation. */
  normal: Vec3Tuple | undefined;
}

const scratchNormalMatrix = new Matrix3();
const scratchNormal = new Vector3();

export class ScenePointerBridge {
  private readonly roots = new Set<Object3D>();
  private readonly touches = new Map<number, TouchPress<Object3D>>();
  private readonly touchOptions: TouchPressOptions;
  private readonly isLive: (element: Object3D) => boolean;
  private readonly raycaster = new Raycaster();

  constructor(options: ScenePointerBridgeOptions = {}) {
    this.touchOptions = resolveTouchPress(options.touchOptions);
    this.isLive = options.isLive ?? ((): boolean => true);
  }

  /**
   * Register a panel root for hit-testing. Call once per panel, right after
   * its `data-uix` controls are upgraded (`upgradePanel`) - the same moment
   * `XrBlocksPointerBridge.wire` is called.
   */
  wire(root: Object3D): void {
    this.roots.add(root);
  }

  /** Drop a panel root once its window closes, so a stale reference is never raycast or probed again. */
  unwire(root: Object3D): void {
    this.roots.delete(root);
  }

  /** The registered root `element` sits under, or `undefined` for an element of no wired panel. */
  rootOf(element: Object3D): Object3D | undefined {
    for (let at: Object3D | null = element; at; at = at.parent) {
      if (this.roots.has(at)) return at;
    }
    return undefined;
  }

  /** Whether slot `handIndex`'s touch machine is pressing this frame (the arbiter's selection lock). */
  isTouchPressed(handIndex: number): boolean {
    return this.touches.get(handIndex)?.held === true;
  }

  /**
   * The nearest live registered descendant a world-space ray hits, with its
   * hit point and (when the geometry reports one) its world-space surface
   * normal - `undefined` when the ray hits nothing. Used for a `select`
   * (ray) press, per-frame hover, and `ui/pointer-cursor`'s disc placement.
   */
  rayCast(origin: Vec3Tuple, direction: Vec3Tuple): RayHit | undefined {
    this.raycaster.set(new Vector3(...origin), new Vector3(...direction).normalize());
    this.raycaster.far = Infinity;
    let nearest: Intersection<Object3D> | undefined;
    for (const root of this.roots) {
      if (!this.isLive(root)) continue;
      const hits = this.raycaster.intersectObject(root, true);
      const hit = hits[0];
      if (hit && (!nearest || hit.distance < nearest.distance)) {
        nearest = hit;
      }
    }
    if (!nearest) return undefined;
    let normal: Vec3Tuple | undefined;
    if (nearest.face) {
      scratchNormalMatrix.getNormalMatrix(nearest.object.matrixWorld);
      scratchNormal.copy(nearest.face.normal).applyMatrix3(scratchNormalMatrix).normalize();
      normal = [scratchNormal.x, scratchNormal.y, scratchNormal.z];
    }
    return { target: nearest.object, point: [nearest.point.x, nearest.point.y, nearest.point.z], normal };
  }

  /**
   * The nearest live registered descendant a world-space ray hits, or
   * `undefined`. Used for a `select` (ray) press. A thin projection of
   * {@link rayCast} for a caller that needs only the target.
   */
  rayHit(origin: Vec3Tuple, direction: Vec3Tuple): Object3D | undefined {
    return this.rayCast(origin, direction)?.target;
  }

  /**
   * The nearest live registered element within `maxDistance` of `point`,
   * measured along that panel's own front normal (as a touching fingertip or
   * a grabbing grip approaches it), with the exact descendant resolved by a
   * short probe raycast through `point` toward the panel - the same specific
   * "which element" precision a real hit-testing SDK gives, computed here
   * instead of handed to us. `undefined` when nothing is close enough, or
   * nothing is actually rendered at that point (an empty area of the panel).
   *
   * Used for touch (a hand joint) and, with a larger `maxDistance`, for a
   * near/grab press - both are "is this point in front of a panel", not a
   * ray, so they share one probe.
   */
  touchHit(point: Vec3Tuple, maxDistance: number): ProximityHit | undefined {
    let best: (ProximityHit & { absDistance: number }) | undefined;
    for (const root of this.roots) {
      if (!this.isLive(root)) continue;
      const planePoint = worldPositionOf(root);
      const planeNormal = worldForwardOf(root);
      const distance = signedDistanceToPlane(planePoint, planeNormal, point);
      const absDistance = Math.abs(distance);
      if (absDistance > maxDistance) continue;
      if (best && absDistance >= best.absDistance) continue;
      // Probe from just outside the max distance, through the touch point,
      // toward and past the panel, to find the specific mesh in front of it.
      const probeOrigin = new Vector3(
        point[0] + planeNormal[0] * maxDistance,
        point[1] + planeNormal[1] * maxDistance,
        point[2] + planeNormal[2] * maxDistance,
      );
      const probeDirection = new Vector3(-planeNormal[0], -planeNormal[1], -planeNormal[2]);
      this.raycaster.set(probeOrigin, probeDirection);
      this.raycaster.far = maxDistance * 2;
      const hits = this.raycaster.intersectObject(root, true);
      const hit = hits[0];
      if (!hit) continue;
      best = { target: hit.object, signedDistance: distance, absDistance };
    }
    return best ? { target: best.target, signedDistance: best.signedDistance } : undefined;
  }

  /** A ray or grab press resolved to `target` - `pointerdown`, bubbled. `extra` carries the owner (`{ controller }` or `{ hand }`), as the title-bar drag listener reads. */
  pointerDown(target: Object3D, extra: Record<string, unknown> = {}): void {
    if (this.isLive(target)) this.bubble(target, 'pointerdown', extra);
  }

  /** The pointer that pressed `target` was released - `pointerup` then `click`, bubbled, in that order. */
  pointerUp(target: Object3D): void {
    if (this.isLive(target)) {
      this.bubble(target, 'pointerup');
      this.bubble(target, 'click');
    }
  }

  hoverEnter(target: Object3D): void {
    if (this.isLive(target)) (target as unknown as Dispatchable).dispatchEvent({ type: 'pointerenter' });
  }

  hoverExit(target: Object3D): void {
    (target as unknown as Dispatchable).dispatchEvent({ type: 'pointerleave' });
  }

  /** This frame's touch (poke) sample for `handIndex` - the hand-joint or controller-tip identity a caller assigns - or `undefined` while nothing is close enough. Drives the core `TouchPress`. */
  touch(handIndex: number, sample: { signedDistance: number; target: Object3D } | undefined): void {
    let press = this.touches.get(handIndex);
    if (!press) {
      press = new TouchPress<Object3D>(this.touchOptions);
      this.touches.set(handIndex, press);
    }
    const update = press.update(sample);
    dispatchTouchUpdate(
      update,
      { dispatch: (type, target) => this.bubble(target, type) },
      (a, b) => a === b,
    );
  }

  private bubble(hit: Object3D, type: PointerEventType, extra: Record<string, unknown> = {}): void {
    let stopped = false;
    const event = { type, ...extra, stopPropagation: () => (stopped = true) };
    for (let at: Dispatchable | null = hit as unknown as Dispatchable; at && !stopped; at = at.parent) {
      at.dispatchEvent(event);
    }
  }
}
