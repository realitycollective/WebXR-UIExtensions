/**
 * The `ui` slice of `globalThis.__rcHost`, and the two root members this
 * package reads - see NATIVE_HOST_CONTRACT.md, sections "Rules for every
 * slice" and "ui".
 *
 * A native app (OpenXR on Quest, CompositorServices on visionOS, or any other
 * shell) embeds a JavaScript engine such as Hermes, renders panels itself and
 * installs one host object. This package reads its `ui` slice and presents it
 * through the core's `WindowHost` contract, so the panels, the `WindowManager`
 * and the `data-uix` controls are unchanged from web.
 *
 * A HOST IS HANDED RESULTS, NOT RULES. Every UI rule the IWSDK binding
 * applies in its systems runs in this package, from the same core logic:
 * chrome, title and labels, the follow rule, focus bias, hand menus, regions,
 * dragging, touch press and the click edge. The host renders, measures and
 * reports. It never decides where a window goes, when a press starts or
 * whether a click happened. Each member below states what the host does, in
 * what units and with what sign, and which IWSDK line it stands in for.
 *
 * These are structural types, not the native SDK's own classes: any object
 * shaped like `NativeUiHost` works, whether it came from `globalThis.__rcHost`
 * or a test fake. Every value that crosses the boundary is plain - numbers,
 * strings, booleans, arrays and plain objects - per "Rules for every slice".
 * Units are metres, seconds and radians unless stated; poses are world space
 * with quaternions `[x, y, z, w]`; the world is right handed, +Y up, and the
 * viewer looks down -Z at rest.
 */

import type { PointerDisplayConfig } from '@realitycollective/webxr-input';
import type { HeadPose, PoseTuple, PresentedPointer, RayTuple, Vec3Tuple } from '@realitycollective/webxr-uiextensions';

/**
 * One element of a panel's tree, as the native host reports it. `handle` is
 * the host's own opaque, stable reference to the element; `id` is the markup
 * id and `componentName` the declared `uix-*` custom element name, both
 * omitted when the element carries neither.
 */
export interface NativeElementNode {
  /** Host-side element handle - opaque, stable for the element's lifetime. */
  handle: string;
  /** Markup id, when the element carries one. */
  id?: string;
  /**
   * The `uix-*` custom element name, when the element was declared as one:
   * the markup tag itself, such as `"uix-stepper"`. The binding upgrades a
   * control by this name. Whatever loads the app's panels for the host (a
   * build-time cook step or a run-time parser) must accept every tag in the
   * core's `UIX_ELEMENT_TAGS` as a plain container, report it here, and keep
   * its `data-*` attributes. A loader that rejects or drops one leaves the
   * panel without its controls; IWSDK's validating parser needs the same
   * declaration on the web (`uixComponentSet`).
   */
  componentName?: string;
  /**
   * The element's `data-*` attributes exactly as the markup wrote them, such
   * as `{ "data-uix-id": "count", "data-uix-min": "0" }`. The controls read
   * their settings and their id from these, so a native app must send them.
   */
  attributes?: Record<string, string>;
  /**
   * Present when the element scrolls (uikit `overflow: scroll`): its size in
   * pixels and how far its content can scroll. The binding runs the core
   * scroll rule for it and hands the host `setScroll`. Report a change of
   * size or range through `onElementEvent` with type `"scrollextent"` and
   * the new extent as payload.
   */
  scroll?: { width: number; height: number; maxX: number; maxY: number };
  /**
   * Present when the element is a text field (uikit `Input`): its value, and
   * whether it is multi-line and which input type it declared. A click on it
   * makes the binding ask the host for the keyboard (`showKeyboard`).
   */
  input?: { value: string; multiline?: boolean; type?: string };
  children: NativeElementNode[];
}

/** Which pointer produced a {@link NativePointerSample}. */
export type NativePointerKind = 'ray' | 'touch' | 'grab';

