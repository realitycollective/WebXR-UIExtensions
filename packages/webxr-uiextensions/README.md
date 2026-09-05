# @realitycollective/webxr-uiextensions

The core of the Reality Collective UI Extensions. It provides:

- **Windows** - movable, resizable panels with a title bar and pin, dock, minimise and close buttons.
- **Docking** - snapping a window into a named region of the scene, such as a row along a wall.
- **Layout regions** - the named areas that windows snap into.
- **Drag maths** - the pure calculations behind dragging, dropping and following the user.
- **Controls** - the state behind steppers, toggles, expandable sections and log views.
- **Markup upgrading** - code that turns a plain element carrying a `data-uix` attribute into a working control, so you write markup rather than components.
- **Adapter interfaces** - what an engine package must implement to host all of the above.

**This package imports no 3D engine.** A test, `test/architecture.test.ts`, fails the moment `three`, `@iwsdk/*`, `@pmndrs/*` or `xrblocks` appears anywhere in `src/`. That is what lets the same interface run unchanged on every three.js WebXR runtime.

It carries exactly one runtime dependency, [`@realitycollective/webxr-input`](https://www.npmjs.com/package/@realitycollective/webxr-input), and the same test fails on any other. That package is the shared contracts vocabulary: plain tuples and records, no engine imports and no dependencies of its own. `Vec3Tuple`, `QuatTuple`, `HeadPose`, `HeadPoseSource` and `PointerSample` come from there rather than being redeclared here, so a pose or a ray means the same thing to the Interactions family and to this one, and one input stack drives both. All five are re-exported from this package, so importing them from here keeps working.

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
                WindowHost, WindowHandle, WindowOptionsBase, HeadPoseSource,
                PointerInputSource (plain tuples, no engine)
src/contract-cases.ts
                windowHostContractCases() - the WindowHost conformance suite
                as data, for an adapter to run in its own test runner
```

## Writing an adapter

An adapter supplies three capabilities and drives the core from its frame loop:

1. **Panels** - implement `PanelHost.createPanel(configJson)`: turn compiled UIKitML JSON into a live panel whose element tree satisfies `UixElement` (uikit does out of the box; ids land in `userData`).
2. **Input** - deliver press/move/release into the core's `HoldToDrag` + drag math, or wire chrome clicks straight to `WindowManager`.
3. **Viewer pose** - implement `HeadPoseSource` for follow mode and body-locked regions.

The IWSDK adapter is the reference implementation; the XR Blocks adapter shows the same contract bound without an ECS. When yours runs, prove it with the shipped conformance suite below.

### The window surface

`WindowHost` is what app code writes against once panels exist. Four members carry the whole contract, and both shipped adapters honour all four:

- `supportsStandalonePanels: boolean` - whether `createPanel` works here. IWSDK reports `false` because the ECS owns panel lifecycles and `createPanel` throws; the three.js host reports `true`. Check it rather than guessing, and spawn a window when it is `false`.
- `onPanelReady(listener)` - fires as each panel becomes wireable and replays the ones already live, so wiring order never matters. The event's `kind` says what became ready: `window` for one created through the window factory, `panel` for a bare panel the adapter noticed. A bare panel's `id` is the adapter's best stable identifier for it, which on IWSDK is the config path. Only a host that discovers panels the app created outside the window factory ever reports `panel`; the three.js and XR Blocks host reports `window` only, because a standalone `createPanel` document is handed back to the caller and never announced.
- `createWindow(options)` - adapter-specific, because the `config` payload differs per engine, but it always returns a `WindowHandle`.
- `WindowHandle` - `id`, `panel` (`undefined` until the document is attached) and `onReady(listener)`, which runs once and fires immediately if the panel is already there. It is the per-window form of `onPanelReady`, for when you hold a handle and want only that window.
- Getting the panel later, when you did not keep the handle - on IWSDK call `getPanelHandle(entity)` with the window's entity; on the three.js and XR Blocks host call `host.window(id)?.panel`. Both return the same `PanelHandle`.

Options are shared even though `createWindow` is not: every adapter's option type extends `WindowOptionsBase` (`id`, `title`, `dockMode`, `position`, `maxWidth`/`maxHeight`, `movable`, `closable`, `minimizable`, `pinnable`, `followOffset`/`followSpeed`/`followTolerance`, `region`). An option means the same thing everywhere, so one `SceneWindow` maps onto every adapter with no translation table.

### Proving a new adapter conforms

`windowHostContractCases()` is the `WindowHost` conformance suite, shipped as data rather than as tests. Each case is a `name` plus a `run(setup)` that returns silently on success and throws an `Error` describing the failure otherwise, so an adapter runs them in whatever test runner it already has. It ships runner-free because an adapter written outside this repository cannot reach into this one's `test/` folder, and because no adapter should have to install this repo's runner to prove itself.

An adapter's test file is a loop:

```ts
import { windowHostContractCases } from '@realitycollective/webxr-uiextensions';
import type { WindowHostContractSetup } from '@realitycollective/webxr-uiextensions';

function makeSetup(): WindowHostContractSetup {
  const host = createMyHost();
  return {
    host,
    createWindow: (id) => host.createWindow({ id, config: myConfig() }),
    // Only where the panel arrives after the window does:
    attach: (id) => deliverThePanelFor(id),
    // Only where supportsStandalonePanels is true:
    panelConfig: myConfig(),
  };
}

for (const contractCase of windowHostContractCases()) {
  it(contractCase.name, () => contractCase.run(makeSetup()));
}
```

`makeSetup()` runs once per case, because the cases spawn windows of their own and do not clean up after themselves. `attach` and `panelConfig` are both optional: leave `attach` out when a window's panel exists as soon as the window does, and `panelConfig` out when the host reports `supportsStandalonePanels: false`. Both shipped adapters run this suite, so a case failing on yours is a real difference in behaviour, not a difference in test style.

## Testing

```bash
npm test   # from the workspace root - vitest, 100% thresholds on src/core
```

## Live demos

- Showcase: **[webxr-uiextensions.pages.dev](https://webxr-uiextensions.pages.dev)**
- Multiplatform lab: **[webxr-uix-lab.pages.dev](https://webxr-uix-lab.pages.dev)**

## License

MIT © Reality Collective
