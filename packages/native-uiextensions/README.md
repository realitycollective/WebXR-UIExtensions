# @realitycollective/native-uiextensions

The native app adapter for [`@realitycollective/webxr-uiextensions`](../webxr-uiextensions/README.md): the same `WindowManager`, `data-uix` controls and `WindowHost` contract, bound to a **native** host - an OpenXR (Quest) or visionOS (CompositorServices) app that embeds a JavaScript engine such as Hermes, renders panels itself and installs one object, `globalThis.__rcHost`.

> **Maturity:** headless-tested against a reference fake host. The host conformance kit this package ships is what proves a real native host on its device.

## A host is handed results, not rules

On IWSDK, five ECS systems apply the core's window rules to the engine. A native host has no such systems, and a host that re-derives the rules drifts from the web. So everything those systems do runs in this package, from the same core logic, and the host only renders, measures and reports:

| IWSDK system | What this package does in its place |
| --- | --- |
| `UIWindowSystem` | Opens the window's record when its panel attaches. Writes the title (defaulting to the window id), each chrome button's `display`, the PIN and MIN labels and the minimized content with `setProperties`. Wires the chrome buttons. Combines hidden and the hand-menu palm gate into one shown flag. Moves each window toward the viewer by its focus depth (0.02 m per step). Returns a window home on DOCK. |
| `UIDockSystem` | Dock-mode transitions: snap on entering a follow mode, follow from the current pose on unpin, face the viewer on pin. Hand menus placed from the `input` slice's grip poses by the core's `evaluateHandMenu`, hidden while the hand is untracked. |
| IWSDK `FollowSystem` | The core's `stepFollow`: the same yaw follow, proved frame by frame against IWSDK's own system. `head-locked` follows exactly as `body-follow` does, as on IWSDK in a session. |
| `UIDockRegionSystem` | Regions live here, in a core `RegionRegistry`. Docked windows sit at their slot pose; a following region follows with IWSDK's `Follower` defaults. |
| `UIDragSystem` | Hold-to-drag on the title bar (0.3 s for a ray, at once for a near grab), the core drag maths, billboarding while dragged, and drop capture into a region. |
| `UITouchGuardSystem` | One core `TouchPress` per touch pointer, fed the signed distance the host measures (press within 0.02 m arriving from the front, release past 0.03 m, never from behind). Clicks fire on release, for rays as for touch. |
| `UIControlsSystem` | Every panel's `data-uix` controls are upgraded, keyed by the panel root, so a portable client's own `upgradePanel(panel.root, panel.root)` returns the same handles. |

The host receives `setWindowPose` for placement, `applyWindow` for the shown flag and `setProperties` for element state. It reports panels ready, hover and pointer samples. It never places a window or decides a press.

## The `ui` slice this package reads

`src/native-types.ts` is the contract, and every member carries a comment stating its units, sign, defaults and the IWSDK line it stands in for. In short:

```ts
interface NativeUiHost {
  createPanel(panelId: string, config: unknown): NativeElementNode;
  createWindow(windowId: string, config: unknown, options: unknown): void;
  onPanelReady(cb: (windowId: string, panelId: string, tree: NativeElementNode) => void): () => void;
  setProperties(panelId: string, elementHandle: string, props: Record<string, unknown>): void;
  onElementEvent(cb: (panelId: string, elementHandle: string, type: string, payload: unknown) => void): () => void;
  onPointerSample(cb: (sample: NativePointerSample) => void): () => void;
  setWindowPose(windowId: string, pose: PoseTuple, depthOrder: number): void;
  setTargetDimensions(panelId: string, width: number, height: number): void;
  disposePanel(panelId: string): void;
  applyWindow(record: unknown): void; // the host applies `hidden` (not shown) and `dockMode` only
  closeWindow(windowId: string): void;
}

interface NativePointerSample {
  sourceId: string;
  pointer: 'ray' | 'touch' | 'grab';
  panelId: string | null;
  elementHandle: string | null;
  point: Vec3Tuple | null;
  signedDistance?: number; // touch: metres along the panel normal, positive in front
  ray?: RayTuple;          // ray: this frame's ray
  active?: boolean;        // ray: select held; grab: squeeze or pinch held
}
```

Report `ray` and `grab` pointers every frame while tracked, and `touch` pointers while the tip is near a panel. A pointer missing from a frame is a lost pointer, and its press ends with no click.

The head and hands come from the `input` slice (`getHeadPose()`, and `sample()` for each hand's grip pose), the same slice `@realitycollective/native-interactions` reads. Frames come from `update(dt)`, or from `__rcHost.onFrame` with `attachToHost: true`.

Every slice is read by injection, or by falling back to `globalThis.__rcHost`. A missing `ui` slice throws one clear error at construction.

## Usage

```ts
import { NativeWindowHost } from '@realitycollective/native-uiextensions';

// Reads globalThis.__rcHost.ui and .input, and drives itself from __rcHost.onFrame.
const uix = new NativeWindowHost({ attachToHost: true });

const handle = uix.createWindow({
  id: 'status',
  title: 'Status',
  config: '/ui/status.uikitml',
  dockMode: 'body-follow',
  closable: true,
});

handle.onReady((panel) => {
  // The record exists from here on, as on IWSDK.
  uix.manager.focus('status');
});
```

`uix.manager` is the same `WindowManager` every adapter shares. Drive it from a hand menu or app logic (`uix.manager.hide(id)`, `.dockTo(id, region)`, `.togglePin(id)`) and the binding applies the result.

## Proving a host: the conformance kit

`nativeUiHostConformanceCases()` returns the host cases, as runner-free data named `ui/<master row>`. A native app runs them on its device against its real `ui` slice, with the test readbacks of `NativeUiTestHost` (`windowPose`, `windowHidden`, `elementProperties`, `measureTouch`) installed in a test build:

```ts
import { nativeUiHostConformanceCases } from '@realitycollective/native-uiextensions';

for (const hostCase of nativeUiHostConformanceCases()) {
  await hostCase.run({ ui: __rcHost.ui, testHost: __rcShell.testHost, config: CHROME_PANEL, waitForPanel });
}
```

Each case drives the real host through this package with a scripted head and hands, and checks what the host drew, hid, wrote and measured.

## Testing

`test/helpers/fake-native-ui-host.ts` is a reference fake of the `ui` slice that behaves as a correct host would and implements the test readbacks. `test/binding-rules.test.ts` holds one binding case per rule this package now applies, `test/host-conformance.test.ts` runs the conformance kit against the fake (and checks it fails a host that misplaces a window or drops the sign of a touch distance), and `test/host.test.ts` runs the shared `windowHostContractCases()` and `sceneTargetContractCases()`.
