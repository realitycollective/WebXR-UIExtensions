# @realitycollective/uix-devtools

Developer tooling for
[`@realitycollective/iwsdk-uiextensions`](../iwsdk-uiextensions/README.md):
an edit-session **launch gate**, **runtime UIKitML compilation** for live UX
editing, and the **`uix-dev` CLI** that gets a local build onto a headset in
one command via a Cloudflare quick tunnel.

> **This package is dev tooling. Never ship it in a player-facing bundle.**
> Install it as a `devDependency`, guard every use behind a build flag, and
> load overlays through dynamic import. The design makes the safe path the
> easy path - see [Safety model](#safety-model).

## Install

```bash
npm install --save-dev @realitycollective/uix-devtools
```

## The edit gate

```ts
import { installEditGate } from '@realitycollective/uix-devtools';

// Guarded so production builds ELIMINATE this whole block:
if (import.meta.env.DEV || import.meta.env.VITE_UIX_EDIT) {
  const expected = import.meta.env.VITE_UIX_EDIT_TOKEN as string | undefined;
  installEditGate({
    ...(expected ? { tokens: [expected] } : {}), // no token minted → local-dev open gate
    load: (session) =>
      import('./editor-overlay.js').then((m) => m.install(session)),
  });
}
```

- The gate opens only when the page URL carries `?uix-edit=<token>` and the
  token is accepted. Accepted tokens are remembered in `sessionStorage`
  (override with `remember: false`) so in-headset reloads keep the session.
- `load` is invoked exactly once, and a throwing/rejecting overlay is
  contained - it can never take the host app down.
- `clearEditSession()` forgets a remembered token (an "exit edit mode"
  affordance).

All parts are individually exported (`readEditToken`, `isTokenAccepted`,
`resolveEditSession`) and unit-tested - see `test/gate.test.ts`.

## Runtime UIKitML compilation

```ts
import { compilePanelSource } from '@realitycollective/uix-devtools';
import { createUIWindow } from '@realitycollective/iwsdk-uiextensions';

const compiled = compilePanelSource(source); // same JSON the Vite plugin emits
if (compiled.errors.length === 0) {
  createUIWindow(world, { id: 'live', title: 'Live', config: compiled.configUrl });
}
```

`compilePanelSource` runs the same `parse` the build-time Vite plugin uses
and serves the JSON through a `blob:` URL, which IWSDK's `PanelUI` fetches
like any file - so panels can be authored, edited and respawned entirely at
runtime (desktop workbench or in-headset editor). Parse problems land in
`errors` instead of throwing; linked stylesheets can be resolved via the
`resolveFile` option.

## The `uix-dev` CLI

```bash
uix-dev tunnel [--port N] [--cwd DIR] [--no-dev-server]
uix-dev doctor
uix-dev qr <url>
```

`tunnel` mints a per-run edit token, starts the demo's dev server with
`VITE_UIX_EDIT`/`VITE_UIX_EDIT_TOKEN` exported, opens a Cloudflare quick
tunnel (`cloudflared tunnel --url`) and prints QR codes for both the plain
and the edit-mode URL. HTTPS + WSS means WebXR and Vite HMR both work from
the headset. `doctor` checks node/cloudflared/adb with install hints.

The demo's `vite.config.ts` must allow the tunnel host and, when driven by
the CLI (`UIX_DEV_TUNNEL=1`), point HMR at wss:443 - see
`demos/devtools-playground/vite.config.ts` for the reference snippet.

## Safety model

| Layer | Mechanism | Player-facing result |
| --- | --- | --- |
| packaging | separate dev-only package, never imported by the runtime library | not installed → not present |
| build | gate call guarded by `import.meta.env` flags | branch eliminated from production bundles |
| runtime | exact-token match required; overlay is a lazy chunk | wrong/no token → nothing loads, nothing downloads |

## Demo

[`demos/devtools-playground`](../../demos/devtools-playground/README.md) -
the shared showcase scene plus this package's gate and a live in-headset
UIKitML editor window.

## License

MIT © Reality Collective
