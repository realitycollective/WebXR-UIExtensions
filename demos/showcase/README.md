# IWSDK UI Extensions showcase

Demo client for
[`@realitycollective/iwsdk-uiextensions`](../../packages/iwsdk-uiextensions/README.md)
— five windows and two dock regions exercising the library's whole surface
(see the [workspace README](../../README.md#the-showcase-scene) for the tour).

The scene itself is exported from `src/world.ts` so other demo clients build
on the identical playground — the
[devtools playground](../devtools-playground/README.md) is this scene plus
the live-edit tooling.

## Run it

```bash
npm run dev:showcase     # from the workspace root → http://localhost:8081
```

Deployed automatically by `.github/workflows/webxr-uiextensions-deploy.yml`:
PRs → staging (`webxr-uiextensions-test.pages.dev`), pushes to
`main` → production (`webxr-uiextensions.pages.dev`).

For headset testing against a local build (USB or Cloudflare quick tunnel),
see [docs/developer-cycle.md](../../docs/developer-cycle.md).
