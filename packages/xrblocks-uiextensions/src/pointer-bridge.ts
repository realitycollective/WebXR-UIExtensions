/**
 * XrBlocksPointerBridge - turns XR Blocks' interaction callbacks and input
 * frame into the portable `pointerdown` / `pointerup` / `click` /
 * `pointerenter` / `pointerleave` events every `data-uix` control and window
 * chrome listener already reads (`UixElement.addEventListener`), and into
 * per-frame samples for the core `TouchPress`.
 *
 * What XR Blocks calls, and on what. XR Blocks 0.21 resolves hit-testing
 * itself, then looks up the hit object's ancestors for a SCRIPT: an object
 * with `isXRScript === true` that defines one of its targeted hooks
 * (`onObjectSelectStart`, `onObjectSelectEnd`, `onObjectTouchStart`,
 * `onObjectTouching`, `onObjectTouchEnd`, `onObjectGrabStart`,
 * `onObjectGrabEnd`, `onHoverEnter`, `onHovering`, `onHoverExit`; see
 * `ScriptsManager.hasTargetHandler` and `HitResolver.resolve` in xrblocks).
 * The nearest such ancestor is the target, and the hook is called on it with
 * an event that names the mesh actually hit (`intersection.object`,
 * `surface`) and the hit point. A plain `Object3D` carrying callbacks is never
 * a target: the gesture falls through to the Script-level global
 * `onSelectStart`, which carries no target at all. (xrblocks 0.19, which this
 * bridge was first written against, called `onSelectStart` on the hit object
 * itself; that contract is gone.)
 *
 * So `wire(root)` inserts ONE node per panel between the panel document and
 * the uikit root: a bare `Group` flagged as a Script with those hooks
 * (`XrBlocksPanelScript`). Every hit inside the panel resolves to it. It is a
 * fresh `Group`, not the uikit root or the document, because both of those
 * have `update` and `dispose` methods, which XR Blocks would index as Script
 * hooks and call every frame. The node also carries the no-op `init` and
 * `dispose` XR Blocks calls on a Script it finds in, or loses from, the scene.
 *
 * The bridge bubbles its own pointer events from the hit mesh up through
 * `Object3D.parent`, exactly as `NativeWindowHost.dispatch` bubbles from a
 * `NativeElementNode`, and stops XR Blocks' own propagation to ancestor
 * Scripts, which have nothing to add.
 *
 * Click timing. A ray press is `pointerdown` at `onObjectSelectStart` and
 * `pointerup` at `onObjectSelectEnd`; `click` follows when that end is
 * `completed` (XR Blocks: released over the same panel) and the source's own
 * ray, as the bridge last cast it, still rests on the element it pressed. So a
 * click lands on release, on the element under the ray, as every other
 * platform does.
 *
 * Touch. XR Blocks' own direct touch only reports once a fingertip is inside
 * the panel's bounding box, which a flat panel makes a few millimetres deep,
 * so it never sees the approach the core `TouchPress` needs (in front, then
 * through the press distance). Touch is driven instead from the input frame
 * (`updateFrame`): each fingertip in `directTouches` is cast along the nearest
 * wired panel's normal to the element beneath it, and its signed distance to
 * that element's plane drives the core `TouchPress` every frame exactly as
 * native's touch pointers do, through `dispatchTouchUpdate`. Select events XR
 * Blocks raises for its own direct touch (`source.type === 'direct-touch'`)
 * are ignored for the same reason.
 *
 * Shared arbitration and hover. Each touch, grab and ray candidate is offered
 * to the app's `PointerArbiter` (`PanelPointerOffers`), keyed by handedness
 * (`handIndex` 0 is left), and a press acts only while its kind owns the
 * source. Rays are raycast per frame by the bridge itself (`updateFrame`),
 * which also raises hover per source through the core `HoverTracker`; XR
 * Blocks' hover hooks are one flag per object, not per pointer, and are not
 * used.
 *
 * A near (grab) press only ever begins on the title bar, exactly as native's
 * grab pointer: `onObjectGrabStart`/`End` do nothing unless the element under
 * the grabbing hand is inside the `uix-titlebar` element.
 */
