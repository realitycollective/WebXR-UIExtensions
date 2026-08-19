/**
 * Dock state machine - pure logic, no engine imports.
 *
 * A window is always in exactly one dock mode:
 *
 * - `world-locked` - placed in space; the window keeps its world transform.
 * - `body-follow`  - lazily follows the player (IWSDK `Follower` on the head),
 *                    with a deadzone so it doesn't jitter.
 * - `head-locked`  - rigidly attached to the view (IWSDK `ScreenSpace` outside
 *                    XR / a zero-tolerance follow inside XR). Use sparingly.
 *
 * The state machine itself only decides WHICH engine ingredients a mode needs;
 * `DockSystem` applies them (adding/removing `Follower` / `ScreenSpace`).
 * Keeping the decision pure makes every transition unit-testable without a
 * headset or a renderer.
 */

export const DockMode = {
  WorldLocked: 'world-locked',
  BodyFollow: 'body-follow',
  HeadLocked: 'head-locked',
} as const;

export type DockModeValue = (typeof DockMode)[keyof typeof DockMode];

/** Engine-agnostic description of what a dock mode requires. */
export interface DockRecipe {
  /** Requires an IWSDK `Follower` targeting the player's head. */
  follower: boolean;
  /** Requires an IWSDK `ScreenSpace` component (non-XR HUD lock). */
  screenSpace: boolean;
  /**
   * When true the window should re-sync its follow position immediately on
   * entering the mode (jump to the ideal spot instead of drifting there).
   */
  snapOnEnter: boolean;
}

const RECIPES: Record<DockModeValue, DockRecipe> = {
  [DockMode.WorldLocked]: { follower: false, screenSpace: false, snapOnEnter: false },
  [DockMode.BodyFollow]: { follower: true, screenSpace: false, snapOnEnter: true },
  [DockMode.HeadLocked]: { follower: true, screenSpace: true, snapOnEnter: true },
};

export function isDockMode(value: unknown): value is DockModeValue {
  return (
    value === DockMode.WorldLocked ||
    value === DockMode.BodyFollow ||
    value === DockMode.HeadLocked
  );
}

export function recipeFor(mode: DockModeValue): DockRecipe {
  return RECIPES[mode];
}

/** A transition plan: what to add and what to remove, in engine terms. */
export interface DockTransition {
  from: DockModeValue;
  to: DockModeValue;
  addFollower: boolean;
  removeFollower: boolean;
  addScreenSpace: boolean;
  removeScreenSpace: boolean;
  snap: boolean;
}

/**
 * Compute the minimal set of engine changes to move between dock modes.
 * Returns `undefined` for a no-op (same mode).
 */
export function planTransition(
  from: DockModeValue,
  to: DockModeValue,
): DockTransition | undefined {
  if (from === to) {
    return undefined;
  }
  const a = recipeFor(from);
  const b = recipeFor(to);
  return {
    from,
    to,
    addFollower: !a.follower && b.follower,
    removeFollower: a.follower && !b.follower,
    addScreenSpace: !a.screenSpace && b.screenSpace,
    removeScreenSpace: a.screenSpace && !b.screenSpace,
    snap: b.snapOnEnter,
  };
}

/**
 * The "pin" affordance on a window's title bar toggles between following the
 * player and being placed in space. Head-locked windows unpin to world-locked
 * too - pinning something rigidly to the user's face is never the toggle
 * target you want.
 */
export function togglePinned(mode: DockModeValue): DockModeValue {
  return mode === DockMode.WorldLocked ? DockMode.BodyFollow : DockMode.WorldLocked;
}
