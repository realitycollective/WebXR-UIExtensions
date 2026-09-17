/**
 * DesktopControls - first-person camera control for mouse + keyboard, the
 * stand-in for a headset's head tracking when running on a desktop.
 *
 * - WASD / arrows walk, Shift sprints, Space jumps, C (or Left Ctrl) crouches
 * - Right-mouse drag looks around (left mouse stays free for clicking UI)
 * - All motion runs through the pure model in `desktop-locomotion.ts`
 *
 * Deliberately NOT pointer-lock: the whole point of the desktop pipeline is
 * clicking spatial UI, and pointer lock would swallow those clicks.
 */
import type { PerspectiveCamera } from 'three';
import {
  DEFAULT_LOCOMOTION,
  createLocomotionState,
  intentForKey,
  stepLocomotion,
  type LocomotionOptions,
  type LocomotionState,
  type MoveInput,
} from './desktop-locomotion.js';

export interface DesktopControlsOptions {
  /** Element that receives the input listeners (usually the canvas). */
  domElement: HTMLElement;
  /** Radians of rotation per pixel of mouse drag. Default 0.0025. */
  lookSensitivity?: number;
  /** Locomotion tuning; see {@link DEFAULT_LOCOMOTION}. */
  locomotion?: Partial<LocomotionOptions>;
  /** Starting ground position [x, z]. */
  start?: [number, number];
  /** Starting heading in radians (0 = facing -Z). */
  startYaw?: number;
}

const MAX_PITCH = Math.PI / 2 - 0.05;

/**
 * True when a key event is being typed into a DOM text field - `<input>`,
 * `<textarea>`, `<select>` or anything contenteditable.
 *
 * Overlays share the page with the scene (the devtools playground puts a
 * source editor over it), and their keystrokes are theirs alone: WASD must
 * not walk the camera mid-word, and Space must reach the field instead of
 * being swallowed as a jump.
 *
 * A structural check rather than `instanceof HTMLElement`, so it stays
 * unit-testable with no DOM.
 */
export function isTextEntryTarget(target: unknown): boolean {
  if (target === null || typeof target !== 'object') {
    return false;
  }
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  if (element.isContentEditable === true) {
    return true;
  }
  const tag =
    typeof element.tagName === 'string' ? element.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export class DesktopControls {
  readonly state: LocomotionState;
  readonly options: LocomotionOptions;
  /** Heading in radians, about +Y. */
  yaw: number;
  /** Look-up/down in radians, clamped to just under ±90°. */
  pitch = 0;

  private readonly camera: PerspectiveCamera;
  private readonly domElement: HTMLElement;
  private readonly lookSensitivity: number;
  private readonly input: MoveInput = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    crouch: false,
    sprint: false,
  };
  private looking = false;
  private lastX = 0;
  private lastY = 0;
  private readonly disposers: Array<() => void> = [];

  constructor(camera: PerspectiveCamera, options: DesktopControlsOptions) {
    this.camera = camera;
    this.domElement = options.domElement;
    this.lookSensitivity = options.lookSensitivity ?? 0.0025;
    this.options = { ...DEFAULT_LOCOMOTION, ...options.locomotion };
    this.state = createLocomotionState(this.options);
    if (options.start) {
      [this.state.x, this.state.z] = options.start;
    }
    this.yaw = options.startYaw ?? 0;

    this.bind();
    this.applyToCamera();
  }

  private bind(): void {
    const onKey = (down: boolean) => (event: KeyboardEvent) => {
      const intent = intentForKey(event.code);
      if (intent === undefined) {
        return;
      }
      // Only keydown is filtered: a keyup always releases, so a key held
      // before focus moved into a field can never stick on.
      if (down && isTextEntryTarget(event.target)) {
        return;
      }
      // Space would otherwise scroll the page.
      if (event.code === 'Space') {
        event.preventDefault();
      }
      this.input[intent] = down;
    };
    const keydown = onKey(true);
    const keyup = onKey(false);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    this.disposers.push(() => window.removeEventListener('keydown', keydown));
    this.disposers.push(() => window.removeEventListener('keyup', keyup));

    // Right-drag to look; left button is reserved for UI interaction.
    const pointerdown = (event: PointerEvent) => {
      if (event.button !== 2) {
        return;
      }
      this.looking = true;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
    };
    const pointermove = (event: PointerEvent) => {
      if (!this.looking) {
        return;
      }
      const dx = event.clientX - this.lastX;
      const dy = event.clientY - this.lastY;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.yaw -= dx * this.lookSensitivity;
      this.pitch = Math.max(
        -MAX_PITCH,
        Math.min(MAX_PITCH, this.pitch - dy * this.lookSensitivity),
      );
    };
    const stopLooking = () => void (this.looking = false);
    const contextmenu = (event: Event) => event.preventDefault();

    this.domElement.addEventListener('pointerdown', pointerdown);
    window.addEventListener('pointermove', pointermove);
    window.addEventListener('pointerup', stopLooking);
    this.domElement.addEventListener('contextmenu', contextmenu);
    this.disposers.push(
      () => this.domElement.removeEventListener('pointerdown', pointerdown),
      () => window.removeEventListener('pointermove', pointermove),
      () => window.removeEventListener('pointerup', stopLooking),
      () => this.domElement.removeEventListener('contextmenu', contextmenu),
    );
  }

  /** Advance movement and write the pose onto the camera. */
  update(delta: number): void {
    stepLocomotion(this.state, this.input, delta, this.options, this.yaw);
    this.applyToCamera();
  }

  private applyToCamera(): void {
    this.camera.position.set(this.state.x, this.state.y, this.state.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  dispose(): void {
    for (const dispose of this.disposers) {
      dispose();
    }
    this.disposers.length = 0;
  }
}
