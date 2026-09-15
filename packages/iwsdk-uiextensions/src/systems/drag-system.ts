/**
 * UIDragSystem - drag windows by the title bar, far or near.
 *
 * Reuses `@pmndrs/handle` (the exact library behind the IWSDK's grab
 * systems): a `HandleStore` targets the window entity's object while being
 * *bound* to the title-bar uikit element, so grabbing the title bar moves
 * the whole window with the same feel as native IWSDK grabbing. The system
 * pumps its own stores, so it works even when the app doesn't enable
 * `features.grabbing`.
 *
 * Which pointers can reach the title bar is IWSDK's decision, and by
 * default only the far `ray` pointer can (the window carries
 * `RayInteractable`). Near grabbing needs two more things, both done here
 * when `nearDrag` is on:
 *
 * - the title bar must be a candidate for the near `grab` pointer. IWSDK
 *   rebuilds `scene.grabDescendants` every frame from `OneHandGrabbable`
 *   entities, so this system, which runs after `InputSystem`, appends each
 *   movable window's title bar to that list. (Putting `OneHandGrabbable` on
 *   the window would instead have IWSDK grab the whole panel and deny the
 *   ray on it.)
 * - the `grab` sub-pointer must be enabled, and a hand pinch must drive it.
 *   IWSDK's `GrabSystem` does both, but only when the app enables
 *   `features.grabbing`. This system enables the sub-pointer itself, and
 *   forwards a pinch to it while the hand is on a title bar, so windows do
 *   not require a physics-adjacent feature and pinching elsewhere still
 *   means what the app decided.
 *
 * A near grab is a deliberate gesture, so it starts dragging at once; a ray
 * press still waits out `dragDelay` so title-bar clicks stay clicks.
 *
 * Dragging implies placing: on grab the window leaves any dock region and
 * switches to `world-locked`; on release near a region it docks there.
 */
import { HandleStore } from '@pmndrs/handle';
import {
  GrabSystem,
  PanelDocument,
  Types,
  UIKitDocument,
  type Entity,
} from '@iwsdk/core';
import { createSystem } from '../create-system.js';
import { Vector3, type Object3D } from 'three';
import { UIDockRegion, UIDockedTo, UIWindow, UIWindowState } from '../components.js';
import { WINDOW_CHROME_IDS } from '@realitycollective/webxr-uiextensions';
import { DockMode } from '@realitycollective/webxr-uiextensions';
import { faceViewerYaw } from '@realitycollective/webxr-uiextensions';
import { HoldToDrag } from '@realitycollective/webxr-uiextensions';
import type { Vec3 } from '@realitycollective/webxr-uiextensions';
import { regionRegistryFor } from '../region-registry-store.js';
import { windowManagerFor } from '../manager-registry.js';

interface DragState {
  store: HandleStore<unknown>;
  hold: HoldToDrag;
  titlebar: Object3D;
  /** Which pointer kind made the press the store is holding. */
  pressKind: PointerKind | undefined;
}

type PointerKind = 'ray' | 'grab' | 'touch';
type Handedness = 'left' | 'right';

/** The IWSDK scene lists pointers intersect, rebuilt by `InputSystem` each frame. */
type SceneWithDescendants = {
  grabDescendants?: Object3D[];
  interactableDescendants?: Object3D[];
};

const HANDS: readonly Handedness[] = ['left', 'right'];