import { Group, Quaternion, Raycaster, Vector3, type Intersection, type Object3D } from 'three';
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
import type { XBDirectTouchLike, XBInputFrameLike, XBVec3Like } from './ray-input.js';

/** The slice of an XR Blocks `Controller` this bridge reads a live ray pose from. Structural - no dependency on the `xrblocks` package. */
export type XrBlocksController = Object3D;

/** `InteractionSource` in xrblocks' `interaction/InteractionTypes.ts`: who is pressing. */
export interface XrBlocksInteractionSource {
  /** `'mouse' | 'controller-ray' | 'hand-ray' | 'direct-touch' | 'gaze' | 'simulator'`. */
  type: string;
  handedness: 'left' | 'right' | 'none';
  /** The same controller identity `xb.input.getFrame().raySources[i].controller` carries. */
  controller: XrBlocksController;
}

/** `SelectEvent` in xrblocks' `core/Script.ts`, as `onObjectSelectStart` receives it. */
export interface XrBlocksSelectEvent {
  source: XrBlocksInteractionSource;
  /** The Script resolved for the hit: the bridge's own panel node. */
  target?: Object3D;
  /** The mesh actually hit. */
  surface?: Object3D;
  /** The ray's hit on `surface`: the mesh, the world point and the distance along the ray. */
  intersection?: { object: Object3D; point: XBVec3Like; distance: number };
  stopPropagation(): void;
}

/** `SelectEndEvent` in xrblocks' `core/Script.ts`. `completed` is true when the source released over the same target it pressed. */
export interface XrBlocksSelectEndEvent extends XrBlocksSelectEvent {
  completed: boolean;
  reason: string;
}

/** `ObjectGrabEvent` in xrblocks' `core/Script.ts`. */
export interface XrBlocksGrabEvent {
  source?: XrBlocksInteractionSource;
  /** 0 is the left hand, anything else the right (the mapping `xrblocks-interactions` uses). */
  handIndex: number;
  /** The grabbing hand (its wrist joint), moved by tracking; a title-bar grab rides it. */
  hand: Object3D;
  /** The fingertip's world position at the grab. */
  touchPosition: XBVec3Like;
  stopPropagation?(): void;
}

/** A node dispatch reaches - loosely typed so no `Object3D` cast is needed at call sites. */
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

/**
 * How far in front of and behind a panel's face a fingertip is still cast to
 * the element beneath it (metres). Wider than any press band the core allows
 * a `TouchPress`, so the approach is seen; narrow enough that a hand resting
 * well away from a panel is not "over" it.
 */
export const TOUCH_REACH = 0.15;

/**
 * Hits this close together along a ray (metres) are one surface: a uikit
 * element and the elements inside it lie in one plane, offset only by the
 * depth uikit gives their render order.
 */
export const COPLANAR_TOLERANCE = 0.002;

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

function tuple(point: XBVec3Like): Vec3Tuple {
  return [point.x, point.y, point.z];
}

/** Whether `element` is `root` or inside it. */
function isWithin(element: Object3D, root: Object3D): boolean {
  for (let at: Object3D | null = element; at; at = at.parent) if (at === root) return true;
  return false;
}

/**
 * The one node per panel XR Blocks treats as a Script. Inserted by
 * {@link XrBlocksPointerBridge.wire} between the panel document and the uikit
 * root, so it is an ancestor of every mesh in the panel and the Script XR
 * Blocks resolves for a hit on any of them. Its hooks forward to the bridge.
 */
export class XrBlocksPanelScript extends Group {
  /** What `ScriptsManager.isScript` reads. */
  readonly isXRScript = true;

