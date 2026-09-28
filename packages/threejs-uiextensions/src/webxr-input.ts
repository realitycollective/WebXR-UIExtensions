/**
 * WebXR session wiring for the plain three.js binding: everything that turns
 * a live `renderer.xr` (three's `WebXRManager`) into pose sources and
 * `ScenePointerBridge` calls, with no engine SDK beyond three.js itself.
 *
 * - {@link cameraHeadPoseSource} - the viewer pose, from the render camera.
 * - {@link webxrHandPoseSource} - a tracked hand's pose, for hand menus, from
 *   the session's input sources' grip space (falling back to the target ray
 *   space) - the same convention `xrblocks-uiextensions`'s own copy uses.
 * - {@link connectWebXrPointerInput} - wires ray (select), near/grab
 *   (squeeze) and touch (hand-joint `index-finger-tip`) interactions from the
 *   session onto a `ScenePointerBridge`, and - given a `scene` - a
 *   `CursorVisual` disc per ray (`ui/pointer-cursor`). three.js's own
 *   controller/hand objects (`renderer.xr.getController`, `getControllerGrip`,
 *   `getHand`) are kept at the session's own poses every frame by three, and
 *   dispatch the session's `selectstart`/`selectend`/`squeezestart`/
 *   `squeezeend` events directly on themselves, so this module never touches
 *   `XRFrame` / `XRReferenceSpace` itself - only the per-frame hand-joint
 *   touch poll and ray hover/cursor reads the controller/hand objects' live
 *   world pose, which three already keeps current.
 */
import { HoverTracker } from '@realitycollective/webxr-uiextensions';
import { Quaternion, Vector3, type Object3D, type PerspectiveCamera } from 'three';
import type { HandPoseSource, HeadPose, HeadPoseSource, QuatTuple, Vec3Tuple } from '@realitycollective/webxr-uiextensions';
import { CursorVisual, type CursorVisualOptions } from './cursor-visual.js';
import type { ScenePointerBridge } from './pointer-bridge.js';

/**
 * The slice of three's `WebXRManager` (`renderer.xr`) this module needs.
 * Structural, so a fake in a test needs only these members.
 */
export interface WebXRManagerLike {
  getFrame(): XRFrame | null | undefined;
  getReferenceSpace(): XRReferenceSpace | null;
  getSession(): XRSession | null;
  getController(index: number): Object3D;
  getControllerGrip(index: number): Object3D;
  getHand(index: number): Object3D & { joints: Record<string, Object3D | undefined> };
}

