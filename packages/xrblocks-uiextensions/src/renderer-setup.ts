/**
 * Renderer configuration required by uikit.
 *
 * uikit draws every panel - background plates, borders, images AND text
 * glyphs - as TRANSPARENT meshes, and relies on `renderOrder` to stack them
 * correctly. three.js's default transparent sort orders by distance to the
 * camera, which is meaningless for coplanar UI layers: at grazing angles or
 * close range the panel background can sort in front of its own text, so
 * labels silently vanish while the panel still renders. `reversePainterSortStable`
 * sorts by `renderOrder` instead, which is what uikit assigns.
 *
 * IWSDK applies exactly this configuration in its own UI system, which is
 * why panels look right there; any hand-rolled three.js host (desktop, XR
 * Blocks, tests) must do the same or it will hit the disappearing-text bug.
 *
 * Call once, right after creating the renderer:
 *
 *   const renderer = new WebGLRenderer({ antialias: true });
 *   configureRendererForUikit(renderer);
 */
import { reversePainterSortStable } from '@pmndrs/uikit';

/** The slice of `WebGLRenderer` this needs - keeps the helper testable. */
export interface UikitRenderer {
  localClippingEnabled: boolean;
  setTransparentSort(method: (a: unknown, b: unknown) => number): void;
}

export function configureRendererForUikit(renderer: UikitRenderer): void {
  // Stack UI layers by renderOrder, not by camera distance.
  renderer.setTransparentSort(
    reversePainterSortStable as unknown as (a: unknown, b: unknown) => number,
  );
  // uikit clips panel content (scroll areas, overflow) with local clipping
  // planes; three.js ignores those unless this is enabled.
  renderer.localClippingEnabled = true;
}