/**
 * What one pointer measured this frame. The host MEASURES and reports; the
 * binding runs the press machines and raises every `pointerdown`,
 * `pointerup` and `click` itself.
 *
 * - `ray`: a controller or hand aim ray. Report it EVERY frame while the
 *   source is tracked, hit or no hit, with `ray` and `active`. `active` is
 *   the runtime's select state (trigger or pinch). Press on the rising edge
 *   over an element; `click` on the falling edge when the element under the
 *   ray is the one pressed - on RELEASE, as IWSDK's pointer events do. A
 *   source missing from a frame is a lost pointer: its press ends with no
 *   click.
 * - `touch`: a fingertip, or a controller's tip (a controller's index tip is
 *   its ray origin, as IWSDK's input rig makes it). Report it only while the
 *   tip is near a panel, with `signedDistance`: metres from the tip to the
 *   panel plane, measured along the panel's own local +Z normal taken to
 *   world space, POSITIVE IN FRONT. A target without a normal counts as
 *   faced from the front. This is `sampleOf` in
 *   `iwsdk-uiextensions/src/systems/touch-guard-system.ts`. Missing from a
 *   frame means contact lost. The core `TouchPress` decides (press within
 *   0.02 m arriving from the front, release past 0.03 m, never from behind).
 * - `grab`: the near grab pointer at the grip (controller squeeze, hand
 *   pinch). Report it every frame while tracked, with `point` the pointer's
 *   world position and `active` whether squeeze or pinch is held. Only a
 *   window's title bar answers it (near drag, IWSDK's `grabDescendants`).
 */
export interface NativePointerSample {
  /** The input source's id, stable while it is tracked; the same id the `input` slice reports. */
  sourceId: string;
  pointer: NativePointerKind;
  /** The panel the pointer is over, or `null` for none. */
  panelId: string | null;
  /** The element under the pointer (deepest hit), or `null` for none. */
  elementHandle: string | null;
  /** World point: the ray or touch hit, or the grab pointer's position. `null` with no hit. */
  point: Vec3Tuple | null;
  /** `touch` only: metres from the panel plane along its normal, positive in front. */
  signedDistance?: number;
  /**
   * Metres the pointer arbitration compares this sample with an
   * interactable's candidate on the same source (IWSDK's `MultiPointer`
   * keeps, per pointer kind, the nearest of everything it reaches): for
   * `ray` the ray parameter of the hit, for `touch` and `grab` the unsigned
   * distance from the fingertip or grip to the panel. Report it when the
   * host can; the binding otherwise derives it from `ray` and `point`, from
   * `|signedDistance|`, or takes 0 for a grab over the title bar.
   */
  distance?: number;
  /** `ray` only: the ray this frame, origin in metres, direction normalised. */
  ray?: RayTuple;
  /** `ray`: select held. `grab`: squeeze or pinch held. */
  active?: boolean;
  /**
   * `ray` only, over an element that scrolls or sits inside one: the hit
   * point in that scrolling element's own pixel space, x right and y down
   * from its top left corner. The binding scrolls by the drag of this point
   * (the core `ScrollState`, uikit's drag rule). Without it a press on a
   * scrolling element does not scroll.
   */
  localPoint?: [number, number];
}

/**
 * The `ui` slice itself. The JavaScript side keeps the real `WindowManager`,
 * the controls and every placement and press rule; the native app renders
 * panels and windows, measures pointers, and reports back.
 */
