/**
 * Layout regions - pure slot math for docking windows into named regions.
 *
 * A `DockRegion` is an anchor in space (an entity transform) that lays its
 * docked windows out in a row, column or grid of fixed-pitch slots. The math
 * here is deliberately simple and deterministic: given a slot index and a
 * region definition, produce a local-space offset; given a drop point and the
 * regions in the scene, decide which region (if any) captured the drop.
 */

export type Vec3 = readonly [number, number, number];

export type RegionFlow = 'row' | 'column' | 'grid';

export interface RegionDefinition {
  /** Layout direction. `row` = +X, `column` = -Y, `grid` = rows of `columns`. */
  flow: RegionFlow;
  /** Distance between slot origins, in meters. */
  pitch: number;
  /** Number of columns per row; only meaningful for `grid`. */
  columns: number;
  /** Maximum windows the region accepts (0 = unlimited). */
  capacity: number;
  /** Drop-capture radius around the region origin, in meters. */
  snapRadius: number;
}

export const DEFAULT_REGION: RegionDefinition = {
  flow: 'column',
  pitch: 0.35,
  columns: 2,
  capacity: 0,
  snapRadius: 0.5,
};

export function normalizeRegion(partial: Partial<RegionDefinition>): RegionDefinition {
  const region = { ...DEFAULT_REGION, ...partial };
  if (!(region.pitch > 0)) {
    throw new Error(`[uix] region pitch must be > 0 (got ${region.pitch})`);
  }
  if (!(region.columns >= 1)) {
    throw new Error(`[uix] region columns must be >= 1 (got ${region.columns})`);
  }
  if (region.capacity < 0) {
    throw new Error(`[uix] region capacity must be >= 0 (got ${region.capacity})`);
  }
  if (!(region.snapRadius > 0)) {
    throw new Error(`[uix] region snapRadius must be > 0 (got ${region.snapRadius})`);
  }
  return region;
}

/** Local-space offset of slot `index` within a region. */
export function slotOffset(region: RegionDefinition, index: number): Vec3 {
  if (index < 0 || !Number.isInteger(index)) {
    throw new Error(`[uix] slot index must be a non-negative integer (got ${index})`);
  }
  // `+ 0` folds the -0 that `-0 * pitch` would produce into plain 0.
  switch (region.flow) {
    case 'row':
      return [index * region.pitch, 0, 0];
    case 'column':
      return [0, -index * region.pitch + 0, 0];
    case 'grid': {
      const col = index % region.columns;
      const row = Math.floor(index / region.columns);
      return [col * region.pitch, -row * region.pitch + 0, 0];
    }
  }
}

export function hasCapacity(region: RegionDefinition, occupancy: number): boolean {
  return region.capacity === 0 || occupancy < region.capacity;
}

export interface RegionCandidate<TId> {
  id: TId;
  origin: Vec3;
  region: RegionDefinition;
  occupancy: number;
}

/**
 * Which region captures a window dropped at `point`? The nearest region whose
 * `snapRadius` contains the point and which still has capacity; `undefined`
 * when the drop lands in open space (the window stays world-locked where it
 * was released).
 */
export function captureDrop<TId>(
  point: Vec3,
  candidates: readonly RegionCandidate<TId>[],
): RegionCandidate<TId> | undefined {
  let best: RegionCandidate<TId> | undefined;
  let bestDistSq = Infinity;
  for (const candidate of candidates) {
    if (!hasCapacity(candidate.region, candidate.occupancy)) {
      continue;
    }
    const dx = point[0] - candidate.origin[0];
    const dy = point[1] - candidate.origin[1];
    const dz = point[2] - candidate.origin[2];
    const distSq = dx * dx + dy * dy + dz * dz;
    const radius = candidate.region.snapRadius;
    if (distSq <= radius * radius && distSq < bestDistSq) {
      best = candidate;
      bestDistSq = distSq;
    }
  }
  return best;
}