  constructor(
    /** The uikit root this node wraps. */
    readonly panelRoot: Object3D,
    private readonly bridge: XrBlocksPointerBridge,
  ) {
    super();
    this.name = 'uix-xrblocks-panel';
  }

  /** XR Blocks calls this once when it first sees the node in the scene. Nothing to set up. */
  init(): void {}

  /** XR Blocks calls this when the node leaves the scene (its window closed). The host disposed the panel already. */
  dispose(): void {}

  onObjectSelectStart(event: XrBlocksSelectEvent): void {
    this.bridge.selectStart(this, event);
  }

  onObjectSelectEnd(event: XrBlocksSelectEndEvent): void {
    this.bridge.selectEnd(this, event);
  }

  onObjectGrabStart(event: XrBlocksGrabEvent): void {
    this.bridge.grabStart(this, event);
  }

  onObjectGrabEnd(event: XrBlocksGrabEvent): void {
    this.bridge.grabEnd(this, event);
  }
}

export class XrBlocksPointerBridge {
  private readonly touches = new Map<number, TouchPress<Object3D>>();
  private readonly touchOptions: TouchPressOptions;
  private readonly isLive: (element: Object3D) => boolean;
  private readonly offers: PanelPointerOffers;
  private readonly hover = new HoverTracker<Object3D>();
  /** Every wired uikit root (what the host handed `wire`). */
  private readonly roots = new Set<Object3D>();
  /** Root -> the Script node inserted above it. */
  private readonly scripts = new Map<Object3D, XrBlocksPanelScript>();
  private readonly raycaster = new Raycaster();
  /** Source key -> the element its select press went down on, so the release ends the SAME press. */
  private readonly selects = new Map<string, Object3D>();
  /** Hand key -> the element its grab went down on. */
  private readonly grabs = new Map<string, Object3D>();
  /** The ray sources of the last {@link updateFrame}, in order: a controller with no handedness is keyed by its position here. */
  private raySources: XBInputFrameLike['raySources'] = [];
  /** Source keys the last {@link updateFrame} offered a ray for, so a source that goes away is forgotten. */
  private rayKeys = new Set<string>();
  /** Source key -> the element its ray rested on at the last {@link updateFrame}. */
  private readonly rayTargets = new Map<string, Object3D>();
  /** Hand indexes the last {@link updateFrame} saw a fingertip for. */
  private touchHands = new Set<number>();

  constructor(options: XrBlocksPointerBridgeOptions = {}) {
    this.touchOptions = resolveTouchPress(options.touchOptions);
    this.isLive = options.isLive ?? ((): boolean => true);
    this.offers = new PanelPointerOffers(options.pointers);
  }

  /**
   * Make `root` (a panel's uikit root) interactive to XR Blocks: insert the
   * panel's Script node above it, in its parent's place, and join the set
   * {@link updateFrame} raycasts. Call once per panel, right after its
   * `data-uix` controls are upgraded (`upgradePanel`).
   */
  wire(root: Object3D): void {
    if (this.scripts.has(root)) return;
    const script = new XrBlocksPanelScript(root, this);
    const parent = root.parent;
    script.add(root);
    parent?.add(script);
    this.scripts.set(root, script);
    this.roots.add(root);
  }

  /** Stop raycasting `root` (its window closed). Its Script node stays in place and harmless. */
  unwire(root: Object3D): void {
    this.roots.delete(root);
  }

  /** The Script node {@link wire} inserted above `root`, or `undefined` when `root` was never wired. */
  scriptOf(root: Object3D): XrBlocksPanelScript | undefined {
    return this.scripts.get(root);
  }

