/**
 * Scrolling - how an overflowing element scrolls under a pointer drag and a
 * wheel, and how it coasts and settles afterwards. Pure logic, no engine.
 *
 * The template is uikit's scroll handling (`@pmndrs/uikit` `scroll.js`),
 * which IWSDK and three.js panels get for free and a native host does not:
 *
 * - A pointer pressed on a scrollable element captures it. Each move scrolls
 *   by the drag's delta in the element's own pixel space (x right, y down),
 *   both negated: content follows the finger, so dragging it up scrolls
 *   down. The drag's velocity is kept in pixels per millisecond for the
 *   coast that follows. (uikit's local y runs up, so it negates x only.)
 * - Past either end the drag meets a rubber band: a delta that pushes
 *   further out shrinks by `1 - overshoot / 100` pixels, and each frame
 *   pulls the position back by 30 % of the overshoot.
 * - Released, the content coasts: each frame moves by `velocity * dt` and
 *   multiplies the velocity by 0.9, stopping below 0.01 px/ms (10 px/s).
 * - A wheel scrolls by its deltas directly, clamped to the range.
 *
 * A thumbstick is not in the template: an app that wants one maps its axis
 * to `wheel` at a speed it chooses.
 */

export interface ScrollOptions {
  /** Velocity multiplier per frame while coasting. uikit 0.9. */
  damping: number;
  /** Pixels per millisecond below which a coast stops. uikit 0.01 (10 px/s). */
  stopBelow: number;
  /** The fraction of an overshoot pulled back per frame. uikit 0.3. */
  rubberBandReturn: number;
  /** Pixels of overshoot at which a further push has no effect. uikit 100. */
  rubberBandRange: number;
}

export const SCROLL_DEFAULTS: Readonly<ScrollOptions> = Object.freeze({
  damping: 0.9,
  stopBelow: 0.01,
  rubberBandReturn: 0.3,
  rubberBandRange: 100,
});

/** A scrollable element's extent: its size and how far it can scroll, pixels. */
export interface ScrollExtent {
  width: number;
  height: number;
  maxX: number;
  maxY: number;
}

interface Drag {
  /** The last local point, in pixels. */
  x: number;
  y: number;
  timestampMs: number;
}

export class ScrollState {
  readonly options: ScrollOptions;
  private x = 0;
  private y = 0;
  private velocityX = 0;
  private velocityY = 0;
  private extent: ScrollExtent = { width: 0, height: 0, maxX: 0, maxY: 0 };
  private readonly drags = new Map<string, Drag>();

  constructor(options: Partial<ScrollOptions> = {}) {
    this.options = { ...SCROLL_DEFAULTS, ...options };
  }

  /** The scroll position now, pixels from the top left. */
  get position(): readonly [number, number] {
    return [this.x, this.y];
  }

  get velocity(): readonly [number, number] {
    return [this.velocityX, this.velocityY];
  }

  /** Whether any pointer is dragging. */
  get dragging(): boolean {
    return this.drags.size > 0;
  }

  /** Whether a frame would still move the content (coasting or returning from an overshoot). */
  get settling(): boolean {
    return this.velocityX !== 0 || this.velocityY !== 0 || Math.abs(this.outside(this.x, this.extent.maxX)) > 1 || Math.abs(this.outside(this.y, this.extent.maxY)) > 1;
  }

  /** The element's size and range changed (layout, content). The position is kept and clamped on the next frame. */
  setExtent(extent: ScrollExtent): void {
    this.extent = { ...extent };
  }

  /** A pointer pressed the element at `local` (pixels in the element). */
  beginDrag(pointerId: string, local: readonly [number, number], timestampMs: number): void {
    this.drags.set(pointerId, { x: local[0], y: local[1], timestampMs });
    this.velocityX = 0;
    this.velocityY = 0;
  }

  /** The pointer moved to `local`; scroll by the delta and record the velocity. Returns the new position. */
  moveDrag(pointerId: string, local: readonly [number, number], timestampMs: number): readonly [number, number] {
    const drag = this.drags.get(pointerId);
    if (!drag) return this.position;
    const dx = local[0] - drag.x;
    const dy = local[1] - drag.y;
    const dt = timestampMs - drag.timestampMs;
    drag.x = local[0];
    drag.y = local[1];
    drag.timestampMs = timestampMs;
    if (dt > 0) {
      this.velocityX = -dx / dt;
      this.velocityY = -dy / dt;
    }
    this.apply(-dx, -dy, true);
    return this.position;
  }

  /** The pointer released or left; the content coasts from here. */
  endDrag(pointerId: string): void {
    this.drags.delete(pointerId);
  }

  /** A wheel (or a thumbstick an app maps to one): scroll by the deltas, clamped. */
  wheel(deltaX: number, deltaY: number): readonly [number, number] {
    this.apply(deltaX, deltaY, false);
    return this.position;
  }

  /** Advance one frame of coasting and rubber-band return while nothing drags. Returns the position. */
  frame(dtMs: number): readonly [number, number] {
    if (this.drags.size > 0) return this.position;
    let deltaX = this.outside(this.x, this.extent.maxX) * -this.options.rubberBandReturn;
    let deltaY = this.outside(this.y, this.extent.maxY) * -this.options.rubberBandReturn;
    deltaX += this.velocityX * dtMs;
    deltaY += this.velocityY * dtMs;
    this.velocityX *= this.options.damping;
    this.velocityY *= this.options.damping;
    if (Math.abs(this.velocityX) < this.options.stopBelow) this.velocityX = 0;
    if (Math.abs(this.velocityY) < this.options.stopBelow) this.velocityY = 0;
    if (deltaX !== 0 || deltaY !== 0) this.apply(deltaX, deltaY, true);
    return this.position;
  }

  /** Put the content at a position directly, clamped. */
  scrollTo(x: number, y: number): void {
    this.x = clamp(x, 0, this.extent.maxX);
    this.y = clamp(y, 0, this.extent.maxY);
    this.velocityX = 0;
    this.velocityY = 0;
  }

  private apply(deltaX: number, deltaY: number, rubberBand: boolean): void {
    this.x = this.compute(this.x, this.extent.maxX, deltaX, rubberBand);
    this.y = this.compute(this.y, this.extent.maxY, deltaY, rubberBand);
  }

  /** uikit's `computeScroll`: a push further out shrinks with the overshoot; without the band the result is clamped. */
  private compute(position: number, max: number, delta: number, rubberBand: boolean): number {
    if (delta === 0) return position;
    const outside = this.outside(position, max);
    if (delta >= 0 === outside >= 0 && outside !== 0) {
      delta *= Math.max(0, 1 - Math.abs(outside) / this.options.rubberBandRange);
    }
    const next = position + delta;
    return rubberBand ? next : clamp(next, 0, max);
  }

  private outside(value: number, max: number): number {
    if (value < 0) return value;
    if (value > max) return value - max;
    return 0;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
