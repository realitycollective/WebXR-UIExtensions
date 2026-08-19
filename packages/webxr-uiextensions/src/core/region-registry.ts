/**
 * RegionRegistry — pure bookkeeping of dock regions and their members.
 *
 * The ECS layer feeds it region definitions (from `UIDockRegion` components)
 * and world-space origins at drop time; it answers slot assignments and drop
 * capture. Window/region ids are opaque strings.
 */
import {
  RegionDefinition,
  Vec3,
  captureDrop,
  hasCapacity,
  normalizeRegion,
  slotOffset,
} from './region-layout.js';

export interface RegisteredRegion {
  id: string;
  definition: RegionDefinition;
  /** Docked window ids in slot order. */
  members: string[];
}

export class RegionRegistry {
  private regions = new Map<string, RegisteredRegion>();
  private regionByWindow = new Map<string, string>();

  register(id: string, definition: Partial<RegionDefinition> = {}): RegisteredRegion {
    if (this.regions.has(id)) {
      throw new Error(`[uix] region "${id}" is already registered`);
    }
    const region: RegisteredRegion = {
      id,
      definition: normalizeRegion(definition),
      members: [],
    };
    this.regions.set(id, region);
    return region;
  }

  unregister(id: string): void {
    const region = this.regions.get(id);
    if (!region) {
      return;
    }
    for (const windowId of region.members) {
      this.regionByWindow.delete(windowId);
    }
    this.regions.delete(id);
  }

  get(id: string): RegisteredRegion | undefined {
    return this.regions.get(id);
  }

  /** Dock a window; returns its slot index. */
  dock(windowId: string, regionId: string): number {
    const region = this.regions.get(regionId);
    if (!region) {
      throw new Error(`[uix] unknown region "${regionId}"`);
    }
    if (!hasCapacity(region.definition, region.members.length)) {
      throw new Error(`[uix] region "${regionId}" is full`);
    }
    this.undock(windowId);
    region.members.push(windowId);
    this.regionByWindow.set(windowId, regionId);
    return region.members.length - 1;
  }

  /** Remove a window from whichever region holds it. Later members shift up. */
  undock(windowId: string): string | undefined {
    const regionId = this.regionByWindow.get(windowId);
    if (regionId === undefined) {
      return undefined;
    }
    this.regionByWindow.delete(windowId);
    // `unregister` scrubs regionByWindow, so a mapped id always has a region.
    const region = this.regions.get(regionId) as RegisteredRegion;
    region.members = region.members.filter((member) => member !== windowId);
    return regionId;
  }

  regionOf(windowId: string): string | undefined {
    return this.regionByWindow.get(windowId);
  }

  /** Local-space offset for a docked window, or undefined when not docked. */
  offsetOf(windowId: string): Vec3 | undefined {
    const regionId = this.regionByWindow.get(windowId);
    if (regionId === undefined) {
      return undefined;
    }
    // A mapped window always has a live region with it as a member (dock/
    // undock/unregister keep both maps in step).
    const region = this.regions.get(regionId) as RegisteredRegion;
    return slotOffset(region.definition, region.members.indexOf(windowId));
  }

  /**
   * Which region captures a drop at `point`, given each region's current
   * world-space origin? Regions missing from `origins` are not considered
   * (e.g. their entity is gone this frame).
   */
  capture(point: Vec3, origins: ReadonlyMap<string, Vec3>): string | undefined {
    const candidates = [...this.regions.values()]
      .filter((region) => origins.has(region.id))
      .map((region) => ({
        id: region.id,
        origin: origins.get(region.id) as Vec3,
        region: region.definition,
        occupancy: region.members.length,
      }));
    return captureDrop(point, candidates)?.id;
  }

  list(): RegisteredRegion[] {
    return [...this.regions.values()];
  }
}
