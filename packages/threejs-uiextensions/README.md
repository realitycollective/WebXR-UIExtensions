# @realitycollective/threejs-uiextensions

Plain three.js / WebXR adapter for [`@realitycollective/webxr-uiextensions`](../webxr-uiextensions/README.md), the engine-free windowing, docking and control core for WebXR spatial UI. It hosts the same UIKitML panels, window chrome, window manager, dock regions and hand menus as the IWSDK and XR Blocks adapters, inside any three.js scene with a WebXR session, driven from the browser's WebXR APIs with no engine SDK beyond three.js itself.

`@realitycollective/xrblocks-uiextensions` builds directly on this package: its `UixWindowHost` is a thin subclass of this one, supplying its own interaction source (Google XR Blocks' interaction manager) in place of this package's session-driven bridge. Everything about how a window, panel or region behaves - spawn, chrome, follow mode, dock regions, hand menus, drag, focus bias - lives here, once, and both adapters run it unchanged.

> **Maturity:** new. Proved headlessly (window lifecycle, follow and placement by the core rules, the shared `WindowHost`/`SceneTarget`/`UixElement` contracts, and every interaction rule against wired meshes and a faked WebXR session); it has had no on-device pass yet.

## What it binds

- **`UixWindowHost`** - spawns UIKitML windows and dock regions into a three.js scene graph, wires chrome buttons (focus/PIN/DOCK/MIN/X), follow mode (`body-follow`/`head-locked`), dock regions, hand menus, title-bar drag (hold-to-drag, near/grab, billboard, drop capture) and focus bias - implements the core `WindowHost` and `SceneTarget`.
- **`UixPanelDocument`** - a `Group` wrapping an interpreted UIKitML tree over `@pmndrs/uikitml`, scaled to fit, with `getElementById`.
- **`ScenePointerBridge`** - turns a resolved ray hit, a proximity-tested grab or touch, into `pointerdown`/`pointerup`/`click`/`pointerenter`/`pointerleave` events and core `TouchPress` samples. `rayCast` also reports the world-space hit point and surface normal, for the cursor below.
- **`CursorVisual`** - a disc drawn at a ray's current hit on a panel, oriented to the hit surface (`ui/pointer-cursor`). IWSDK's engine draws this for free and XR Blocks draws its own reticle inside its SDK; on plain three.js this binding owns rendering, so this class exists to draw one. Placement follows the core's `cursorPlacement` rule (the hit point nudged a small fixed distance off the surface, IWSDK's own constant) so it never z-fights the panel; orientation comes from the core's `faceViewer`. Shown and hidden by nothing but whether the ray currently hits something - never by hover or focus state.
- **`connectWebXrPointerInput`** - wires that bridge to a live WebXR session through `renderer.xr`: `selectstart`/`selectend`/`squeezestart`/`squeezeend` on three's own controller objects for ray and near/grab press, a per-frame `index-finger-tip` joint poll for touch, and - given a `scene` - a `CursorVisual` per ray, updated from the same per-frame ray cast hover already runs.
- **`connectUIExtensions`** - the one setup entry point: builds the host bound to a scene and camera, and, given a renderer, wires the session input above (including cursors) automatically.
- **`configureRendererForUikit`** - the renderer settings uikit needs (transparent sort by `renderOrder`, local clipping).

## Required renderer setup (read this first)

uikit draws panel backgrounds, borders and **text glyphs** all as transparent meshes, stacked by `renderOrder`. three.js sorts transparent objects by camera distance by default, which is meaningless for coplanar UI layers - at grazing angles or close range a panel background can sort in front of its own text and labels silently vanish. uikit also clips panel content with local clipping planes, which three.js ignores unless enabled.

```ts
import { WebGLRenderer } from 'three';
import { configureRendererForUikit } from '@realitycollective/threejs-uiextensions';

const renderer = new WebGLRenderer({ antialias: true });
configureRendererForUikit(renderer); // transparent sort + local clipping
renderer.xr.enabled = true;
```

## Usage

```ts
import { PerspectiveCamera, Scene, Clock } from 'three';
import { DockMode, connectUIExtensions } from '@realitycollective/threejs-uiextensions';

const scene = new Scene();
const camera = new PerspectiveCamera();

const uix = connectUIExtensions({ scene, camera, renderer }); // renderer optional - see below
const config = await fetch('./ui/my-window.json').then((r) => r.json());
uix.createWindow({ id: 'status', title: 'Status', config, dockMode: DockMode.BodyFollow });

const clock = new Clock();
renderer.setAnimationLoop(() => {
  uix.update(clock.getDelta());
  renderer.render(scene, camera);
});
```

