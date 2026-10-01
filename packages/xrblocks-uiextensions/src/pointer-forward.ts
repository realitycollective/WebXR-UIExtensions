/**
 * Minimal pointer forwarding - turns an engine raycast hit into a uikit
 * click, with no press/release timing.
 *
 * Superseded for `UixWindowHost` / `connectUIExtensions`: the host now wires
 * `pointer-bridge.ts`'s `XrBlocksPointerBridge` onto every panel it creates,
 * which drives the core `TouchPress` and `TitlebarDragController` from XR
 * Blocks' own select/touch/grab/hover callbacks - clicking on release, not
 * on intersection, as IWSDK does. This module
 * stays for a caller driving its OWN raycaster outside the host (a bare
 * `createPanel`, or a hand-rolled three.js integration) that only needs a
 * plain click with no drag, hover or touch.
 */
import type { Object3D } from 'three';

/**
 * The event surface uikit components expose (three.js EventDispatcher).
 * Exported because `pickInteractive` returns it.
 */
export interface InteractiveLike {
  dispatchEvent?(event: { type: string; [key: string]: unknown }): void;
  userData?: Record<string, unknown>;
  parent?: unknown;
}

/**
 * Walk up from a hit object to the nearest ancestor that can receive
 * events and belongs to a uikit tree (identified by the `dataUid` UIKitML
 * stamps into userData). Pure - testable with stub objects.
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
