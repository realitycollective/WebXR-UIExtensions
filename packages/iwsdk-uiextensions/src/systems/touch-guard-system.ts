/**
 * UITouchGuardSystem - press / hold / release for IWSDK's near (poke)
 * pointers, driven by the core's `TouchPress` state machine.
 *
 * What IWSDK does on its own. Its touch pointer (`@pmndrs/pointer-events`)
 * presses when the fingertip's distance to a panel drops under 2 cm and
 * releases when it rises above, and that distance has no sign: uikit's panel
 * spherecast projects the fingertip onto the panel plane and measures how
 * far it is, either side. A finger pushed through a panel and pulled back
 * therefore fires press, release, press, release - two clicks for one
 * gesture - and a finger arriving from behind presses too.
 *
 * What this system does. It takes over the two touch pointers' `down` and
 * `up`: IWSDK's own calls become no-ops, and each frame (right after
 * `InputSystem` has moved the pointers) the fingertip's SIGNED distance to
 * what it is over is fed to a `TouchPress`, whose transitions call the
 * original `down` / `up`. The pointer still delivers `pointerdown`,
 * `pointerup` and `click` to the element exactly as before, so nothing
 * downstream changes; only when they fire does. The guarantees are the
 * machine's: a press only from the front, one press per touch until a
 * release, release on coming back out or on losing contact.
 *
 * Every poke target in the app benefits, IWSDK's own panels included, since
 * they share the same two pointers. Off with
 * `registerUIExtensions(world, { touchGuard: false })`.
 */
import { Types } from '@iwsdk/core';
import { createSystem } from '../create-system.js';
import { Quaternion, Vector3, type Object3D } from 'three';
import {
  DEFAULT_TOUCH_PRESS,
  TouchPress,
  type TouchSample,
} from '@realitycollective/webxr-uiextensions';

type Handedness = 'left' | 'right';

/** The slice of a pointer-events `Pointer` this system drives. */
interface TouchPointerLike {
  down(event: { timeStamp: number; button: number }): void;
  up(event: { timeStamp: number; button: number }): void;
  getIntersection():
    | {
        object: Object3D & { isVoidObject?: boolean };
        point: Vector3;
        pointerPosition?: Vector3;
        normal?: Vector3;
        distance: number;
      }
    | undefined;
}

interface Guard {
  pointer: TouchPointerLike;
  press: TouchPress<Object3D>;
  down: TouchPointerLike['down'];
  up: TouchPointerLike['up'];
}

const HANDS: readonly Handedness[] = ['left', 'right'];
const HELPER_NORMAL = new Vector3();
const HELPER_OFFSET = new Vector3();
const HELPER_QUATERNION = new Quaternion();

export class UITouchGuardSystem extends createSystem(
  {},
  {
    /** Signed distance in front (meters) at or under which a touch presses. */
    pressDistance: { type: Types.Float32, default: DEFAULT_TOUCH_PRESS.pressDistance },
    /** Signed distance in front the finger must come back past to release. */
    releaseDistance: { type: Types.Float32, default: DEFAULT_TOUCH_PRESS.releaseDistance },
    /** Let a fingertip arriving from behind a panel press. */
    allowFromBehind: { type: Types.Boolean, default: DEFAULT_TOUCH_PRESS.allowFromBehind },
  },
) {
  private guards = new Map<Handedness, Guard>();

  override init(): void {
    const xr = (this.input as typeof this.input | undefined)?.xr;
    if (!xr) {
      return; // headless, or no XR input: nothing to guard
    }
    for (const hand of HANDS) {
      const pointer = xr.multiPointers[hand].getPointer('touch') as unknown as TouchPointerLike;
      const guard: Guard = {
        pointer,
        press: new TouchPress<Object3D>({
          pressDistance: this.config.pressDistance.value,
          releaseDistance: this.config.releaseDistance.value,
          allowFromBehind: this.config.allowFromBehind.value,
        }),
        down: pointer.down.bind(pointer),
        up: pointer.up.bind(pointer),
      };
      // IWSDK's unsigned-distance press and its forced release on lost hover
      // both land here and are dropped; the machine below decides instead.
      pointer.down = () => {};
      pointer.up = () => {};
      this.guards.set(hand, guard);
    }
    this.cleanupFuncs.push(() => {
      for (const guard of this.guards.values()) {
        guard.pointer.down = guard.down;
        guard.pointer.up = guard.up;
        guard.press.reset();
      }
      this.guards.clear();
    });
  }

  override update(_delta: number, time: number): void {
    const event = { timeStamp: time * 1000, button: 0 };
    for (const guard of this.guards.values()) {
      const result = guard.press.update(sampleOf(guard.pointer));
      if (result.pressed) {
        guard.down(event);
      }
      if (result.released) {
        guard.up(event);
      }
    }
  }

  /** The state machine for a hand, for inspection and tests. */
  pressFor(hand: Handedness): TouchPress<Object3D> | undefined {
    return this.guards.get(hand)?.press;
  }
}

/**
 * This frame's signed distance from the fingertip to the surface it is over,
 * positive in front. The surface normal is the intersection's local normal
 * (uikit panels report +Z) taken to world space; a target with no normal is
 * treated as faced from the front, so a plain mesh keeps IWSDK's behaviour.
 */
export function sampleOf(pointer: TouchPointerLike): TouchSample<Object3D> | undefined {
  const intersection = pointer.getIntersection();
  if (!intersection || intersection.object.isVoidObject) {
    return undefined;
  }
  const { object, point, pointerPosition, normal } = intersection;
  if (!normal || !pointerPosition) {
    return { signedDistance: intersection.distance, target: object };
  }
  object.getWorldQuaternion(HELPER_QUATERNION);
  HELPER_NORMAL.copy(normal).applyQuaternion(HELPER_QUATERNION).normalize();
  HELPER_OFFSET.copy(pointerPosition).sub(point);
  return { signedDistance: HELPER_OFFSET.dot(HELPER_NORMAL), target: object };
}
