/**
 * Platform-adapter contract.
 *
 * The core package owns every UX decision - window lifecycle, dock state,
 * region slot math, drag math, control models - and knows nothing about any
 * engine. An engine adapter supplies the three capabilities the core cannot
 * provide for itself, and drives the core from its own frame loop:
 *
 *  - {@link PanelHost}: turn compiled UIKitML JSON into a live spatial panel
 *  - {@link PointerInputSource}: deliver ray/pointer press-move-release
 *  - {@link HeadPoseSource}: the viewer pose, for follow mode & body-lock
 *
 * On top of those, {@link WindowHost} adds the portable window surface:
 * {@link WindowHost.onPanelReady} for readiness, {@link PanelReadyEvent.kind}
 * to tell a managed window from a bare panel, and
 * {@link WindowHost.supportsStandalonePanels} to say whether `createPanel` is
 * usable at all. Each adapter's own `createWindow` returns a
 * {@link WindowHandle} and takes options extending {@link WindowOptionsBase},
 * so window code reads the same on every engine even though the `config`
 * payload does not.
 *
 * Known adapters:
 *  - `@realitycollective/iwsdk-uiextensions` - Meta IWSDK (ECS systems bind
 *    these capabilities to `@iwsdk/core` components)
 *  - `@realitycollective/xrblocks-uiextensions` - Google XR Blocks / plain
 *    three.js (experimental)
 *
 * The interfaces use plain tuples/records only - no engine, no three.js.
 */
import type { DockModeValue } from './core/dock-state.js';
import type { UixElement } from './controls/element.js';

/** Position as [x, y, z] in meters, world space unless stated otherwise. */
export type Vec3Tuple = [number, number, number];

/** Orientation quaternion as [x, y, z, w]. */
export type QuatTuple = [number, number, number, number];

/** A viewer (head) pose sample. */
export interface HeadPose {
  position: Vec3Tuple;
  quaternion: QuatTuple;
}

/** Supplies the viewer pose each frame - camera on desktop, HMD in XR. */
export interface HeadPoseSource {
  getHeadPose(): HeadPose;
}

/**
 * A live spatial panel created from compiled UIKitML JSON.
 * The `root` is traversable with the core's `walk`/`findRole` helpers and
 * the `data-uix` control upgraders - identical markup works on every
 * adapter.
 */
export interface PanelHandle {
  /** Root element of the interpreted panel (UixElement-conformant). */
  readonly root: UixElement;
  /** Look up an element by its markup `id`. */
  getElementById(id: string): UixElement | undefined;
  /** Constrain the panel to fit within width × height meters. */
  setTargetDimensions(width: number, height: number): void;
  /** Release panel resources. */
  dispose(): void;
}

/** Creates spatial panels - the engine-specific half of UIKitML rendering. */
export interface PanelHost {
  /**
   * Create a panel from compiled UIKitML JSON (the `{ element, classes }`
   * shape produced by the build plugin or by
   * `@realitycollective/uix-devtools`' `compilePanelSource`).
   */
  createPanel(configJson: unknown): PanelHandle;
}

/**
 * A window whose panel has finished loading and is ready to be wired.
 * Delivered by {@link WindowHost.onPanelReady}.
 */
export interface PanelReadyEvent {
  /** The window's id, as given to the scene descriptor / create call. */
  id: string;
  /** The live panel - traverse it, or look elements up by markup id. */
  panel: PanelHandle;
  /**
   * What became ready.
   *
   * - `window` - created through the adapter's window factory and managed by
   *   the window manager, so `id` is the id the caller asked for.
   * - `panel` - a bare panel the adapter noticed. `id` is then the adapter's
   *   best stable identifier for it, which on IWSDK is the panel's config
   *   path.
   *
   * Left optional so existing listeners keep compiling; adapters set it.
   */
  kind?: 'window' | 'panel';
}