export interface NativeUiHost {
  /**
   * Build a bare panel from `config` (compiled UIKitML JSON, or a path the
   * app resolves) and return its element tree, synchronously. The binding
   * upgrades its `data-uix` controls at once, as IWSDK's `UIControlsSystem`
   * does for every panel.
   */
  createPanel(panelId: string, config: unknown): NativeElementNode;
  /**
   * Spawn a managed window's panel. Fire-and-forget: the panel arrives later
   * through `onPanelReady`, and the window's `WindowManager` record opens
   * only then, as IWSDK's `UIWindowSystem.adoptWindow` opens it when the
   * entity gains its panel document (`window-system.ts`, `adoptWindow`).
   * `options` is plain data: `id`, `title` (defaults to the window id),
   * `dockMode` (world-locked for a window in a region), the four chrome
   * flags (all `false` unless asked), and any sizing the app passed. The
   * host draws nothing until the first `setWindowPose`.
   */
  createWindow(windowId: string, config: unknown, options: unknown): void;
  /** A window's panel has finished loading; `tree` is its element tree. Report once per window. */
  onPanelReady(
    cb: (windowId: string, panelId: string, tree: NativeElementNode) => void,
  ): () => void;
  /**
   * Write properties onto one element, as uikit's `setProperties` takes
   * them: `text` (a string), `display` (`"flex"` or `"none"`), colours and
   * layout values in uikit's own names and units. The binding writes the
   * title (`uix-title` text), the chrome buttons' `display`, the PIN and
   * MIN labels and the content's `display` this way, as
   * `window-system.ts` does (`applyChrome`, `syncPinLabel`,
   * `syncMinimizeLabel`, `applyMinimized`).
   */
  setProperties(panelId: string, elementHandle: string, props: Record<string, unknown>): void;
  /**
   * An element raised an event the host owns: a value change from a host
   * control. Delivered to that element only. Pointer presses, clicks, hover
   * enter and hover leave do NOT come through here: they are decided by the
   * binding from `onPointerSample` (the core press machines and the core
   * `HoverTracker`), and a `pointerenter` or `pointerleave` a host sends
   * here is ignored.
   */
  onElementEvent(
    cb: (panelId: string, elementHandle: string, type: string, payload: unknown) => void,
  ): () => void;
  /**
   * Apply, or remove, the hover style of one element: uikit's `:hover`
   * appearance on the web. The binding decides hover per element from the
   * pointer samples (the core rule: an element is hovered while any pointer
   * is over it, IWSDK's pointer events), and tells the host only on a
   * change. A host restyles and decides nothing. Without this member the
   * host shows no hover style, and the conformance kit fails it.
   */
  setHover?(panelId: string, elementHandle: string, hovered: boolean): void;
  /**
   * Scroll an element's content to `x`, `y` pixels from its top left, as
   * the binding decided (the core `ScrollState`: uikit's drag, coast and
   * rubber band, so the position may briefly lie past the range while it
   * springs back). The host draws the content at that offset and decides
   * nothing. Called whenever the position changes. Without this member
   * nothing scrolls on the host.
   */
  setScroll?(panelId: string, elementHandle: string, x: number, y: number): void;
  /**
   * Show the platform's system keyboard for a text field the user clicked,
   * with the field's current `value`; `multiline` asks for a return key
   * that inserts a line break, `type` is the HTML input type the field
   * declared. This is the web's hidden HTML input taking focus (uikit
   * `Input`). While it is up the host reports every change through
   * `onElementEvent` with type `"input"` and payload `{ value }` (the WHOLE
   * value, each time), and `"keyboardclosed"` when entry ended: the user
   * dismissed the keyboard, focus moved, or the binding called
   * `hideKeyboard`. A host that cannot observe the dismissal itself (an
   * Android `NativeActivity` host has no focus event from the system
   * keyboard) reports `"keyboardclosed"` from the two things it can see:
   * its own `hideKeyboard` (the binding calls it when a press lands outside
   * the field, on every platform), and a key event that ends entry (Enter on
   * a single-line field, Back or Escape). It never reports it twice for one
   * entry, and never before `"input"` with the value that ended it. The
   * binding writes the value onto the element and raises its `valueChanged`.
   * Without this member text cannot be entered.
   */
  showKeyboard?(panelId: string, elementHandle: string, request: { value: string; multiline: boolean; type: string }): void;
  /** Dismiss the keyboard from the app's side. */
  hideKeyboard?(): void;
  /**
   * Every pointer measurement this frame, one call per pointer. See
   * {@link NativePointerSample} for what to report and when. The binding
   * consumes them on its next `update`.
   */
  onPointerSample(cb: (sample: NativePointerSample) => void): () => void;
  /**
   * Place a window: draw its panel, and hit-test it, at `pose`. The binding
   * computes the pose every frame from the core rules - follow, hand menu,
   * region slot, drag - and has already moved it toward the viewer by the
   * focus bias (0.02 m per focus step, `window-system.ts` `update`). The
   * host applies it as given and never places a window itself. `depthOrder`
   * is the window's focus depth from `WindowManager.orderOf`: 0 is the
   * focused window; use it only to break draw-order ties. Called only when
   * the pose or depth changed.
   */
  setWindowPose(windowId: string, pose: PoseTuple, depthOrder: number): void;
  /** Constrain a panel to fit within `width` x `height` metres, keeping its aspect ratio. */
  setTargetDimensions(panelId: string, width: number, height: number): void;
  /** Release a panel's resources. */
  disposePanel(panelId: string): void;
  /**
   * A window's record changed. The host applies exactly two fields:
   * `hidden` (true: neither drawn nor hit-testable, state kept) and
   * `dockMode` (informational). `hidden` here is what should be SHOWN: it is
   * true when the record is hidden or a hand menu's palm gate is closed, as
   * `window-system.ts` `reconcilePresentation` combines them. Title, chrome
   * and labels arrive through `setProperties`, and the pose through
   * `setWindowPose`; the rest of the record is informational.
   */
  applyWindow(record: unknown): void;
  /** A window was closed through the `WindowManager`; tear it down on the host side too. */
  closeWindow(windowId: string): void;
}

