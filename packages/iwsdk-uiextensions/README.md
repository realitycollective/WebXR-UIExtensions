# @realitycollective/iwsdk-uiextensions

Windowing, docking, layout regions and extra controls for [Meta's Immersive Web SDK](https://iwsdk.dev) (`@iwsdk/core`).

**This is the Meta IWSDK adapter** - and the reference implementation - for the engine-free [`@realitycollective/webxr-uiextensions`](../webxr-uiextensions/README.md) core, which it re-exports in full: one dependency gets IWSDK apps the whole surface. (A sibling [`@realitycollective/xrblocks-uiextensions`](../xrblocks-uiextensions/README.md) adapter binds the same core to Google XR Blocks, experimentally.)

**Reuse, not recreation.** The IWSDK already ships an excellent spatial UI stack - UIKitML markup, `@pmndrs/uikit` rendering, `Follower`/`ScreenSpace` anchoring, grab/ray/poke interaction. This package adds the missing layer above it:

| Feature | What you get |
| --- | --- |
| **Windows** | Title-bar chrome (pin / minimize / close), focus & z-ordering, a per-world `WindowManager` with typed events |
| **Dock states** | `world-locked` (place in space) ⇄ `body-follow` (lazy follow) ⇄ `head-locked`, realised with the IWSDK's own `Follower`/`ScreenSpace` |
| **Manipulation** | Drag windows by the title bar (powered by `@pmndrs/handle`, the same library behind IWSDK grabbing), billboard-while-dragging, drop-to-dock |
| **Layout regions** | Named regions (row / column / grid slots) windows snap into; regions can themselves follow the player |
| **Controls** | `data-uix` markup upgrades: **stepper**, **toggle**, **expandable multi-line label**, **log/list view** - plus everything UIKitML already has (buttons, inputs, textareas, images, and the horizon kit's Slider/Checkbox/…) |

Everything is authored in plain UIKitML (HTML/CSS-like) - no new markup language, no custom renderer, no wrapper widgets around things the IWSDK already does.

## Install

```bash
npm install @realitycollective/iwsdk-uiextensions
# peer: @iwsdk/core >=0.5.0 <0.6.0
```

## Quick start

```ts
import { World } from '@iwsdk/core';
import {
  registerUIExtensions,
  createUIWindow,
  createDockRegion,
  DockMode,
} from '@realitycollective/iwsdk-uiextensions';

const world = await World.create(container, {
  features: { spatialUI: true },
});

const windows = registerUIExtensions(world); // registers all systems, returns the WindowManager

createDockRegion(world, { id: 'wall', flow: 'column', position: [1.5, 1.8, -1.5] });

createUIWindow(world, {
  id: 'status',
  title: 'Player Status',
  config: './ui/status.uikitml', // UIKitML source; IWSDK 0.5 parses it at runtime
  dockMode: DockMode.BodyFollow,   // follows until the user pins it
});

windows.events.on('closed', (w) => console.log(`${w.title} closed`));
```

### Window markup

Windows are ordinary UIKitML panels; the chrome is discovered by well-known element ids (only the ids are contractual - restyle freely):

```html
<div id="uix-window" class="my-window">
  <div id="uix-titlebar" class="my-titlebar">      <!-- drag surface -->
    <span id="uix-title" class="my-title">.</span>
    <div id="uix-pin">PIN</div>                    <!-- follow ⇄ placed; label auto-syncs to PIN/UNPIN -->
    <div id="uix-dock">DOCK</div>                  <!-- return to home (spawn region / placement) -->
    <div id="uix-minimize">MIN</div>
    <div id="uix-close">X</div>
  </div>
  <div id="uix-content">
    <!-- window body -->
  </div>
</div>
```

> Use `<div>`s (not `<button>`s) for chrome buttons: with a component kit registered, lowercase `<button>` resolves to the kit's Button component, whose intrinsic sizing fights compact title-bar chrome.

### Controls markup

Annotate any element with `data-uix` and the `UIControlsSystem` upgrades it - in any panel, not just windows:

```html
<div data-uix="stepper" data-uix-id="health" data-uix-min="0" data-uix-max="100" data-uix-step="10">
  <button data-uix-role="decrement">-</button>
  <span data-uix-role="value">.</span>
  <button data-uix-role="increment">+</button>
</div>
```

```ts
import { panelControlsFor } from '@realitycollective/iwsdk-uiextensions';

const controls = panelControlsFor(document); // the panel's UIKitDocument
controls.stepper('health').events.on('change', (hp) => setHealth(hp));
```

> UIKitML note: every dynamic-text element needs a literal placeholder child (`<span data-uix-role="value">.</span>`) or no Text node is created.

### Interaction model

- **Drag** the title bar with the ray (or mouse on desktop) to move a window; it billboards toward you while dragging and settles facing you when released. A press only becomes a drag after `dragDelay` seconds (default 0.3, per-window on `UIWindow`) - shorter presses stay clicks, and the chrome buttons swallow their presses entirely, so PIN/DOCK/MIN/X never fight the drag gesture.
- **Drop** a window inside a region's snap radius to dock it into the next slot; drag it out again to undock.
- **Pin** toggles `body-follow` ⇄ `world-locked` ("place in space").
- Dragging a following window implicitly places it - pin re-attaches it.

See `Examples/` (shipped in this package) and the deployable showcase client in the repository for complete, working demonstrations of every feature.

## Windows and panel readiness

`createUIWindow` returns the ECS entity, which is what you want when you are going to add components to it. When you want the PANEL, use the scene host: `createWindow` gives you a handle that resolves itself.

```ts
import { createSceneHost, getPanelHandle } from '@realitycollective/iwsdk-uiextensions';

const host = createSceneHost(world);          // call after registerUIExtensions(world)

const status = host.createWindow({
  id: 'status',                                // optional - omit and you get uix-window-<n>
  title: 'Player Status',
  config: './ui/status.uikitml',
});

status.panel;                                  // undefined until IWSDK attaches the document
status.onReady((panel) => {                    // runs once, immediately if it is already there
  panel.getElementById('uix-title');
});
status.entity;                                 // still the entity, for ECS work
```

`getPanelHandle(entity)` does the same lookup for an entity you already hold, and returns `undefined` while the document is still loading.

Across a whole scene, subscribe to the host instead:

```ts
host.onPanelReady(({ id, panel, kind }) => {
  if (kind === 'panel') {
    // A bare PanelUI entity with no UIWindow: `id` is its config path.
    return;
  }
  wireMyWindow(id, panel);
});
```

Bare panels are announced as well as managed windows, which is how devtools and hand-built `PanelUI` entities show up in the same stream. `supportsStandalonePanels` is `false` on this host: IWSDK owns panel lifecycles through the ECS, so `createPanel()` throws rather than half-working. Spawn a window instead.

## Headless core

All decision logic (window manager, dock state machine, region slot math, drag math, control models) lives in `@realitycollective/webxr-uiextensions` - pure TypeScript with no engine imports, tested at 100% coverage. The ECS systems in this package are thin appliers of that core onto `@iwsdk/core` components.

## Live demos

- Showcase: **[webxr-uiextensions.pages.dev](https://webxr-uiextensions.pages.dev)**
- Multiplatform lab: **[webxr-uix-lab.pages.dev](https://webxr-uix-lab.pages.dev)**

## License

MIT © Reality Collective
