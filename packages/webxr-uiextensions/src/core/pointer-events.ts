/**
 * Pointer press/release/click - pure event-timing logic shared by every
 * platform's ray, controller and touch pointers, with no engine imports.
 *
 * Two pointer shapes exist, and both end at the same three events
 * (`pointerdown`, `pointerup`, `click`):
 *
 *  - A TOUCH (poke) pointer decides press and release itself, from signed
 *    distance - that is `TouchPress` (`touch-press.ts`). {@link dispatchTouchUpdate}
 *    turns its per-frame `TouchUpdate` into the three events.
 *  - A RAY or GRAB pointer is simpler: the adapter already knows whether the
 *    source is "active" (trigger down, pinch closed) each frame, and
 *    {@link EdgePress} turns the rising/falling edge of that boolean into a
 *    press over whatever is under the pointer when it goes active, and a
 *    release - with a `click` only when the release lands back on the same
 *    target - when it goes inactive.
 *
 * Every native and XR Blocks pointer (poke, controller tip, ray, grab) is one
 * of these two machines; an adapter never re-derives press/click timing of
 * its own. This is what `NativeWindowHost` used to do as private methods
 * (`press`/`release`/`edge`) - moved here so the XR Blocks binding runs
 * exactly the same rule instead of clicking on intersection.
 */
import type { TouchUpdate } from './touch-press.js';

/** The DOM-style pointer events the core raises on a panel element: a press, its release, and the click a release on the pressed element makes (as IWSDK's UI pointer does). */
export type PointerEventType = 'pointerdown' | 'pointerup' | 'click';

/**
 * Where a pointer event actually lands. An adapter's `dispatch` bubbles the
 * event up the element tree itself (or lets the engine bubble it - see
 * `EdgePress`'s `sink` parameter for XR Blocks, whose own event walk does
 * this); this interface is only the one call a press/release decision makes.
 */
export interface PointerEventSink<T> {
  dispatch(type: PointerEventType, target: T): void;
}

/**
 * Turn one frame's `TouchPress.update()` result into dispatched pointer
 * events: `pointerdown` where a press started, then on release `pointerup`
 * at wherever the pointer now is, and `click` too when that is where the
 * press started. Contact lost mid-hold still raises `pointerup`, at the
 * press target, with no `click`.
 *
 * `isSameTarget` decides the click, rather than `TouchUpdate.sameTarget`
 * (which compares the target values themselves): a target is typically a
 * fresh wrapper built each frame from a hit test (an element plus the panel
 * it belongs to), so two target VALUES for the same element are rarely `===`
 * even though they mean the same element. The same rule `EdgePress` takes an
 * `isSameTarget` for.
 */
export function dispatchTouchUpdate<T>(
  update: TouchUpdate<T>,
  sink: PointerEventSink<T>,
  isSameTarget: (a: T, b: T) => boolean,
): void {
  if (update.pressed && update.pressTarget !== undefined) {
    sink.dispatch('pointerdown', update.pressTarget);
  }
  if (!update.released) return;
  if (update.releaseTarget !== undefined) {
    sink.dispatch('pointerup', update.releaseTarget);
    if (update.pressTarget !== undefined && isSameTarget(update.pressTarget, update.releaseTarget)) {
      sink.dispatch('click', update.releaseTarget);
    }
  } else if (update.pressTarget !== undefined) {
    // Contact lost: the press ends where it started, with no click.
    sink.dispatch('pointerup', update.pressTarget);
  }
}

/**
 * Press/release/click for a boolean-active pointer: a ray (trigger) or a
 * grab (pinch). A press starts on the rising edge of `active` while a target
 * is under the pointer; a release fires on the falling edge, `pointerup`
 * wherever the pointer now is, with `click` added only when that is the
 * press target. Losing the target entirely (an `undefined` target on the
 * falling edge) still releases, at the original press target, with no click -
 * matching {@link dispatchTouchUpdate}'s "contact lost" case.
 *
 * One instance tracks one pointer. `isSameTarget` lets a binding compare its
 * own target shape (an element wrapper, a uikit `Object3D`) without this
 * module knowing what a target is.
 */
export class EdgePress<T> {
  private active = false;
  private pressed = false;
  private pressTarget: T | undefined;

  /** Whether this pointer is mid-press (between the down and the matching up). */
  get isPressed(): boolean {
    return this.pressed;
  }

  /** The target the current press started on, while `isPressed` is true. */
  get target(): T | undefined {
    return this.pressTarget;
  }

  update(
    active: boolean,
    target: T | undefined,
    sink: PointerEventSink<T>,
    isSameTarget: (a: T, b: T) => boolean,
  ): void {
    if (active && !this.active && target !== undefined) {
      this.pressed = true;
      this.pressTarget = target;
      sink.dispatch('pointerdown', target);
    }
    if (!active && this.active && this.pressed) {
      const pressTarget = this.pressTarget as T;
      this.pressed = false;
      this.pressTarget = undefined;
      if (target !== undefined) {
        sink.dispatch('pointerup', target);
        if (isSameTarget(pressTarget, target)) sink.dispatch('click', target);
      } else {
        sink.dispatch('pointerup', pressTarget);
      }
    }
    this.active = active;
  }
}
