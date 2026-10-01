/**
 * Panel pointer offers - how a window host takes part in the one pointer
 * decision per source that the Interactions family shares
 * (`PointerArbiter` in `@realitycollective/webxr-input`).
 *
 * Meta IWSDK 1.0.0 runs one `MultiPointer` per hand over EVERY pointer-event
 * object, uikit panels included: per hand its touch, grab and ray pointers
 * each find the nearest thing they reach, panel or not, and the first of
 * touch, grab, ray with a candidate owns the hand. Until 29 September 2026
 * the Reality Collective's window hosts ran their own touch, ray and grab
 * machines over panels alone, so a fingertip on a panel never retired the
 * ray over an object, an object's touch never retired a panel's ray, and no
 * cursor was ever reported on a panel (Pale Signal handover, G4).
 *
 * A window host now OFFERS, per source and per pointer kind, the nearest
 * panel candidate it found, and ACTS (hovers, presses, drags, scrolls) with
 * a pointer kind only while the arbiter says that kind owns the source with
 * this host's candidate (`owns`). The Interactions runtime does the same
 * with its interactables, and publishes the visuals, panel cursor included.
 *
 * Keys: a host names a source by its handedness (`"left"`, `"right"`) when
 * that is all it knows, or by the same id the input provider uses; the
 * Interactions runtime aliases each side to its snapshot id, so both reach
 * the same source. Distances are what IWSDK's pointers compare: the sphere
 * intersector's distance for touch and grab (a fingertip's unsigned distance
 * to the panel), the ray parameter for a ray.
 *
 * A host used on its own (no arbiter passed) gets an arbiter of its own and
 * owns every source it offers for, so it behaves exactly as before.
 *
 * WHO PRESENTS THE POINTERS. IWSDK draws each hand's ray and cursor itself,
 * whichever packages an app uses, so on the web an app with windows and no
 * interactables still shows where it points. A platform that draws only what
 * it is told (a native host) shows nothing unless a binding tells it. The
 * rule: whoever owns the arbiter presents every source. With a shared
 * arbiter that is the Interactions runtime, panel cursor included. With an
 * arbiter of its own (`ownArbiter`) it is the window host, through
 * `present`. Until 1 October 2026 nobody did in that case, and a native app
 * with windows alone drew no ray and no cursor.
 */
import {
  PointerArbiter,
  type ActivePointerKind,
  type NearPointerKind,
  type PointerDecision,
  type PointerDisplay,
  type PointerDrawing,
  type PointerTargetKind,
  type PointerTargetSet,
  type Vec3Tuple,
} from '@realitycollective/webxr-input';

/** The target set every window host registers with the arbiter. */
export const UIX_POINTER_SET = 'uix';

/** Metres from a grip within which a panel is a grab candidate: IWSDK's grab pointer sphere (`createGrabPointer`, 0.07), the same radius the Interactions core uses for interactables. */
export const PANEL_GRAB_RADIUS = 0.07;

/** The nearest panel a host's pointer of one kind reaches this frame. */
export interface PanelPointerCandidate {
  /** The panel's id, as the host names it (a window id, or a bare panel's id). */
  panelId: string;
  /** World-space point: the ray's hit, or the fingertip's or grip's nearest point on the panel. */
  point: Vec3Tuple;
  /** Metres: the ray parameter for a ray, the unsigned distance to the panel for touch and grab. */
  distance: number;
}

/**
 * What a platform is handed to draw for one source: the drawing the app's
 * pointer display settings give (`PointerDisplay.drawing`: whether to draw
 * the ray, its extent, radius and colour, and the cursor disc) and what the
 * cursor sits on. The same record the Interactions binding hands a native
 * host through `applyPointerVisuals`.
 */
export interface PresentedPointer extends PointerDrawing {
  /** The pointer owning the source, or null when none has a candidate. */
  activePointer: ActivePointerKind | null;
  /** What the cursor sits on: here always a panel, or null without a candidate. */
  targetKind: PointerTargetKind | null;
  /** The panel id the cursor sits on, or null. */
  targetId: string | null;
  /** The hit's distance (the ray parameter, or the surface distance), or null. */
  hitDistance: number | null;
}

export class PanelPointerOffers {
  /** The arbiter decisions are made in: the app's, or this host's own. */
  readonly arbiter: PointerArbiter;
  /** True when this host made the arbiter itself (it then draws its own panel cursors). */
  readonly ownArbiter: boolean;
  private readonly set: PointerTargetSet;
  private disposed = false;

  constructor(arbiter?: PointerArbiter) {
    this.ownArbiter = arbiter === undefined;
    this.arbiter = arbiter ?? new PointerArbiter();
    this.set = this.arbiter.registerSet(UIX_POINTER_SET, 'panel');
  }

  /** This frame's nearest panel for `kind` on the source, or `undefined` for none. Replaces the last offer. */
  offer(sourceKey: string, kind: NearPointerKind, candidate: PanelPointerCandidate | undefined): void {
    if (this.disposed) return;
    this.set.offer(
      sourceKey,
      kind,
      candidate
        ? { targetId: candidate.panelId, point: [candidate.point[0], candidate.point[1], candidate.point[2]], distance: candidate.distance }
        : null,
    );
  }

  /** This host's `kind` pointer is pressing or dragging on the source (the selection lock). */
  setSelecting(sourceKey: string, kind: NearPointerKind, selecting: boolean): void {
    if (this.disposed) return;
    this.set.setSelecting(sourceKey, kind, selecting);
  }

  /** Decide for the source from every set's latest offers. Call after offering, before acting. */
  resolve(sourceKey: string): PointerDecision {
    return this.arbiter.resolve(sourceKey);
  }

  /**
   * What to draw for one source, after `resolve`: the arbiter's visuals for
   * its last decision, through the app's pointer display settings. `hasRay`
   * is whether the source carries a ray this frame; `selecting` whether its
   * active pointer is pressing (the ray and cursor take their selected look).
   * A binding hands the result to its platform only while `ownArbiter` is
   * true; with a shared arbiter the Interactions runtime presents. Call it
   * once more with `hasRay` and `selecting` false after a source disappears,
   * so the platform stops drawing it.
   */
  present(sourceKey: string, hasRay: boolean, selecting: boolean, display: PointerDisplay): PresentedPointer {
    const visuals = this.arbiter.visuals(sourceKey, hasRay);
    const drawing = display.drawing(visuals, selecting);
    return {
      ...drawing,
      rayColor: [drawing.rayColor[0], drawing.rayColor[1], drawing.rayColor[2]],
      activePointer: visuals.activePointer,
      targetKind: visuals.targetKind,
      targetId: visuals.targetId,
      hitDistance: visuals.hitDistance,
    };
  }

  /** Whether this host's `kind` pointer owns the source as of the last decision. */
  owns(sourceKey: string, kind: NearPointerKind): boolean {
    return !this.disposed && this.set.owns(sourceKey, kind);
  }

  /** The source stopped being tracked by this host. */
  forget(sourceKey: string): void {
    if (this.disposed) return;
    this.set.forget(sourceKey);
    if (this.ownArbiter) this.arbiter.forget(sourceKey);
  }

  /** Leave the arbiter. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.set.dispose();
  }
}
