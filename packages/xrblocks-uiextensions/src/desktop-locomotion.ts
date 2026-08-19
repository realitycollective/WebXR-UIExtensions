/**
 * Desktop locomotion — WASD walking, jump and crouch for a first-person
 * camera, so a mouse-and-keyboard user can move around a scene that would
 * otherwise rely on a headset's room-scale tracking.
 *
 * The MOTION MODEL here is pure and frame-rate independent (no three.js, no
 * DOM), so it is fully unit-testable; `DesktopLocomotion` in
 * `desktop-controls.ts` is the thin adapter that feeds it key state and
 * writes the result onto a camera.
 */

/** Which movement intents are active this frame. */
export interface MoveInput {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  crouch: boolean;
  /** Shift — move faster. */
  sprint: boolean;
}

export const NO_INPUT: MoveInput = {
  forward: false,
  back: false,
  left: false,
  right: false,
  jump: false,
  crouch: false,
  sprint: false,
};

export interface LocomotionOptions {
  /** Walking speed, m/s. */
  speed: number;
  /** Multiplier applied while sprinting. */
  sprintMultiplier: number;
  /** Eye height when standing, meters. */
  standHeight: number;
  /** Eye height when crouching, meters. */
  crouchHeight: number;
  /** How fast the eye height eases between stand and crouch (1/s). */
  crouchSpeed: number;
  /** Upward velocity imparted by a jump, m/s. */
  jumpVelocity: number;
  /** Gravity, m/s² (positive magnitude). */
  gravity: number;
}

export const DEFAULT_LOCOMOTION: LocomotionOptions = {
  speed: 2.2,
  sprintMultiplier: 2,
  standHeight: 1.6,
  crouchHeight: 0.9,
  crouchSpeed: 8,
  jumpVelocity: 3.6,
  gravity: 9.81,
};

/** Mutable locomotion state. `x`/`z` are ground position; `y` is eye height. */
export interface LocomotionState {
  x: number;
  z: number;
  /** Current eye height (includes any jump arc). */
  y: number;
  /** Vertical velocity, m/s. Zero while grounded. */
  verticalVelocity: number;
  /** True when standing on the ground (jump allowed). */
  grounded: boolean;
}

export function createLocomotionState(
  options: LocomotionOptions = DEFAULT_LOCOMOTION,
): LocomotionState {
  return {
    x: 0,
    z: 0,
    y: options.standHeight,
    verticalVelocity: 0,
    grounded: true,
  };
}

/**
 * Ground-plane movement direction in WORLD space for a given yaw.
 *
 * Yaw is the camera's heading (0 = looking down -Z, matching three.js).
 * Returns a normalised [x, z] so diagonal movement isn't faster, or
 * [0, 0] when no direction is held.
 */
export function moveDirection(input: MoveInput, yaw: number): [number, number] {
  // Local axes: forward is -Z, right is +X.
  const localZ = (input.back ? 1 : 0) - (input.forward ? 1 : 0);
  const localX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (localX === 0 && localZ === 0) {
    return [0, 0];
  }
  const length = Math.hypot(localX, localZ);
  const nx = localX / length;
  const nz = localZ / length;
  // Rotate the local direction by the camera yaw about +Y.
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return [nx * cos + nz * sin, -nx * sin + nz * cos];
}

/** The eye height being eased toward, ignoring any jump arc. */
export function targetStanceHeight(
  input: MoveInput,
  options: LocomotionOptions,
): number {
  return input.crouch ? options.crouchHeight : options.standHeight;
}

/**
 * Advance the locomotion state by `delta` seconds.
 *
 * Horizontal movement is direct (no inertia — precise for UI testing);
 * vertical motion is a simple ballistic arc over the stance height, so
 * jumping while crouched jumps from the lower stance as expected.
 * Mutates and returns `state`.
 */
export function stepLocomotion(
  state: LocomotionState,
  input: MoveInput,
  delta: number,
  options: LocomotionOptions = DEFAULT_LOCOMOTION,
  yaw = 0,
): LocomotionState {
  if (!(delta > 0)) {
    return state;
  }

  const [dx, dz] = moveDirection(input, yaw);
  const speed = options.speed * (input.sprint ? options.sprintMultiplier : 1);
  state.x += dx * speed * delta;
  state.z += dz * speed * delta;

  const stance = targetStanceHeight(input, options);

  if (state.grounded) {
    if (input.jump) {
      state.verticalVelocity = options.jumpVelocity;
      state.grounded = false;
    } else {
      // Ease the eye height toward the stance (crouch/stand transition).
      const alpha = Math.min(1, options.crouchSpeed * delta);
      state.y += (stance - state.y) * alpha;
      state.verticalVelocity = 0;
    }
  }

  if (!state.grounded) {
    state.verticalVelocity -= options.gravity * delta;
    state.y += state.verticalVelocity * delta;
    if (state.y <= stance) {
      state.y = stance;
      state.verticalVelocity = 0;
      state.grounded = true;
    }
  }

  return state;
}

/** Map a `KeyboardEvent.code` to the movement intent it drives. */
export function intentForKey(code: string): keyof MoveInput | undefined {
  switch (code) {
    case 'KeyW':
    case 'ArrowUp':
      return 'forward';
    case 'KeyS':
    case 'ArrowDown':
      return 'back';
    case 'KeyA':
    case 'ArrowLeft':
      return 'left';
    case 'KeyD':
    case 'ArrowRight':
      return 'right';
    case 'Space':
      return 'jump';
    case 'KeyC':
    case 'ControlLeft':
      return 'crouch';
    case 'ShiftLeft':
    case 'ShiftRight':
      return 'sprint';
    default:
      return undefined;
  }
}
