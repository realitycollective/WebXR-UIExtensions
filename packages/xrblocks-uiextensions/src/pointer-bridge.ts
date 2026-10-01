/**
 * XrBlocksPointerBridge - turns XR Blocks' own per-object interaction
 * callbacks into the portable `pointerdown` / `pointerup` / `click` /
 * `pointerenter` / `pointerleave` events every `data-uix` control and window
 * chrome listener already reads (`UixElement.addEventListener`), and into
 * per-frame samples for the core `TouchPress`.
 *
 * XR Blocks 0.21.1 resolves hit-testing itself and calls `onSelectStart`,
 * `onSelectEnd`, `onObjectTouchStart` / `onObjectTouching` / `onObjectTouchEnd`,
 * `onObjectGrabStart` / `onObjectGrabEnd` and `onHoverEnter` / `onHoverExit`
 * directly on the object it decided is involved (see the `InteractionManager`
 * doc comments in the vendored `xrblocks.d.ts`), recursing to ancestors only
 * while a handler returns a falsy "not handled". Rather than rely on that
 * ancestor walk - documented only as "recursively ... until handled", with no
 * stated order or `typeof`-guard behaviour to build on - this bridge attaches
 * to every node once, at panel-creation time, and does its OWN bubbling from
 * the node the SDK actually calls, up through `Object3D.parent`, exactly as
 * `NativeWindowHost.dispatch` bubbles from a `NativeElementNode`. Every
 * attached handler returns `true`, so an ancestor the SDK also asks (it has
 * the same handler) is told the gesture is already handled and does nothing
 * further.
 *
 * Click timing. XR Blocks' select is itself edge-triggered - one
 * `onSelectStart` / `onSelectEnd` pair per gesture, evidently on the same
 * object throughout (the SDK's own manipulation manager decides the target
 * once, at select start) - so a press is `pointerdown` at select start and
 * `pointerup` + `click` at select end, with no separate edge-detection
 * needed. This is unlike native, whose samples arrive already resolved but
 * as a per-frame active flag the binding must itself edge-detect (see
 * `EdgePress`); XR Blocks needs no such state here. A touch (poke) IS a
 * continuous per-frame signal (`onObjectTouching`), so it drives the core
 * `TouchPress` every frame exactly as native's touch pointers do, through
 * `dispatchTouchUpdate`.
 *
 * Shared arbitration and hover. Each touch, grab and ray candidate is offered
 * to the app's `PointerArbiter` (`PanelPointerOffers`), keyed by handedness
 * (`handIndex` 0 is left), and a press acts only while its kind owns the
 * source. Rays need a per-frame raycast of their own (`updateRays`), which
 * also raises hover per source through the core `HoverTracker`.
 *
 * A near (grab) press only ever begins on the title bar, exactly as native's
 * grab pointer: `onObjectGrabStart`/`End` do nothing unless the hit node is
 * inside the `uix-titlebar` element.
 */
import { Quaternion, Raycaster, Vector3, type Intersection, type Object3D } from 'three';
import type { PointerArbiter } from '@realitycollective/webxr-input';
import {
  HoverTracker,
  PanelPointerOffers,
  TouchPress,
  WINDOW_CHROME_IDS,
  dispatchTouchUpdate,
  resolveTouchPress,
  type PointerEventType,
  type TouchPressOptions,
  type Vec3Tuple,
} from '@realitycollective/webxr-uiextensions';
import type { XBInputFrameLike } from './ray-input.js';

/** The slice of an XR Blocks `Controller` this bridge reads a live ray pose from. Structural - no dependency on the `xrblocks` package. */
export type XrBlocksController = Object3D;

/** `xrblocks.d.ts`'s `SelectEvent`. */
export interface XrBlocksSelectEvent {
  target: XrBlocksController;
}

/** `xrblocks.d.ts`'s `ObjectTouchEvent`. */
export interface XrBlocksTouchEvent {
  handIndex: number;
  touchPosition: { x: number; y: number; z: number };
}

/** `xrblocks.d.ts`'s `ObjectGrabEvent`. */
export interface XrBlocksGrabEvent {
  handIndex: number;
  hand: Object3D;
}

