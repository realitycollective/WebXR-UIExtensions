/**
 * ECS components for UI Extensions.
 *
 * These compose with the IWSDK's own components — a window entity typically
 * carries `PanelUI` (the IWSDK loads/renders the panel), `UIWindow` (ours),
 * and the IWSDK interaction tags (`RayInteractable`, `PokeInteractable`).
 * The systems in this package add/remove the IWSDK `Follower` / `ScreenSpace`
 * components to realise dock modes rather than re-implementing them.
 */
import { Types, createComponent } from '@iwsdk/core';
import { DockMode } from '@realitycollective/webxr-uiextensions';

/** Region flow options mirrored as an enum object for the component schema. */
export const RegionFlowType = {
  Row: 'row',
  Column: 'column',
  Grid: 'grid',
} as const;

/**
 * Marks a panel entity as a managed window with chrome, focus, docking and
 * drag behaviour. Pair with `PanelUI` whose markup contains the window chrome
 * elements (see `WINDOW_CHROME_IDS` / the Examples folder).
 */
export const UIWindow = createComponent(
  'UIWindow',
  {
    /** Stable id; auto-generated when empty. */
    windowId: { type: Types.String, default: '' },
    /** Title text written into the `uix-title` element. */
    title: { type: Types.String, default: '' },
    /** Current dock state. */
    dockMode: { type: Types.Enum, enum: DockMode, default: DockMode.WorldLocked },
    /** Whether the title bar drags the window. */
    movable: { type: Types.Boolean, default: true },
    /** Show/enable the close affordance. */
    closable: { type: Types.Boolean, default: true },
    /** Show/enable the minimize affordance. */
    minimizable: { type: Types.Boolean, default: true },
    /** Show/enable the pin (body-follow ⇄ world-locked) affordance. */
    pinnable: { type: Types.Boolean, default: true },
    /** Keep the window yawed toward the viewer while it is being dragged. */
    billboardWhileDragging: { type: Types.Boolean, default: true },
    /**
     * Seconds a title-bar press must be held before it becomes a drag.
     * Shorter presses stay clicks, so title-bar buttons don't fight the drag.
     */
    dragDelay: { type: Types.Float32, default: 0.3 },
    /** Head-relative offset used in `body-follow` mode (meters). */
    followOffset: { type: Types.Vec3, default: [0, -0.15, -1.2] },
    /** `Follower` lerp speed for body-follow. */
    followSpeed: { type: Types.Float32, default: 3 },
    /** `Follower` positional deadzone for body-follow (meters). */
    followTolerance: { type: Types.Float32, default: 0.35 },
    /** Meters the focused window is nudged toward the viewer per focus depth. */
    focusBias: { type: Types.Float32, default: 0.02 },
    /**
     * World size box in meters, applied via `UIKitDocument.setTargetDimensions`
     * once the document loads. IWSDK 0.5 removed `PanelUI.maxWidth/maxHeight`;
     * this is the supported replacement. `0` leaves the document at its
     * intrinsic markup size, scaled only by the entity transform.
     */
    targetWidth: { type: Types.Float32, default: 0 },
    targetHeight: { type: Types.Float32, default: 0 },
  },
  'UI Extensions managed window (chrome, focus, docking, drag)',
);

/**
 * Internal bookkeeping the systems keep on window entities — which dock mode
 * has actually been applied to engine components, and whether chrome wiring
 * has run for the current PanelDocument.
 */
export const UIWindowState = createComponent(
  'UIWindowState',
  {
    appliedDockMode: { type: Types.String, default: '' },
    chromeWired: { type: Types.Boolean, default: false },
    /** "Home" snapshot captured on adoption — the DOCK button returns here. */
    homeDockMode: { type: Types.String, default: '' },
    homeRegion: { type: Types.String, default: '' },
    homePosition: { type: Types.Vec3, default: [0, 0, 0] },
    homeYaw: { type: Types.Float32, default: 0 },
  },
  'Internal UI Extensions window bookkeeping',
);

/**
 * A named layout region that docked windows snap to and are laid out within.
 * Place the entity where the region should live (it can itself carry a
 * `Follower` to make a body-locked region).
 */
export const UIDockRegion = createComponent(
  'UIDockRegion',
  {
    regionId: { type: Types.String, default: '' },
    flow: { type: Types.Enum, enum: RegionFlowType, default: RegionFlowType.Column },
    /** Distance between slot origins (meters). */
    pitch: { type: Types.Float32, default: 0.35 },
    /** Columns per row (grid flow only). */
    columns: { type: Types.Float32, default: 2 },
    /** Max docked windows (0 = unlimited). */
    capacity: { type: Types.Float32, default: 0 },
    /** Drop-capture radius (meters). */
    snapRadius: { type: Types.Float32, default: 0.5 },
  },
  'UI Extensions layout region for docking windows',
);

/** Present on a window entity while it is docked into a region. */
export const UIDockedTo = createComponent(
  'UIDockedTo',
  {
    regionId: { type: Types.String, default: '' },
  },
  'Marks a UI Extensions window as docked into a region',
);
