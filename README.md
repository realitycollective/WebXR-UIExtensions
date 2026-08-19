# WebXR UI Extensions

A windowing / docking / layout / controls library for **WebXR spatial UI** —
an engine-free core plus adapters for
[Meta's Immersive Web SDK](https://iwsdk.dev) and
[Google XR Blocks](https://github.com/google/xr-blocks) / plain three.js,
developer tooling, and deployable demo clients. Built to the Reality Collective
[service-framework](https://github.com/realitycollective/com.realitycollective.service-framework.ts)
package conventions.

```bash
git clone https://github.com/realitycollective/WebXR-UIExtensions.git
cd WebXR-UIExtensions
npm ci
```

The repository root **is** the npm workspace root — `packages/*` are the
publishable libraries, `demos/*` the clients. Work branches off `main` and PRs
target `main`.

## Layout — one folder per package, one demo client each

```
WebXR-UIExtensions/
├── packages/
│   ├── webxr-uiextensions/     @realitycollective/webxr-uiextensions — THE CORE
│   │   ├── src/core/           window/dock/region/drag logic + control models
│   │   │                       (pure, no engine imports, 100% coverage gated)
│   │   ├── src/controls/       data-uix markup upgraders (UixElement interface)
│   │   ├── src/chrome/         window chrome conventions (contractual ids)
│   │   ├── src/adapter.ts      platform-adapter contract (PanelHost, HeadPose…)
│   │   ├── src/scene.ts        SceneDescriptor — the portable scene format
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
│   ├── showcase/               demo for the IWSDK adapter (full feature tour)
│   │   ├── ui/*.uikitml        the five windows, authored in UIKitML
│   │   ├── src/playground-scene.ts      THE playground, as portable data
│   │   ├── src/playground-behaviour.ts  its demo logic, engine-free
│   │   └── src/world.ts        IWSDK bootstrap + stage dressing
│   ├── devtools-playground/    demo for uix-devtools — reuses the showcase
│   │                           world, adds the edit gate + live UX editor
│   └── webxr-multiplatform/    "the lab" — the single encompassing demo:
│       └── src/pipelines/      iwsdk / xrblocks / desktop, picked by hardware
│                               (UA detection + ?uix-engine override); edit gate
│                               on the IWSDK pipeline; own Pages projects
├── scripts/verify-pack.mjs     consumer check — packs, installs, imports
├── docs/developer-cycle.md     the four development loops, terminal to deploy
├── CHANGELOG.md                shared across all four packages
├── .github/workflows/          CI, Cloudflare Pages deploy, GitHub publish
├── vitest.config.ts            workspace test run + coverage gates
└── tsconfig.base.json          shared strict compiler options
```

Every package has a demo client, and all three demos build the **same
playground** — the scene is a portable `SceneDescriptor` and its behaviour is
wired through the engine-free `onPanelReady` contract, so the IWSDK, XR Blocks
and plain-three.js pipelines run identical UX from identical data. Each adapter
re-exports the core wholesale, so apps depend on exactly one package:

| Install | For |
| --- | --- |
| `@realitycollective/iwsdk-uiextensions` | Meta IWSDK apps (core re-exported) |
| `@realitycollective/xrblocks-uiextensions` | XR Blocks / three.js apps (core re-exported, experimental) |
| `@realitycollective/webxr-uiextensions` | writing your own engine adapter |
| `@realitycollective/uix-devtools` | dev dependency only — never in a shipped bundle |

Working **in** this repo needs none of the above: `npm ci` is the whole
setup, and the demos, tests and typecheck all resolve `@realitycollective/*`
to `packages/<name>/src` rather than to anything installed. That stays true
after the packages are published — see [How the demos resolve the
libraries](./docs/developer-cycle.md#how-the-demos-resolve-the-libraries-and-what-changes-once-published)
for the contributor-vs-consumer split and how to test the published path.

## Commands (workspace root)

| Command | What |
| --- | --- |
| `npm ci` | install everything |
| `npm run build` | build all four packages (`tsc` → `dist/`, core first) |
| `npm run typecheck` | strict typecheck — all packages + all demos |
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

New here? Read **[docs/developer-cycle.md](./docs/developer-cycle.md)** — the
full developer cycle: desktop preview, testing on a Quest (USB and tunnel),
live edit sessions, deployment and publishing. Released changes are tracked
in **[CHANGELOG.md](./CHANGELOG.md)** — all four packages version together.

## Automation (`.github/workflows/`)

| Workflow | Trigger | Does |
| --- | --- | --- |
| `webxr-uiextensions-ci.yml` | PR / push on `main` | build + typecheck + test + demo builds, dists uploaded as artifacts |
| `webxr-uiextensions-deploy.yml` | PR → staging, push to `main` → production | Cloudflare Pages deploys: showcase (`webxr-uiextensions` / `-test`) **and** the multiplatform lab (`webxr-uix-lab` / `-test`); step summaries with short codes + QR |
| `webxr-uiextensions-publish.yml` | manual dispatch | packs ALL FOUR packages; publishes to **GitHub Packages** + attaches tarballs to a **GitHub Release** (npmjs.com deliberately off for now; defaults to dry run) |

A PR can never touch production — staging lives in its own isolated Pages
projects.

## The showcase scene

Five windows + two dock regions demonstrating the whole surface:

- **Crew Registration** — native UIKitML `<input>`/`<textarea>` (system
  keyboard), horizon-kit `Slider`, submit validation
- **Event Log** — `data-uix="log-view"` fed by live `WindowManager` events;
  spawns docked into the world-locked "console wall" region
- **Click Machine** — a button with a "clicked" list display
- **Player Status** — movable info window: health stepper, shield toggle,
  expandable bio; follows the player until pinned or dragged
- **Gallery** — image rendering via the native `<img>` element
- Regions: a world-locked wall (column) and a body-locked belt (row) —
  drag any window into either

The devtools playground adds the **UX Editor** window on top: UIKitML source
in a textarea, compiled at runtime to a live panel — see
[demos/devtools-playground](./demos/devtools-playground/README.md). The
multiplatform lab runs the same scene through whichever pipeline the hardware
calls for — see [demos/webxr-multiplatform](./demos/webxr-multiplatform/README.md).

Known verification gap: everything headless is CI-tested, but in-headset
behaviours (title-bar `HandleStore` drag, system keyboard on Quest) still
need a manual pass on device — see the PR/commit notes.