  /**
   * Once per frame, with `xb.input.getFrame()`. Rays: raycast every wired
   * panel along each ray source, offer the nearest hit to the shared arbiter
   * as that source's ray candidate, resolve the source, and raise
   * `pointerenter` / `pointerleave` for what each source's ray now owns.
   * Touches: cast each fingertip to the element beneath it on the nearest
   * wired panel and drive that hand's `TouchPress` with its signed distance.
   */
  updateFrame(frame: XBInputFrameLike): void {
    this.raySources = frame.raySources;
    const seen = new Set<string>();
    frame.raySources.forEach((source, index) => {
      const key = this.controllerKey(source.controller, index);
      seen.add(key);
      const { origin, direction } = source.ray;
      const hit = this.rayCast(tuple(origin), tuple(direction));
      this.offers.offer(key, 'ray', hit ? { panelId: hit.root.uuid, point: hit.point, distance: hit.distance } : undefined);
      this.offers.resolve(key);
      const target = hit && this.offers.owns(key, 'ray') ? hit.target : undefined;
      if (target) this.rayTargets.set(key, target);
      else this.rayTargets.delete(key);
      this.setHover(`ray:${key}`, target);
    });
    for (const key of this.rayKeys) {
      if (seen.has(key)) continue;
      this.setHover(`ray:${key}`, undefined);
      this.rayTargets.delete(key);
      this.offers.forget(key);
    }
    this.rayKeys = seen;

    const hands = new Set<number>();
    for (const touch of frame.directTouches ?? []) {
      hands.add(touch.handIndex);
      this.touchSample(touch);
    }
    for (const handIndex of this.touchHands) {
      if (hands.has(handIndex)) continue;
      this.offers.offer(handKey(handIndex), 'touch', undefined);
      this.offers.resolve(handKey(handIndex));
      this.touch(handIndex, undefined);
    }
    this.touchHands = hands;
  }

  /** @deprecated Renamed {@link updateFrame}: the frame now drives touch as well as rays. */
  updateRays(frame: XBInputFrameLike): void {
    this.updateFrame(frame);
  }

  // --- XR Blocks hooks, forwarded by the panel's Script node ----------------

  /** @internal `onObjectSelectStart` on a panel's Script node. */
  selectStart(script: XrBlocksPanelScript, event: XrBlocksSelectEvent): void {
    event.stopPropagation();
    if (event.source.type === 'direct-touch') return; // touch is driven from the input frame
    const key = this.sourceKey(event.source);
    // The element: what this source's ray rested on at the last frame (the deepest element under
    // it), else the deepest element under XR Blocks' hit point, else the object XR Blocks names.
    // XR Blocks' own pick among coplanar hits may be the panel rather than the button on it.
    const rested = this.rayTargets.get(key);
    const element =
      (rested && isWithin(rested, script.panelRoot) ? rested : undefined) ??
      (event.intersection ? this.elementUnder(script.panelRoot, tuple(event.intersection.point))?.target : undefined) ??
      event.intersection?.object ??
      event.surface;
    if (!element || !this.isLive(element)) return;
    const point = event.intersection ? tuple(event.intersection.point) : worldPositionOf(element);
    const distance = event.intersection?.distance ?? 0;
    if (this.claimRay(key, script.panelRoot, point, distance)) {
      this.selects.set(key, element);
      this.offers.setSelecting(key, 'ray', true);
      this.bubble(element, 'pointerdown', { controller: event.source.controller });
    }
  }

  /** @internal `onObjectSelectEnd` on a panel's Script node. */
  selectEnd(_script: XrBlocksPanelScript, event: XrBlocksSelectEndEvent): void {
    event.stopPropagation();
    if (event.source.type === 'direct-touch') return;
    const key = this.sourceKey(event.source);
    const element = this.selects.get(key);
    if (element === undefined) return;
    this.selects.delete(key);
    this.offers.setSelecting(key, 'ray', false);
    if (!this.isLive(element)) return;
    this.bubble(element, 'pointerup');
    if (event.completed !== false && this.rayRestsOn(key, element)) this.bubble(element, 'click');
  }

