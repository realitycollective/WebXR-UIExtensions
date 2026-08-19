/**
 * UIDockRegionSystem - keeps the region registry in sync with `UIDockRegion`
 * entities and lays docked windows out in their region's slots each frame.
 *
 * Regions are ordinary entities: give one a `Follower` and its docked
 * windows become a body-locked toolbar; leave it static for a world-locked
 * console wall.
 */
import { Quaternion, Vector3, createSystem, type Entity } from '@iwsdk/core';
import { UIDockRegion, UIDockedTo, UIWindow } from '../components.js';
import { DockMode } from '@realitycollective/webxr-uiextensions';
import type { RegionDefinition, RegionFlow } from '@realitycollective/webxr-uiextensions';
import { regionRegistryFor } from '../region-registry-store.js';
import type { RegionRegistry } from '@realitycollective/webxr-uiextensions';

let autoRegionId = 0;

export class UIDockRegionSystem extends createSystem({
  regions: { required: [UIDockRegion] },
  docked: { required: [UIWindow, UIDockedTo] },
}) {
  private registry!: RegionRegistry;
  private regionEntities = new Map<string, Entity>();
  private slotPosition = new Vector3();
  private regionQuaternion = new Quaternion();

  override init(): void {
    this.registry = regionRegistryFor(this.world);

    this.cleanupFuncs.push(
      this.queries.regions.subscribe('qualify', (entity) => this.addRegion(entity)),
      this.queries.regions.subscribe('disqualify', (entity) => this.removeRegion(entity)),
      this.queries.docked.subscribe('qualify', (entity) => this.dockWindow(entity)),
      this.queries.docked.subscribe('disqualify', (entity) => this.undockWindow(entity)),
    );
    this.queries.regions.entities.forEach((entity) => this.addRegion(entity));
    this.queries.docked.entities.forEach((entity) => this.dockWindow(entity));
  }

  override update(): void {
    for (const entity of this.queries.docked.entities) {
      const windowId = entity.getValue(UIWindow, 'windowId') as string;
      const offset = this.registry.offsetOf(windowId);
      const regionId = this.registry.regionOf(windowId);
      const regionEntity = regionId === undefined ? undefined : this.regionEntities.get(regionId);
      const regionObject = regionEntity?.object3D;
      const object = entity.object3D;
      if (!offset || !regionObject || !object || !object.parent) {
        continue;
      }
      // Slot offset is region-local; express it in the window's parent space.
      this.slotPosition.set(offset[0], offset[1], offset[2]);
      regionObject.localToWorld(this.slotPosition);
      object.parent.worldToLocal(this.slotPosition);
      object.position.copy(this.slotPosition);
      regionObject.getWorldQuaternion(this.regionQuaternion);
      object.quaternion.copy(this.regionQuaternion);
    }
  }

  private addRegion(entity: Entity): void {
    let id = entity.getValue(UIDockRegion, 'regionId') as string;
    if (!id) {
      id = `uix-region-${autoRegionId++}`;
      entity.setValue(UIDockRegion, 'regionId', id);
    }
    if (this.registry.get(id)) {
      return;
    }
    const definition: Partial<RegionDefinition> = {
      flow: entity.getValue(UIDockRegion, 'flow') as RegionFlow,
      pitch: entity.getValue(UIDockRegion, 'pitch') as number,
      columns: Math.max(1, Math.round(entity.getValue(UIDockRegion, 'columns') as number)),
      capacity: Math.max(0, Math.round(entity.getValue(UIDockRegion, 'capacity') as number)),
      snapRadius: entity.getValue(UIDockRegion, 'snapRadius') as number,
    };
    this.registry.register(id, definition);
    this.regionEntities.set(id, entity);
  }

  private removeRegion(entity: Entity): void {
    const id = entity.getValue(UIDockRegion, 'regionId') as string;
    if (id && this.regionEntities.get(id) === entity) {
      this.registry.unregister(id);
      this.regionEntities.delete(id);
    }
  }

  private dockWindow(entity: Entity): void {
    const windowId = entity.getValue(UIWindow, 'windowId') as string;
    const regionId = entity.getValue(UIDockedTo, 'regionId') as string;
    if (!windowId || !regionId || !this.registry.get(regionId)) {
      // Unknown region (or the window has no id yet) - docking is meaningless.
      entity.removeComponent(UIDockedTo);
      return;
    }
    try {
      this.registry.dock(windowId, regionId);
    } catch {
      // Region is full: reject the dock.
      entity.removeComponent(UIDockedTo);
      return;
    }
    // Docked windows are world-locked by definition (the region may follow).
    if (entity.getValue(UIWindow, 'dockMode') !== DockMode.WorldLocked) {
      entity.setValue(UIWindow, 'dockMode', DockMode.WorldLocked);
    }
  }

  private undockWindow(entity: Entity): void {
    const windowId = entity.getValue(UIWindow, 'windowId') as string;
    if (windowId) {
      this.registry.undock(windowId);
    }
  }
}
