/**
 * Portable scene descriptors.
 *
 * A scene is plain DATA - which windows exist, where they sit, which dock
 * regions they can drop into - with no engine types anywhere. Each adapter
 * knows how to apply the same descriptor through its own factories, so one
 * playground definition drives IWSDK, XR Blocks and plain three.js alike:
 *
 *   applyScene(iwsdkTarget, PLAYGROUND);   // ECS entities
 *   applyScene(vanillaHost, PLAYGROUND);   // three.js groups
 *
 * Panel config paths stay strings (`./ui/foo.json`) because every adapter
 * resolves them the same way - IWSDK fetches them itself, the vanilla host
 * is handed the parsed JSON by `applyScene`'s loader.
 */
import type { DockModeValue } from './core/dock-state.js';
import type { RegionFlow, Vec3 } from './core/region-layout.js';

/** One window in a scene. */
export interface SceneWindow {
  id: string;
  title: string;
  /** Path to the compiled UIKitML JSON, e.g. `./ui/clicker.json`. */
  config: string;
  /** World position for world-locked windows. */
  position?: Vec3;
  maxWidth?: number;
  maxHeight?: number;
  dockMode?: DockModeValue;
  /** Dock straight into this region on spawn. */
  region?: string;
  followOffset?: Vec3;
  followSpeed?: number;
  followTolerance?: number;
  movable?: boolean;
  closable?: boolean;
  minimizable?: boolean;
  pinnable?: boolean;
}

/** One dock region in a scene. */
export interface SceneRegion {
  id: string;
  flow?: RegionFlow;
  pitch?: number;
  columns?: number;
  capacity?: number;
  snapRadius?: number;
  position?: Vec3;
  /** Body-lock the region so it follows the viewer. */
  follow?: boolean;
  followOffset?: Vec3;
}

/** A complete, engine-free scene definition. */
export interface SceneDescriptor {
  name?: string;
  regions?: readonly SceneRegion[];
  windows: readonly SceneWindow[];
}

/**
 * What an adapter must provide for {@link applyScene} to build a scene.
 * Both shipped adapters implement this; a new adapter only needs these two
 * methods to gain full scene portability.
 */
export interface SceneTarget {
  spawnRegion(region: SceneRegion): void;
  spawnWindow(window: SceneWindow): void;
}

/**
 * Apply a descriptor to an adapter. Regions are created before windows so a
 * window that spawns docked (`region: 'x'`) always finds its region.
 */
export function applyScene(target: SceneTarget, scene: SceneDescriptor): void {
  for (const region of scene.regions ?? []) {
    target.spawnRegion(region);
  }
  for (const window of scene.windows) {
    target.spawnWindow(window);
  }
}

/** Every distinct panel config path in a scene (for preloading). */
export function sceneConfigPaths(scene: SceneDescriptor): string[] {
  return [...new Set(scene.windows.map((window) => window.config))];
}

/**
 * Validate a descriptor: unique window/region ids, and every `region`
 * reference resolvable. Returns the problems found (empty = valid) rather
 * than throwing, so callers can report them all at once.
 */
export function validateScene(scene: SceneDescriptor): string[] {
  const problems: string[] = [];
  const regionIds = new Set<string>();
  for (const region of scene.regions ?? []) {
    if (regionIds.has(region.id)) {
      problems.push(`duplicate region id "${region.id}"`);
    }
    regionIds.add(region.id);
  }
  const windowIds = new Set<string>();
  for (const window of scene.windows) {
    if (windowIds.has(window.id)) {
      problems.push(`duplicate window id "${window.id}"`);
    }
    windowIds.add(window.id);
    if (window.region !== undefined && !regionIds.has(window.region)) {
      problems.push(
        `window "${window.id}" docks into unknown region "${window.region}"`,
      );
    }
  }
  return problems;
}