  /** @internal `onObjectGrabStart` on a panel's Script node. */
  grabStart(script: XrBlocksPanelScript, event: XrBlocksGrabEvent): void {
    event.stopPropagation?.();
    const key = handKey(event.handIndex);
    const under = this.elementUnder(script.panelRoot, tuple(event.touchPosition));
    const element = under?.target ?? script.panelRoot;
    if (!this.isLive(element)) return;
    this.offers.offer(key, 'grab', { panelId: script.panelRoot.uuid, point: worldPositionOf(event.hand), distance: 0 });
    this.offers.resolve(key);
    if (!this.offers.owns(key, 'grab')) return;
    this.grabs.set(key, element);
    this.offers.setSelecting(key, 'grab', true);
    if (this.isOnTitlebar(element)) this.bubble(element, 'pointerdown', { hand: event.hand });
  }

  /** @internal `onObjectGrabEnd` on a panel's Script node. */
  grabEnd(_script: XrBlocksPanelScript, event: XrBlocksGrabEvent): void {
    event.stopPropagation?.();
    const key = handKey(event.handIndex);
    const element = this.grabs.get(key);
    if (element === undefined) return;
    this.grabs.delete(key);
    this.offers.setSelecting(key, 'grab', false);
    this.offers.offer(key, 'grab', undefined);
    this.offers.resolve(key);
    if (this.isLive(element) && this.isOnTitlebar(element)) {
      this.bubble(element, 'pointerup');
      this.bubble(element, 'click');
    }
  }

  // --- internals -------------------------------------------------------------

  /**
   * Whether the ray of the source in `key` may press the panel at `root`.
   * When {@link updateFrame} has offered for this source, its decision
   * stands. Otherwise (no input frame wired) XR Blocks' own hit is offered
   * here, so a host without the frame still presses.
   */
  private claimRay(key: string, root: Object3D, point: Vec3Tuple, distance: number): boolean {
    if (!this.rayKeys.has(key)) {
      this.offers.offer(key, 'ray', { panelId: root.uuid, point, distance });
      this.offers.resolve(key);
    }
    return this.offers.owns(key, 'ray');
  }

  /** Whether the source's ray, as last cast by {@link updateFrame}, rests on `element`. True when the frame is not wired: XR Blocks' `completed` is then the whole answer. */
  private rayRestsOn(key: string, element: Object3D): boolean {
    if (!this.rayKeys.has(key)) return true;
    return this.rayTargets.get(key) === element;
  }

  /** The arbiter's name for an interaction source: its handedness, else `controller:<position in the ray sources>`. */
  private sourceKey(source: XrBlocksInteractionSource): string {
    return sideOf(source.handedness) ?? this.controllerKey(source.controller);
  }

  /** The arbiter's name for a controller: its input source's handedness, else `controller:<position in the ray sources>`. */
  private controllerKey(controller: object, knownIndex?: number): string {
    const side = sideOf((controller as { inputSource?: { handedness?: unknown } }).inputSource?.handedness);
    if (side) return side;
    return `controller:${knownIndex ?? this.raySources.findIndex((source) => source.controller === controller)}`;
  }

  /** The nearest hit on any live wired panel along a world ray. */
  private rayCast(origin: Vec3Tuple, direction: Vec3Tuple): { root: Object3D; target: Object3D; point: Vec3Tuple; distance: number } | undefined {
    this.raycaster.set(scratchOrigin.set(...origin), scratchDirection.set(...direction).normalize());
    this.raycaster.far = Infinity;
    let nearest: { root: Object3D; hit: Intersection<Object3D> } | undefined;
    for (const root of this.roots) {
      if (!this.isLive(root)) continue;
      const hit = this.castDeepest(root);
      if (hit && (!nearest || hit.distance < nearest.hit.distance)) nearest = { root, hit };
    }
    if (!nearest) return undefined;
    const { hit } = nearest;
    return { root: nearest.root, target: hit.object, point: [hit.point.x, hit.point.y, hit.point.z], distance: hit.distance };
  }

