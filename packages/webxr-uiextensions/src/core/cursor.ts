/**
 * Ray-hit cursor placement - pure logic, no engine imports.
 *
 * `ui/pointer-cursor`: a disc at every ray hit, whatever presence says - a
 * binding shows it exactly while a ray currently hits something, hides it
 * exactly when a ray hits nothing, and never hides it merely because nothing
 * is "focused" (presence/hover never hides a cursor - see the family's
 * native-interactions proof for the same rule).
 *
 * The reference is IWSDK's `@iwsdk/xr-input` `CursorVisual`
 * (`updateFromIntersection`): a circle mesh at the intersection point,
 * oriented to the hit surface normal (or the pointer's own orientation with
 * no normal to read), nudged a small fixed distance along that orientation's
 * own local +Z so it never z-fights the surface it is drawn against. This
 * module restates that OFFSET rule, with IWSDK's own constant, so every
 * binding places its cursor the same amount off the surface; a binding
 * builds the ORIENTATION itself from the core's existing `faceViewer` (aim
 * +Z at a point one unit along the surface normal) - not a new rule, so nothing
 * new is added for it here.
 */
import type { QuatTuple, Vec3Tuple } from '@realitycollective/webxr-input';
import { rotate } from './hand-menu.js';

/**
 * Meters a cursor disc sits off the surface it is drawn against, along its
 * own facing (post-rotation local +Z), so it never z-fights that surface.
 * IWSDK's `CursorVisual` base `zOffset` (it adds a per-pointer stagger on top
 * for multiple simultaneous cursors sharing one surface - an engine
 * rendering detail, not a placement rule, so it is not restated here).
 */
export const DEFAULT_CURSOR_OFFSET = 0.004;

/**
 * A cursor disc's world pose: `point`, nudged `offset` meters along
 * `facing`'s own local +Z axis, oriented as `facing` unchanged.
 */
export function cursorPlacement(
  point: Vec3Tuple,
  facing: QuatTuple,
  offset: number = DEFAULT_CURSOR_OFFSET,
): { position: Vec3Tuple; quaternion: QuatTuple } {
  const nudge = rotate(facing, [0, 0, offset]);
  return {
    position: [point[0] + nudge[0], point[1] + nudge[1], point[2] + nudge[2]],
    quaternion: facing,
  };
}
