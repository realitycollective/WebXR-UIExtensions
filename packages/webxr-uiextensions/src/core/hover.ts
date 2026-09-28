/**
 * Hover - which element each pointer is over, and whether an element is
 * hovered at all. Pure logic, no engine imports.
 *
 * The template is IWSDK's pointer events (`@pmndrs/pointer-events`, driving
 * uikit's `:hover`): each pointer raises `pointerenter` on the element it
 * moves onto and `pointerleave` on the one it left, once per change, and
 * an element's hover STYLE holds while any pointer is over it. This module
 * restates that as one decision every binding makes from the pointer
 * samples it already has (a ray hit, a fingertip near a panel, a grab
 * pointer on a title bar), so a native host is told the hover state and
 * only restyles, and three.js and XR Blocks raise the same events from
 * the same rule rather than each their own.
 *
 * A pointer that stops reporting counts as having left; a pointer over
 * nothing leaves whatever it was over. Targets are compared by identity
 * unless a `keyOf` is given (a binding that rebuilds a target value each
 * frame passes the element's stable key).
 */

/** What changed for one pointer this frame, and for the element's hover style. */
export interface HoverUpdate<T> {
  /** The element this pointer moved onto, raising `pointerenter` on it. */
  pointerEnter: T | undefined;
  /** The element this pointer moved off, raising `pointerleave` on it. */
  pointerLeave: T | undefined;
  /** The element that became hovered by its first pointer: apply the hover style. */
  hoverOn: T | undefined;
  /** The element that lost its last pointer: remove the hover style. */
  hoverOff: T | undefined;
}

const NONE: HoverUpdate<never> = Object.freeze({ pointerEnter: undefined, pointerLeave: undefined, hoverOn: undefined, hoverOff: undefined });

export class HoverTracker<T> {
  private readonly byPointer = new Map<string, { key: unknown; target: T }>();
  private readonly counts = new Map<unknown, { target: T; count: number }>();
  private readonly keyOf: (target: T) => unknown;

  constructor(keyOf: (target: T) => unknown = (target) => target) {
    this.keyOf = keyOf;
  }

  /** Report what `pointerId` is over this frame; `undefined` for nothing. */
  update(pointerId: string, target: T | undefined): HoverUpdate<T> {
    const key = target === undefined ? undefined : this.keyOf(target);
    const previous = this.byPointer.get(pointerId);
    if (previous?.key === key) {
      if (previous && target !== undefined) {
        previous.target = target;
        this.counts.get(key)!.target = target;
      }
      return NONE as HoverUpdate<T>;
    }
    const update: HoverUpdate<T> = { pointerEnter: undefined, pointerLeave: undefined, hoverOn: undefined, hoverOff: undefined };
    if (previous) {
      update.pointerLeave = previous.target;
      update.hoverOff = this.release(previous.key);
      this.byPointer.delete(pointerId);
    }
    if (target !== undefined) {
      update.pointerEnter = target;
      update.hoverOn = this.acquire(key, target);
      this.byPointer.set(pointerId, { key, target });
    }
    return update;
  }

  /** The pointer is gone: it leaves whatever it was over. */
  remove(pointerId: string): HoverUpdate<T> {
    return this.update(pointerId, undefined);
  }

  /** Whether any pointer is over `target` now. */
  isHovered(target: T): boolean {
    return (this.counts.get(this.keyOf(target))?.count ?? 0) > 0;
  }

  /** Every element hovered now. */
  hovered(): T[] {
    return [...this.counts.values()].map((entry) => entry.target);
  }

  /** Forget every pointer without raising anything (the panel went away). */
  clear(): void {
    this.byPointer.clear();
    this.counts.clear();
  }

  private acquire(key: unknown, target: T): T | undefined {
    const entry = this.counts.get(key);
    if (entry) {
      entry.count += 1;
      entry.target = target;
      return undefined;
    }
    this.counts.set(key, { target, count: 1 });
    return target;
  }

  private release(key: unknown): T | undefined {
    // A pointer's key is always counted: it was acquired when the pointer arrived.
    const entry = this.counts.get(key)!;
    entry.count -= 1;
    if (entry.count > 0) return undefined;
    this.counts.delete(key);
    return entry.target;
  }
}
