/**
 * CursorVisual - a disc drawn at a ray's current hit on a panel, closing
 * `ui/pointer-cursor` for plain three.js.
 *
 * IWSDK's own engine (`@iwsdk/xr-input`'s `CursorVisual`) draws this disc for
 * every ray pointer automatically; XR Blocks draws its own reticle inside
 * its SDK with no seam to observe. Neither is
 * true here: this package owns rendering, so nothing draws a cursor unless
 * this class does.
 *
 * Placement is the core's `cursorPlacement` rule (the hit point, nudged a
 * small fixed distance off the surface along the disc's own facing, so it
 * never z-fights that surface) with IWSDK's own constant
 * (`DEFAULT_CURSOR_OFFSET`). The facing itself is built from the core's
 * existing `faceViewer`, aiming the disc's local +Z at a point one unit along
 * the hit's world-space surface normal - the same thing IWSDK's
 * `Quaternion.setFromUnitVectors(+Z, normal)` achieves, restated from a
 * primitive the core already ships rather than adding a new one. With no
 * surface normal to read (geometry that reports no face), the disc instead
 * takes the ray's own live orientation, matching `CursorVisual`'s fallback.
 *
 * Presence never hides it: `showAtHit` and `hide` are the only two calls
 * that change visibility, driven solely by whether a ray currently hits
 * anything - never by hover/focus state.
 */
import { CircleGeometry, Mesh, MeshBasicMaterial, type Object3D } from 'three';
import {
  DEFAULT_CURSOR_OFFSET,
  cursorPlacement,
  faceViewer,
  type QuatTuple,
  type Vec3Tuple,
} from '@realitycollective/webxr-uiextensions';

export interface CursorVisualOptions {
  /** Disc radius, meters. Default 0.008 - IWSDK's `CursorVisual` radius. */
  radius?: number;
  /** Meters the disc sits off the hit surface. Default the core's `DEFAULT_CURSOR_OFFSET`. */
  offset?: number;
}

export class CursorVisual {
  /** The disc mesh itself - add nothing to it; position/orientation/visibility are `showAtHit`/`hide`'s. */
  readonly object: Mesh;
  private readonly offset: number;

  constructor(parent: Object3D, options: CursorVisualOptions = {}) {
    const radius = options.radius ?? 0.008;
    this.offset = options.offset ?? DEFAULT_CURSOR_OFFSET;
    this.object = new Mesh(
      new CircleGeometry(radius, 32),
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }),
    );
    this.object.name = 'uix-cursor';
    this.object.visible = false;
    this.object.renderOrder = Infinity;
    parent.add(this.object);
  }

  /**
   * Show the disc at `point`, facing `normal` when the ray hit reports one,
   * or `rayQuaternion` (the ray's own live orientation) when it does not.
   */
  showAtHit(point: Vec3Tuple, normal: Vec3Tuple | undefined, rayQuaternion: QuatTuple): void {
    const facing: QuatTuple = normal
      ? faceViewer(point, [point[0] + normal[0], point[1] + normal[1], point[2] + normal[2]])
      : rayQuaternion;
    const placement = cursorPlacement(point, facing, this.offset);
    this.object.position.set(...placement.position);
    this.object.quaternion.set(...placement.quaternion);
    this.object.visible = true;
  }

  /** The ray this cursor rides hits nothing this frame - the only thing that hides it. */
  hide(): void {
    this.object.visible = false;
  }

  dispose(): void {
    this.object.geometry.dispose();
    (this.object.material as MeshBasicMaterial).dispose();
    this.object.removeFromParent();
  }
}
