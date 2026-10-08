# webxr-multiplatform demo - "the lab"

Demo client for [`@realitycollective/webxr-uiextensions`](../../packages/webxr-uiextensions/README.md). It ships **both platform adapters** and activates the one that matches the hardware it is running on.

It is also the **single encompassing demo**: it exercises all four packages in one deployable client (core + both adapters + the devtools edit gate on the IWSDK pipeline), and it deploys automatically - see [Deployment](#deployment).

## Can it detect IWSDK vs XR Blocks?

Not directly - those are frameworks an app is *built with*, not properties of the device. What the page can ask is the browser's own **WebXR runtime**: which immersive session modes it can start (`navigator.xr.isSessionSupported`, the question the Service Framework's `SessionFacet.isSupported` and XR Blocks itself ask). That answer pre-selects one of **three modes** on the launch screen (`@showcase/platform-detect.ts`, unit-tested - the showcase boots the same detection directly):

| What the runtime answers | Pre-selected mode |
| --- | --- |
| no immersive mode, or no `navigator.xr` (no https) | **Desktop** - plain three.js, mouse + orbit controls |
| immersive WebXR in a Meta Horizon OS browser | **IWSDK** - the full showcase scene |
| `immersive-ar` anywhere else (Android XR, XREAL Aura, AR phones) | **XR Blocks** - experimental adapter in an `xb.Script` |
| `immersive-vr` only, outside Meta | **Desktop** - IWSDK has no desktop camera; force it with `?uix-engine=iwsdk` |

The user agent is read for one thing only: telling a Meta browser from any other, which no runtime question can do because a Quest supports both modes. It never decides whether XR is available, so an Android XR browser that does not name itself still lands on XR Blocks.

Nothing boots until you press **START** - the launch screen shows what was detected and why, lets you pick any of the three modes, and launching is the proof that the chosen implementation runs on this browser. The chosen mode is written into the URL (`?uix-engine=desktop|iwsdk|xrblocks`) so reloads and shared links keep it; the same param pre-selects a mode anywhere, and the override is authoritative. All three pipelines are dynamic imports, so a session only downloads the engine it launches, and an on-page badge shows the active engine.

## What each pipeline shows

All three build the **identical playground** - five windows and two dock regions from the portable descriptor in [`demos/showcase/src/playground-scene.ts`](../showcase/src/playground-scene.ts), with the identical engine-free behaviour from [`playground-behaviour.ts`](../showcase/src/playground-behaviour.ts). Only the bootstrap differs:

