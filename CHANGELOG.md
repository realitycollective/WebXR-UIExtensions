# Changelog

Change log for the Reality Collective WebXR UI Extensions packages. All four packages are versioned and released together; the version below is the one carried by the `v<version>` release tag.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Preview builds are not listed separately. The entry for a version accumulates while its previews are published, and is dated when that version is released.

## [0.1.0]

### Added

- `@realitycollective/webxr-uiextensions` - engine-free core: window manager, dock state and regions, drag maths, hold-to-drag, control models (stepper/toggle/expandable/log), the `SceneDescriptor` scene format, window chrome conventions and the platform-adapter contract.
- `@realitycollective/iwsdk-uiextensions` - Meta IWSDK adapter binding the core onto IWSDK's ECS, UIKitML and interaction systems, with shipped examples.
- `@realitycollective/xrblocks-uiextensions` - EXPERIMENTAL Google XR Blocks / plain three.js adapter: panel document, window host, follow and scale maths, desktop controls and locomotion, pointer forwarding.
- `@realitycollective/uix-devtools` - dev-only tooling: edit-session launch gate, runtime UIKitML compilation, and the `uix-dev` CLI (Cloudflare quick tunnel, QR onboarding, environment doctor).
- Demo clients: the IWSDK showcase, the devtools playground, and the multiplatform lab that picks its pipeline from the hardware.
- `uixComponentSet`, exported from `@realitycollective/iwsdk-uiextensions`. Pass it to `spatialUI.componentSets` so the IWSDK 0.5 parser accepts the `<uix-*>` control elements. Without it a panel using any control fails to parse and never attaches. No equivalent is needed on the three.js or XR Blocks adapters.

### Changed

- **Controls are declared as custom elements rather than attributes.** `<uix-stepper>` replaces `<div data-uix="stepper">`, and each part is its own element: `<uix-value>`, `<uix-line>`, `<uix-label>` and so on, replacing `data-uix-role`. Parameters are unchanged and stay `data-uix-*`. This is what makes one markup file portable: IWSDK 0.5 parses with `@drawcall/uikitml`, which rejects every `data-*` attribute on a built-in tag but accepts custom tags declared in a component set, while the three.js and XR Blocks parser accepts custom tags with no registration at all. Both expose the declared tag on `userData.customElement.componentName`, so the engine-free upgraders read one contract on every adapter.
- The expandable label's `toggle` part is now `<uix-more>`. As an element the old name would have collided with the `<uix-toggle>` control.
- `@realitycollective/iwsdk-uiextensions` targets **IWSDK 0.5.x**: peer range `>=0.5.0 <0.6.0`, developed against `@iwsdk/core` 0.5.3. `PanelUI` in 0.5 declares a single field, `config`, holding the URL of the UIKitML **source**; the compiled JSON it took on 0.4.x, and the `@iwsdk/vite-plugin-uikitml` step that produced it, are both gone. `maxWidth` and `maxHeight` were removed from the component schema, and ECS ignores unknown fields silently, so a panel that still writes them is mis-sized with no error. Size through `createUIWindow`, which routes to `UIWindow.targetWidth/Height`.
- `UixWindowHost` resolves a window's `config` by fetching the `.uikitml` source and parsing it, where it previously fetched compiled JSON. Supplying `loadConfig` is no longer necessary for an ordinary panel; override it only for an unusual transport.
- `compilePanelSource` in `@realitycollective/uix-devtools` serves the **source** on its `blob:` URL rather than compiled JSON, matching what 0.5 fetches. `CompiledPanel.json` is now `CompiledPanel.source`, and the `resolveFile` option is gone because the 0.5 parser has no `<link ref>` stylesheet resolution; put shared rules in a `<style>` block, of which several are allowed and merge. Validation now runs on `@drawcall/uikitml`, pinned to the version `@iwsdk/core` depends on, so a source that passes here is one `PanelUISystem` will accept and no second parser enters the tree.
- Example and demo markup uses `rgba()` or eight-digit hex rather than `background-opacity`, which the 0.5 parser removed. Both parsers accept the replacement, so one stylesheet serves every adapter.
- The IWSDK component kit is selected by name, `spatialUI: { kit: 'horizon' }`, rather than by passing an imported kit module. The kits now live inside the parser.
- `@types/three` is pinned to `0.184.0` across the workspace. IWSDK 0.5.3 and xrblocks resolved different copies, and two copies of the three typings make structurally identical `Object3D` types mutually unassignable, which surfaces as spurious errors far from their cause.

[0.1.0]: https://github.com/realitycollective/WebXR-UIExtensions/commits/main
