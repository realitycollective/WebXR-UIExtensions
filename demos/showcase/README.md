# UI Extensions showcase

Demo client for the UI Extensions: six windows and two dock regions exercising the library's whole surface, including one window with every title-bar button on, one with none, and one driven from a hand menu on the left hand. The [workspace README](../../README.md#the-showcase-scene) has the tour.

## Two builds, one scene

The runtime is picked from the hardware by `src/platform-detect.ts`, the same detection the [multiplatform lab](../webxr-multiplatform/README.md) offers on its launch screen:

| Browser | Build | Bootstrap |
| --- | --- | --- |
| Meta Horizon OS (Quest) | [`@realitycollective/iwsdk-uiextensions`](../../packages/iwsdk-uiextensions/README.md) | `src/world.ts` |
| anything else | [`@realitycollective/xrblocks-uiextensions`](../../packages/xrblocks-uiextensions/README.md) (its plain three.js half) | `src/desktop-world.ts` |

IWSDK is Meta's SDK: it takes the view pose from the headset and ships no desktop camera, so driving this scene with it on a desktop would render from a frozen viewpoint with two of the five windows and one of the two dock regions permanently outside a 50° frustum. Desktop is desktop; IWSDK is Meta. Force either build with `?uix-engine=iwsdk` or `?uix-engine=desktop` - useful for checking the headset build from a PC, and how CI smoke-tests both.

Both builds raise the identical playground from the identical portable descriptor (`src/playground-scene.ts`) with the identical engine-free behaviour (`src/playground-behaviour.ts`), so this is one demo with two bindings. Each bootstrap is a dynamic import, so a visitor only downloads the one they get.

**Desktop controls:** left click drives the spatial UI, **WASD** walks, **Shift** sprints, **Space**/**C** jump and crouch, **right-drag** looks around. If the browser reports a working `immersive-vr` runtime (a headset tethered to the PC), the hint bar offers a reload into the IWSDK build.

Other demo clients build on these same modules: the [devtools playground](../devtools-playground/README.md) is the IWSDK bootstrap plus the live-edit tooling, and the lab's desktop and IWSDK pipelines wrap `src/desktop-world.ts` and `src/world.ts` directly.

## Service Framework

Both builds are [Service Framework](https://github.com/realitycollective/com.realitycollective.service-framework.ts) apps. Each bootstrap registers one app service, `UixAppService` in `src/app-service.ts`, which imports only `@realitycollective/service-framework`. On the desktop build the three.js `WebXRRuntimeAdapter` owns the frame loop through the renderer's `setAnimationLoop`. Each frame reaches the service's `render()`, which updates the controls, ticks the window host, forwards pointer events and draws. On the IWSDK build the World keeps its own loop, and the bridge system from `@realitycollective/service-framework-iwsdk` relays each visible frame to the service. The UI Extensions systems still tick from the World, so the service's frame closure is empty there. On both builds the service writes the adapter's capabilities and each XR session state to the Event Log window.

## Run it

```bash
npm run dev:showcase     # from the workspace root → http://localhost:8081
```

Deployed automatically by `.github/workflows/ci.yml`: pull requests go to staging (`webxr-uiextensions-test.pages.dev`), pushes to `main` go to production (`webxr-uiextensions.pages.dev`).

For headset testing against a local build (USB or Cloudflare quick tunnel), see [docs/developer-cycle.md](../../docs/developer-cycle.md).