### `connectUIExtensions` options (`EngineContext`)

| Option | Meaning |
| --- | --- |
| `scene` | Where windows and regions are parented. |
| `camera` | The viewer pose source - read every frame for follow mode and body-lock. |
| `renderer` | `{ xr: renderer.xr }`. Supplied, the host wires its own pointer input straight from the live WebXR session (ray/grab press-release, touch from tracked hand joints, hand poses for hand menus) and `update()` polls it automatically. Left out on a desktop preview with no session - drive the host's panels by hand instead. |
| `kit` | Optional UIKitML component kit(s) (for example a horizon kit). |
| `controllerCount` | How many controller/hand slots to read from the session. Default `2`. |
| `touchDistance` | Meters within which a tracked fingertip is probed for a touch. Default `0.08`. |
| `grabDistance` | Meters within which a grip presses (near/grab). Default `0.12`. |
| `cursor` | `{ radius?, offset? }` for each ray's cursor disc (`ui/pointer-cursor`). Radius default `0.008` m, offset default the core's `DEFAULT_CURSOR_OFFSET` (`0.004` m). Ignored with no `renderer`. |

`connectUIExtensions` returns the host with `update`/`dispose` already combined with the WebXR pointer poll, plus `disconnect()` to stop just the session wiring (also called by `dispose()`).

### Window options and handles

`createWindow` takes the portable `WindowOptionsBase` fields plus `config` (compiled UIKitML JSON), so an option means here what it means on every other adapter:

- `id` is optional. Omit it and the window is named `uix-window-<n>`.
- `movable` (default `true`) gates the title-bar drag: `false` never wires a press listener onto the title bar at all.
- `dragDelay` (default `DEFAULT_DRAG_DELAY`, 0.3 s) is how long a ray press on the title bar is held before it becomes a drag; a grab (near drag) always starts at once. `billboardWhileDragging` (default `true`) keeps the window yawed toward the viewer while dragged. With a `renderer` supplied, a ray drag rides the actual controller ray at a fixed distance (the same laser-distance math IWSDK and native use); without one, it falls back to the controller's own position delta.
- The four chrome flags (`closable`, `minimizable`, `pinnable`, `dockable`) are off unless set, as on every platform; `host.manager.setChrome(id, {...})` changes them later.
- `handMenu` and `dockMode: 'hand-locked'` make a hand menu, ridden from the session's tracked hands when a `renderer` is supplied. With no hand tracked - no source at all, or a session with neither palm raised - the menu is hidden, exactly as IWSDK, XR Blocks and native; it never falls back to some other placement.

The handle it returns satisfies the core `WindowHandle` and adds the three.js specifics:

```ts
const handle = uix.createWindow({ title: 'Status', config });
handle.id;        // 'uix-window-1'
handle.group;     // the scene-graph node - position and rotate freely
handle.document;  // the UixPanelDocument
handle.panel;     // the same document, under the portable name
handle.onReady((panel) => wire(panel)); // fires straight away - uikitml interprets synchronously
```

### Driving your own pointer bridge

`UixWindowHost`'s `pointerBridgeFactory` option lets a caller supply its own interaction source in place of `ScenePointerBridge` - this is how `@realitycollective/xrblocks-uiextensions` reuses this whole package. The only requirement is `wire(root: Object3D): void`, called once per panel:

```ts
import { UixWindowHost } from '@realitycollective/threejs-uiextensions';

const host = new UixWindowHost({
  scene,
  headPose,
  pointerBridgeFactory: (isLive) => new MyOwnBridge({ isLive }),
});
```

## Testing

```bash
npm test
```

Real WebXR-session raycasting against an actual UIKitML panel is not exercised headlessly: uikit only measures a panel's layout once its fonts load, which needs a DOM the project's `environment: 'node'` vitest config does not provide. The raycasting/probing (`ScenePointerBridge`) and the session-event wiring (`connectWebXrPointerInput`) are proved instead against plain wired meshes and a faked `renderer.xr`, which need no layout pass; the host, follow/placement parity with the core, and every published contract (`WindowHost`, `SceneTarget`, `UixElement`) run against real UIKitML panels, which interpret synchronously even though their visual layout does not.

## License

MIT © Reality Collective