/**
 * One tracked input source, as much of it as windows need: which hand, and
 * its grip pose. Structurally a subset of `InputSourceSnapshot` from
 * `@realitycollective/webxr-input`, so the `input` slice the Interactions
 * family reads serves here unchanged.
 */
export interface NativeUiInputSource {
  handedness: 'left' | 'right' | 'none';
  /** The WebXR grip space pose, the frame `hand-menu.ts` documents. */
  gripPose?: PoseTuple;
}

/**
 * The `input` slice, as far as windows use it: the viewer's head for
 * follow, focus bias and billboarding, the hands' grip poses for hand
 * menus, and the two members that draw the pointers. The same slice
 * `@realitycollective/native-interactions` reads and writes.
 */
export interface NativeUiInputHost {
  /** The viewer's head pose this frame, world space. Absent until the host tracks a head. */
  getHeadPose?(): HeadPose;
  /** This frame's tracked sources. A hand that is not tracked is absent. */
  sample(): readonly NativeUiInputSource[];
  /**
   * Draw this source's ray and cursor exactly as given, until told otherwise:
   * the ray only while `ray` is true, from `rayFrom` to `rayTo` metres along
   * the source's ray, and the cursor disc at `cursorPoint` (world space,
   * metres) only while `cursor` is true. The host decides none of it. This is
   * the member `@realitycollective/native-interactions` defines on the same
   * slice (`NativeInputHost.applyPointerVisuals`) and the record is the same.
   *
   * This binding calls it only when it was given no shared pointer arbiter
   * (`NativeWindowHostOptions.pointers`), which is an app with windows and no
   * interactables: once per frame for every source that reported a pointer
   * sample, `sourceId` being the sample's, and once more with `ray` and
   * `cursor` false when a source stops reporting. With a shared arbiter the
   * Interactions binding makes the calls. Optional: a host without it draws
   * no pointer for such an app. IWSDK: the ray and cursor it draws itself
   * for every hand (`RayPointer`, `CursorVisual`).
   */
  applyPointerVisuals?(sourceId: string, visuals: PresentedPointer): void;
  /**
   * The app's pointer display settings, handed over when the window host is
   * created and on every change (`PointerDisplay.set`), so a host can size
   * its meshes or log the configuration. Only when this binding presents the
   * pointers (see `applyPointerVisuals`). Informational: every per-frame
   * decision already arrives resolved in `applyPointerVisuals`, so a host
   * needs nothing from here to draw correctly. Optional. The same member
   * `@realitycollective/native-interactions` defines.
   */
  applyPointerDisplay?(config: PointerDisplayConfig): void;
}

