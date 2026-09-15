/**
 * Touch press - the press / hold / release state machine for a near (poke)
 * pointer against a panel, pure logic with no engine imports.
 *
 * Why it exists. Engines measure a fingertip's distance to a panel without
 * a sign, so 2 cm behind a panel reads like 2 cm in front. A finger pushed
 * through a panel and pulled back out therefore fires press, release, press,
 * release: two clicks for one gesture. Worse, a finger arriving from behind
 * presses too. This machine works on SIGNED distance (positive in front) and
 * holds three guarantees:
 *
 * 1. A press starts only from the front. A fingertip that is first seen
 *    behind the panel, or that crosses the press band from behind, never
 *    presses.
 * 2. Once pressed, the touch is HELD until a release: however deep the
 *    finger goes and whichever way it comes back, no second press can start
 *    until `released` has been reported.
 * 3. Release happens when the fingertip comes back out in FRONT past the
 *    release distance (hysteresis, so a finger resting on the surface does
 *    not chatter), or when contact is lost entirely (hover gone, tracking
 *    dropped).
 *
 * Targets. The machine records what was under the finger at the press and
 * reports what is under it at the release, because they can differ: a finger
 * that enters one button and leaves through its neighbour. Whether that
 * counts as a click of either is the adapter's (or the engine's) rule; the
 * machine only makes both ends visible so that rule can be applied.
 */

export interface TouchPressOptions {
  /** Signed distance (meters, positive in front) at or under which a press starts. */
  pressDistance: number;
  /** Signed distance in front the finger must return past for a release. Never less than `pressDistance`. */
  releaseDistance: number;
  /** Let a fingertip arriving from behind the panel press. Off by default. */
  allowFromBehind: boolean;
}

export const DEFAULT_TOUCH_PRESS: Readonly<TouchPressOptions> = Object.freeze({
  pressDistance: 0.02,
  releaseDistance: 0.03,
  allowFromBehind: false,
});

export function resolveTouchPress(options: Partial<TouchPressOptions> = {}): TouchPressOptions {
  const resolved = { ...DEFAULT_TOUCH_PRESS, ...options };
  if (resolved.pressDistance < 0) {
    throw new Error(`[uix] touch press distance must be >= 0 (got ${resolved.pressDistance})`);
  }
  if (resolved.releaseDistance < resolved.pressDistance) {
    throw new Error(
      `[uix] touch release distance (${resolved.releaseDistance}) must be >= press distance (${resolved.pressDistance})`,
    );
  }
  return resolved;
}

/** What the adapter measured this frame. `undefined` means no contact at all. */
export interface TouchSample<T = unknown> {
  /** Signed distance from the fingertip to the panel plane, positive in front (meters). */
  signedDistance: number;
  /** What the fingertip is over: the element under the projected point. */
  target: T;
}

export type TouchPhase = 'idle' | 'near' | 'pressed';

/** The transitions the adapter acts on this frame. */
export interface TouchUpdate<T = unknown> {
  phase: TouchPhase;
  /** True on the exact update where a press started; `pressTarget` is set. */
  pressed: boolean;
  /** True on the exact update where the hold ended. */
  released: boolean;
  /** The target under the finger when the press started; kept through the hold. */
  pressTarget: T | undefined;
  /** The target under the finger at the release, which may differ from `pressTarget`. */
  releaseTarget: T | undefined;
  /** On a release, whether it happened over the same target the press did. */
  sameTarget: boolean;
}

export class TouchPress<T = unknown> {
  readonly options: TouchPressOptions;
  private phase: TouchPhase = 'idle';
  /** Whether the last sample was in front of the press band. */
  private wasInFront = false;
  private pressTarget: T | undefined;

  constructor(options: Partial<TouchPressOptions> = {}) {
    this.options = resolveTouchPress(options);
  }

  get current(): TouchPhase {
    return this.phase;
  }

  get held(): boolean {
    return this.phase === 'pressed';
  }

  /** The target the current hold started on, if any. */
  get target(): T | undefined {
    return this.pressTarget;
  }

  /** Advance with this frame's measurement (or `undefined` for no contact). */
  update(sample: TouchSample<T> | undefined): TouchUpdate<T> {
    const { pressDistance, releaseDistance, allowFromBehind } = this.options;

    if (sample === undefined) {
      // Contact lost: a hold ends here, whichever side the finger went.
      const released = this.phase === 'pressed';
      const pressTarget = this.pressTarget;
      this.phase = 'idle';
      this.wasInFront = false;
      this.pressTarget = undefined;
      return {
        phase: 'idle',
        pressed: false,
        released,
        pressTarget: released ? pressTarget : undefined,
        releaseTarget: undefined,
        sameTarget: false,
      };
    }

    const { signedDistance, target } = sample;
    const inFront = signedDistance > pressDistance;

    if (this.phase === 'pressed') {
      // Held until the finger comes back out in front past the release
      // distance. Going deeper, or returning within the band, changes nothing.
      if (signedDistance > releaseDistance) {
        const pressTarget = this.pressTarget;
        this.phase = 'near';
        this.wasInFront = true;
        this.pressTarget = undefined;
        return {
          phase: 'near',
          pressed: false,
          released: true,
          pressTarget,
          releaseTarget: target,
          sameTarget: pressTarget === target,
        };
      }
      return this.hold();
    }

    if (inFront) {
      this.phase = 'near';
      this.wasInFront = true;
      return this.quiet('near');
    }

    // Within the press band or behind. Press only from the front: the last
    // sample was in front, or this is the first sample and it is not behind.
    const fromFront =
      this.wasInFront || (this.phase === 'idle' && signedDistance >= 0);
    if (fromFront || allowFromBehind) {
      this.phase = 'pressed';
      this.wasInFront = false;
      this.pressTarget = target;
      return {
        phase: 'pressed',
        pressed: true,
        released: false,
        pressTarget: target,
        releaseTarget: undefined,
        sameTarget: false,
      };
    }
    // Arrived from behind: stay near, and stay unarmed until the finger has
    // been seen in front.
    this.phase = 'near';
    this.wasInFront = false;
    return this.quiet('near');
  }

  /** Drop any hold without reporting it (the pointer went away for good). */
  reset(): void {
    this.phase = 'idle';
    this.wasInFront = false;
    this.pressTarget = undefined;
  }

  private hold(): TouchUpdate<T> {
    return {
      phase: 'pressed',
      pressed: false,
      released: false,
      pressTarget: this.pressTarget,
      releaseTarget: undefined,
      sameTarget: false,
    };
  }

  private quiet(phase: TouchPhase): TouchUpdate<T> {
    return {
      phase,
      pressed: false,
      released: false,
      pressTarget: undefined,
      releaseTarget: undefined,
      sameTarget: false,
    };
  }
}