  /**
   * The element of `root` beneath a world `point`, found by casting from
   * {@link TOUCH_REACH} in front of the panel's face, along its normal, and
   * the point's signed distance to that element's plane (positive in front).
   * `undefined` when nothing of the panel lies under the point.
   */
  private elementUnder(root: Object3D, point: Vec3Tuple): { target: Object3D; signedDistance: number } | undefined {
    const normal = worldForwardOf(root);
    scratchOrigin.set(point[0] + normal[0] * TOUCH_REACH, point[1] + normal[1] * TOUCH_REACH, point[2] + normal[2] * TOUCH_REACH);
    scratchDirection.set(-normal[0], -normal[1], -normal[2]);
    this.raycaster.set(scratchOrigin, scratchDirection);
    this.raycaster.far = TOUCH_REACH * 2;
    const hit = this.castDeepest(root);
    if (!hit) return undefined;
    return { target: hit.object, signedDistance: signedDistanceToPlane(hit.object, point) };
  }

  /**
   * The hit on `root` along {@link raycaster}'s current ray that names the
   * element a pointer is really over: of the nearest hits (within
   * {@link COPLANAR_TOLERANCE}, since a uikit element and everything inside
   * it share one plane) the deepest in the tree, so a button inside a panel
   * wins over the panel.
   *
   * Every object is asked to `raycast` and every child is visited, whatever
   * `raycast` returned: three's own `intersectObject` stops at a uikit
   * component, whose `raycast` returns `false` to keep three out of its
   * glyph meshes, and would only ever report the panel itself. XR Blocks'
   * `HitRegistry.intersectTree` walks the same way.
   */
  private castDeepest(root: Object3D): Intersection<Object3D> | undefined {
    const hits: Intersection<Object3D>[] = [];
    const visit = (object: Object3D): void => {
      if (object.layers.test(this.raycaster.layers)) object.raycast(this.raycaster, hits);
      for (const child of object.children) visit(child);
    };
    visit(root);
    let best: Intersection<Object3D> | undefined;
    let bestDepth = -1;
    let nearest = Infinity;
    for (const hit of hits) if (hit.distance < nearest) nearest = hit.distance;
    for (const hit of hits) {
      if (hit.distance - nearest > COPLANAR_TOLERANCE) continue;
      // Depth below `root`: the root itself is 0, so a hit on it never outranks a hit inside it.
      let depth = 0;
      for (let at: Object3D | null = hit.object; at && at !== root; at = at.parent) depth += 1;
      if (depth > bestDepth) {
        best = hit;
        bestDepth = depth;
      }
    }
    return best;
  }

  /** One fingertip this frame: the element under it on the nearest live panel, offered as that hand's touch, drives the hand's `TouchPress`. */
  private touchSample(touch: XBDirectTouchLike): void {
    const key = handKey(touch.handIndex);
    const point = tuple(touch.point);
    let nearest: { root: Object3D; target: Object3D; signedDistance: number } | undefined;
    for (const root of this.roots) {
      if (!this.isLive(root)) continue;
      const under = this.elementUnder(root, point);
      if (under && (!nearest || Math.abs(under.signedDistance) < Math.abs(nearest.signedDistance))) nearest = { root, ...under };
    }
    if (nearest && !this.isLive(nearest.target)) nearest = undefined;
    // A fingertip over nothing, that was over nothing last frame too, is not the arbiter's business.
    if (!nearest && !this.touchHands.has(touch.handIndex)) return;
    this.offers.offer(key, 'touch', nearest ? { panelId: nearest.root.uuid, point, distance: Math.abs(nearest.signedDistance) } : undefined);
    this.offers.resolve(key);
    this.touch(touch.handIndex, nearest && this.offers.owns(key, 'touch') ? { signedDistance: nearest.signedDistance, target: nearest.target } : undefined);
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
