/**
 * UIDragSystem — drag windows by the title bar.
 *
 * Reuses `@pmndrs/handle` (the exact library behind the IWSDK's grab
 * systems): a `HandleStore` targets the window entity's object while being
 * *bound* to the title-bar uikit element, so grabbing the title bar with the
 * ray (or a pinch) moves the whole window with the same feel as native IWSDK
 * grabbing. The system pumps its own stores, so it works even when the app
 * doesn't enable `features.grabbing`.
 *
 * Dragging implies placing: on grab the window leaves any dock region and
 * switches to `world-locked`; on release near a region it docks there.
 */
import { HandleStore } from '@pmndrs/handle';
import {
  PanelDocument,
  UIKitDocument,
  Object3D,
  Vector3,
  createSystem,
  type Entity,
} from '@iwsdk/core';
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
}

export class UIDragSystem extends createSystem({
  windows: { required: [UIWindow, UIWindowState, PanelDocument] },
  regions: { required: [UIDockRegion] },
}) {
  private states = new Map<Entity, DragState>();
  private worldPosition = new Vector3();
  private viewerPosition = new Vector3();

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
  }

  override update(delta: number): void {
    for (const [entity, state] of this.states) {
      const held = state.store.inputState.size > 0;
      const { phase, began, ended } = state.hold.update(held, delta);

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
    }
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
    // The title-bar uikit element is an Object3D — bind it as the grab
    // surface while the store's target stays the window root.
    store.bind(titlebar as unknown as Object3D<never>);
    this.states.set(entity, {
      store,
      hold: new HoldToDrag(Math.max(0, entity.getValue(UIWindow, 'dragDelay') as number)),
    });
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
    // Grabbing takes the window out of any region and out of follow mode —
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
    // Settle facing the viewer at the drop spot — the window keeps the
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
