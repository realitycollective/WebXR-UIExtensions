# @realitycollective/iwsdk-uiextensions

Windowing, docking, layout regions and extra controls for [Meta's Immersive Web SDK](https://iwsdk.dev) (`@iwsdk/core`).

**This is the Meta IWSDK adapter** - and the reference implementation - for the engine-free [`@realitycollective/webxr-uiextensions`](../webxr-uiextensions/README.md) core, which it re-exports in full: one dependency gets IWSDK apps the whole surface. (A sibling [`@realitycollective/xrblocks-uiextensions`](../xrblocks-uiextensions/README.md) adapter binds the same core to Google XR Blocks, experimentally.)

**Reuse, not recreation.** The IWSDK already ships an excellent spatial UI stack - UIKitML markup, `@pmndrs/uikit` rendering, `Follower`/`ScreenSpace` anchoring, grab/ray/poke interaction. This package adds the missing layer above it:

| Feature | What you get |
| --- | --- |
| **Windows** | Title-bar chrome (pin / dock / minimize / close, each opt-in), focus & z-ordering, hide/show, a per-world `WindowManager` with typed events that is also the API for driving a window from code |
| **Hand menus** | A `hand-locked` window rides a hand (left, right or whichever is raised), anchored above the fingertips, at the wrist, or on the thumb or little-finger side, shown while the palm faces you; a vertical stack of buttons that sizes to its content, driving other windows through the manager |
| **Dock states** | `world-locked` (place in space) ⇄ `body-follow` (lazy follow) ⇄ `head-locked`, realised with the IWSDK's own `Follower`/`ScreenSpace` |
| **Manipulation** | Drag windows by the title bar with the far ray or a near grab (controller squeeze, hand pinch), powered by `@pmndrs/handle`, the same library behind IWSDK grabbing; billboard-while-dragging, drop-to-dock |
| **Layout regions** | Named regions (row / column / grid slots) windows snap into; regions can themselves follow the player |
| **Controls** | `data-uix` markup upgrades: **stepper**, **toggle**, **expandable multi-line label**, **log/list view** - plus everything UIKitML already has (buttons, inputs, textareas, images, and the horizon kit's Slider/Checkbox/…) |

Everything is authored in plain UIKitML (HTML/CSS-like) - no new markup language, no custom renderer, no wrapper widgets around things the IWSDK already does.

## Install

```bash
npm install @realitycollective/iwsdk-uiextensions
# peers: @iwsdk/core >=0.5.0 <0.6.0 and three >=0.170.0 (every IWSDK app already has both)
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
  pinnable: true,                  // title-bar buttons are off unless asked for
  minimizable: true,
});

windows.events.on('closed', (w) => console.log(`${w.title} closed`));

// The manager is also how code changes a window - from a hand menu, say:
windows.hide('status');            // and show(), toggleHidden()
windows.togglePin('status');       // or setDockMode(id, DockMode.WorldLocked)
windows.dockTo('status', 'wall');  // undock(id), returnHome(id)
windows.setChrome('status', { close: true, dock: true });
windows.close('status');           // destroys the entity
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

**Every title-bar button is off by default.** Keep all four in the markup, then enable the ones a window should have with `closable`, `minimizable`, `pinnable` and `dockable` at spawn, or later with `windows.setChrome(id, { pin: true })`. A disabled button is hidden and its click ignored; enabling one needs no rewiring.

### Interaction model

- **Drag** the title bar with the ray (or mouse on desktop) to move a window; it billboards toward you while dragging and settles facing you when released. A press only becomes a drag after `dragDelay` seconds (default 0.3, per-window on `UIWindow`) - shorter presses stay clicks, and the chrome buttons swallow their presses entirely, so PIN/DOCK/MIN/X never fight the drag gesture.
- **Near grab** the title bar to pick the window up: squeeze with a controller, or pinch with a tracked hand while it is on the bar. A near grab is a deliberate gesture, so it drags at once with no hold delay. This does not need `features.grabbing`: `UIDragSystem` enables IWSDK's near `grab` pointer itself, lists every movable title bar as a target for it each frame, and forwards a hand pinch to it only while the hand is on a title bar, so pinching anywhere else still means what your app decided. Pass `registerUIExtensions(world, { nearDrag: false })` to keep the ray as the only way to move windows.
- **Drop** a window inside a region's snap radius to dock it into the next slot; drag it out again to undock.
- **Pin** toggles `body-follow` ⇄ `world-locked` ("place in space").
- Dragging a following window implicitly places it - pin re-attaches it.
- **Hide** takes a window out of view and out of reach (no ray or poke can hit it) while keeping its dock mode, region slot and minimized state; **show** brings it back exactly where it was and in front. Minimize collapses the body but leaves the title bar drawn.

### Hand menus

Spawn a window with `dockMode: DockMode.HandLocked` and it becomes a hand menu in the manner of MRTK 2's: it rides a hand and shows while that palm is raised toward you. `handMenu` says how:

```ts
host.createWindow({
  id: 'menu',
  config: './ui/hand-menu.uikitml',
  dockMode: DockMode.HandLocked,
  handMenu: {
    hand: 'left',        // 'left' | 'right' | 'either' (whichever palm is raised)
    anchor: 'above',     // 'above' fingertips | 'inside' (thumb) | 'outside' | 'wrist'
    anchorDistance: 0.12, // meters from the palm
    offset: [0, 0, 0],   // extra hand-local nudge
    palmGate: true,      // show only while the palm faces you
    palmAngle: 60,       // how far off square the palm may be, degrees
  },
});
```

Every field is optional; the defaults are the values shown. `windows.setHandMenu(id, { hand: 'right' })` changes them at runtime. The hand pose is the player rig's grip space, so a controller's grip or a tracked hand both work, and the panel always turns to face you. While the gate is shut the menu is neither drawn nor hittable, and `hide()` still wins over an open gate. Pinning or dragging a hand menu makes it an ordinary world-locked window where it was.

Use `HAND_MENU_SNIPPET` from the core as the markup starting point: the same `uix-window` / `uix-content` ids, no title bar, a vertical stack of buttons that sizes to its content. `Examples/basic-window/` is a window whose manipulation buttons live on such a menu.

### Driving windows from code

`registerUIExtensions` returns the `WindowManager`, and it is the one API app code needs to change a window - a hand menu, a keyboard shortcut, a voice command. Every call is applied by the systems, and the same calls work on the XR Blocks adapter:

| Call | Effect |
| --- | --- |
| `hide(id)` / `show(id)` / `toggleHidden(id)` | Out of view and unhittable; back in place and in front |
| `minimize(id)` / `restore(id)` / `toggleMinimized(id)` | Collapse / expand the body |
| `togglePin(id)` / `setDockMode(id, mode)` | Follow the player or stay put |
| `dockTo(id, regionId)` / `undock(id)` | Into a region slot (world-locked) / out of it |
| `returnHome(id)` | Back to the spawn region, or the spawn placement and mode (what DOCK does) |
| `setChrome(id, { pin, dock, minimize, close })` | Enable or disable title-bar buttons at runtime |
| `focus(id)` | Bring to the front |
| `close(id)` | Destroy the window's entity |

| `setHandMenu(id, { hand, anchor, ... })` | Move a hand menu to the other hand or another anchor |

The record is always what the scene shows: a drag that docks a window, or a PIN click, is written back into `windows.get(id)`, and every change emits a typed event (`hidden`, `shown`, `regionChanged`, `returnHome`, `chromeChanged`, `handMenuChanged`, alongside the existing ones) so a menu can keep its labels honest. See `Examples/basic-window/`.

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

**Do not poll `getPanelHandle` on a timer.** It is a single synchronous read, not a wait, and there is no deadline you can safely guess: the markup is fetched over the network and parsed over later frames, so a cold cache on a headset takes far longer than a warm one on a desktop. A poll that gives up early leaves a window that draws correctly and responds to nothing, with no error and no log line, which is close to undiagnosable from the outside. Every window has a readiness signal already, so use one.

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

`onPanelReady` covers windows spawned by `createUIWindow` too, not only by `host.createWindow`. So code that already holds factory entities does not have to change how it spawns them: create the host once, subscribe, and match on the `id` you passed to the factory.

```ts
const entity = createUIWindow(world, { id: 'status', config: './ui/status.uikitml' });

createSceneHost(world).onPanelReady(({ id, panel }) => {
  if (id === 'status') wireStatus(panel);
});
```

Pass an `id` to `createUIWindow` if you intend to match on one. Without it the window has no id to announce, so it arrives as `kind: 'panel'` with its config path as the `id`, and a listener filtering on `kind === 'window'` will silently never see it. `host.createWindow` differs here: it invents `uix-window-<n>` when you omit the id.

`createSceneHost(world)` returns the same host every time it is called for a world, so separate modules can each ask for it without coordinating or passing it around.

Bare panels are announced as well as managed windows, which is how devtools and hand-built `PanelUI` entities show up in the same stream. `supportsStandalonePanels` is `false` on this host: IWSDK owns panel lifecycles through the ECS, so `createPanel()` throws rather than half-working. Spawn a window instead.

## Headless core

All decision logic (window manager, dock state machine, region slot math, drag math, control models) lives in `@realitycollective/webxr-uiextensions` - pure TypeScript with no engine imports, tested at 100% coverage. The ECS systems in this package are thin appliers of that core onto `@iwsdk/core` components.

## Live demos

- Showcase: **[webxr-uiextensions.pages.dev](https://webxr-uiextensions.pages.dev)**
- Multiplatform lab: **[webxr-uix-lab.pages.dev](https://webxr-uix-lab.pages.dev)**

## License

MIT © Reality Collective
