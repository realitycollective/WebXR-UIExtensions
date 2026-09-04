# WebXR UI Extensions

A library for building user interfaces inside a WebXR scene. It gives you movable, resizable windows that can be dragged, snapped into fixed regions of the scene, and filled with buttons, sliders and other controls.

The core logic is plain TypeScript with no dependency on any 3D engine. Small adapters connect it to [Meta's Immersive Web SDK](https://iwsdk.dev), to [Google XR Blocks](https://github.com/google/xr-blocks), or to plain three.js. The repository also holds developer tooling and demo clients you can deploy.

Panels are written in **UIKitML**, IWSDK's HTML/CSS-like markup for spatial panels.

Built to the Reality Collective [service-framework](https://github.com/realitycollective/com.realitycollective.service-framework.ts) package conventions.

```bash
git clone https://github.com/realitycollective/WebXR-UIExtensions.git
cd WebXR-UIExtensions
npm ci
```

The repository root **is** the npm workspace root - `packages/*` are the publishable libraries, `demos/*` the clients. Work branches off `main` and PRs target `main`.

## Layout - one folder per package, one demo client each

```text
WebXR-UIExtensions/
├── packages/
│   ├── webxr-uiextensions/     @realitycollective/webxr-uiextensions - the core
│   │   ├── src/core/           window/dock/region/drag logic + control models
│   │   │                       (pure, no engine imports, 100% coverage gated)
│   │   ├── src/controls/       data-uix markup upgraders (UixElement interface)
│   │   ├── src/chrome/         window chrome conventions (contractual ids)
│   │   ├── src/adapter.ts      what an engine adapter must implement (PanelHost, HeadPose…)
│   │   ├── src/scene.ts        SceneDescriptor - the portable scene format
│   │   └── test/               the coverage-gated suites
│   ├── iwsdk-uiextensions/     Meta IWSDK adapter (reference implementation)
│   │   ├── src/systems/        ECS systems binding the core to @iwsdk/core
│   │   ├── src/factory.ts …    factory, components, manager/region registries
│   │   └── Examples/           basic-window, controls, dock-regions
│   │                           (shipped in the npm tarball)
│   ├── xrblocks-uiextensions/  Google XR Blocks / three.js adapter (EXPERIMENTAL)
│   │   └── src/                panel document, window host, follow + scale math,
│   │                           desktop controls/locomotion, pointer forwarding
│   └── uix-devtools/           dev tooling (dev-only, NEVER ship)
│       ├── src/gate.ts         edit-session launch gate (compiled out of prod)
│       ├── src/runtime-compile.ts  live UIKitML → panel compilation
│       └── src/cli/            the `uix-dev` CLI (quick tunnel, QR, doctor)
├── demos/
│   ├── showcase/               the feature tour, on whichever runtime fits
│   │   ├── ui/*.uikitml        the five windows, authored in UIKitML
│   │   ├── src/playground-scene.ts      THE playground, as portable data
│   │   ├── src/playground-behaviour.ts  its demo logic, engine-free
│   │   ├── src/platform-detect.ts       UA → runtime, shared with the lab
│   │   ├── src/world.ts        IWSDK bootstrap + stage dressing (Horizon OS)
│   │   └── src/desktop-world.ts plain three.js bootstrap (everywhere else)
│   ├── devtools-playground/    demo for uix-devtools - reuses the showcase
│   │                           world, adds the edit gate + live UX editor
│   └── webxr-multiplatform/    "the lab" - the single encompassing demo:
│       └── src/pipelines/      iwsdk / xrblocks / desktop, offered on a launch
│                               screen (same detection + ?uix-engine override);
│                               the iwsdk and desktop pipelines wrap the
│                               showcase's own bootstraps rather than copying
│                               them; edit gate on IWSDK; own Pages projects
├── scripts/verify-pack.mjs     consumer check - packs, installs, imports
├── docs/developer-cycle.md     the four development loops, terminal to deploy
├── CHANGELOG.md                shared across all four packages
├── .github/workflows/          CI, Cloudflare Pages deploy, GitHub publish
├── vitest.config.ts            workspace test run + coverage gates
└── tsconfig.base.json          shared strict compiler options
```

Every package ships a demo, and all three demos build the same playground scene. The scene is a portable `SceneDescriptor` and its behaviour is wired through the `onPanelReady` contract, neither of which depends on an engine. Because of that, the IWSDK, XR Blocks and plain three.js versions behave identically from identical data.

Each adapter re-exports the whole core, so an app installs one package:

| Install | For |
| --- | --- |
| `@realitycollective/iwsdk-uiextensions` | Meta IWSDK apps (core re-exported) |
| `@realitycollective/xrblocks-uiextensions` | XR Blocks / three.js apps (core re-exported, experimental) |
| `@realitycollective/webxr-uiextensions` | writing your own engine adapter |
| `@realitycollective/uix-devtools` | dev dependency only - never in a shipped bundle |

Working **in** this repo needs none of the above: `npm ci` is the whole setup, and the demos, tests and typecheck all resolve `@realitycollective/*` to `packages/<name>/src` rather than to anything installed. That stays true after the packages are published - see [How the demos resolve the libraries](./docs/developer-cycle.md#how-the-demos-resolve-the-libraries-and-what-changes-once-published)

for the contributor-vs-consumer split and how to test the published path.

## Commands (workspace root)

| Command | What |
| --- | --- |
| `npm ci` | install everything |
| `npm run build` | build all four packages (`tsc` → `dist/`, core first) |
| `npm run typecheck` | strict typecheck - all packages + all demos |
| `npm test` | vitest + v8 coverage (100% thresholds on the pure modules) |
| `npm run test:watch` | the same suites in watch mode |
| `npm run verify:pack` | consumer check: pack, install into a temp project, import |
| `npm run dev:showcase` | run the IWSDK showcase locally |
| `npm run dev:playground` | run the devtools playground locally (edit gate open in dev) |
| `npm run dev:multiplatform` | run the engine-picking demo (`?uix-engine=` to force) |
| `npm run dev:live` | **one-command headset loop**: playground + Cloudflare quick tunnel + QR codes |
| `npm run build:demos` | static bundles for all three demos (compiles UIKitML too) |
| `npm run build:showcase` / `build:playground` | one demo bundle at a time (what deploy uses) |
| `npx uix-dev doctor` | check node / cloudflared / adb before first use |

New here? Read **[docs/developer-cycle.md](./docs/developer-cycle.md)** - the full developer cycle: desktop preview, testing on a Quest (USB and tunnel), live edit sessions, deployment and publishing. Released changes are tracked in **[CHANGELOG.md](./CHANGELOG.md)** - all four packages version together.

## Live demos

Deployed from `main` by the **Deploy** workflow. Pull requests deploy to the isolated `-test` projects instead, so a PR can never touch these.

| Demo | Production | Staging (per PR) |
| --- | --- | --- |
| Showcase | [`webxr-uiextensions.pages.dev`](https://webxr-uiextensions.pages.dev) | `webxr-uiextensions-test.pages.dev` |
| Multiplatform lab | [`webxr-uix-lab.pages.dev`](https://webxr-uix-lab.pages.dev) | `webxr-uix-lab-test.pages.dev` |

Open either on a headset - each production deploy also prints a short code and a QR code to the workflow's step summary. Both demos pick their runtime from the hardware, through the same detection (`demos/showcase/src/platform-detect.ts`): Quest → IWSDK, Android XR → XR Blocks, anything else → plain three.js. The lab offers all three on a launch screen; the showcase ships two of them and boots the choice directly, because IWSDK takes the view pose from the headset and has no desktop camera. Force either with `?uix-engine=iwsdk`, `?uix-engine=xrblocks` or `?uix-engine=desktop`.

## Automation (`.github/workflows/`)

Two workflows ship in every Reality Collective TypeScript repository, with the same names everywhere. `ci.yml` both gates and deploys: the build job runs once and the deploy jobs consume its artifacts, so nothing is built or tested twice.

| Workflow | Trigger | Does |
| --- | --- | --- |
| `ci.yml` | every PR + push to `main` / `development` | Build, typecheck, test with coverage gates, `verify:pack`, and all three demo builds. On a PR it then deploys to the `-test` Pages projects; on a push to `main`, to production, with short codes and QR codes in the step summary. The deploy steps skip when the Cloudflare secrets are absent, leaving a pure build gate |
| `publish-npm.yml` | manual dispatch | packs all four packages and publishes to **npmjs.com** with provenance - `preview` dist-tag from `development`, `latest` from `main`. **Defaults to a dry run** |

A PR can never touch production - staging lives in its own isolated Pages projects.

## The showcase scene

Five windows + two dock regions demonstrating the whole surface:

- **Crew Registration** - native UIKitML `<input>`/`<textarea>` (system keyboard), horizon-kit `Slider`, submit validation
- **Event Log** - `data-uix="log-view"` fed by live `WindowManager` events; spawns docked into the world-locked "console wall" region
- **Click Machine** - a button with a "clicked" list display
- **Player Status** - movable info window: health stepper, shield toggle, expandable bio; follows the player until pinned or dragged
- **Gallery** - image rendering via the native `<img>` element
- Regions: a world-locked wall (column) and a body-locked belt (row) - drag any window into either

The devtools playground adds the **UX Editor** window on top: UIKitML source in a textarea, compiled at runtime to a live panel - see [demos/devtools-playground](./demos/devtools-playground/README.md). The multiplatform lab runs the same scene through whichever pipeline the hardware calls for - see [demos/webxr-multiplatform](./demos/webxr-multiplatform/README.md).

Known verification gap: everything headless is CI-tested, but in-headset behaviours (title-bar `HandleStore` drag, system keyboard on Quest) still need a manual pass on device - see the PR/commit notes.

## What this stack is and is not

The Reality Collective WebXR packages aim at one outcome: an app's logic, input handling, interactions and UI should not care which engine hosts them. Each family ships an engine-free core and thin adapters for Meta IWSDK, plain three.js and WebXR, and Google XR Blocks. When an app still has to reach into the host, either a contract is missing, which is a bug to report, or the app is overreaching.

Portable world-building is not a current promise. Scene content (meshes, prefabs, placement) is built by the app, ideally behind a factory interface the app owns, so that a second host can implement the same factories. A shared content descriptor, following the shape of the UI family's `SceneDescriptor`, will be considered only when a second host is actually targeted. Meta's `iwsdk.scene.v1` format is an acceptable authoring interchange in the meantime.

Position recorded on 2026-09-03 from the Pale Signal client's gaps report.
