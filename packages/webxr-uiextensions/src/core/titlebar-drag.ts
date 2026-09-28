/**
 * TitlebarDragController - the title-bar hold-to-drag orchestration a binding
 * runs per window, engine-free: `UIDragSystem` on IWSDK, and formerly private
 * methods on `NativeWindowHost` (`beginTitlebarPress` / `stepDrags` /
 * `whileDragging` / `onDragStart` / `onDragEnd`) duplicated with no rule
 * behind them. Moved here so every platform runs the exact same recipe:
 *
 *  - A ray press is a drag candidate only after `holdDelaySeconds` held
 *    ({@link HoldToDrag}); a grab (near drag) starts at once.
 *  - While dragging, the window rides the ray at its grab distance
 *    (`drag-math.ts`), or a point pointer (touch/grab) by the point's delta.
 *  - Starting a drag focuses the window, marks it dragging (so the PIN label
 *    reads PIN throughout), takes it out of any region, and off any follow
 *    mode (world-locked for the duration).
 *  - While dragging (and once more settling at the drop), the window
 *    optionally billboards to face the viewer (`billboardWhileDragging`).
 *  - Dropping captures the window into a region under it, if any
 *    (`RegionRegistry.capture`).
 *
 * A binding owns everything this controller does not: resolving which
 * pointer currently holds the title bar and its latest ray/point sample
 * (`processPointers` on native, the XR Blocks select/grab edges on XR
 * Blocks), and the head pose for billboarding.
 */
import type { PoseTuple, RayTuple, Vec3Tuple } from '@realitycollective/webxr-input';
import { DEFAULT_DRAG_DELAY } from './placement.js';
import { DockMode, type DockModeValue } from './dock-state.js';
import { beginDrag, dragPosition, faceViewerYaw, type DragSession } from './drag-math.js';
import { yawOf, yawQuaternion } from './follow.js';
import { HoldToDrag } from './hold-to-drag.js';
import type { RegionRegistry } from './region-registry.js';
import type { Vec3 } from './region-layout.js';
import type { WindowManager } from './window-manager.js';

/** The pointer kind a title-bar press started from. */
export type TitlebarPressKind = 'ray' | 'touch' | 'grab';

/** What began the press: its kind, and where it landed. */
export interface TitlebarPressStart {
  kind: TitlebarPressKind;
  /** World-space point at press time (`null` for a ray that reported none). */
  point: Vec3Tuple | null;
  /** World-space ray at press time. A ray press with both `ray` and `point` rides the ray at its grab distance; every other press (touch, grab, or a ray with no point) rides the point's delta instead. */
  ray?: RayTuple;
}

/** This frame's sample for the pointer that owns the current press. */
export interface TitlebarDragSample {
  ray?: RayTuple;
  point?: Vec3Tuple;
}

/** How one window's title-bar drag behaves. The IWSDK reference reads the same values from its UIWindow component. */
export interface TitlebarDragOptions {
  /** The window's manager - the same instance the binding applies everywhere else. */
  manager: WindowManager;
  /** Drop-capture regions. Omit on a platform with no regions feature; drops then never dock. */
  registry?: RegionRegistry;
  /** The id of the window this controller drags. */
  windowId: string;
  /** Seconds a ray or touch press is held before it becomes a drag. Default {@link DEFAULT_DRAG_DELAY}: `WindowOptionsBase.dragDelay`. A grab ignores this and starts at once. */
  holdDelaySeconds?: number;
  /** Keep the window yawed toward the viewer while dragging, and once more settling at the drop. Default `true`: `WindowOptionsBase`'s billboard switch. */
  billboard?: boolean;
}

interface ActivePress {
  readonly kind: TitlebarPressKind;
  readonly startPoint: Vec3Tuple | null;
  readonly startPosition: Vec3Tuple;
  readonly session: DragSession | undefined;
}

/**
 * One window's title-bar drag, as IWSDK's UIDragSystem runs it: a ray or touch press held for the drag delay becomes a drag, a grab drags at once, a ray rides at its grab distance, the window billboards while dragged, and a drop within a region's snap radius docks it. Every binding feeds it pointer samples; none re-derives drag timing or placement itself.
 */
export class TitlebarDragController {
  private readonly hold: HoldToDrag;
  private readonly manager: WindowManager;
  private readonly registry: RegionRegistry | undefined;
  private readonly windowId: string;
  private readonly billboard: boolean;
  private press: ActivePress | undefined;
  private draggingFlag = false;

