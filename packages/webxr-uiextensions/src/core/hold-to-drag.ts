/**
 * Hold-to-drag threshold - pure timing state for title-bar dragging.
 *
 * A press only becomes a drag after being held for `delaySeconds`. Anything
 * shorter is a click (pin/minimize/close and friends), so buttons on the
 * drag surface never fight the drag gesture.
 */
export type HoldPhase = 'idle' | 'pending' | 'dragging';

export interface HoldUpdate {
  phase: HoldPhase;
  /** True on the exact update where the hold crossed into dragging. */
  began: boolean;
  /** True on the exact update where an active drag was released. */
  ended: boolean;
}

export class HoldToDrag {
  private heldFor = 0;
  private phase: HoldPhase = 'idle';

  constructor(readonly delaySeconds = 0.3) {
    if (delaySeconds < 0) {
      throw new Error(`[uix] drag delay must be >= 0 (got ${delaySeconds})`);
    }
  }

  get current(): HoldPhase {
    return this.phase;
  }

  /** Advance with this frame's held state and delta time (seconds). */
  update(held: boolean, delta: number): HoldUpdate {
    if (!held) {
      const ended = this.phase === 'dragging';
      this.phase = 'idle';
      this.heldFor = 0;
      return { phase: 'idle', began: false, ended };
    }
    if (this.phase === 'dragging') {
      return { phase: 'dragging', began: false, ended: false };
    }
    this.heldFor += delta;
    if (this.heldFor >= this.delaySeconds) {
      this.phase = 'dragging';
      return { phase: 'dragging', began: true, ended: false };
    }
    this.phase = 'pending';
    return { phase: 'pending', began: false, ended: false };
  }
}