/**
 * The engine-agnostic surface an app needs to build a UI: spawn windows and
 * regions from portable data, observe when panels become wireable, and reach
 * the shared `WindowManager`.
 *
 * Panels load asynchronously on every adapter (IWSDK fetches the config;
 * uikit lays out over following frames), so app code must never assume a
 * panel exists immediately after creating its window. {@link onPanelReady}
 * is the portable answer - it replaces engine-specific discovery (ECS
 * queries on IWSDK, polling anywhere else) and fires for panels that became
 * ready before the listener was registered, so wiring order never matters.
 */
export interface WindowHost extends PanelHost {
  /**
   * Whether {@link PanelHost.createPanel} works on this host. When `false`
   * the method is not available and throws; spawn a window instead, so the
   * engine owns the panel lifecycle. IWSDK is `false`, three.js/XR Blocks is
   * `true`.
   */
  readonly supportsStandalonePanels: boolean;
  /**
   * Subscribe to panel readiness. Late subscribers are replayed the windows
   * that are already live. Returns an unsubscribe function.
   */
  onPanelReady(listener: (event: PanelReadyEvent) => void): () => void;
}

/**
 * A window an adapter spawned, before its panel necessarily exists.
 *
 * `createWindow` itself stays adapter-specific because the `config` payload
 * differs per engine, but what it hands back is the same everywhere: an id, a
 * panel once there is one, and a one-shot readiness callback.
 */
export interface WindowHandle {
  /** The window's id - the one passed in, or one the adapter generated. */
  readonly id: string;
  /**
   * The live panel, or `undefined` until the adapter has attached the
   * document. IWSDK loads and parses the markup over later frames; the
   * three.js host interprets it during `createWindow`, so there it is set
   * straight away.
   */
  readonly panel: PanelHandle | undefined;
  /**
   * Run `listener` once, when the panel is attached. Fires immediately if it
   * already is, so wiring order never matters. Returns an unsubscribe
   * function for the case where the caller gives up first.
   */
  onReady(listener: (panel: PanelHandle) => void): () => void;
}

/**
 * The window options every adapter understands.
 *
 * An adapter's own `CreateWindowOptions` extends this and adds only what its
 * engine needs - chiefly `config`, whose type differs (IWSDK takes a source
 * path, the three.js host takes parsed markup). Keeping the rest here is what
 * lets one `SceneWindow` map onto every adapter without a translation table.
 */
export interface WindowOptionsBase {
  /** Stable window id. Adapters generate one when it is absent. */
  id?: string;
  /** Title text written into the window chrome's title element. */
  title?: string;
  dockMode?: DockModeValue;
  /** World position for world-locked windows. */
  position?: Vec3Tuple;
  /** Fit the panel into this box in meters, preserving aspect ratio. */
  maxWidth?: number;
  maxHeight?: number;
  /** Whether the title bar drags the window. */
  movable?: boolean;
  closable?: boolean;
  minimizable?: boolean;
  pinnable?: boolean;
  /** Head-relative offset used in body-follow mode (meters). */
  followOffset?: Vec3Tuple;
  followSpeed?: number;
  followTolerance?: number;
  /** Dock straight into this region on spawn. */
  region?: string;
}

/** One pointer/ray interaction stream, engine-normalised. */
export interface PointerSample {
  /** Pointer world position (ray origin or touch point). */
  origin: Vec3Tuple;
  /** Normalised pointing direction. */
  direction: Vec3Tuple;
}

/**
 * Delivers press-move-release for one interaction source (a controller ray,
 * a hand pinch, a mouse). The core's `hold-to-drag` and `drag-math` consume
 * these; the adapter decides what constitutes press/release.
 */
export interface PointerInputSource {
  onPress(listener: (sample: PointerSample) => void): () => void;
  onMove(listener: (sample: PointerSample) => void): () => void;
  onRelease(listener: (sample: PointerSample) => void): () => void;
}
