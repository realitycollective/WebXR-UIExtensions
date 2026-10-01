# Native test harness (UI Extensions)

A native app built from this repository's own source that runs the UI Extensions family's suites against a real native host on the device, and plays the showcase scene there through `NativeWindowHost`. It exists so a defect in a native host, or in the native binding, is found here before a client project runs into it.

The harness is a project for the WebXR-to-native conversion pipeline (the Reality Collective's `WebXR-Native-Pipeline` repository): `app.json` describes it, `entry.ts` is its native entry, `ui/` holds its panels. The pipeline bundles the entry to Hermes bytecode through its gates (no three.js, `@iwsdk` or `@pmndrs` code in the bundle, only the host-profile globals), cooks each panel in `ui/` to `assets/ui/<name>.json`, packs the showcase image, generates the Android project and builds the APK. Nothing in the pipeline names this project; it is handed this folder.

The harness is UI only: it has windows and no interactables, so the window host runs with its own pointer arbiter and presents the pointers itself. The host is told each hand's ray and cursor through the `input` slice's `applyPointerVisuals`, as the Interactions binding tells it in an app that has both.

## Modes

The shell launches the app with `debug.rc.mode` set (`adb shell setprop debug.rc.mode kits`); a runner under Node sets `__rcShell.mode` before it loads the bundle.

| Mode | What runs | Where the result goes |
| --- | --- | --- |
| `kits` | `nativeUiHostConformanceCases`, `windowHostContractCases`, `sceneTargetContractCases` and `uixElementContractCases`, against `__rcShell.testHost` on a device or the reference fakes under Node | one JSON line per suite (`step: "suite"`), then `step: "done"` with `pass` and every failure named |
| `play` | the showcase scene (`demos/showcase/src/playground-scene.ts` and `playground-behaviour.ts`, the same descriptor and behaviour the web showcase runs) over the live `__rcHost`, driven from `__rcTick`; a person plays it | one `event` line per `WindowManager` event and per control event (click, stepper, toggle, expandable label, text), and a `status` line once a second with the windows open, the focused window and whether the hand menu is shown |

`kits` is the default with no native host, `play` the default on a device.

## Building

CI compiles the harness and never runs it: a native build runs only on a developer's machine or a headset.

```
npm run harness:ui
npm run harness:compile
```

`harness:ui` fills `ui/` from the showcase's panels (`demos/showcase/public/ui/*.uikitml`, copied unchanged) and from the core's `WINDOW_CHROME_SNIPPET`, which becomes `rc-kit-chrome.uikitml`, the window the host kit opens. Run it after either source changes and keep its output in the folder.

`harness:compile` typechecks the harness, bundles `entry.ts` with esbuild (no browser, no engine, the host-profile gate) to `build/node/harness.js`, and compiles the bundle to Hermes bytecode with the flags the pipeline uses, so a bundle the device's engine would refuse fails the build. `--require-hermes` fails when `hermes-compiler` is missing instead of skipping that step; CI passes it.

With no `__rcHost` installed, the bundle uses this repository's reference fakes (`src/fakes.ts`), the same fake `ui` slice the package's own suites prove the kit against, so a local runner can load it in Node and drive `__rcTick` to prove the kits pass on the fakes.

For a device, the conversion pipeline builds the APK from `app.json` (`rc check`, `rc assets`, `rc build --target quest`). The pipeline takes each Reality Collective package from this repository's `node_modules` first, so the harness is built from this working tree once `npm run build` has run, and the rest from its own install. To build against other families' working trees as well, name their `packages/` folders in `RC_PACKAGES`. Nothing is copied over an install.

## What the shell must provide

The root contract (`__rcHost.onFrame`, `__rcTick`) and the `ui` and `input` slices of `@realitycollective/native-uiextensions` (`native-types.ts`). Panel configs are given as `/ui/<name>.uikitml`, the path of a file in `ui/`; the shell resolves each to its cooked panel. The showcase's descriptor names its panels `./ui/<name>.uikitml`, and `play` rewrites the leading `./` to `/`.

For `kits`, `__rcShell.testHost` with a `ui` slice that draws nothing, `input`, `readbacks.ui` implementing `NativeUiTestHost` (`windowPose`, `windowHidden`, `elementProperties`, `measureTouch`, and for the hover, scroll and keyboard cases `elementHovered`, `elementHandle`, `scrollPosition`, `keyboardShown`), and `pumpUi()`, which lets the host finish panels and report them. It is called on every settle turn.

The element suite (`uixElementContractCases`) needs to read what the host draws for an element and to fire an event at it, which the readbacks do not cover. It runs when the test host also carries `uiDriver`: `contractConfig` (a panel cooked from `CONTRACT_PANEL_MARKUP`), `rendered(panelId, elementHandle, property)` and `fire(panelId, elementHandle, type)`. Without it the suite is reported as skipped, with the reason, and does not fail the run. Under Node it runs against the fakes.

## Output

Everything the compile and the pipeline write goes under `build/`, which is ignored. Device logs and results are kept outside this repository.