  constructor(options: TitlebarDragOptions) {
    this.manager = options.manager;
    this.registry = options.registry;
    this.windowId = options.windowId;
    this.billboard = options.billboard ?? true;
    this.hold = new HoldToDrag(options.holdDelaySeconds ?? DEFAULT_DRAG_DELAY);
  }

  /** Whether this window is mid-drag right now. */
  get dragging(): boolean {
    return this.draggingFlag;
  }

  /**
   * Begin a press candidate on the title bar, at `currentPosition` (the
   * window's pose position at press time). Ignored while another pointer
   * already holds the bar - the same "first press wins" rule native applies.
   */
  beginPress(start: TitlebarPressStart, currentPosition: Vec3Tuple): void {
    if (this.press !== undefined) return;
    this.press = {
      kind: start.kind,
      startPoint: start.point,
      startPosition: currentPosition,
      session:
        start.kind === 'ray' && start.ray && start.point
          ? beginDrag(start.ray.origin as Vec3, start.point as Vec3, currentPosition as Vec3)
          : undefined,
    };
  }

  /**
   * Advance one frame. `held` is whether the pointer owning the current press
   * is still down this frame; `sample` its latest ray/point while held
   * (ignored otherwise). Returns the window's pose after this step - `pose`
   * unchanged unless a drag is running or just ended with a billboard
   * settle. `headPosition` is needed only for billboarding; `regionOrigins`
   * only at the drop, to decide capture.
   */
  step(
    dt: number,
    held: boolean,
    sample: TitlebarDragSample | undefined,
    pose: PoseTuple,
    headPosition?: Vec3Tuple,
    regionOrigins?: ReadonlyMap<string, Vec3>,
  ): PoseTuple {
    const press = this.press;
    // A near grab is deliberate: no click window to wait out.
    const delay = press?.kind === 'grab' ? 0 : undefined;
    const { phase, began, ended } = this.hold.update(held, dt, delay);
    let next = pose;
    if (began) this.onDragStart();
    if (phase === 'dragging' && press && sample) {
      next = this.whileDragging(press, sample, next, headPosition);
    }
    if (ended) next = this.onDragEnd(next, headPosition, regionOrigins);
    if (!held) this.press = undefined;
    return next;
  }

  private onDragStart(): void {
    const { manager, windowId: id } = this;
    this.draggingFlag = true;
    manager.focus(id);
    // Dragging BEFORE the dock change, so the pin label reads PIN throughout.
    manager.setDragging(id, true);
    // Grabbing takes the window out of any region and out of follow mode.
    manager.undock(id);
    if (manager.get(id)?.dockMode !== DockMode.WorldLocked) {
      manager.setDockMode(id, DockMode.WorldLocked as DockModeValue);
    }
  }

  private whileDragging(press: ActivePress, sample: TitlebarDragSample, pose: PoseTuple, headPosition?: Vec3Tuple): PoseTuple {
    let position: Vec3Tuple | undefined;
    if (press.session && sample.ray) {
      position = [...dragPosition(press.session, sample.ray.origin as Vec3, sample.ray.direction as Vec3)] as Vec3Tuple;
    } else if (press.startPoint && sample.point) {
      position = [
        press.startPosition[0] + sample.point[0] - press.startPoint[0],
        press.startPosition[1] + sample.point[1] - press.startPoint[1],
        press.startPosition[2] + sample.point[2] - press.startPoint[2],
      ];
    }
    let next = position ? { position, quaternion: pose.quaternion } : pose;
    if (this.billboard && headPosition) next = this.faceViewer(next, headPosition);
    return next;
  }

  private onDragEnd(pose: PoseTuple, headPosition?: Vec3Tuple, regionOrigins?: ReadonlyMap<string, Vec3>): PoseTuple {
    const { manager, registry, windowId: id } = this;
    this.draggingFlag = false;
    manager.setDragging(id, false);
    // Settle facing the viewer at the drop spot.
    let next = this.billboard && headPosition ? this.faceViewer(pose, headPosition) : pose;
    if (registry && regionOrigins) {
      const captured = registry.capture(next.position as Vec3, regionOrigins);
      if (captured !== undefined) manager.dockTo(id, captured);
    }
    return next;
  }

  private faceViewer(pose: PoseTuple, headPosition: Vec3Tuple): PoseTuple {
    const yaw = faceViewerYaw(pose.position as Vec3, headPosition as Vec3, yawOf(pose.quaternion));
    return { position: [...pose.position] as Vec3Tuple, quaternion: yawQuaternion(yaw) };
  }
}
