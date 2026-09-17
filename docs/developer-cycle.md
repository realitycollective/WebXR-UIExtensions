# The developer cycle

How to build, preview, live-edit and ship the UI Extensions - from a cold checkout to panels updating live inside a headset.

## The package map

| Package | Role |
| --- | --- |
| `@realitycollective/webxr-uiextensions` | engine-free core: all UX logic + adapter interfaces |
| `@realitycollective/iwsdk-uiextensions` | Meta IWSDK adapter (reference, full feature set) |
| `@realitycollective/xrblocks-uiextensions` | Google XR Blocks / three.js adapter (experimental) |
| `@realitycollective/uix-devtools` | dev-only tooling: edit gate, runtime compiler, `uix-dev` CLI |

Adapters re-export the core, so apps depend on exactly one package. The demos pair up 1:1 - `demos/showcase` (IWSDK adapter), `demos/devtools-playground` (devtools), `demos/webxr-multiplatform` (core: ships both adapters, detects the hardware and boots the matching pipeline - `?uix-engine=iwsdk|xrblocks` overrides).

There are four loops, fastest first. Use the fastest loop that answers your question; only fall down the list when you genuinely need the device or the deployed environment.

| Loop | Where it runs | Latency per change | What it can't tell you |
| --- | --- | --- | --- |
| [1. Headless](#loop-1-headless-tests) | terminal (vitest) | seconds | anything visual |
| [2. Desktop](#loop-2-desktop-preview) | desktop browser | seconds (HMR) | controller/hand feel, follow comfort |
| [3. Headset live](#loop-3-headset-via-cloudflare-quick-tunnel) | Quest via tunnel or USB | seconds (HMR) | nothing - this is the real thing |
| [4. Deployed](#loop-4-staging--production-deploys) | Cloudflare Pages | minutes | - (use for sign-off / sharing) |

## First-time setup

```bash
cd WebXR-UIExtensions
npm ci
npx uix-dev doctor       # checks node, cloudflared, adb - with install hints
```

`cloudflared` is only needed for loop 3's tunnel path ([install docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) - `brew install cloudflared` / `winget install Cloudflare.cloudflared`), and `adb` only for the USB alternative. Everything else works without them.

That is the whole setup - **the packages do not need to be published, and you never install them from a registry to work here.** Everything resolves to the source in `packages/`; see [How the demos resolve the libraries](#how-the-demos-resolve-the-libraries-and-what-changes-once-published) for why, and for what a *consumer* of the published packages gets instead.

## How the demos resolve the libraries (and what changes once published)

**Nothing in this repo installs `@realitycollective/*` from a registry.** The demos, the tests and the typecheck all resolve those specifiers to `packages/<name>/src` - the demos through Vite `resolve.alias`, vitest through its own aliases, `tsc` through `paths` in `tsconfig.base.json`. The workspace entries in each demo's `package.json` (`"@realitycollective/...": "*"`) are satisfied by npm workspace links, never by a download.

Two consequences worth internalising:

- **You can run everything today, unpublished and offline-ish.** `npm ci` then `npm run dev:showcase` works with no registry access to our packages, no auth token, and no `npm run build` - the demos read TypeScript source directly, which is also why a library edit hot-reloads straight into the running demo.
- **The demos never test the published package.** They bypass `dist`, the `exports` map, the `files` allow-list and the dependency ranges entirely. A package can pass the full CI gate and still be unusable once installed.

That second point is what `npm run verify:pack` exists for.

### The two developer modes

| | Contributor mode (today, and after publishing) | Consumer mode |
| --- | --- | --- |
| Who | anyone working *in* this repo | an app depending *on* these packages |
| Resolves to | `packages/<name>/src` via aliases | the installed `dist` |
| Needs a registry | no | yes (npmjs.com, the `@realitycollective` scope) |
| Needs `npm run build` | no | n/a - consumes the published build |
| Exercised by | `npm test`, `npm run dev:*`, `npm run build:demos` | `npm run verify:pack` |

**Publishing does not change contributor mode.** The aliases keep pointing at source, so after the packages go live the demos still run from the working tree. This is deliberate: a contributor should always be testing the code in front of them, not whatever version happens to be published. It also means a published package can silently drift from what the demos prove - hence the verification gate.

### Testing the consumer path

```bash
npm run verify:pack                 # build, pack, install into a temp project, import
npm run verify:pack -- --skip-build # reuse the current dist (what CI does)
```

It packs all four packages exactly as the publish workflow does, installs the tarballs into a throwaway project outside the repo, and asserts that every `main`/`types`/`exports` target exists, every declared `bin` has a file behind it, no sibling dependency is still pinned at `"*"`, LICENSE and CHANGELOG shipped, the core imports in plain node, and the `uix-dev` CLI launches. It runs in CI on every PR and again in the publish workflow before anything is pushed to a registry.

To try a real consumer install by hand once the packages are live, install from npmjs.com (`npm install @realitycollective/iwsdk-uiextensions`, or `@preview` for the development branch's latest preview) or install a Release tarball straight from its URL, which needs no registry config at all.

### If you ever need a demo to run against the published build

Not the normal path - reach for it only when reproducing a consumer bug that the source-linked demos do not show. Comment out the `@realitycollective/*` entries in that demo's `vite.config.ts` `resolve.alias` block and install the real packages into the demo workspace. Remember to put the aliases back: with them removed, the demo silently stops testing your working tree.

## Loop 1: headless tests

```bash
npm test            # vitest + coverage gates (100% on the pure modules)
npm run test:watch
```

All decision logic (window manager, dock state machine, drag math, region layout, control models, the devtools gate/compiler/CLI) is pure TypeScript and tested here - no headset, no browser. The `architecture.test.ts` gate also fails any PR that introduces an engine import into the engine-free layers (`core/`, `controls/`, `chrome/`), which is what keeps the library portable to other three.js WebXR runtimes later.

## Loop 2: desktop preview

```bash
npm run dev:showcase       # IWSDK showcase          → http://localhost:8081
npm run dev:playground     # devtools playground     → http://localhost:8081
npm run dev:multiplatform  # engine-picking demo     → http://localhost:8081
```

The multiplatform demo defaults to the IWSDK pipeline on desktop; append `?uix-engine=xrblocks` to boot the XR Blocks pipeline (its desktop simulator included) instead.

The scene is fully usable with the mouse (drag title bars, dock, pin). Edits hot-reload: `.uikitml` files are recompiled on save by the Vite plugin, TypeScript via normal HMR (module-level edits trigger a page reload).

In the playground, dev builds leave the edit gate **open** (no token minted), so append any token to try the live editor on desktop:

```
http://localhost:8081/?uix-edit=dev
```

The UX Editor window appears in-scene: edit the UIKitML source in its textarea and SPAWN/RESPAWN compile it at runtime into a real, draggable, dockable window. No build step involved.

## Loop 3: headset (via Cloudflare quick tunnel)

WebXR needs a secure origin, which normally makes local headset testing painful. Two ways around it - the tunnel is the primary path here:

### 3a. Quick tunnel - wireless, any network, one command

```bash
npm run dev:live
```

This runs `uix-dev tunnel --cwd demos/devtools-playground`, which:

1. mints a fresh edit-session token for this run,
2. starts the Vite dev server with the token + tunnel HMR settings exported,
3. opens a **Cloudflare quick tunnel** (`cloudflared tunnel --url ...`) - a free, ephemeral `https://<random>.trycloudflare.com` URL, no Cloudflare account or DNS setup needed,
4. prints **two QR codes**: the plain runtime URL, and the edit-mode URL with `?uix-edit=<token>` appended.

On the Quest: open the browser, scan the QR (camera or the browser's QR button), and you're in - real HTTPS, so WebXR works, and Vite HMR flows through the tunnel (wss on 443), so saving a file on the desktop updates the headset in about a second.

Notes:

- **The token dies with the run.** Ctrl+C kills the tunnel URL and the token; the next run mints new ones. Nobody can wander into an edit session, even if the URL leaks.
- A page reload (e.g. after a TS edit) drops you out of the immersive session - the scene re-offers Enter VR immediately (`offer: 'always'`), but it is one extra click. Markup-only iteration via the in-headset UX Editor window avoids reloads entirely.
- Quick-tunnel URLs change every run. If retyping/rescanning grates, a **named tunnel** on your own Cloudflare account gives a permanent hostname you can bookmark in the Quest browser - add its hostname to `server.allowedHosts` in the demo's `vite.config.ts` and run `cloudflared tunnel run <name>` instead. The rest of the flow is identical.
- The tunnel serves whatever demo you point `--cwd` at: `npx uix-dev tunnel --cwd demos/showcase` for the plain showcase.

### 3b. USB - `adb reverse`, zero certificates

With the Quest on USB (developer mode on):

```bash
npm run dev:playground          # or dev:showcase
adb reverse tcp:8081 tcp:8081
```

Open **`http://localhost:8081`** in the Quest browser. `localhost` is a secure context, so WebXR works over plain HTTP - no certificates, no tunnel, and HMR flows over the same forward. Pair with `chrome://inspect/#devices` on the desktop for the headset browser's console and a live 2D screencast.

## The edit gate - how dev mode stays out of players' hands

Three independent layers keep the tooling away from the runtime (see `packages/uix-devtools/README.md` for the API):

1. **Separate package.** The runtime library never imports `@realitycollective/uix-devtools`. Apps that don't install it can't ship it.
2. **Compiled out.** The demo guards the gate with `if (import.meta.env.DEV || import.meta.env.VITE_UIX_EDIT)` - production builds without the flag eliminate the branch, so the gate does not exist on the deployed site.
3. **Token + lazy chunk.** Where the gate is compiled in, it opens only for an exact token match (`?uix-edit=<token>`), and the editor overlay is a dynamic import - normal visitors never even download its chunk.

To enable edit sessions on a *staging* deploy, build with `VITE_UIX_EDIT=1 VITE_UIX_EDIT_TOKEN=<long-secret>` and share the token only with the team. Leave both unset for production.

## Loop 4: staging & production deploys

Handled by the deploy jobs in `.github/workflows/ci.yml`:

- **Open a PR** against `main` → showcase deploys to the isolated staging project (`webxr-uiextensions-test.pages.dev`); the run's step summary includes the URL + QR.
- **Merge/push** to `main` → production (`webxr-uiextensions.pages.dev`).

A PR can never touch production. Use deploys for sign-off and sharing, not for iteration - the tunnel loop is minutes-to-seconds faster.

## Publishing (npmjs.com + GitHub Releases)

`publish-npm.yml` (manual dispatch, **defaults to dry run**) publishes all four packages to npmjs.com under the `@realitycollective` scope, the same arrangement as `com.realitycollective.service-framework.ts` and the other WebXR repositories. Which dist-tag it publishes under depends on the branch you dispatch it from:

- **`development`** publishes every package under the `preview` dist-tag, then bumps the preview counter (`0.1.1-preview.0` to `0.1.1-preview.1`) and pushes the bump back so the next run cannot collide.
- **`main`** publishes every package under the `latest` dist-tag, creates the `v<version>` tag and GitHub Release with the tarballs attached, then merges `main` into `development` and re-seeds it at the next patch preview (`main` 0.1.0 leaves `development` at 0.1.1-preview.0).

Any other branch is rejected. A dry run builds, typechecks, tests, runs `verify:pack`, packs every package and uploads the tarballs as workflow artifacts, with nothing pushed to the registry, no tag, no release and no version bump; re-run with `dryRun=false` to release for real. Every publish carries `--provenance`. The four repositories publish in a fixed order, because this one depends on `@realitycollective/webxr-input`: WebXR-Input first, then WebXR-Interactions, then this repository, then WebXR-Environment.

Consumers need no registry configuration:

   ```bash
   npm install @realitycollective/iwsdk-uiextensions          # the stable release
   npm install @realitycollective/iwsdk-uiextensions@preview  # the newest development preview
   npm install --save-dev @realitycollective/uix-devtools
   ```

A Release tarball also installs directly from its URL, which is useful for pinning a build that was never tagged:

   ```bash
   npm install https://github.com/realitycollective/WebXR-UIExtensions/releases/download/v0.1.0/realitycollective-iwsdk-uiextensions-0.1.0.tgz
   ```

## Quick reference

```bash
npm test                                  # loop 1 - logic
npm run dev:playground                    # loop 2 - desktop + ?uix-edit=dev
npm run dev:live                          # loop 3 - headset, scan the QR
adb reverse tcp:8081 tcp:8081             # loop 3 alt - USB, open localhost:8081
# loop 4 - open a PR (staging) / merge (production)
npm run verify:pack                       # consumer path - pack, install, import
npx uix-dev doctor                        # environment sanity
npx uix-dev qr <url>                      # QR for any URL (e.g. staging)
```
