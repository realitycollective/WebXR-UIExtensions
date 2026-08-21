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
 * Known adapters:
 *  - `@realitycollective/iwsdk-uiextensions` - Meta IWSDK (ECS systems bind
 *    these capabilities to `@iwsdk/core` components)
 *  - `@realitycollective/xrblocks-uiextensions` - Google XR Blocks / plain
 *    three.js (experimental)
 *
 * The interfaces use plain tuples/records only - no engine, no three.js.
 */
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
   * Subscribe to panel readiness. Late subscribers are replayed the windows
   * that are already live. Returns an unsubscribe function.
   */
  onPanelReady(listener: (event: PanelReadyEvent) => void): () => void;
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
