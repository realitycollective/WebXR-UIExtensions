# @realitycollective/native-uiextensions

The native app adapter for [`@realitycollective/webxr-uiextensions`](../webxr-uiextensions/README.md): the same `WindowManager`, `data-uix` controls and `WindowHost` contract, bound to a **native** host - an OpenXR (Quest) or visionOS (CompositorServices) app that embeds a JavaScript engine such as Hermes, renders panels itself and installs one object, `globalThis.__rcHost`.

> **Maturity:** headless-tested only, per the shared native host contract (`NATIVE_HOST_CONTRACT.md`, held alongside the other Reality Collective WebXR family repositories, not in this one). A device run against a real native host is the native team's step.

## What is different here

Every other adapter in this repository owns a real scene graph (three.js, IWSDK's ECS) and interprets UIKitML itself. This one owns **nothing visual**: the native app renders panels and windows, and this package only keeps the core's `WindowManager` and controls talking to it.

- `createPanel` / the panel side of `createWindow` ask the host for a `NativeElementNode` tree and wrap it in `NativeUixElement` proxies - the same `UixElement` interface every control upgrader (`upgradePanel`, `findRole`, `tagOf`) already reads, so `<uix-stepper>`, `<uix-toggle>` and the rest work unchanged.
- `setProperties` on a proxy element forwards to `host.setProperties(panelId, elementHandle, props)`.
- `addEventListener` registers locally; the host's single `onElementEvent` callback is routed to the right element by its `(panelId, elementHandle)`.
- Every `WindowManager` state change (open, focus, minimize, hide, dock, chrome, hand menu) is mirrored to the host as a plain `applyWindow(record)` call; closing a window calls `host.disposePanel` (if its panel had attached) and `host.closeWindow`.
- `config` (compiled UIKitML JSON, or a path string) passes straight through to the host, unchanged - assets stay transparent, per the contract's "Rules for every slice".
- `NativeWindowHost` implements `SceneTarget` as well as `WindowHost`, like the IWSDK and XR Blocks hosts, so `applyScene(host, descriptor)` builds the same scene on native. A descriptor's regions go to the host as `createRegion(region)`; its windows keep their config paths, which the native app resolves.
- `dispose()` closes every window, disposes bare panels, removes the regions it created and releases its subscriptions, as every platform host does.
- The public surface is the same kind every adapter has: the core, `NativeWindowHost` with its options, and the slice types. The proxy elements and the slice reader are internal.

No engine import anywhere in this package - no three.js, no uikit.

## The `ui` slice this package reads

```ts
interface NativeUiHost {
  createPanel(panelId: string, config: unknown): NativeElementNode;
  createWindow(windowId: string, config: unknown, options: unknown): void;
  onPanelReady(cb: (windowId: string, panelId: string, tree: NativeElementNode) => void): () => void;
  setProperties(panelId: string, elementHandle: string, props: Record<string, unknown>): void;
  onElementEvent(cb: (panelId: string, elementHandle: string, type: string, payload: unknown) => void): () => void;
  setTargetDimensions(panelId: string, width: number, height: number): void;
  disposePanel(panelId: string): void;
  applyWindow(record: unknown): void;
  closeWindow(windowId: string): void;
  createRegion(region: SceneRegion): void;
  removeRegion(regionId: string): void;
}
interface NativeElementNode {
  handle: string;
  id?: string;
  componentName?: string;
  children: NativeElementNode[];
}
```

Read by injection, or by falling back to `globalThis.__rcHost.ui`. Given neither, the constructor throws one clear error naming the missing slice, per the contract's rule that every slice but the root is optional.

## Usage

```ts
import { NativeWindowHost } from '@realitycollective/native-uiextensions';

// `host` is optional - omit it to read globalThis.__rcHost.ui instead,
// which is what a real native app installs before evaluating the bundle.
const uix = new NativeWindowHost();

const handle = uix.createWindow({
  id: 'status',
  title: 'Status',
  config: '/ui/status.uikitml',
  closable: true,
});

handle.onReady((panel) => {
  panel.getElementById('uix-title')?.setProperties({ text: 'Status' });
});
```

`uix.manager` is the same `WindowManager` every adapter shares - drive it directly (`uix.manager.hide(id)`, `.dockTo(id, region)`, …) from a hand menu or app logic, and the host stays in sync automatically.

## Testing

`test/helpers/fake-native-ui-host.ts` is an in-memory fake of the `ui` slice: `createPanel` builds a tree synchronously from a small declarative spec, `createWindow` is fire-and-forget with a `readyWindow(...)` helper to simulate the native renderer finishing, and every other call is recorded rather than acted on. `test/host.test.ts` runs the shared `windowHostContractCases()` (via `webxr-uiextensions`'s `test/helpers/window-host-contract.ts`) against `NativeWindowHost`, alongside tests specific to the native binding: proxy element wiring, event dispatch, and mirroring `WindowManager` state to the host.
