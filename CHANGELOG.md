# Changelog

Change log for the Reality Collective WebXR UI Extensions packages. All four
packages are versioned and released together; the version below is the one
carried by the `uix-v<version>` release tag.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-08-18

Initial release, published from the standalone `WebXR-UIExtensions` repository.

### Added

- `@realitycollective/webxr-uiextensions` — engine-free core: window manager,
  dock state and regions, drag maths, hold-to-drag, control models
  (stepper/toggle/expandable/log), the `SceneDescriptor` scene format, window
  chrome conventions and the platform-adapter contract.
- `@realitycollective/iwsdk-uiextensions` — Meta IWSDK adapter binding the core
  onto IWSDK's ECS, UIKitML and interaction systems, with shipped examples.
- `@realitycollective/xrblocks-uiextensions` — EXPERIMENTAL Google XR Blocks /
  plain three.js adapter: panel document, window host, follow and scale maths,
  desktop controls and locomotion, pointer forwarding.
- `@realitycollective/uix-devtools` — dev-only tooling: edit-session launch
  gate, runtime UIKitML compilation, and the `uix-dev` CLI (Cloudflare quick
  tunnel, QR onboarding, environment doctor).
- Demo clients: the IWSDK showcase, the devtools playground, and the
  multiplatform lab that picks its pipeline from the hardware.

[Unreleased]: https://github.com/realitycollective/WebXR-UIExtensions/compare/uix-v0.1.0...HEAD
[0.1.0]: https://github.com/realitycollective/WebXR-UIExtensions/releases/tag/uix-v0.1.0
