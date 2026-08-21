/**
 * Desktop pipeline - plain three.js, no XR framework at all.
 *
 * The bootstrap lives beside the scene it raises, in `@showcase`, next to
 * `playground-scene.ts` and `playground-behaviour.ts`: the showcase's own
 * desktop build and this pipeline are the same code, not two copies of it.
 * This wrapper is the lab's half - publish the handles for devtools poking,
 * exactly as the IWSDK pipeline does.
 */
import { bootstrapDesktopShowcase } from '@showcase/desktop-world.js';

export async function bootDesktop(container: HTMLDivElement): Promise<void> {
  const handles = await bootstrapDesktopShowcase(container);
  (window as unknown as { uix: unknown }).uix = handles;
}
