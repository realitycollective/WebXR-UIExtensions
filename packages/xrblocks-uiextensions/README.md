# @realitycollective/xrblocks-uiextensions

**EXPERIMENTAL** adapter for [Google XR Blocks](https://github.com/google/xrblocks) and plain three.js. It hosts the same [`@realitycollective/webxr-uiextensions`](../webxr-uiextensions/README.md) core as the IWSDK adapter, with the same UIKitML panels, window chrome and window manager, inside any three.js WebXR scene. An XR Blocks Script gives you exactly that kind of scene.

> **Maturity:** the IWSDK adapter is the most complete one, and this adapter is built to match it. It now has nearly all the same windowing features, and its desktop path is verified in a real browser (panels render, mouse clicks reach uikit controls, WASD/jump/ crouch move the camera). It has still had NO on-device pass on Android XR hardware - treat the XR Blocks path specifically as unverified.

## Feature matrix vs the IWSDK adapter

| Feature | IWSDK | XR Blocks / three.js (this package) |
| --- | --- | --- |
| UIKitML panel hosting (runtime interpret, scale-to-fit) | ✅ | ✅ `UixPanelDocument` |
| Window lifecycle + chrome (focus/PIN/MIN/X, pin labels) | ✅ | ✅ `UixWindowHost` |
| Portable scene descriptors (`applyScene`) | ✅ | ✅ implements `SceneTarget` |
| Panel-ready wiring (`onPanelReady`) | ✅ | ✅ implements `WindowHost` |
| Follow mode (body-follow, yaw-only, eased) | ✅ | ✅ pure `follow-math` |
| Dock regions (wall/belt, slots, follow) | ✅ | ✅ `createRegion` / `dock` |
| Desktop mouse input (hover, click, drag-to-look) | ✅ | ✅ via `@pmndrs/pointer-events` |
| Desktop locomotion (WASD, jump, crouch, sprint) | n/a | ✅ `DesktopControls` |
| XR select-ray click forwarding | ✅ | ✅ minimal (`forwardClick`) |
| Title-bar ray drag (`@pmndrs/handle`) | ✅ | ⬜ roadmap |
| Drop-to-dock by dragging | ✅ | ⬜ roadmap (needs drag) |
| System keyboard text input | ✅ | ⬜ untested on Android XR |

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
import {
  DockMode,
  connectUIExtensions,
  forwardClick,
} from '@realitycollective/xrblocks-uiextensions';

class MyScript extends xb.Script {
  async init() {
    this.uix = connectUIExtensions({ scene: this, camera: xb.camera });
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
  onSelectStart(event) {
    /* raycast from event.target, then forwardClick(intersections) -
       see demos/webxr-multiplatform for the complete wiring */
  }
}

xb.add(new MyScript());
await xb.init();
```

Nothing here imports `xrblocks` - the glue binds to plain three.js shapes (`scene: Object3D`, `camera`), so the same host works in a hand-rolled three.js WebXR app.

## Known constraint: three versions

`xrblocks@0.19` declares a peer of `three@^0.184`, while IWSDK mandates the `super-three@0.181` fork used workspace-wide. Vite resolves a single `three` per bundle so the pairing works in practice, but npm's peer check cannot express it - this workspace uses `legacy-peer-deps` (see the root `.npmrc`). Revisit when IWSDK's three catches up.

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

MIT © Reality Collective
