# webxr-multiplatform demo - "the lab"

Demo client for
[`@realitycollective/webxr-uiextensions`](../../packages/webxr-uiextensions/README.md)
- ships **both platform adapters** and activates the pipeline that matches
the hardware it finds itself on.

It is also the **single encompassing demo**: it exercises all four packages
in one deployable client (core + both adapters + the devtools edit gate on
the IWSDK pipeline), and it deploys automatically - see
[Deployment](#deployment).

## Can it detect IWSDK vs XR Blocks?

Not directly - those are frameworks an app is *built with*, not properties
of the device. What is detectable is the **browser/hardware**, and that
pre-selects one of **three modes** on the launch screen
(`src/platform-detect.ts`, unit-tested):

| Signature | Pre-selected mode |
| --- | --- |
| Meta Horizon OS browser (`OculusBrowser`) | **IWSDK** - the full showcase scene |
| Android XR Chrome (`AndroidXR`) | **XR Blocks** - experimental adapter in an `xb.Script` |
| anything else (desktop/mobile) | **Desktop** - plain three.js, mouse + orbit controls |

Nothing boots until you press **START** - the launch screen shows what was
detected and why, lets you pick any of the three modes, and launching is
the proof that the chosen implementation runs on this browser. The chosen
mode is written into the URL (`?uix-engine=desktop|iwsdk|xrblocks`) so
reloads and shared links keep it; the same param pre-selects a mode
anywhere (UA sniffing is best-effort; the override is authoritative). All
three pipelines are dynamic imports, so a session only downloads the
engine it launches, and an on-page badge shows the active engine.

## What each pipeline shows

All three build the **identical playground** - five windows and two dock
regions from the portable descriptor in
[`demos/showcase/src/playground-scene.ts`](../showcase/src/playground-scene.ts),
with the identical engine-free behaviour from
[`playground-behaviour.ts`](../showcase/src/playground-behaviour.ts). Only
the bootstrap differs:

- **Desktop (three.js)** - a hand-rolled three.js scene with no XR
  framework. Real mouse input via `@pmndrs/pointer-events`
  (`forwardHtmlEvents`), so hover, buttons, steppers, toggles and text
  fields behave exactly as under IWSDK, plus **WASD** movement, **Space**
  jump, **C** crouch, **Shift** sprint and right-drag look
  (`DesktopControls`).
- **IWSDK** - the same playground through the IWSDK adapter's scene host,
  with drag, dock-by-drag and VR entry.
- **XR Blocks** - the same playground hosted inside an `xb.Script`, with
  select-ray click forwarding. Scope matches that adapter's feature matrix.

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

Headset loops (tunnel / adb) work exactly as described in
[docs/developer-cycle.md](../../docs/developer-cycle.md) - point `uix-dev
tunnel --cwd demos/webxr-multiplatform` at this demo. In local dev the
devtools edit gate is open on the IWSDK pipeline (`?uix-edit=dev`), reusing
the playground's UX Editor overlay.

## Deployment

`webxr-uiextensions-deploy.yml` deploys this demo to its own isolated
Cloudflare Pages projects, alongside (never instead of) the showcase:

| Environment | Trigger | Project / URL | Edit gate |
| --- | --- | --- | --- |
| Production | push to `main` | `webxr-uix-lab.pages.dev` | compiled out |
| Staging | pull request | `webxr-uix-lab-test.pages.dev` | compiled in **only if** the `UIX_EDIT_TOKEN` repo secret is set; activate with `?uix-edit=<token>` |

Each deploy's step summary publishes a **verified** da.gd short link + QR
(`.github/scripts/publish-shortlink.sh` follows the redirect and confirms it
lands on the right URL before anything is published - falling back to a
stable random code, or the direct URL, when a memorable code can't be
verified).

Platform switching is testable on the deployed site exactly as locally:
scan the QR on a Quest (IWSDK pipeline), open on Android XR (XR Blocks
pipeline), or force either with `?uix-engine=`.