- **Desktop (three.js)** - a hand-rolled three.js scene with no XR framework. Real mouse input via `@pmndrs/pointer-events` (`forwardHtmlEvents`), so hover, buttons, steppers, toggles and text fields behave exactly as under IWSDK, plus **WASD** movement, **Space** jump, **C** crouch, **Shift** sprint and right-drag look (`DesktopControls`).
- **IWSDK** - the same playground through the IWSDK adapter's scene host, with drag, dock-by-drag and VR entry.
- **XR Blocks** - the same playground hosted inside an `xb.Script`, with select-ray click forwarding. Scope matches that adapter's feature matrix. On a browser without immersive WebXR, XR Blocks runs its desktop simulator. On one with it, the page shows XR Blocks' **Enter XR** button at the bottom centre and draws the 2D view from standing height (1.7 m, IWSDK's own camera height) until you enter (`src/pipelines/xrblocks-page.ts`).

### Desktop controls

| Input | Action |
| --- | --- |
| **W A S D** / arrows | walk |
| **Shift** | sprint |
| **Space** | jump |
| **C** / Left Ctrl | crouch |
| Right-drag | look around |
| Left click | interact with panels |

## Run it

```bash
npm run dev:multiplatform     # from the workspace root → http://localhost:8081
# then press START. To pre-select a mode:
#   ?uix-engine=desktop    plain three.js + WASD (default on desktop)
#   ?uix-engine=iwsdk      the IWSDK pipeline
#   ?uix-engine=xrblocks   the XR Blocks pipeline / desktop simulator
```

Headset loops (tunnel / adb) work exactly as described in [docs/developer-cycle.md](../../docs/developer-cycle.md) - point `uix-dev tunnel --cwd demos/webxr-multiplatform` at this demo. In local dev the devtools edit gate is open on the IWSDK pipeline (`?uix-edit=dev`), reusing the playground's UX Editor overlay.

## Diagnostics

For framework testers only. A hidden URL option, not shown anywhere on the page, records what happens on the device and sends it to the maintainers, so a test proves the lab works on that device or shows why it does not. Without the option the lab records nothing, stores nothing and shows no Diagnostics button.

| URL option | Effect |
| --- | --- |
| `?uix-log=1` | records from the first line, before any pipeline loads, and sends the log by itself: 20 s after the page opens, when each XR session ends, and when the page is left, whenever something new was recorded |
| `?uix-log=local` | records, but keeps the log on the device; the tester presses Send |
| absent, `0` or `off` | nothing |

Add it to whatever else the link carries, for example `https://webxr-uix-lab-test.pages.dev/?uix-log=1`. Once given, it holds for the rest of the visit in that tab: the page remembers it in session storage and puts it back in the URL after any navigation that dropped it, whichever engine is started. `?uix-log=off` ends it; a new tab starts without it.

The log holds console output, uncaught errors, failed loads, WebGL context loss, and every WebXR session: its mode, blend mode, granted features, first frame, and frame and pose counts every 10 s. Each send carries the whole log of the page load so far, so the newest report for a page load is the complete one. The device keeps the last three page loads in local storage, so a reload or a crash does not lose them, and a send that failed offline goes when the browser is back online. Query values other than `uix-engine`, `uix-autostart` and `uix-log` are never recorded, so an edit token is never stored.

### What to send a tester

1. The link with `?uix-log=1`.
2. Ask them to open it, press START, enter XR if they can, try the panels, exit, and close the page. Nothing else is needed: the log arrives by itself.
3. If it does not arrive (no network, or storage not set up), ask them to press **Diagnostics** at the top right and then **Download**. That saves `uix-lab-diagnostics-<time>.txt` to the device's downloads; on Android XR open it in the Files app, under Downloads. Over USB: `adb pull /sdcard/Download/<file name>`. **Copy** puts the log on the clipboard instead.

With USB debugging (where the device allows it): connect, check `adb devices`, open `chrome://inspect/#devices` in Chrome on the computer, inspect the lab's tab and run `copy(rcDiagnostics.text())` in its console.

A local `npm run dev` has no report service, so Send says so there; Download and Copy still work.

### Turning on storage (maintainers, once per Pages project)

Reports go to `functions/api/report.ts`, a Cloudflare Pages Function that `wrangler pages deploy` publishes with the site. It answers 503 until the project has a D1 database bound, and the log then stays on the device. D1 is on the Workers Free plan; nothing here uses KV.

1. Sign Wrangler in to the Cloudflare account that owns the Pages projects (it opens a browser): `npx wrangler login`
2. Create one database, shared by both labs (each report carries its lab): `npx wrangler d1 create rc-diagnostics`
3. Bind it to each Pages project that should store reports: `webxr-uix-lab` and `webxr-interactions`, and the `-test` projects if PR builds should store them too. In the [Cloudflare dashboard](https://dash.cloudflare.com/), open **Workers & Pages** and select the project. Open **Settings**, check the environment selector at the top shows **Production** (every CI deploy of these projects is a Production deploy), then **Bindings**, **Add**, **D1 database**. Set **Variable name** to `REPORTS_DB` exactly, choose `rc-diagnostics` as the database, and save. CI only ever sets a project's production branch, so it never removes the binding.
4. Deploy again. A binding applies only to deployments made after it: the next pull request picks it up for the `-test` projects, the next push to `main` for production. The Function creates its table with the first report.
5. Check it (use `webxr-uix-lab-test.pages.dev` for the test site): `curl -i -X POST https://webxr-uix-lab.pages.dev/api/report -H "content-type: application/json" --data "{\"id\":\"setup-check-1\",\"lab\":\"setup\"}"` answers `201` once storage works and `503` while the binding is missing or not yet deployed. Any other answer means the Function itself is not deployed yet. It stores one row, which ages out after 48 hours.

### Reading reports

The test sites carry the newest code: every pull request deploys this lab to `https://webxr-uix-lab-test.pages.dev` (and the Interactions playground to `https://webxr-interactions-test.pages.dev`). Send testers those links with `?uix-log=1` (`?log=1` for the playground). The production labs pick the logging up with the next release.

Without any tooling: in the Cloudflare dashboard, open the `rc-diagnostics` D1 database and its **Console**, then run a query such as the first one below. With Wrangler:

```bash
npx wrangler d1 execute rc-diagnostics --remote --command "SELECT id, lab, datetime(received_at / 1000, 'unixepoch') AS received, user_agent FROM reports ORDER BY received_at DESC LIMIT 20"
npx wrangler d1 execute rc-diagnostics --remote --json --command "SELECT body FROM reports WHERE id = '<id>'" > report.json
```

A report id is the page load's id plus a send number (`<page load>-<n>`); the highest `n` is the complete log. Its `body` is JSON: `reports` holds this page load and up to two earlier ones from the same device, each with `env` (browser, user agent, what WebXR reported, the WebGL renderer) and `events`, one per line in the order they happened: `t` in milliseconds since the page opened, `k` the kind (`console`, `error`, `rejection`, `resource`, `webgl`, `xr`, `note`), `l` the level, `m` the message, and `n` how often it repeated. The `xr` events say whether a session was requested, granted (`session started`, with the display's blend mode and features), drew a first frame, and how many frames had a viewer pose. A tester can show the same log on the device: **Diagnostics**, at the top right, lists it.

Retention and cost: a report is kept at least 48 hours, which is enough to arrange a test and collect it; each new report deletes those older than that. On the Free plan a report costs one Function request and about three D1 rows written (the row and its indexes), against 100,000 rows a day. Static pages never invoke the Function. It stores at most 200 reports a day for the whole database, one per client every 15 s, at most 64 KiB each. A client is a hash of its address salted with the day; no address is stored.

## Deployment

`ci.yml` deploys this demo to its own isolated Cloudflare Pages projects, alongside the showcase and never instead of it:

| Environment | Trigger | Project / URL | Edit gate |
| --- | --- | --- | --- |
| Production | push to `main` | `webxr-uix-lab.pages.dev` | compiled out |
| Staging | pull request | `webxr-uix-lab-test.pages.dev` | compiled in **only if** the `UIX_EDIT_TOKEN` repo secret is set; activate with `?uix-edit=<token>` |

Each deploy's step summary publishes a **verified** da.gd short link + QR (`.github/scripts/publish-shortlink.sh` follows the redirect and confirms it lands on the right URL before anything is published - falling back to a stable random code, or the direct URL, when a memorable code can't be verified).

Platform switching is testable on the deployed site exactly as locally: scan the QR on a Quest (IWSDK pipeline), open on Android XR (XR Blocks pipeline), or force either with `?uix-engine=`.
