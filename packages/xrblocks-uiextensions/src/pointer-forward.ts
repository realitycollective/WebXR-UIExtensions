/**
 * Minimal pointer forwarding — turns engine raycast hits into uikit events.
 *
 * XR Blocks (and any plain three.js app) raycasts with its own machinery;
 * uikit components are ordinary three.js Meshes, so they appear in those
 * intersections. This module picks the correct interactive element from a
 * hit list and dispatches DOM-ish events to it. v1 forwards clicks and
 * hover enter/leave — enough for window chrome and `data-uix` controls.
 * (Full pointer capture / poke semantics: use `@pmndrs/pointer-events`,
 * which is what IWSDK itself builds on.)
 */
import type { Object3D } from 'three';

/** The event surface uikit components expose (three.js EventDispatcher). */
interface InteractiveLike {
  dispatchEvent?(event: { type: string; [key: string]: unknown }): void;
  userData?: Record<string, unknown>;
  parent?: unknown;
}

/**
 * Walk up from a hit object to the nearest ancestor that can receive
 * events and belongs to a uikit tree (identified by the `dataUid` UIKitML
 * stamps into userData). Pure — testable with stub objects.
 */
export function pickInteractive(hit: unknown): InteractiveLike | undefined {
  let current = hit as InteractiveLike | undefined;
  while (current) {
    if (
      typeof current.dispatchEvent === 'function' &&
      current.userData &&
      current.userData['dataUid'] !== undefined
    ) {
      return current;
    }
    current = current.parent as InteractiveLike | undefined;
  }
  return undefined;
}

/**
 * Dispatch a click to the interactive element (if any) under the first hit
 * of an intersection list (`Raycaster.intersectObject(panel, true)` order).
 * Returns the element that received the event, for host-side bookkeeping.
 */
export function forwardClick(
  intersections: ReadonlyArray<{ object: Object3D }>,
): InteractiveLike | undefined {
  const first = intersections[0];
  if (!first) {
    return undefined;
  }
  const target = pickInteractive(first.object);
  target?.dispatchEvent?.({ type: 'click' });
  return target;
}