export class UIDragSystem extends createSystem(
  {
    windows: { required: [UIWindow, UIWindowState, PanelDocument] },
    regions: { required: [UIDockRegion] },
  },
  {
    /**
     * Let the near `grab` pointer (controller squeeze, hand pinch) pick a
     * window up by its title bar. Off leaves the ray-only behaviour.
     */
    nearDrag: { type: Types.Boolean, default: true },
  },
) {
  private states = new Map<Entity, DragState>();
  private worldPosition = new Vector3();
  private viewerPosition = new Vector3();
  /** Per hand: a pinch this system routed to the grab pointer, awaiting its release. */
  private pinchRouted: Record<Handedness, boolean> = { left: false, right: false };

  override init(): void {
    this.cleanupFuncs.push(
      this.queries.windows.subscribe('qualify', (entity) => {
        this.attach(entity);
      }),
      this.queries.windows.subscribe('disqualify', (entity) => {
        this.detach(entity);
      }),
    );
    this.queries.windows.entities.forEach((entity) => this.attach(entity));

    if (this.nearDragEnabled) {
      // Idempotent with GrabSystem doing the same when the app enables
      // `features.grabbing`.
      const xr = this.xrInput;
      if (xr) {
        for (const hand of HANDS) {
          xr.multiPointers[hand].toggleSubPointer('grab', true);
        }
      }
    }
  }

  override update(delta: number, time: number): void {
    if (this.nearDragEnabled) {
      this.offerTitlebarsToGrabPointer();
      this.forwardPinchToGrab(time);
    }

    for (const [entity, state] of this.states) {
      const held = state.store.inputState.size > 0;
      // A near grab is deliberate: no click window to wait out.
      const delay = state.pressKind === 'grab' ? 0 : state.hold.delaySeconds;
      const { phase, began, ended } = state.hold.update(held, delta, delay);

      if (began) {
        this.onDragStart(entity);
      }
      if (phase === 'dragging') {
        // The store only runs while an actual drag is in progress: presses
        // shorter than the hold delay never move the window (they're
        // clicks), and skipping the release-frame update stops the handle
        // from restoring its grab-time rotation over our billboard yaw.
        state.store.update(delta);
        this.whileDragging(entity);
      }
      if (ended) {
        this.onDragEnd(entity);
      }
      if (!held) {
        state.pressKind = undefined;
      }
    }
  }

  private get nearDragEnabled(): boolean {
    return this.config.nearDrag.value;
  }

  /** `world.input.xr`, which a headless world (tests) does not have. */
  private get xrInput() {
    return (this.input as typeof this.input | undefined)?.xr;
  }

  /**
   * `InputSystem` (priority -4) has just rebuilt the per-kind pointer lists
   * for this frame; add every movable title bar to the grab list so the
   * near pointer can find it. Nothing else is touched, so the ray and touch
   * lists (and the app's own grabbables) behave exactly as before.
   */
  private offerTitlebarsToGrabPointer(): void {
    const scene = this.scene as unknown as SceneWithDescendants | undefined;
    if (!scene?.grabDescendants) {
      return; // no pointer lists this frame (outside XR with canvas input off)
    }
    for (const [entity, state] of this.states) {
      if (entity.object3D?.visible === false) {
        continue; // hidden windows are not hittable
      }
      if (!scene.grabDescendants.includes(state.titlebar)) {
        scene.grabDescendants.push(state.titlebar);
      }
      if (scene.interactableDescendants && !scene.interactableDescendants.includes(state.titlebar)) {
        scene.interactableDescendants.push(state.titlebar);
      }
    }
  }

  /**
   * On a tracked hand the grab pointer has no squeeze button, so IWSDK's
   * `GrabSystem` forwards the pinch (select) to it - but only when the app
   * turned that on. Do it here for pinches that land on a title bar, and
   * route the matching release wherever the hand is by then.
   */
  private forwardPinchToGrab(time: number): void {
    const xr = this.xrInput;
    if (!xr) {
      return;
    }
    if (this.grabSystemForwardsPinch()) {
      return;
    }
    const timeStamp = time * 1000;
    for (const hand of HANDS) {
      const gamepad = xr.gamepads[hand];
      if (!gamepad || !xr.isPrimary('hand', hand)) {
        continue;
      }
      const pointer = xr.multiPointers[hand];
      if (gamepad.getSelectStart() && this.isTitlebar(pointer.getPointer('grab').getIntersection()?.object)) {
        pointer.routeDown('squeeze', 'grab', { timeStamp });
        this.pinchRouted[hand] = true;
      }
      if (gamepad.getSelectEnd() && this.pinchRouted[hand]) {
        pointer.routeUp('squeeze', 'grab', { timeStamp });
        this.pinchRouted[hand] = false;
      }
    }
  }

  private grabSystemForwardsPinch(): boolean {
    const grab = this.world.getSystem(GrabSystem) as
      | { config?: { useHandPinchForGrab?: { value: boolean } } }
      | undefined;
    return grab?.config?.useHandPinchForGrab?.value === true;
  }

  /** Whether `object` is one of our title bars or sits inside one. */
  private isTitlebar(object: Object3D | undefined): boolean {
    for (let current = object; current; current = current.parent ?? undefined) {
      for (const state of this.states.values()) {
        if (state.titlebar === current) {
          return true;
        }
      }
    }
    return false;
  }

  private attach(entity: Entity): void {
    if (this.states.has(entity) || !entity.getValue(UIWindow, 'movable')) {
      return;
    }
    const document = PanelDocument.data.document[entity.index] as
      | UIKitDocument
      | undefined;
    const titlebar = document?.getElementById(WINDOW_CHROME_IDS.titlebar);
    const object = entity.object3D;
    if (!titlebar || !object) {
      return;
    }
    const store = new HandleStore(object, () => ({
      translate: true as const,
      rotate: false as const,
      scale: false as const,
      multitouch: false,
      projectRays: false,
    }));
    // The title-bar uikit element is an Object3D - bind it as the grab
    // surface while the store's target stays the window root.
    store.bind(titlebar as unknown as Object3D<never>);
    const state: DragState = {
      store,
      hold: new HoldToDrag(Math.max(0, entity.getValue(UIWindow, 'dragDelay') as number)),
      titlebar: titlebar as unknown as Object3D,
      pressKind: undefined,
    };
    // Remember which pointer kind pressed, so the hold delay can be skipped
    // for a near grab. Registered alongside the store's own listener; both
    // see the same pointerdown.
    (titlebar as unknown as {
      addEventListener: (type: string, listener: (event: { pointerType?: string }) => void) => void;
    }).addEventListener('pointerdown', (event) => {
      if (state.pressKind === undefined) {
        state.pressKind = event.pointerType as PointerKind | undefined;
      }
    });
    this.states.set(entity, state);
  }

  private detach(entity: Entity): void {
    const state = this.states.get(entity);
    if (!state) {
      return;
    }
    try {
      state.store.cancel();
    } catch {
      // Handle stores throw when cancelled with no active input; ignore.
    }
    this.states.delete(entity);
  }

  private onDragStart(entity: Entity): void {
    const id = entity.getValue(UIWindow, 'windowId') as string;
    const manager = windowManagerFor(this.world);
    if (id && manager.has(id)) {
      manager.focus(id);
      // Mark dragging BEFORE the dock change so the pin label reads "PIN"
      // (loose in hand) throughout the drag, not "UNPIN".
      manager.setDragging(id, true);
    }
    // Grabbing takes the window out of any region and out of follow mode -
    // the user is placing it by hand.
    if (entity.hasComponent(UIDockedTo)) {
      entity.removeComponent(UIDockedTo);
    }
    if (entity.getValue(UIWindow, 'dockMode') !== DockMode.WorldLocked) {
      entity.setValue(UIWindow, 'dockMode', DockMode.WorldLocked);
    }
  }

  private whileDragging(entity: Entity): void {
    if (!entity.getValue(UIWindow, 'billboardWhileDragging')) {
      return;
    }
    const object = entity.object3D;
    if (!object) {
      return;
    }
    object.getWorldPosition(this.worldPosition);
    this.camera.getWorldPosition(this.viewerPosition);
    const yaw = faceViewerYaw(
      [this.worldPosition.x, this.worldPosition.y, this.worldPosition.z],
      [this.viewerPosition.x, this.viewerPosition.y, this.viewerPosition.z],
      object.rotation.y,
    );
    object.rotation.set(0, yaw, 0);
  }

  private onDragEnd(entity: Entity): void {
    const id = entity.getValue(UIWindow, 'windowId') as string;
    const manager = windowManagerFor(this.world);
    if (id && manager.has(id)) {
      manager.setDragging(id, false); // released → placed → label "UNPIN"
    }
    // Settle facing the viewer at the drop spot - the window keeps the
    // orientation it was dragged in, not its pre-drag rotation.
    this.whileDragging(entity);
    const object = entity.object3D;
    if (!object) {
      return;
    }
    object.getWorldPosition(this.worldPosition);
    const dropPoint: Vec3 = [
      this.worldPosition.x,
      this.worldPosition.y,
      this.worldPosition.z,
    ];

    const registry = regionRegistryFor(this.world);
    const origins = new Map<string, Vec3>();
    this.queries.regions.entities.forEach((regionEntity) => {
      const regionId = regionEntity.getValue(UIDockRegion, 'regionId') as string;
      const regionObject = regionEntity.object3D;
      if (!regionId || !regionObject) {
        return;
      }
      regionObject.getWorldPosition(this.viewerPosition);
      origins.set(regionId, [
        this.viewerPosition.x,
        this.viewerPosition.y,
        this.viewerPosition.z,
      ]);
    });

    const captured = registry.capture(dropPoint, origins);
    if (captured !== undefined) {
      entity.addComponent(UIDockedTo, { regionId: captured });
    }
  }
}
