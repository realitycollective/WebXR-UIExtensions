# uix-devtools playground

Demo client for
[`@realitycollective/uix-devtools`](../../packages/uix-devtools/README.md).
It boots the **exact same playground scene** as the library showcase
(imported from `../showcase/src/world.ts` — same windows, dock regions and
UIKitML), then adds only what the devtools provide:

- the **edit-session gate**, wired the way a real app should wire it
  (build-flag guard + token + dynamic import — see `src/index.ts`), and
- the **UX Editor** overlay (`src/editor-overlay.ts`): a spatial window whose
  own panel is compiled at runtime, containing a UIKitML textarea (Quest
  system keyboard works) and SPAWN / RESPAWN / RESET buttons. Markup typed
  there is compiled in-browser via `compilePanelSource` and spawned as a
  real, draggable, dockable window — the whole edit loop without leaving
  the headset.

## Run it

```bash
# desktop (gate open in dev — any token):
npm run dev:playground        # then open http://localhost:8081/?uix-edit=dev

# headset (one command — QR codes for a Cloudflare quick tunnel):
npm run dev:live
```

Both commands run from the workspace root. See
[docs/developer-cycle.md](../../docs/developer-cycle.md) for the full loop,
including the USB (`adb reverse`) alternative and staging deploys.

## What players can reach

Nothing. A build of this demo without `VITE_UIX_EDIT` contains no gate at
all (the guard is dead-code-eliminated); a build with it still requires the
exact per-run token in the URL, and the editor chunk is only downloaded once
the gate opens.