/** HeadPoseSource backed by a three.js camera. */
export function cameraHeadPoseSource(
  camera: Pick<PerspectiveCamera, 'getWorldPosition' | 'getWorldQuaternion'>,
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

/**
 * HandPoseSource backed by a live WebXR session: each hand's pose is its
 * input source's `gripSpace` (a controller's grip, or the tracked hand),
 * falling back to the target ray space when a runtime gives a hand none.
 * Returns `undefined` for a hand with no input source this frame, or with no
 * frame at all (outside a session), so hand menus stay hidden there.
 */
export function webxrHandPoseSource(
  xr: Pick<WebXRManagerLike, 'getFrame' | 'getReferenceSpace' | 'getSession'>,
): HandPoseSource {
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

const scratchPosition = new Vector3();
const scratchQuaternion = new Quaternion();
const scratchDirection = new Vector3();

/** `object`'s current world position, as a plain tuple. */
function worldPositionOf(object: Object3D): Vec3Tuple {
  object.getWorldPosition(scratchPosition);
  return [scratchPosition.x, scratchPosition.y, scratchPosition.z];
}

/** `object`'s local `-Z` axis, rotated to world space - three's target-ray convention. */
function worldRayDirectionOf(object: Object3D): Vec3Tuple {
  object.getWorldQuaternion(scratchQuaternion);
  scratchDirection.set(0, 0, -1).applyQuaternion(scratchQuaternion);
  return [scratchDirection.x, scratchDirection.y, scratchDirection.z];
}

/** `object`'s current world orientation, as a plain tuple. */
function worldQuaternionOf(object: Object3D): QuatTuple {
  object.getWorldQuaternion(scratchQuaternion);
  return [scratchQuaternion.x, scratchQuaternion.y, scratchQuaternion.z, scratchQuaternion.w];
}

export interface ConnectWebXrPointerInputOptions {
  /** `renderer.xr`, or anything with the same three.js `WebXRManager` methods. */
  renderer: { xr: WebXRManagerLike };
  /** The bridge {@link UixWindowHostOptions.pointerBridgeFactory} produced - the SAME instance windows are `wire()`d onto. */
  bridge: ScenePointerBridge;
  /** How many controller/hand slots to wire (session input sources 0..n-1). Default 2. */
  controllerCount?: number;
  /**
   * Meters within which a tracked fingertip is considered "near enough to
   * probe" a panel at all. Default 0.08 - comfortably past the core
   * `TouchPress`'s own release distance (0.03 m, `ui/touch-press`), so a
   * finger retreating through the release band is still resolved to the same
   * target instead of the contact being reported lost prematurely; the press
   * and release thresholds themselves live in the core, not here.
   */
  touchDistance?: number;
  /** Meters within which a grip presses (near/grab). Default 0.12 - wide enough to reach a title bar's thickness from a natural grab pose. */
  grabDistance?: number;
  /**
   * Where each ray's cursor disc (`ui/pointer-cursor`: a disc at every ray
   * hit, whatever presence says) is parented, in the same world space
   * `bridge.rayCast` reports hits in - normally the same scene
   * `UixWindowHost` spawns windows into (`connectUIExtensions` passes it
   * automatically). Leave it out to skip cursors entirely - a headless test,
   * or a caller drawing its own.
   */
  scene?: Object3D;
  /** Cursor disc radius/offset. Ignored with no `scene`. */
  cursor?: CursorVisualOptions;
}

/**
 * The four session interaction events three.js dispatches on a controller
 * object (`renderer.xr.getController(i)`). `@types/three`'s `Object3DEventMap`
 * does not include them (they come from the runtime WebXR session, not
 * three's own event vocabulary), so this narrow, structural view is cast to
 * at the point of use rather than widening every `Object3D` call site.
 */
interface XrControllerEventTarget {
  addEventListener(type: 'selectstart' | 'selectend' | 'squeezestart' | 'squeezeend', listener: () => void): void;
  removeEventListener(type: 'selectstart' | 'selectend' | 'squeezestart' | 'squeezeend', listener: () => void): void;
}

function xrEvents(object: Object3D): XrControllerEventTarget {
  return object as unknown as XrControllerEventTarget;
}

export interface WebXrPointerInput {
  /** Poll ray hover and hand-joint touch. Call once per render frame while a session may be active. */
  update(): void;
  /** Remove every event listener this added. Safe to call once; `UixWindowHost.dispose` does not call this - call it yourself when tearing down the renderer. */
  dispose(): void;
}

/**
 * Wire ray (select), near/grab (squeeze) and touch (hand-joint) interactions
 * from a live WebXR session onto `bridge`. Every rule decision (press timing,
 * click-on-release, hold-to-drag, focus bias, and so on) already runs in
 * `UixWindowHost` and the core it drives; this module's only job is turning
 * session signals into `bridge.rayHit` / `touchHit` / `pointerDown` /
 * `pointerUp` / `touch` calls - the same division of labour
 * `XrBlocksPointerBridge` has from `UixWindowHost` in the XR Blocks binding.
 */
export function connectWebXrPointerInput(options: ConnectWebXrPointerInputOptions): WebXrPointerInput {
  const { renderer, bridge } = options;
  const touchDistance = options.touchDistance ?? 0.08;
  const grabDistance = options.grabDistance ?? 0.12;
  const controllerCount = options.controllerCount ?? 2;
  const disposers: Array<() => void> = [];
  /** Controller/grip -> the target its press resolved to, so release ends the SAME gesture even if the ray has since moved off it. */
  const activePress = new Map<Object3D, Object3D>();
  const hover = new HoverTracker<Object3D>();
  /** One cursor disc per controller slot, `undefined` when no `scene` was given (cursors skipped). */
  const cursors: Array<CursorVisual> | undefined = options.scene
    ? Array.from({ length: controllerCount }, () => new CursorVisual(options.scene!, options.cursor))
    : undefined;

  for (let index = 0; index < controllerCount; index += 1) {
    const controller = renderer.xr.getController(index);
    const grip = renderer.xr.getControllerGrip(index);

    const onSelectStart = (): void => {
      const hit = bridge.rayHit(worldPositionOf(controller), worldRayDirectionOf(controller));
      if (hit) {
        activePress.set(controller, hit);
        bridge.pointerDown(hit, { controller });
      }
    };
    const onSelectEnd = (): void => {
      const hit = activePress.get(controller);
      if (hit) {
        bridge.pointerUp(hit);
        activePress.delete(controller);
      }
    };
    const onSqueezeStart = (): void => {
      const hit = bridge.touchHit(worldPositionOf(grip), grabDistance);
      if (hit) {
        activePress.set(grip, hit.target);
        bridge.pointerDown(hit.target, { hand: grip });
      }
    };
    const onSqueezeEnd = (): void => {
      const hit = activePress.get(grip);
      if (hit) {
        bridge.pointerUp(hit);
        activePress.delete(grip);
      }
    };
    const events = xrEvents(controller);
    events.addEventListener('selectstart', onSelectStart);
    events.addEventListener('selectend', onSelectEnd);
    events.addEventListener('squeezestart', onSqueezeStart);
    events.addEventListener('squeezeend', onSqueezeEnd);
    disposers.push(() => {
      events.removeEventListener('selectstart', onSelectStart);
      events.removeEventListener('selectend', onSelectEnd);
      events.removeEventListener('squeezestart', onSqueezeStart);
      events.removeEventListener('squeezeend', onSqueezeEnd);
    });
  }

  function update(): void {
    // Hover (and the cursor disc, ui/pointer-cursor): one ray cast per
    // visible controller serves both - the hover target diffed against last
    // frame's, and the disc shown at the SAME hit (or hidden with none),
    // never gated on hover/focus state.
    for (let index = 0; index < controllerCount; index += 1) {
      const controller = renderer.xr.getController(index);
      const detail = controller.visible
        ? bridge.rayCast(worldPositionOf(controller), worldRayDirectionOf(controller))
        : undefined;
      // Hover per element is the core rule (`HoverTracker`): each pointer
      // raises enter and leave on the element it moves onto and off, as
      // IWSDK's pointer events do for uikit's :hover.
      const change = hover.update(`ray:${index}`, detail?.target);
      if (change.pointerLeave) bridge.hoverExit(change.pointerLeave);
      if (change.pointerEnter) bridge.hoverEnter(change.pointerEnter);
      const cursor = cursors?.[index];
      if (cursor) {
        if (detail) cursor.showAtHit(detail.point, detail.normal, worldQuaternionOf(controller));
        else cursor.hide();
      }
    }

    // Touch: every tracked hand's index-finger-tip, every frame - handIndex
    // addresses the same slot a controller-tip poke would, so both
    // press through one shared `TouchPress` sequence per slot.
    for (let index = 0; index < controllerCount; index += 1) {
      const hand = renderer.xr.getHand(index);
      const tip = hand.visible ? hand.joints['index-finger-tip'] : undefined;
      if (!tip) {
        bridge.touch(index, undefined);
        continue;
      }
      const hit = bridge.touchHit(worldPositionOf(tip), touchDistance);
      bridge.touch(index, hit ? { signedDistance: hit.signedDistance, target: hit.target } : undefined);
    }
  }

  function dispose(): void {
    for (const off of disposers) off();
    disposers.length = 0;
    activePress.clear();
    hover.clear();
    for (const cursor of cursors ?? []) cursor.dispose();
  }

  return { update, dispose };
}
