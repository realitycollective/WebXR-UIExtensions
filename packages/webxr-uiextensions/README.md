# @realitycollective/webxr-uiextensions

The core of the Reality Collective UI Extensions. It provides:

- **Windows** - movable, resizable panels with a title bar and pin, dock, minimise and close buttons.
- **Docking** - snapping a window into a named region of the scene, such as a row along a wall.
- **Layout regions** - the named areas that windows snap into.
- **Drag maths** - the pure calculations behind dragging, dropping and following the user.
- **Controls** - the state behind steppers, toggles, expandable sections and log views.
- **Markup upgrading** - code that turns a plain element carrying a `data-uix` attribute into a working control, so you write markup rather than components.
- **Adapter interfaces** - what an engine package must implement to host all of the above.

**This package has zero runtime dependencies and imports no 3D engine.** A test, `test/architecture.test.ts`, fails the moment `three`, `@iwsdk/*`, `@pmndrs/*` or `xrblocks` appears anywhere in `src/`. That is what lets the same interface run unchanged on every three.js WebXR runtime.

## You probably want an adapter, not this package

| Your engine | Install | Status |
| --- | --- | --- |
| Meta IWSDK (Quest / Horizon OS) | [`@realitycollective/iwsdk-uiextensions`](../iwsdk-uiextensions/README.md) | reference adapter, full feature set |
| Google XR Blocks / plain three.js | [`@realitycollective/xrblocks-uiextensions`](../xrblocks-uiextensions/README.md) | **experimental**, partial feature set |

Both adapters re-export everything here, so an app installs one package only. Depend on the core directly when writing headless logic, tests, tooling - or a new adapter.

## What lives here

```
src/core/       window manager, dock state machine, region slot math,
                drag math, hold-to-drag, control models (stepper/toggle/
                expandable/log) - pure logic, 100% coverage gated
src/controls/   data-uix markup upgraders, driven through the structural
                UixElement interface (works on ANY conforming element tree)
src/chrome/     window chrome conventions: contractual element ids
                (uix-titlebar, uix-pin, ...) + reference UIKitML snippet
src/adapter.ts  the platform-adapter contract: PanelHost, PanelHandle,
                HeadPoseSource, PointerInputSource (plain tuples, no engine)
```

## Writing an adapter

An adapter supplies three capabilities and drives the core from its frame loop:

1. **Panels** - implement `PanelHost.createPanel(configJson)`: turn compiled UIKitML JSON into a live panel whose element tree satisfies `UixElement` (uikit does out of the box; ids land in `userData`).
2. **Input** - deliver press/move/release into the core's `HoldToDrag` + drag math, or wire chrome clicks straight to `WindowManager`.
3. **Viewer pose** - implement `HeadPoseSource` for follow mode and body-locked regions.

The IWSDK adapter is the reference implementation; the XR Blocks adapter shows the same contract bound without an ECS.

## Testing

```bash
npm test   # from the workspace root - vitest, 100% thresholds on src/core
```

## Live demos

- Showcase: **[webxr-uiextensions.pages.dev](https://webxr-uiextensions.pages.dev)**
- Multiplatform lab: **[webxr-uix-lab.pages.dev](https://webxr-uix-lab.pages.dev)**

## License

MIT © Reality Collective