/** The app's frame callback, the root member of `__rcHost`. Delta in seconds. */
export interface NativeUiFrameSource {
  onFrame(callback: (timestampMs: number, deltaS: number) => void): () => void;
}

/**
 * Test-only readbacks a host provides so the host conformance kit
 * (`nativeUiHostConformanceCases`) can check what the host actually did. A
 * shipping host may omit them; a device test build installs them, for
 * example under `__rcShell.testHost`.
 */
export interface NativeUiTestHost {
  /** The pose the host is drawing the window at now, or `undefined` before one was applied. */
  windowPose(windowId: string): PoseTuple | undefined;
  /** Whether the host is hiding the window now (not drawn, not hit-testable). */
  windowHidden(windowId: string): boolean | undefined;
  /** Every property the host has applied to the element with markup `elementId`, merged. */
  elementProperties(windowId: string, elementId: string): Record<string, unknown> | undefined;
  /**
   * What the host would report as a `touch` sample for a fingertip at world
   * `point` near the window's panel: the signed distance (metres, positive in
   * front, along the panel's normal) and the markup id of the element under
   * it, or `undefined` when the point is not over the panel. Lets a test
   * check the host's measurement without a hand.
   */
  measureTouch(windowId: string, point: Vec3Tuple): { signedDistance: number; elementId: string | null } | undefined;
  /** Whether the host is drawing the element with markup `elementId` in its hover style now, as last told through `setHover`. Optional; the hover case fails without it. */
  elementHovered?(windowId: string, elementId: string): boolean | undefined;
  /** The host's own ids for the element with markup `elementId` in a window's panel, so a case can address it. Optional; the hover case fails without it. */
  elementHandle?(windowId: string, elementId: string): { panelId: string; elementHandle: string } | undefined;
  /** The scroll offset the host draws an element's content at now, pixels, as last told through `setScroll`. Optional; the scroll case fails without it. */
  scrollPosition?(windowId: string, elementId: string): [number, number] | undefined;
  /** The keyboard the host is showing now, or null. Optional; the keyboard case fails without it. */
  keyboardShown?(): { panelId: string; elementHandle: string; value: string } | null;
}

/** The shape of `globalThis.__rcHost` this package cares about. */
interface RcHostLike {
  ui?: NativeUiHost;
  input?: NativeUiInputHost;
  onFrame?: NativeUiFrameSource['onFrame'];
}

function installedHost(): RcHostLike | undefined {
  return (globalThis as { __rcHost?: RcHostLike }).__rcHost;
}

/**
 * Reads the `ui` slice: the host given (for tests, or a caller that already
 * holds one), or `globalThis.__rcHost.ui`. Every slice except the root is
 * optional, so a native app that has not installed `ui` yet gets one clear
 * error naming the slice, at construction, rather than a confusing failure
 * later.
 */
export function readNativeUiHost(host?: NativeUiHost): NativeUiHost {
  if (host) {
    return host;
  }
  const slice = installedHost()?.ui;
  if (!slice) {
    throw new Error(
      '[native-uiextensions] globalThis.__rcHost.ui is missing - the native host has not installed the "ui" slice.',
    );
  }
  return slice;
}

/** The `input` slice given, or `globalThis.__rcHost.input`, or `undefined`: windows then neither follow nor ride a hand. */
export function readNativeUiInput(input?: NativeUiInputHost): NativeUiInputHost | undefined {
  return input ?? installedHost()?.input;
}

/** The frame source given, or `globalThis.__rcHost`'s `onFrame`. Throws naming it when neither exists. */
export function readNativeUiFrames(frames?: NativeUiFrameSource): NativeUiFrameSource {
  if (frames) {
    return frames;
  }
  const root = installedHost();
  if (!root?.onFrame) {
    throw new Error(
      '[native-uiextensions] attachToHost needs a frame source, and globalThis.__rcHost.onFrame is not installed. Pass `frames`, or call update(dt) yourself.',
    );
  }
  const onFrame = root.onFrame.bind(root);
  return { onFrame };
}
