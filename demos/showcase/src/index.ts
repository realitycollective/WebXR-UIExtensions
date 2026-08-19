/**
 * IWSDK UI Extensions - showcase client entry.
 * All scene construction lives in world.ts so other demo clients (the
 * uix-devtools playground) can reuse the identical scene.
 */
import { bootstrapShowcase } from './world.js';

bootstrapShowcase(
  document.getElementById('scene-container') as HTMLDivElement,
).then(({ world, manager }) => {
  // Handy for poking around in devtools.
  (window as unknown as { uix: unknown }).uix = { world, manager };
});
