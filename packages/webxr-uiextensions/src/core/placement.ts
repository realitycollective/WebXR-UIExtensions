/**
 * Placement - the window placement rules a binding applies each frame, as
 * pure tuple logic: the focus bias, a docked window's slot pose, and the
 * window defaults the IWSDK binding's `UIWindow` component carries. A
 * binding that places windows itself (the native binding) uses these so it
 * places them exactly as the IWSDK systems do.
 *
 * Units: metres and seconds. Poses are world space, quaternions `[x, y, z, w]`.
 */
import type { PoseTuple, Vec3Tuple } from '@realitycollective/webxr-input';
import { rotate } from './hand-menu.js';
import { slotOffset, type RegionDefinition } from './region-layout.js';

/**
 * How far each step of focus depth moves a window toward the viewer
 * (metres): `UIWindow.focusBias`, applied by `UIWindowSystem.update`.
 */
export const DEFAULT_FOCUS_BIAS = 0.02;

/** How long a ray press on the title bar is held before it drags (seconds): `UIWindow.dragDelay`. */
export const DEFAULT_DRAG_DELAY = 0.3;

/** Whether a dragged window turns to face the viewer: `billboardWhileDragging`. */
export const DEFAULT_BILLBOARD_WHILE_DRAGGING = true;

/**
 * How far toward the viewer a window at focus `depth` is drawn (metres):
 * `bias * max(0, count - 1 - depth)`, so with three windows the focused one
 * (depth 0) comes forward two steps and the back one not at all.
 */
export function focusBiasAmount(bias: number, count: number, depth: number): number {
  return bias * Math.max(0, count - 1 - depth);
}

/**
 * The position a window at `position` is drawn at with focus bias `amount`:
 * moved `amount` metres straight toward the viewer. IWSDK moves the panel's
 * document by that much toward the camera in the window's local space, which
 * is the same world offset. No move when the amount is zero or the viewer is
 * at the window.
 */
export function applyFocusBias(position: Vec3Tuple, viewer: Vec3Tuple, amount: number): Vec3Tuple {
  if (amount === 0) {
    return [...position] as Vec3Tuple;
  }
  const dx = viewer[0] - position[0];
  const dy = viewer[1] - position[1];
  const dz = viewer[2] - position[2];
  const length = Math.hypot(dx, dy, dz);
  if (length === 0) {
    return [...position] as Vec3Tuple;
  }
  const k = amount / length;
  return [position[0] + dx * k, position[1] + dy * k, position[2] + dz * k];
}

/**
 * Where a window docked at slot `index` of a region sits: the slot offset in
 * the region's local frame, taken to world space, with the region's
 * orientation. `UIDockRegionSystem.update` does exactly this.
 */
export function regionSlotPose(region: PoseTuple, definition: RegionDefinition, index: number): PoseTuple {
  const local = slotOffset(definition, index);
  const world = rotate(region.quaternion, [local[0], local[1], local[2]]);
  return {
    position: [
      region.position[0] + world[0],
      region.position[1] + world[1],
      region.position[2] + world[2],
    ],
    quaternion: [...region.quaternion] as PoseTuple['quaternion'],
  };
}
