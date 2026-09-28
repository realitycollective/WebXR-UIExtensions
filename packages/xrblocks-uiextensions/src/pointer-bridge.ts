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
 * A near (grab) press only ever begins on the title bar, exactly as native's
 * grab pointer: `onObjectGrabStart`/`End` do nothing unless the hit node is
 * inside the `uix-titlebar` element.
 */
import { Quaternion, Vector3, type Object3D } from 'three';
import {
  TouchPress,
  WINDOW_CHROME_IDS,
  dispatchTouchUpdate,
  resolveTouchPress,
  type PointerEventType,
  type TouchPressOptions,
  type Vec3Tuple,
} from '@realitycollective/webxr-uiextensions';

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

export class XrBlocksPointerBridge {
  private readonly touches = new Map<number, TouchPress<Object3D>>();
  private readonly touchOptions: TouchPressOptions;
  private readonly isLive: (element: Object3D) => boolean;

  constructor(options: XrBlocksPointerBridgeOptions = {}) {
    this.touchOptions = resolveTouchPress(options.touchOptions);
    this.isLive = options.isLive ?? ((): boolean => true);
  }

  /**
   * Attach every callback this bridge understands to `root` and every
   * descendant, recursively. Call once per panel, right after its
   * `data-uix` controls are upgraded (`upgradePanel`).
   */
  wire(root: Object3D): void {
    root.traverse((element) => this.attach(element));
  }

  private attach(element: Object3D): void {
    const bridge = this;
    Object.assign(element, {
      onSelectStart(event: XrBlocksSelectEvent): boolean {
        if (bridge.isLive(element)) bridge.bubble(element, 'pointerdown', { controller: event.target });
        return true;
      },
      onSelectEnd(): boolean {
        if (bridge.isLive(element)) {
          bridge.bubble(element, 'pointerup');
          bridge.bubble(element, 'click');
        }
        return true;
      },
      onObjectGrabStart(event: XrBlocksGrabEvent): boolean {
        if (bridge.isLive(element) && bridge.isOnTitlebar(element)) {
          bridge.bubble(element, 'pointerdown', { hand: event.hand });
        }
        return true;
      },
      onObjectGrabEnd(): boolean {
        if (bridge.isLive(element) && bridge.isOnTitlebar(element)) {
          bridge.bubble(element, 'pointerup');
          bridge.bubble(element, 'click');
        }
        return true;
      },
      onObjectTouchEnd(event: XrBlocksTouchEvent): boolean {
        bridge.touch(event.handIndex, undefined);
        return true;
      },
      onObjectTouching(event: XrBlocksTouchEvent): boolean {
        if (!bridge.isLive(element)) return true;
        const point: Vec3Tuple = [event.touchPosition.x, event.touchPosition.y, event.touchPosition.z];
        bridge.touch(event.handIndex, { signedDistance: signedDistanceToPlane(element, point), target: element });
        return true;
      },
      onHoverEnter(): boolean {
        if (bridge.isLive(element)) (element as unknown as Dispatchable).dispatchEvent({ type: 'pointerenter' });
        return true;
      },
      onHoverExit(): boolean {
        (element as unknown as Dispatchable).dispatchEvent({ type: 'pointerleave' });
        return true;
      },
    });
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
