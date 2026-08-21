/**
 * IWSDK UI Extensions - showcase client entry.
 *
 * The runtime is picked from the hardware, the same way the multiplatform
 * lab picks one: a Meta Horizon OS browser boots the IWSDK build, everything
 * else boots the native three.js build. IWSDK is Meta's SDK - it takes the
 * view pose from the headset and ships no desktop camera - so on a desktop
 * it would render this scene from a frozen viewpoint, with two of the five
 * windows and one of the two dock regions permanently outside the frustum.
 * Desktop is desktop; IWSDK is Meta.
 *
 * Both builds raise the IDENTICAL playground from the identical portable
 * descriptor (`playground-scene.ts`) with the identical engine-free
 * behaviour (`playground-behaviour.ts`), so this is one demo with two
 * bindings, not two demos. Force either with `?uix-engine=iwsdk` or
 * `?uix-engine=desktop`.
 *
 * Both bootstraps are dynamic imports: a desktop visitor never downloads
 * IWSDK, and a headset never downloads the three.js host.
 */
import { chooseEngine } from './platform-detect.js';

const container = document.getElementById('scene-container') as HTMLDivElement;
const choice = chooseEngine(navigator.userAgent, location.search);

// The lab ships all three pipelines; the showcase ships two of them. Android
// XR resolves to 'xrblocks' there and has no IWSDK build to fall back on, so
// here it takes the three.js one - its browser is still a browser.
const engine = choice.engine === 'iwsdk' ? 'iwsdk' : 'desktop';

/** Handy for poking around in devtools. */
function publish(handles: unknown): void {
  (window as unknown as { uix: unknown }).uix = handles;
}

async function boot(): Promise<void> {
  if (engine === 'iwsdk') {
    const { bootstrapShowcase } = await import('./world.js');
    publish(await bootstrapShowcase(container));
    return;
  }
  const [{ bootstrapDesktopShowcase }, { installDesktopHintBar }] =
    await Promise.all([
      import('./desktop-world.js'),
      import('./desktop-hint.js'),
    ]);
  publish(await bootstrapDesktopShowcase(container));
  installDesktopHintBar();
}

void boot().catch((error) => {
  console.error(`[showcase] ${engine} build failed to start:`, error);
});
