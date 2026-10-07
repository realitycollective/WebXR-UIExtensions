# @realitycollective/xrblocks-uiextensions

**EXPERIMENTAL** adapter for [Google XR Blocks](https://github.com/google/xrblocks). It builds on [`@realitycollective/threejs-uiextensions`](../threejs-uiextensions/README.md) and hosts the same [`@realitycollective/webxr-uiextensions`](../webxr-uiextensions/README.md) core as the IWSDK adapter, with the same UIKitML panels, window chrome and window manager, inside an XR Blocks Script's three.js scene. For plain three.js without XR Blocks, use `@realitycollective/threejs-uiextensions` directly.

```sh
npm install @realitycollective/xrblocks-uiextensions three
```

It re-exports everything from the core, so this is the only UI Extensions package your app needs. Peer dependency: `three >= 0.170.0`; `xrblocks` itself is not a dependency.

> **Maturity:** the IWSDK adapter is the most complete one, and this adapter is built to match it. It now has nearly all the same windowing features, and its desktop path is verified in a real browser (panels render, mouse clicks reach uikit controls, WASD, jump and crouch move the camera). It has still had NO on-device pass on Android XR hardware - treat the XR Blocks path specifically as unverified.

## Feature matrix vs the IWSDK adapter

| Feature | IWSDK | XR Blocks (this package) |
| --- | --- | --- |
| UIKitML panel hosting (runtime interpret, scale-to-fit) | ✅ | ✅ `UixPanelDocument` |
| Window lifecycle + chrome (focus/PIN/DOCK/MIN/X, all opt-in, pin labels) | ✅ | ✅ `UixWindowHost` |
| Driving windows from code (`WindowManager`: hide/show, dockTo/undock/returnHome, setChrome, close) | ✅ | ✅ every manager event applied |
| Portable scene descriptors (`applyScene`) | ✅ | ✅ implements `SceneTarget` |
| Panel-ready wiring (`onPanelReady`) | ✅ | ✅ implements `WindowHost` |
| Follow mode (body-follow, yaw-only, eased) | ✅ | ✅ pure `follow-math` |
| Hand menus (`hand-locked`, palm gate, anchors) | ✅ from the player rig | ✅ from a `HandPoseSource`; `webxrHandPoseSource(renderer.xr)` reads the session's input sources. No tracked hand hides the menu, exactly as IWSDK and native - it never falls back to some other placement |
| Dock regions (wall/belt, slots, follow) | ✅ | ✅ `createRegion`, `manager.dockTo` (`host.dock` forwards) |
| Desktop mouse input (hover, click, drag-to-look) | ✅ | ✅ via `@pmndrs/pointer-events` |
| Desktop locomotion (WASD, jump, crouch, sprint) | n/a | ✅ `DesktopControls` |
| Ray click on release, poke (touch), controller-tip poke | ✅ | ✅ `pointer-bridge.ts`'s `XrBlocksPointerBridge`, attached to every panel automatically - runs the core `TouchPress` and clicks on `onSelectEnd`, not on intersection |
| Hover styles (`pointerenter`/`pointerleave`) | ✅ | ✅ relayed from `onHoverEnter`/`onHoverExit` |
| Bare panels (`createPanel`) | ⬜ ECS owns the lifecycle | ✅ `supportsStandalonePanels` is `true` |
| Title-bar ray drag, with a per-window `dragDelay` | ✅ (`@pmndrs/handle`) | ✅ `TitlebarDragController`, from `onSelectStart`/`onSelectEnd` on the title bar |
| Title-bar near grab (squeeze / pinch), starts at once | ✅ | ✅ from `onObjectGrabStart`/`onObjectGrabEnd`, gated to the title bar as on native |
| Billboard while dragging | ✅ | ✅ `billboardWhileDragging` (default on) |
| Drop-to-dock by dragging | ✅ | ✅ the core `RegionRegistry.capture` |
| Focus bias (the focused window drawn nearer) | ✅ | ✅ `applyFocusBias`, every frame, for every window including a docked one - `regionSlotPose` re-places every docked window every frame, not only on a dock change |
| Guarded poke (one press per touch, front only) | ✅ `UITouchGuardSystem` over IWSDK's touch pointers | ✅ the same core `TouchPress`, fed from `onObjectTouching` |
| System keyboard text input | ✅ | ⬜ untested on Android XR |
| Shared pointers with the Interactions family | ✅ `UIPointerOfferSystem` | ✅ `connectUIExtensions({ pointers })`: touch, grab and ray candidates offered to the same `PointerArbiter` as `@realitycollective/xrblocks-interactions` |
| Hover per pointer | ✅ | ✅ the bridge raycasts panels itself; XR Blocks' per-element hover callbacks are not relied on |
| Scrolling (drag, coast, clamp) | ✅ uikit | ⬜ core `ScrollState` exists; no case yet drives uikit beside it |

A ray drag rides the ray at a fixed grab distance, the same laser math IWSDK and native use, when `input: xb.input` is supplied to `connectUIExtensions` (or `rayInput` to the host directly) - `xb.input.getFrame()`'s `raySources` give the controller's live ray, since `SelectEvent` itself carries none. With no `rayInput` wired it falls back to the controller's own position delta instead: correct, but not laser-distance.

Requires `xrblocks` **0.20 or later** when `input: xb.input` is supplied: the host reads rays with `xb.input.getFrame()`, and refuses an older input once, at construction, by name. Verified against `xrblocks` 0.21.1.

## Required renderer setup (read this first)

uikit draws panel backgrounds, borders and **text glyphs** all as transparent meshes, stacked by `renderOrder`. three.js sorts transparent objects by camera distance by default, which is meaningless for coplanar UI layers - at grazing angles or close range a panel background can sort in front of its own text and labels silently vanish. uikit also clips panel content with local clipping planes, which three.js ignores unless enabled.

Apply both settings to any renderer you create:

```ts
import { configureRendererForUikit } from '@realitycollective/xrblocks-uiextensions';

const renderer = new WebGLRenderer({ antialias: true });
configureRendererForUikit(renderer);   // transparent sort + local clipping
```

IWSDK does this internally, which is why panels look right there with no setup. **A hand-rolled three.js host must do it explicitly**, and under XR Blocks you should apply it to the renderer `xb.init()` creates.

## Usage in an XR Blocks Script

```ts
import * as xb from 'xrblocks';
import { DockMode, connectUIExtensions } from '@realitycollective/xrblocks-uiextensions';

class MyScript extends xb.Script {
  async init() {
    this.uix = connectUIExtensions({ scene: this, camera: xb.camera, xr: xb.core.renderer.xr, input: xb.input });
    const config = await fetch('./ui/my-window.json').then((r) => r.json());
    this.uix.createWindow({
      id: 'status',
      title: 'Status',
      config,
      dockMode: DockMode.BodyFollow,
    });
  }
  update() {
    this.uix.update(xb.getDeltaTime());
  }
}

xb.add(new MyScript());
await xb.init();
```

Nothing here imports `xrblocks` at the type level - the glue binds to plain three.js shapes (`scene: Object3D`, `camera`), so the same host works in a hand-rolled three.js WebXR app. Press, poke, drag and hover need no wiring in your own `Script`: `createWindow`/`createPanel` attach the pointer bridge to every panel automatically, driven by whichever of XR Blocks' `onSelectStart`/`onSelectEnd`, `onObjectTouchStart`/`onObjectTouching`/`onObjectTouchEnd`, `onObjectGrabStart`/`onObjectGrabEnd` and `onHoverEnter`/`onHoverExit` your scene calls.

### Window options and handles

`createWindow` takes the portable `WindowOptionsBase` fields plus `config`, so an option means here what it means on the IWSDK adapter. Notes specific to this host:

- `id` is optional. Omit it and the window is named `uix-window-<n>`.
- `movable` (default `true`) gates the title-bar drag: `false` never wires a press listener onto the title bar at all.
- `dragDelay` (default `DEFAULT_DRAG_DELAY`, 0.3 s) is how long a ray press on the title bar is held before it becomes a drag; a grab (near drag) always starts at once. `billboardWhileDragging` (default `true`) keeps the window yawed toward the viewer while it is dragged, and once more settling at the drop. Pass `input: xb.input` to `connectUIExtensions` (or `rayInput` to the host) so a ray drag rides the actual controller ray at a fixed distance, as IWSDK and native do; without it, a ray drag falls back to the controller's own position delta.
- The four chrome flags (`closable`, `minimizable`, `pinnable`, `dockable`) are off unless set, as on IWSDK; `host.manager.setChrome(id, {...})` changes them later. `host.manager.hide/show`, `dockTo/undock/returnHome` and `close` all take effect here, so a menu written against the manager needs no host-specific code.
- `handMenu` and `dockMode: 'hand-locked'` make a hand menu. Pass `xr: renderer.xr` to `connectUIExtensions` (or `handPose` to the host) so it rides the session's tracked hands. With no hand tracked - no source at all, or a session with neither palm raised - the menu is hidden, exactly as IWSDK and native; it never falls back to some other placement.

The handle it returns satisfies the core `WindowHandle` and adds the three.js specifics:

```ts
const handle = host.createWindow({ title: 'Status', config });
handle.id;        // 'uix-window-1'
handle.group;     // the scene-graph node - position and rotate freely
handle.document;  // the UixPanelDocument
handle.panel;     // the same document, under the portable name
handle.onReady((panel) => wire(panel));   // fires straight away here
```

`onReady` fires synchronously because uikitml interprets the markup during `createWindow`; only LAYOUT is async. It still returns an unsubscribe function, so code that runs on both adapters has one shape. `supportsStandalonePanels` is `true`: `createPanel(config)` gives an unmanaged panel with no chrome and no window record.

## Known constraint: three versions

`xrblocks` 0.21 declares a peer of `three@^0.184` and logs an error below r182, while IWSDK 1.0 pins the `super-three@0.181.0` fork. The Reality Collective workspaces override both to one shared copy of `super-three@0.185.0`, which meets XR Blocks' r182 floor and which IWSDK runs unchanged. npm's peer check cannot express that override, so the workspaces use `legacy-peer-deps` (see the root `.npmrc`). An app that installs this package picks its own `three`, and XR Blocks needs r182 or later.

## Testing

```bash
npm test   # scale/follow/pointer math + a headless host lifecycle suite
```

## Demo

[`demos/webxr-multiplatform`](../../demos/webxr-multiplatform/README.md) - detects the platform and boots this adapter on Android XR (or via `?uix-engine=xrblocks` anywhere, including XR Blocks' desktop simulator).

## Live demos

- Showcase: **[webxr-uiextensions.pages.dev](https://webxr-uiextensions.pages.dev)**
- Multiplatform lab: **[webxr-uix-lab.pages.dev](https://webxr-uix-lab.pages.dev)**

## License

MIT - see [LICENSE](./LICENSE).