/** A node dispatch reaches - loosely typed like `pointer-forward.ts`'s `InteractiveLike`, so no `Object3D` cast is needed at call sites. */
interface Dispatchable {
  dispatchEvent(event: { type: string; [key: string]: unknown }): void;
  parent: Dispatchable | null;
}

export interface XrBlocksPointerBridgeOptions {
  /** Whether `element` should currently receive pointer events (a hidden or gated window says no). Omit to allow everything - a bare, unmanaged panel. */
  isLive?(element: Object3D): boolean;
  /** Touch press thresholds. Default `DEFAULT_TOUCH_PRESS`. */
  touchOptions?: Partial<TouchPressOptions>;
  /**
   * The app's shared pointer arbiter (the Interactions runtime's). The bridge
   * offers its touch, grab and ray candidates to it and acts only with a
   * pointer kind the arbiter says owns the source. Omit it and the bridge
   * makes its own, which owns every source it offers for.
   */
  pointers?: PointerArbiter;
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

/** This object's current world position projected onto ITS OWN local +Z plane, signed distance to `point`, positive in front - the same convention `NativePointerSample.signedDistance` uses. */
function signedDistanceToPlane(element: Object3D, point: Vec3Tuple): number {
  const position = worldPositionOf(element);
  const normal = worldForwardOf(element);
  const dx = point[0] - position[0];
  const dy = point[1] - position[1];
  const dz = point[2] - position[2];
  return dx * normal[0] + dy * normal[1] + dz * normal[2];
}

const scratchOrigin = new Vector3();
const scratchDirection = new Vector3();

/** `left` or `right` from a handedness string, else `undefined`. */
function sideOf(handedness: unknown): 'left' | 'right' | undefined {
  return handedness === 'left' || handedness === 'right' ? handedness : undefined;
}

/** XR Blocks' `handIndex`: 0 is the left hand, anything else the right (the mapping `xrblocks-interactions` uses). */
function handKey(handIndex: number): string {
  return handIndex === 0 ? 'left' : 'right';
}

/** Metres between two world points. */
function distanceBetween(a: Vec3Tuple, b: Vec3Tuple): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export class XrBlocksPointerBridge {
  private readonly touches = new Map<number, TouchPress<Object3D>>();
  private readonly touchOptions: TouchPressOptions;
  private readonly isLive: (element: Object3D) => boolean;
  private readonly offers: PanelPointerOffers;
  private readonly hover = new HoverTracker<Object3D>();
  private readonly roots = new Set<Object3D>();
  /** Every wired element -> the panel root it was wired under, for the arbiter's panel id. */
  private readonly rootOf = new WeakMap<Object3D, Object3D>();
  private readonly raycaster = new Raycaster();
  /** Element -> the source key its select press was granted to, so the release ends the SAME press. */
  private readonly selects = new Map<Object3D, string>();
  /** Element -> the source key its grab was granted to. */
  private readonly grabs = new Map<Object3D, string>();
  /** The ray sources of the last {@link updateRays}, in order: a controller with no handedness is keyed by its position here. */
  private raySources: XBInputFrameLike['raySources'] = [];
  /** Source keys the last {@link updateRays} offered a ray for, so a source that goes away is forgotten. */
  private rayKeys = new Set<string>();

  constructor(options: XrBlocksPointerBridgeOptions = {}) {
    this.touchOptions = resolveTouchPress(options.touchOptions);
    this.isLive = options.isLive ?? ((): boolean => true);
    this.offers = new PanelPointerOffers(options.pointers);
  }

  /**
   * Attach every callback this bridge understands to `root` and every
   * descendant, recursively. Call once per panel, right after its
   * `data-uix` controls are upgraded (`upgradePanel`). The root also joins the
   * set {@link updateRays} raycasts.
   */
  wire(root: Object3D): void {
    this.roots.add(root);
    root.traverse((element) => {
      this.rootOf.set(element, root);
      this.attach(element);
    });
  }

  /** Stop raycasting `root` (its window closed). Its callbacks stay attached and harmless. */
  unwire(root: Object3D): void {
    this.roots.delete(root);
  }

  /**
   * Once per frame, with `xb.input.getFrame()`: raycast every wired panel
   * along each ray source, offer the nearest hit to the shared arbiter as that
   * source's ray candidate, resolve the source, and raise `pointerenter` /
   * `pointerleave` for what each source's ray now owns. XR Blocks' own
   * `onHoverEnter` / `onHoverExit` are not used: they are not per pointer and
   * ignore the arbiter.
   */
  updateRays(frame: XBInputFrameLike): void {
    this.raySources = frame.raySources;
    const seen = new Set<string>();
    frame.raySources.forEach((source, index) => {
      const key = this.controllerKey(source.controller, index);
      seen.add(key);
      const { origin, direction } = source.ray;
      const hit = this.rayCast([origin.x, origin.y, origin.z], [direction.x, direction.y, direction.z]);
      this.offers.offer(key, 'ray', hit ? { panelId: hit.root.uuid, point: hit.point, distance: hit.distance } : undefined);
      this.offers.resolve(key);
      this.setHover(`ray:${key}`, hit && this.offers.owns(key, 'ray') ? hit.target : undefined);
    });
    for (const key of this.rayKeys) {
      if (seen.has(key)) continue;
      this.setHover(`ray:${key}`, undefined);
      this.offers.forget(key);
    }
    this.rayKeys = seen;
  }

  private attach(element: Object3D): void {
    const bridge = this;
    Object.assign(element, {
      onSelectStart(event: XrBlocksSelectEvent): boolean {
        if (!bridge.isLive(element)) return true;
        const key = bridge.controllerKey(event.target);
        if (bridge.claimRay(key, element, event.target)) {
          bridge.selects.set(element, key);
          bridge.offers.setSelecting(key, 'ray', true);
          bridge.bubble(element, 'pointerdown', { controller: event.target });
        }
        return true;
      },
      onSelectEnd(): boolean {
        const key = bridge.selects.get(element);
        if (key === undefined) return true;
        bridge.selects.delete(element);
        bridge.offers.setSelecting(key, 'ray', false);
        if (bridge.isLive(element)) {
          bridge.bubble(element, 'pointerup');
          bridge.bubble(element, 'click');
        }
        return true;
      },
      onObjectGrabStart(event: XrBlocksGrabEvent): boolean {
        if (!bridge.isLive(element)) return true;
        const key = handKey(event.handIndex);
        bridge.offers.offer(key, 'grab', { panelId: bridge.panelIdOf(element), point: worldPositionOf(event.hand), distance: 0 });
        bridge.offers.resolve(key);
        if (!bridge.offers.owns(key, 'grab')) return true;
        bridge.grabs.set(element, key);
        bridge.offers.setSelecting(key, 'grab', true);
        if (bridge.isOnTitlebar(element)) bridge.bubble(element, 'pointerdown', { hand: event.hand });
        return true;
      },
      onObjectGrabEnd(): boolean {
        const key = bridge.grabs.get(element);
        if (key === undefined) return true;
        bridge.grabs.delete(element);
        bridge.offers.setSelecting(key, 'grab', false);
        bridge.offers.offer(key, 'grab', undefined);
        bridge.offers.resolve(key);
        if (bridge.isLive(element) && bridge.isOnTitlebar(element)) {
          bridge.bubble(element, 'pointerup');
          bridge.bubble(element, 'click');
        }
        return true;
      },
      onObjectTouchEnd(event: XrBlocksTouchEvent): boolean {
        const key = handKey(event.handIndex);
        bridge.offers.offer(key, 'touch', undefined);
        bridge.offers.resolve(key);
        bridge.touch(event.handIndex, undefined);
        return true;
      },
      onObjectTouching(event: XrBlocksTouchEvent): boolean {
        if (!bridge.isLive(element)) return true;
        const key = handKey(event.handIndex);
        const point: Vec3Tuple = [event.touchPosition.x, event.touchPosition.y, event.touchPosition.z];
        const signedDistance = signedDistanceToPlane(element, point);
        bridge.offers.offer(key, 'touch', { panelId: bridge.panelIdOf(element), point, distance: Math.abs(signedDistance) });
        bridge.offers.resolve(key);
        bridge.touch(event.handIndex, bridge.offers.owns(key, 'touch') ? { signedDistance, target: element } : undefined);
        return true;
      },
      // Hover is raised per pointer from `updateRays`' own raycast, through the
      // core `HoverTracker`. XR Blocks' hover callbacks are one flag per
      // object, not per pointer, and know nothing of the shared arbiter, so
      // they do nothing here. They return true ("handled") so the SDK does
      // not walk on to the ancestors.
      onHoverEnter(): boolean {
        return true;
      },
      onHoverExit(): boolean {
        return true;
      },
    });
  }

  /**
   * Whether the ray of the controller in `key` may press `element`. When
   * {@link updateRays} has offered for this source, its decision stands.
   * Otherwise (no ray input wired) XR Blocks' own hit on `element` is offered
   * here, at the controller's distance, so a host without ray input still
   * presses.
   */
  private claimRay(key: string, element: Object3D, controller: XrBlocksController): boolean {
    if (!this.rayKeys.has(key)) {
      const point = worldPositionOf(element);
      this.offers.offer(key, 'ray', { panelId: this.panelIdOf(element), point, distance: distanceBetween(worldPositionOf(controller), point) });
      this.offers.resolve(key);
    }
    return this.offers.owns(key, 'ray');
  }

  /** The arbiter's name for a controller: its handedness, else `controller:<position in the ray sources>`. */
  private controllerKey(controller: object, knownIndex?: number): string {
    const side = sideOf((controller as { inputSource?: { handedness?: unknown } }).inputSource?.handedness);
    if (side) return side;
    return `controller:${knownIndex ?? this.raySources.findIndex((source) => source.controller === controller)}`;
  }

  /** The panel id for the arbiter: the uuid of the wired root `element` belongs to. */
  private panelIdOf(element: Object3D): string {
    return this.rootOf.get(element)!.uuid;
  }

  /** The nearest hit on any live wired panel along a world ray. */
  private rayCast(origin: Vec3Tuple, direction: Vec3Tuple): { root: Object3D; target: Object3D; point: Vec3Tuple; distance: number } | undefined {
    this.raycaster.set(scratchOrigin.set(...origin), scratchDirection.set(...direction).normalize());
    this.raycaster.far = Infinity;
    let nearest: { root: Object3D; hit: Intersection<Object3D> } | undefined;
    for (const root of this.roots) {
      if (!this.isLive(root)) continue;
      const hit = this.raycaster.intersectObject(root, true)[0];
      if (hit && (!nearest || hit.distance < nearest.hit.distance)) nearest = { root, hit };
    }
    if (!nearest) return undefined;
    const { hit } = nearest;
    return { root: nearest.root, target: hit.object, point: [hit.point.x, hit.point.y, hit.point.z], distance: hit.distance };
  }

  /** One pointer's hover target this frame: `pointerleave` on what it left, `pointerenter` on what it reached (live elements only). */
  private setHover(pointerId: string, target: Object3D | undefined): void {
    const change = this.hover.update(pointerId, target);
    if (change.pointerLeave) (change.pointerLeave as unknown as Dispatchable).dispatchEvent({ type: 'pointerleave' });
    if (change.pointerEnter && this.isLive(change.pointerEnter)) (change.pointerEnter as unknown as Dispatchable).dispatchEvent({ type: 'pointerenter' });
  }

  /** Whether `element` sits on, or inside, a window's title bar - the only thing a grab pointer can hold. */
  private isOnTitlebar(element: Object3D): boolean {
    for (let at: Object3D | null = element; at; at = at.parent) {
      if (at.userData?.['id'] === WINDOW_CHROME_IDS.titlebar) return true;
    }
    return false;
  }

  private touch(handIndex: number, sample: { signedDistance: number; target: Object3D } | undefined): void {
    let press = this.touches.get(handIndex);
    if (!press) {
      press = new TouchPress<Object3D>(this.touchOptions);
      this.touches.set(handIndex, press);
    }
    const update = press.update(sample);
    this.offers.setSelecting(handKey(handIndex), 'touch', press.held);
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
