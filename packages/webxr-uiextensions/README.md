# @realitycollective/webxr-uiextensions

The **engine-free core** of the Reality Collective UI Extensions: windowing,
docking, layout regions, drag mathematics, control models, the `data-uix`
markup upgraders, the window-chrome conventions - and the platform-adapter
interfaces that engine packages implement.

**This package has zero runtime dependencies and zero engine imports** -
enforced by `test/architecture.test.ts`, which fails the moment `three`,
`@iwsdk/*`, `@pmndrs/*` or `xrblocks` appears anywhere in `src/`. That
guarantee is what makes the UX portable across three.js WebXR runtimes.

## You probably want an adapter, not this package

| Your engine | Install | Status |
| --- | --- | --- |
| Meta IWSDK (Quest / Horizon OS) | [`@realitycollective/iwsdk-uiextensions`](../iwsdk-uiextensions/README.md) | reference adapter, full feature set |
| Google XR Blocks / plain three.js | [`@realitycollective/xrblocks-uiextensions`](../xrblocks-uiextensions/README.md) | **experimental**, partial feature set |

Both adapters re-export this package wholesale, so apps depend on one
package only. Depend on the core directly when writing headless logic,
tests, tooling - or a new adapter.

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

An adapter supplies three capabilities and drives the core from its frame
loop:

1. **Panels** - implement `PanelHost.createPanel(configJson)`: turn compiled
   UIKitML JSON into a live panel whose element tree satisfies `UixElement`
   (uikit does out of the box; ids land in `userData`).
2. **Input** - deliver press/move/release into the core's `HoldToDrag` +
   drag math, or wire chrome clicks straight to `WindowManager`.
3. **Viewer pose** - implement `HeadPoseSource` for follow mode and
   body-locked regions.

The IWSDK adapter is the reference implementation; the XR Blocks adapter
shows the same contract bound without an ECS.

## Testing

```bash
npm test   # from the workspace root - vitest, 100% thresholds on src/core
```

## License

MIT © Reality Collective
