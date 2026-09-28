/**
 * UixWindowHost - the engine binding for plain three.js WebXR scenes.
 *
 * Owns a core `WindowManager` + `RegionRegistry` and applies their decisions
 * to the scene graph: spawn UIKitML windows and dock regions, wire chrome
 * buttons (focus / PIN / DOCK / MIN / X), collapse content while minimized,
 * hide and show, place docked windows into their region's slots, return a
 * window to where it spawned, ease `body-follow` windows (and body-locked
 * regions) toward the viewer each frame, ride `hand-locked` windows (hand
 * menus) on a tracked hand behind the palm gate, and draw the focused window
 * nearer the viewer than the ones behind it (`applyFocusBias`).
 *
 * Every panel it creates is also wired to a scene pointer bridge
 * (`pointer-bridge.ts`'s `ScenePointerBridge` by default), which turns
 * resolved hit-test decisions into `pointerdown`/`pointerup`/`click`/
 * `pointerenter`/`pointerleave` events and drives the core `TouchPress` for
 * poke - a ray or grab clicks on release, never on intersection. A press on a
 * title bar runs the core `TitlebarDragController`: hold-to-drag (a ray
 * waits out `dragDelay`, a grab starts at once), drag math, billboard while
 * dragging, and drop capture into a region.
 *
 * This class is not tied to any one interaction source: `pointerBridgeFactory`
 * lets a caller supply its own bridge, which is how
 * `@realitycollective/xrblocks-uiextensions` reuses every rule below and adds
 * only Google XR Blocks' own select/touch/grab/hover callbacks
 * (`XrBlocksPointerBridge`) on top - "one behaviour, every platform": the
 * window/panel/region logic lives here, once, and a platform binding adds
 * only how it decides what was pressed.
 *
 * The manager is the API app code drives; every manager event is applied
 * here, so `host.manager.hide(id)` or `.dockTo(id, region)` from a hand menu
 * is all a caller needs.
 *
 * It implements the core's `WindowHost` (so app code can wire behaviour
 * through `onPanelReady` with no engine knowledge) and `SceneTarget` (so a
 * portable `SceneDescriptor` builds the same playground here as on IWSDK).
 */
import { Group, type Object3D } from 'three';
import { parse, type Kit } from '@pmndrs/uikitml';

/**
 * Default `config` resolver: fetch UIKitML source and parse it.
 *
 * IWSDK 0.5 dropped the build-time compile step and parses `PanelUI.config`
 * as source at runtime, so descriptors carry `.uikitml` paths. This parses the
 * same file for the three.js and XR Blocks hosts, which interpret an AST.
 */
async function loadUikitmlSource(path: string): Promise<unknown> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`UIKitML source ${path} -> HTTP ${response.status}`);
  }
  return parse(await response.text());
}
import {
  DEFAULT_BILLBOARD_WHILE_DRAGGING,
  DEFAULT_DRAG_DELAY,
  DEFAULT_FOCUS_BIAS,
  DockMode,
  RegionRegistry,
  DEFAULT_REGION_FOLLOW,
  DEFAULT_WINDOW_FOLLOW,
  TitlebarDragController,
  WINDOW_CHROME_IDS,
  WindowManager,
  applyFocusBias,
  enterFollow,
  evaluateHandMenu,
  focusBiasAmount,
  followOffsetFromPose,
  intersectRayPlane,
  resolveFollow,
  regionSlotPose,
  stepFollow,
  upgradePanel,
  type FollowState,
  minimizeLabelFor,
  pinLabelFor,
  type HandPoseSource,
  type HandPoses,
  type HeadPoseSource,
  type PanelHandle,
  type PanelReadyEvent,
  type PoseTuple,
  type RayTuple,
  type RegionDefinition,
  type WindowChrome,
  type WindowRecord,
  type SceneRegion,
  type SceneTarget,
  type SceneWindow,
  type UixElement,
  type Vec3,
  type Vec3Tuple,
  type WindowHandle as CoreWindowHandle,
  type WindowHost,
  type WindowOptionsBase,
} from '@realitycollective/webxr-uiextensions';
import { UixPanelDocument } from './panel-document.js';
import { ScenePointerBridge, worldForwardOf, worldPositionOf } from './pointer-bridge.js';
import { rayOf, type RayInputAccess } from './ray-input.js';

/**
 * Options for {@link UixWindowHost.createWindow}.
 *
 * Everything but `config` comes from the portable {@link WindowOptionsBase},
 * so an option means the same thing here as on the IWSDK adapter. `id` is
 * optional: leave it out and the host names the window `uix-window-<n>`.
 */
export interface CreateWindowOptions extends WindowOptionsBase {
  /** Compiled UIKitML JSON (the `{ element, classes }` shape). */
  config: unknown;
  /** Keep the window yawed toward the viewer while it is being dragged. Default `true`, as on IWSDK and native. */
  billboardWhileDragging?: boolean;
}

export interface CreateRegionOptions extends Partial<RegionDefinition> {
  id: string;
  position?: Vec3Tuple;
  /** Body-lock the region so it follows the viewer. */
  follow?: boolean;
  followOffset?: Vec3Tuple;
}

/**
 * A window spawned by {@link UixWindowHost.createWindow}.
 *
 * Satisfies the core {@link CoreWindowHandle} and adds the three.js specifics.
 * `panel` is the document itself, which already implements `PanelHandle`, and
 * is never `undefined` here: uikitml interprets the markup synchronously, so
 * the panel exists the moment `createWindow` returns.
 */
export interface ThreeJsWindowHandle extends CoreWindowHandle {
  readonly id: string;
  /** The scene-graph node - position/rotate freely. */
  group: Group;
  document: UixPanelDocument;
  /** Same object as {@link document}, under the portable name. */
  readonly panel: UixPanelDocument;
  onReady(listener: (panel: PanelHandle) => void): () => void;
}

/** Back-compatible name for {@link ThreeJsWindowHandle}. */
export type WindowHandle = ThreeJsWindowHandle;

/**
 * Back-compatible name for {@link ThreeJsWindowHandle}: the XR Blocks binding
 * exported it under this name before its host moved into this package -
 * `@realitycollective/xrblocks-uiextensions` re-exports it unchanged.
 */
export type XrBlocksWindowHandle = ThreeJsWindowHandle;

export interface RegionHandle {
  id: string;
  group: Group;
}

/** The minimum a pointer bridge must do for {@link UixWindowHost} to drive it: register every panel it creates so the bridge can resolve interactions against it. */
export interface PointerBridgeLike {
  wire(root: Object3D): void;
}

export interface UixWindowHostOptions {
  /** Parent for spawned windows (the scene, or any group inside it). */
  scene: Object3D;
  /** Viewer pose provider - camera on desktop, HMD pose in XR. */
  headPose: HeadPoseSource;
  /**
   * Tracked-hand pose provider, for `hand-locked` windows (hand menus). See
   * `webxrHandPoseSource` for one backed by a WebXR session. Leave it out
   * where there are no hands (a desktop) and hand-locked windows fall back
   * to body-follow placement, so the same scene still shows its menus.
   */
  handPose?: HandPoseSource;
  /** Optional UIKitML component kit(s) (e.g. horizon kit). */
  kit?: Kit;
  /**
   * Resolver for a window's `config` when it arrives as a string path (as
   * portable `SceneDescriptor`s carry it).
   *
   * Defaults to fetching the `.uikitml` source and parsing it, which is the
   * same artefact IWSDK loads - so one markup file serves every adapter and
   * no build step is required. Override only for an unusual transport; you do
   * not need to supply this to load a normal panel.
   */
  loadConfig?: (path: string) => Promise<unknown>;
  /** Upgrade every panel's `data-uix` controls, as IWSDK's `UIControlsSystem` does. Default `true`. */
  controls?: boolean;
  /**
   * Read for a title-bar ray drag's live ray every frame
   * (`ray-input.ts`'s `rayOf`), so it rides the ray at a fixed distance the
   * way IWSDK and native do (`beginDrag`/`dragPosition`), rather than by the
   * controller's own position. Leave it out and a ray drag falls back to
   * that point-delta math instead - correct, but not laser-distance-exact.
   */
  rayInput?: RayInputAccess;
  /**
   * Factory for the pointer bridge that turns engine-resolved interaction
   * decisions into `pointerdown`/`pointerup`/`click`/`pointerenter`/
   * `pointerleave` events and touch samples. Defaults to `ScenePointerBridge`,
   * this package's own three.js raycasting bridge, driven by
   * `connectWebXrPointerInput` from a live WebXR session. A binding whose SDK
   * already resolves hit-testing itself (XR Blocks) supplies its own -
   * `isLive` is bound to this host's own presence/gate check either way, so a
   * hidden or gated window is never interactive on any bridge.
   */
  pointerBridgeFactory?: (isLive: (element: Object3D) => boolean) => PointerBridgeLike;
}

interface FollowOptions {
  followOffset: Vec3Tuple;
  followSpeed: number;
  followTolerance: number;
}

interface WindowState {
  handle: ThreeJsWindowHandle;
  /** Where the window spawned, for `returnHome`. */
  home: { region: string | undefined; position: Vec3Tuple; dockMode: WindowRecord['dockMode'] };
  /** Whether the title bar drags the window. */
  movable: boolean;
  options: FollowOptions;
  content: UixElement | undefined;
  pin: UixElement | undefined;
  minimize: UixElement | undefined;
  /** Every chrome button by its role, for `chromeChanged`. */
  buttons: Record<keyof WindowChrome, UixElement | undefined>;
  /** Hand-menu palm gate this frame; always open in the other dock modes. */
  gateOpen: boolean;
  /** The core follow state while the window follows; `undefined` otherwise. */
  follow: FollowState | undefined;
  /** The offset the current follow uses: the configured one, or where the window was unpinned. */
  followOffset: Vec3Tuple;
  /** Whether a frame has placed this window yet (the first follow uses the configured offset). */
  placed: boolean;
  /** Hold-to-drag, drag math, billboard and drop capture - the core `TitlebarDragController` (`titlebar-drag.ts`). */
  readonly drag: TitlebarDragController;
  /**
   * The pointer currently holding the title bar, while a press is candidate
   * or dragging - a ray's controller (read from `rayInput` each frame for
   * its live ray) or a grab's hand (read for its live world position).
   */
  dragOwner:
    | { kind: 'ray'; controller: Object3D; usesRay: boolean }
    | { kind: 'grab'; hand: Object3D }
    | undefined;
  /**
   * The window's own position, before focus bias - written by whichever
   * placement ran this frame (follow, hand menu, drag), and read back
   * unchanged by `applyFocusBias`. `group.position` itself is not a safe
   * baseline: it carries the PREVIOUS frame's bias, and re-biasing an
   * already-biased position would compound it, or leave a former focused
   * window stuck nudged forward after it loses focus.
   */
  truePosition: Vec3Tuple;
}

interface RegionState {
  handle: RegionHandle;
  follow: boolean;
  followOffset: Vec3Tuple;
  /** The core follow state of a following region. */
  followState: FollowState;
}

const DEFAULT_FOLLOW_OFFSET: Vec3Tuple = [...DEFAULT_WINDOW_FOLLOW.offset] as Vec3Tuple;
const DEFAULT_REGION_FOLLOW_OFFSET: Vec3Tuple = [...DEFAULT_REGION_FOLLOW.offset] as Vec3Tuple;

/** A group's current pose, as the core's plain `PoseTuple`. */
function poseOf(group: Object3D): PoseTuple {
  return {
    position: [group.position.x, group.position.y, group.position.z],
    quaternion: [group.quaternion.x, group.quaternion.y, group.quaternion.z, group.quaternion.w],
  };
}

/** Write a core `PoseTuple` back onto a group. */
function applyPose(group: Object3D, pose: PoseTuple): void {
  group.position.set(...pose.position);
  group.quaternion.set(...pose.quaternion);
}

export class UixWindowHost implements WindowHost, SceneTarget {
  /** Bare panels work here - the host does not own a panel lifecycle. */
  readonly supportsStandalonePanels: boolean = true;
  readonly manager = new WindowManager();
  readonly regions = new RegionRegistry();
  private readonly scene: Object3D;
  private readonly headPose: HeadPoseSource;
  private readonly handPose: HandPoseSource | undefined;
  private readonly kit: Kit | undefined;
  private readonly loadConfig: (path: string) => Promise<unknown>;
  private readonly controls: boolean;
  private readonly rayInput: RayInputAccess | undefined;
  private readonly states = new Map<string, WindowState>();
  private readonly regionStates = new Map<string, RegionState>();
  private readonly readyListeners = new Set<(event: PanelReadyEvent) => void>();
  /** Panels already live - replayed to late `onPanelReady` subscribers. */
  private readonly ready = new Map<string, PanelReadyEvent>();
  /** Feeds `uix-window-<n>` ids to windows created without one. */
  private windowSequence = 0;
  /** Turns resolved interaction decisions into pointer events and touch samples (`pointer-bridge.ts`, or a caller's own bridge). */
  private readonly pointerBridge: PointerBridgeLike;
  /** A panel's root component -> the window id it belongs to, so the bridge can gate a hidden or gated window. Bare panels are never in here, and are always live. */
  private readonly panelWindowIds = new WeakMap<Object3D, string>();
  /** Every manager subscription, released by {@link dispose}. */
  private readonly subscriptions: Array<() => void> = [];
  private disposed = false;

  constructor(options: UixWindowHostOptions) {
    this.scene = options.scene;
    this.headPose = options.headPose;
    this.handPose = options.handPose;
    this.kit = options.kit;
    this.loadConfig = options.loadConfig ?? loadUikitmlSource;
    this.controls = options.controls !== false;
    this.rayInput = options.rayInput;
    const buildBridge = options.pointerBridgeFactory ?? ((isLive: (element: Object3D) => boolean) => new ScenePointerBridge({ isLive }));
    this.pointerBridge = buildBridge((element) => this.isElementLive(element));

    this.subscriptions.push(this.manager.events.on('closed', (record) => {
      const state = this.states.get(record.id);
      if (state) {
        this.states.delete(record.id);
        this.ready.delete(record.id);
        this.regions.undock(record.id);
        state.handle.document.dispose();
        state.handle.group.removeFromParent();
        this.layoutRegions();
      }
    }));
    this.subscriptions.push(this.manager.events.on('hidden', (record) => {
      this.applyPresentation(record.id);
    }));
    this.subscriptions.push(this.manager.events.on('shown', (record) => {
      this.applyPresentation(record.id);
    }));
    this.subscriptions.push(this.manager.events.on('dockChanged', ({ window, previous }) => {
      if (previous === DockMode.HandLocked) {
        // Off the hand: the gate no longer applies.
        const state = this.states.get(window.id);
        if (state) {
          state.gateOpen = true;
          this.applyPresentation(window.id);
        }
      }
    }));
    this.subscriptions.push(this.manager.events.on('followChanged', ({ window }) => {
      // A new offset re-aims a following window; a placed one takes it when it next follows.
      const state = this.states.get(window.id);
      if (state) state.followOffset = [...window.follow.offset] as Vec3Tuple;
    }));
    this.subscriptions.push(this.manager.events.on('regionChanged', ({ window }) => {
      this.applyRegion(window);
    }));
    this.subscriptions.push(this.manager.events.on('returnHome', (record) => {
      this.returnHome(record.id);
    }));
    this.subscriptions.push(this.manager.events.on('chromeChanged', ({ window }) => {
      this.applyChrome(window);
    }));
    this.subscriptions.push(this.manager.events.on('minimized', (record) => {
      this.setContentCollapsed(record.id, true);
      this.syncMinimizeLabel(record.id);
    }));
    this.subscriptions.push(this.manager.events.on('restored', (record) => {
      this.setContentCollapsed(record.id, false);
      this.syncMinimizeLabel(record.id);
    }));
    this.subscriptions.push(this.manager.events.on('dockChanged', ({ window }) => {
      this.syncPinLabel(window.id);
    }));
  }

  // --- WindowHost -----------------------------------------------------------

  /**
   * PanelHost - bare panel, unmanaged (used by devtools and tests). Always
   * available here, which is what `supportsStandalonePanels` reports.
   */
  createPanel(configJson: unknown): UixPanelDocument {
    const panel = new UixPanelDocument(configJson, this.kit);
    if (this.controls) upgradePanel(panel.root, panel.root);
    this.pointerBridge.wire(panel.rootComponent);
    return panel;
  }

  /**
   * Observe panel readiness. Windows already live are replayed immediately,
   * so wiring code never races window creation.
   */
  onPanelReady(listener: (event: PanelReadyEvent) => void): () => void {
    this.readyListeners.add(listener);
    for (const event of this.ready.values()) {
      listener(event);
    }
    return () => void this.readyListeners.delete(listener);
  }

  /**
   * Leave nothing behind: close every window through the manager, so each
   * goes down the normal close path (its document disposed, its group
   * removed), remove the region groups this host added to the scene, then
   * release every manager subscription. Safe to call twice.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of [...this.states.keys()]) {
      if (this.manager.has(id)) this.manager.close(id);
    }
    for (const region of this.regionStates.values()) {
      region.handle.group.removeFromParent();
    }
    this.regionStates.clear();
    this.ready.clear();
    this.readyListeners.clear();
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.length = 0;
  }

  // --- SceneTarget (portable scene descriptors) -----------------------------

  spawnRegion(region: SceneRegion): void {
    this.createRegion({
      id: region.id,
      ...(region.flow !== undefined ? { flow: region.flow } : {}),
      ...(region.pitch !== undefined ? { pitch: region.pitch } : {}),
      ...(region.columns !== undefined ? { columns: region.columns } : {}),
      ...(region.capacity !== undefined ? { capacity: region.capacity } : {}),
      ...(region.snapRadius !== undefined ? { snapRadius: region.snapRadius } : {}),
      ...(region.position !== undefined
        ? { position: [...region.position] as Vec3Tuple }
        : {}),
      ...(region.follow !== undefined ? { follow: region.follow } : {}),
      ...(region.followOffset !== undefined
        ? { followOffset: [...region.followOffset] as Vec3Tuple }
        : {}),
    });
  }

  /**
   * Scene descriptors carry config PATHS; this resolves the path and spawns
   * the window when it arrives. Fire-and-forget by design - subscribe with
   * {@link onPanelReady} to wire behaviour once the panel exists.
   */
  spawnWindow(window: SceneWindow): void {
    void this.loadConfig(window.config)
      .then((config) => {
        this.createWindow({
          id: window.id,
          config,
          title: window.title,
          ...(window.position !== undefined
            ? { position: [...window.position] as Vec3Tuple }
            : {}),
          ...(window.maxWidth !== undefined ? { maxWidth: window.maxWidth } : {}),
          ...(window.maxHeight !== undefined ? { maxHeight: window.maxHeight } : {}),
          ...(window.dockMode !== undefined ? { dockMode: window.dockMode } : {}),
          ...(window.region !== undefined ? { region: window.region } : {}),
          ...(window.followOffset !== undefined
            ? { followOffset: [...window.followOffset] as Vec3Tuple }
            : {}),
          ...(window.followSpeed !== undefined
            ? { followSpeed: window.followSpeed }
            : {}),
          ...(window.followTolerance !== undefined
            ? { followTolerance: window.followTolerance }
            : {}),
          ...(window.movable !== undefined ? { movable: window.movable } : {}),
          ...(window.closable !== undefined ? { closable: window.closable } : {}),
          ...(window.minimizable !== undefined
            ? { minimizable: window.minimizable }
            : {}),
          ...(window.pinnable !== undefined ? { pinnable: window.pinnable } : {}),
          ...(window.dockable !== undefined ? { dockable: window.dockable } : {}),
          ...(window.handMenu !== undefined ? { handMenu: window.handMenu } : {}),
        });
      })
      .catch((error) => {
        console.error(`[uix] failed to load panel "${window.id}":`, error);
      });
  }

  // --- Regions --------------------------------------------------------------

  /** Create a dock region anchored in the scene. */
  createRegion(options: CreateRegionOptions): RegionHandle {
    const { id, position, follow, followOffset, ...definition } = options;
    this.regions.register(id, definition);

    const group = new Group();
    group.name = `uix-region:${id}`;
    if (position) {
      group.position.set(...position);
    }
    this.scene.add(group);

    const handle: RegionHandle = { id, group };
    this.regionStates.set(id, {
      handle,
      follow: follow ?? false,
      followOffset: followOffset ?? DEFAULT_REGION_FOLLOW_OFFSET,
      // A new follower snaps on its first frame, as IWSDK's needsPositionSync.
      followState: enterFollow(position ? [...position] : [0, 0, 0]),
    });
    return handle;
  }

  region(id: string): RegionHandle | undefined {
    return this.regionStates.get(id)?.handle;
  }

  /**
   * Dock a window into a region (or undock it with `undefined`). A thin
   * forwarder to the manager, kept so existing callers read the same;
   * `manager.dockTo` / `manager.undock` are the portable calls.
   */
  dock(windowId: string, regionId: string | undefined): void {
    if (regionId === undefined) {
      this.manager.undock(windowId);
    } else {
      this.manager.dockTo(windowId, regionId);
    }
  }

  /** Make the registry (and the layout) agree with the record's region. */
  private applyRegion(record: Pick<WindowRecord, 'id' | 'region'>): void {
    const current = this.regions.regionOf(record.id);
    if (current === record.region) {
      return;
    }
    if (current !== undefined) {
      this.regions.undock(record.id);
    }
    if (record.region !== undefined) {
      try {
        this.regions.dock(record.id, record.region);
      } catch (error) {
        // Unknown or full region: the record must not claim it.
        this.manager.undock(record.id);
        throw error;
      }
    }
    this.layoutRegions();
  }

  /** Put a window back where it spawned: its region, or its placement and mode. */
  private returnHome(id: string): void {
    const state = this.states.get(id);
    if (!state) {
      return;
    }
    const { home } = state;
    if (home.region !== undefined) {
      this.manager.dockTo(id, home.region);
      return;
    }
    this.manager.undock(id);
    this.manager.setDockMode(id, home.dockMode);
    if (home.dockMode === DockMode.WorldLocked) {
      state.truePosition = [...home.position] as Vec3Tuple;
      state.handle.group.position.set(...home.position);
    }
    // Follow modes ease back to the viewer on their own in update().
  }

  // --- Windows --------------------------------------------------------------

  /** Spawn a managed window from compiled UIKitML JSON. */
  createWindow(options: CreateWindowOptions): ThreeJsWindowHandle {
    const id = options.id ?? `uix-window-${(this.windowSequence += 1)}`;
    const document = new UixPanelDocument(options.config, this.kit);
    document.setTargetDimensions(options.maxWidth ?? 1, options.maxHeight ?? 1);

    const group = new Group();
    group.name = `uix-window:${id}`;
    group.add(document);
    if (options.position) {
      group.position.set(...options.position);
    }
    this.scene.add(group);

    const handle: ThreeJsWindowHandle = {
      id,
      group,
      document,
      panel: document,
      // The panel exists already, so readiness is immediate. The unsubscribe
      // is returned anyway, so callers can write one shape of code for both
      // adapters.
      onReady(listener: (panel: PanelHandle) => void): () => void {
        listener(document);
        return () => {};
      },
    };
    const dockMode = options.dockMode ?? DockMode.WorldLocked;
    this.states.set(id, {
      handle,
      home: {
        region: options.region,
        position: options.position ? [...options.position] : [0, 0, 0],
        dockMode,
      },
      movable: options.movable ?? true,
      options: {
        followOffset: options.followOffset ?? DEFAULT_FOLLOW_OFFSET,
        followSpeed: options.followSpeed ?? DEFAULT_WINDOW_FOLLOW.speed,
        followTolerance: options.followTolerance ?? DEFAULT_WINDOW_FOLLOW.tolerance,
      },
      content: undefined,
      pin: undefined,
      minimize: undefined,
      buttons: { pin: undefined, dock: undefined, minimize: undefined, close: undefined },
      gateOpen: true,
      follow: undefined,
      followOffset: options.followOffset ?? DEFAULT_FOLLOW_OFFSET,
      placed: false,
      drag: new TitlebarDragController({
        manager: this.manager,
        registry: this.regions,
        windowId: id,
        holdDelaySeconds: options.dragDelay ?? DEFAULT_DRAG_DELAY,
        billboard: options.billboardWhileDragging ?? DEFAULT_BILLBOARD_WHILE_DRAGGING,
      }),
      dragOwner: undefined,
      truePosition: options.position ? [...options.position] as Vec3Tuple : [0, 0, 0],
    });
    if (this.controls) {
      // As IWSDK's UIControlsSystem does for every panel, keyed by the root
      // so a client's own upgradePanel(panel.root, panel.root) finds these.
      upgradePanel(document.root, document.root);
    }
    this.panelWindowIds.set(document.rootComponent, id);
    this.pointerBridge.wire(document.rootComponent);

    const record = this.manager.open(id, {
      // The record's own default, the window id, as on every platform.
      title: options.title ?? id,
      dockMode,
      // Chrome buttons are opt-in - see WindowOptionsBase.
      chrome: {
        close: options.closable ?? false,
        minimize: options.minimizable ?? false,
        pin: options.pinnable ?? false,
        dock: options.dockable ?? false,
      },
      ...(options.handMenu !== undefined ? { handMenu: options.handMenu } : {}),
      // The follow settings live on the record, so `manager.setFollow` can
      // change them after spawn on every platform alike.
      follow: {
        ...(options.followOffset !== undefined ? { offset: [...options.followOffset] as Vec3Tuple } : {}),
        ...(options.followSpeed !== undefined ? { speed: options.followSpeed } : {}),
        ...(options.followTolerance !== undefined ? { tolerance: options.followTolerance } : {}),
      },
    });
    this.wireChrome(options, handle);
    this.applyChrome(record);

    if (options.region !== undefined) {
      this.dock(id, options.region);
    }

    // The panel's element tree exists synchronously (uikitml interprets on
    // construction); only its LAYOUT is async. Announce readiness now so
    // wiring can attach handlers immediately.
    const event: PanelReadyEvent = { id, panel: document, kind: 'window' };
    this.ready.set(id, event);
    for (const listener of this.readyListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error(`[uix] panel-ready listener failed for "${id}":`, error);
      }
    }

    return handle;
  }

  window(id: string): ThreeJsWindowHandle | undefined {
    return this.states.get(id)?.handle;
  }

  /** Drive per-frame from the engine loop (delta in SECONDS). */
  update(deltaSeconds: number): void {
    let hands: HandPoses | undefined;
    const head = this.headPose.getHeadPose();

    // Pass 1: per-window document tick and drag stepping. A drag beginning
    // or ending this frame undocks or docks through the manager, which the
    // next pass's region layout must see.
    for (const [id, state] of this.states) {
      state.handle.document.update(deltaSeconds);
      if (!this.manager.get(id)) continue;
      this.stepDrag(id, state, deltaSeconds, head.position);
    }

    // Pass 2: following regions ease toward the viewer, then EVERY region
    // re-places its docked windows into their slots - every frame, not only
    // on a dock change, so a docked window's `truePosition` is fresh before
    // focus bias reads it below. This is `NativeWindowHost.stepRegions`'
    // order: drags first, then regions, then placement and focus bias.
    for (const state of this.regionStates.values()) {
      if (state.follow) {
        // IWSDK's Follower defaults for a region (speed 1, tolerance 0.4 m).
        const step = stepFollow(
          state.followState,
          head,
          resolveFollow({ offset: state.followOffset }, DEFAULT_REGION_FOLLOW),
          deltaSeconds,
        );
        state.followState = step.state;
        state.handle.group.position.set(...step.pose.position);
        state.handle.group.quaternion.set(...step.pose.quaternion);
      }
    }
    for (const id of this.regionStates.keys()) {
      this.layoutRegion(id);
    }

    // Pass 3: hand-lock / follow placement for a window that is neither
    // dragging nor docked (a docked window was placed above, by
    // `layoutRegion`), then focus bias for every window, docked or not.
    for (const [id, state] of this.states) {
      const record = this.manager.get(id);
      if (!record) continue;
      const docked = this.regions.regionOf(id) !== undefined;
      if (!docked) {
        if (record.dockMode === DockMode.HandLocked && !record.dragging) {
          // Exactly as native and IWSDK: no tracked hand (no source at all,
          // or a session with neither palm raised) means `evaluateHandMenu`
          // finds nothing to ride, so the menu is hidden - never a fallback
          // to body-follow. Rule 1: a platform never decides a behaviour the
          // reference has not.
          hands ??= this.readHands();
          this.placeOnHand(id, state, hands);
        } else {
          // Both follow modes follow in a session, as on IWSDK, where
          // ScreenSpace hands a head-locked panel back to its Follower.
          const following =
            (record.dockMode === DockMode.BodyFollow || record.dockMode === DockMode.HeadLocked) && !record.dragging;
          if (following) {
            this.stepWindowFollow(state, deltaSeconds);
          } else {
            state.follow = undefined;
            state.placed = true;
          }
        }
      }
      this.applyFocusBias(id, state, head.position);
    }
  }

  /** This frame's tracked hands from the source, absent ones left out. */
  private readHands(): HandPoses {
    const poses: HandPoses = {};
    for (const hand of ['left', 'right'] as const) {
      const pose = this.handPose?.getHandPose(hand);
      if (pose) {
        poses[hand] = pose;
      }
    }
    return poses;
  }

  // --- dragging (title bar hold-to-drag, near drag, drop capture) -----------

  /** This frame's live ray for `controller`, from `rayInput`, or `undefined` with no `rayInput` wired or no ray source for it this frame. */
  private currentRay(controller: object): RayTuple | undefined {
    return this.rayInput ? rayOf(this.rayInput.getFrame(), controller) : undefined;
  }

  /**
   * A ray (select) or grab press began on the title bar; ignored while
   * another pointer already holds it. A grab starts dragging at once; a ray
   * waits out `dragDelay` - `TitlebarDragController` decides that from
   * `kind`, exactly as native.
   *
   * A ray press seeds the drag session (`beginDrag`) from a real hit point,
   * the same laser-distance math IWSDK and native use: a plain three.js
   * select event carries no hit point of its own, so this intersects the
   * controller's LIVE ray, read from `rayInput`, with the title bar's own
   * plane (`intersectRayPlane`). With no `rayInput` wired, or no ray source
   * for this controller yet, the only thing left to seed a session from is
   * the controller's own position - a point-delta drag, not laser-distance,
   * exactly the fallback the XR Blocks host used before `rayInput` existed.
   */
  private beginTitlebarDrag(id: string, kind: 'ray' | 'grab', owner: Object3D, titlebar: Object3D): void {
    const state = this.states.get(id);
    if (!state || state.dragOwner !== undefined) return;
    const startPosition: Vec3Tuple = [
      state.handle.group.position.x,
      state.handle.group.position.y,
      state.handle.group.position.z,
    ];
    if (kind === 'grab') {
      state.dragOwner = { kind: 'grab', hand: owner };
      state.drag.beginPress({ kind: 'grab', point: worldPositionOf(owner) }, startPosition);
      return;
    }
    const ray = this.currentRay(owner);
    const point = ray ? intersectRayPlane(ray.origin, ray.direction, worldPositionOf(titlebar), worldForwardOf(titlebar)) : undefined;
    // Decided once, for the whole gesture - exactly as native decides
    // `session` once at press time and never re-derives it mid-drag: a ray
    // press with no ray (or no plane hit) yet degrades to point-delta for
    // the whole drag, rather than possibly switching math mid-gesture.
    const usesRay = ray !== undefined && point !== undefined;
    state.dragOwner = { kind: 'ray', controller: owner, usesRay };
    state.drag.beginPress(
      usesRay ? { kind: 'ray', point: [...point] as Vec3Tuple, ray: ray! } : { kind: 'ray', point: worldPositionOf(owner) },
      startPosition,
    );
  }

  /** The pointer that held the title bar was released. */
  private endTitlebarDrag(id: string): void {
    const state = this.states.get(id);
    if (state) state.dragOwner = undefined;
  }

  /** Advance this window's drag one frame: hold-to-drag timing, drag math, billboard and drop capture, all in the core `TitlebarDragController`. */
  private stepDrag(id: string, state: WindowState, deltaSeconds: number, headPosition: Vec3Tuple): void {
    const { dragOwner } = state;
    const held = dragOwner !== undefined;
    let sample: { ray?: RayTuple; point?: Vec3Tuple } | undefined;
    if (dragOwner?.kind === 'grab') {
      sample = { point: worldPositionOf(dragOwner.hand) };
    } else if (dragOwner?.kind === 'ray') {
      if (dragOwner.usesRay) {
        // The controller's LIVE ray, every frame - the laser-distance math
        // needs it throughout the drag, not only at the start. With no ray
        // this frame the window simply does not move this frame (its own
        // position is still whatever the last frame left it at).
        const ray = this.currentRay(dragOwner.controller);
        sample = ray ? { ray } : undefined;
      } else {
        // Degraded at press time (no `rayInput`, or no ray for this
        // controller yet) - point-delta for the whole gesture, consistently.
        sample = { point: worldPositionOf(dragOwner.controller) };
      }
    }
    const wasDragging = state.drag.dragging;
    const aboutToDrop = !held && wasDragging;
    const group = state.handle.group;
    // The BASELINE is the true, pre-bias pose, never the possibly-biased
    // `group.position` a previous frame's `applyFocusBias` left behind.
    const currentPose: PoseTuple = {
      position: state.truePosition,
      quaternion: [group.quaternion.x, group.quaternion.y, group.quaternion.z, group.quaternion.w],
    };
    const pose = state.drag.step(
      deltaSeconds,
      held,
      sample,
      currentPose,
      headPosition,
      aboutToDrop ? this.regionOrigins() : undefined,
    );
    if (state.drag.dragging || wasDragging) {
      applyPose(group, pose);
      state.truePosition = [...pose.position] as Vec3Tuple;
    }
  }

  /** Every region's current world-space origin, for drop capture. */
  private regionOrigins(): Map<string, Vec3> {
    const origins = new Map<string, Vec3>();
    for (const [id, region] of this.regionStates) {
      const { x, y, z } = region.handle.group.position;
      origins.set(id, [x, y, z]);
    }
    return origins;
  }

  /**
   * How far the focused window is drawn toward the viewer per focus depth
   * (`applyFocusBias`, the same rule `UIWindowSystem` applies on IWSDK and
   * `NativeWindowHost.present` on native). Runs every frame, for every
   * window, unconditionally - including a window mid-drag, which native also
   * biases - always from `truePosition`, never from `group.position`, so it
   * recomputes fresh instead of compounding onto last frame's bias.
   */
  private applyFocusBias(id: string, state: WindowState, headPosition: Vec3Tuple): void {
    const depth = this.manager.orderOf(id);
    const amount = focusBiasAmount(DEFAULT_FOCUS_BIAS, this.manager.count, depth);
    const biased = applyFocusBias(state.truePosition, headPosition, amount);
    state.handle.group.position.set(...biased);
  }

  /** Whether `element`'s window (if any) is currently shown and its hand-menu gate open. A bare, unmanaged panel is always live. */
  private isElementLive(element: Object3D): boolean {
    for (let at: Object3D | null = element; at; at = at.parent) {
      const windowId = this.panelWindowIds.get(at);
      if (windowId === undefined) continue;
      const record = this.manager.get(windowId);
      const state = this.states.get(windowId);
      return record !== undefined && !record.hidden && (state?.gateOpen ?? true);
    }
    return true;
  }

  private placeOnHand(id: string, state: WindowState, hands: HandPoses): void {
    const record = this.manager.get(id);
    if (!record) {
      return;
    }
    const placement = evaluateHandMenu(hands, this.headPose.getHeadPose().position, record.handMenu);
    state.gateOpen = placement.visible;
    if (placement.pose) {
      state.truePosition = [...placement.pose.position] as Vec3Tuple;
      state.handle.group.quaternion.set(...placement.pose.quaternion);
    }
    this.applyPresentation(id);
  }

  /**
   * The core follow rule, `stepFollow`: IWSDK's FollowSystem in PivotY. A
   * window entering a follow mode snaps to its strict target on its first
   * frame; unpinned from a placed pose, it follows from where it was left.
   */
  private stepWindowFollow(state: WindowState, deltaSeconds: number): void {
    const head = this.headPose.getHeadPose();
    const group = state.handle.group;
    // The record's follow settings: the ones the window opened with, or
    // whatever `manager.setFollow` changed them to since.
    const follow = this.manager.get(state.handle.id)?.follow ?? DEFAULT_WINDOW_FOLLOW;
    if (!state.follow) {
      const position = state.truePosition;
      state.followOffset = state.placed
        ? followOffsetFromPose(position, head, follow.offset)
        : follow.offset;
      state.follow = enterFollow(position);
    }
    const step = stepFollow(
      state.follow,
      head,
      {
        offset: state.followOffset,
        speed: follow.speed,
        tolerance: follow.tolerance,
        maxAngle: follow.maxAngle,
      },
      deltaSeconds,
    );
    state.follow = step.state;
    state.placed = true;
    state.truePosition = [...step.pose.position] as Vec3Tuple;
    group.quaternion.set(...step.pose.quaternion);
  }

  /** Re-place every docked window into its region's slot. */
  private layoutRegions(): void {
    for (const id of this.regionStates.keys()) {
      this.layoutRegion(id);
    }
  }

  /**
   * Place every window docked into `regionId` at its slot - the core
   * `regionSlotPose` (rotates the slot offset by the region's own
   * orientation, then adds its world position), the same function native's
   * `stepRegions` uses. Also updates each window's `truePosition`, so focus
   * bias (run every frame, for every window) has a fresh, unbiased baseline
   * to nudge rather than the previous frame's already-biased position.
   */
  private layoutRegion(regionId: string): void {
    const regionState = this.regionStates.get(regionId);
    const registered = this.regions.get(regionId);
    if (!regionState || !registered) {
      return;
    }
    const regionPose = poseOf(regionState.handle.group);
    registered.members.forEach((windowId, index) => {
      const windowState = this.states.get(windowId);
      if (!windowState) {
        return;
      }
      const slot = regionSlotPose(regionPose, registered.definition, index);
      windowState.truePosition = [...slot.position] as Vec3Tuple;
      windowState.handle.group.position.set(...slot.position);
      windowState.handle.group.quaternion.set(...slot.quaternion);
    });
  }

  private wireChrome(
    options: CreateWindowOptions,
    handle: ThreeJsWindowHandle,
  ): void {
    const element = (id: string) => handle.document.getElementById(id);
    const id = handle.id;

    const title = element(WINDOW_CHROME_IDS.title);
    if (title && options.title) {
      title.setProperties({ text: options.title });
    }

    // Chrome presses must not bubble to the window root's focus handler:
    // a press on CLOSE would otherwise focus a window that is about to be
    // destroyed, and `focus()` on a removed window throws. (Same guard the
    // IWSDK adapter applies.)
    const swallowPress = (button: UixElement | undefined): void => {
      button?.addEventListener('pointerdown', (event) => {
        (event as { stopPropagation?: () => void } | undefined)?.stopPropagation?.();
      });
    };
    swallowPress(element(WINDOW_CHROME_IDS.pin));
    swallowPress(element(WINDOW_CHROME_IDS.dock));
    swallowPress(element(WINDOW_CHROME_IDS.minimize));
    swallowPress(element(WINDOW_CHROME_IDS.close));

    // Any press anywhere on the window brings it to the front. Guarded:
    // events can still arrive for a window that was just closed.
    element(WINDOW_CHROME_IDS.window)?.addEventListener('pointerdown', () => {
      if (this.manager.has(id)) {
        this.manager.focus(id);
      }
    });

    // A press on the title bar is a drag candidate - a ray (select) or a
    // grab, whichever the pointer bridge's bubbled event carries. Chrome
    // buttons sit on the drag surface and swallow their own presses above,
    // so a button press never reaches here.
    const titlebar = element(WINDOW_CHROME_IDS.titlebar);
    if (this.states.get(id)?.movable && titlebar) {
      titlebar.addEventListener('pointerdown', (event) => {
        const press = event as { controller?: Object3D; hand?: Object3D } | undefined;
        if (press?.controller) this.beginTitlebarDrag(id, 'ray', press.controller, titlebar as unknown as Object3D);
        else if (press?.hand) this.beginTitlebarDrag(id, 'grab', press.hand, titlebar as unknown as Object3D);
      });
      titlebar.addEventListener('pointerup', () => {
        this.endTitlebarDrag(id);
      });
    }

    const state = this.states.get(id);
    if (state) {
      state.content = element(WINDOW_CHROME_IDS.content);
      state.pin = element(WINDOW_CHROME_IDS.pin);
      state.minimize = element(WINDOW_CHROME_IDS.minimize);
      state.buttons = {
        close: element(WINDOW_CHROME_IDS.close),
        minimize: element(WINDOW_CHROME_IDS.minimize),
        pin: element(WINDOW_CHROME_IDS.pin),
        dock: element(WINDOW_CHROME_IDS.dock),
      };
    }

    // Every button is wired once and gated on the record at click time, so
    // enabling a button later (manager.setChrome) needs no rewiring.
    const enabled = (key: keyof WindowChrome): boolean =>
      this.manager.get(id)?.chrome[key] === true;

    element(WINDOW_CHROME_IDS.close)?.addEventListener('click', () => {
      if (enabled('close')) {
        this.manager.close(id);
      }
    });
    element(WINDOW_CHROME_IDS.minimize)?.addEventListener('click', () => {
      if (enabled('minimize')) {
        this.manager.toggleMinimized(id);
      }
    });
    element(WINDOW_CHROME_IDS.pin)?.addEventListener('click', () => {
      if (enabled('pin')) {
        // Pinning a docked window pops it out of its region first.
        this.manager.undock(id);
        this.manager.togglePin(id);
      }
    });
    element(WINDOW_CHROME_IDS.dock)?.addEventListener('click', () => {
      if (enabled('dock')) {
        this.manager.returnHome(id);
      }
    });
    this.syncMinimizeLabel(id);
    this.syncPinLabel(id);
  }

  /** Show exactly the enabled buttons. */
  private applyChrome(record: Pick<WindowRecord, 'id' | 'chrome'>): void {
    const buttons = this.states.get(record.id)?.buttons;
    if (!buttons) {
      return;
    }
    for (const key of ['close', 'minimize', 'pin', 'dock'] as const) {
      buttons[key]?.setProperties({ display: record.chrome[key] ? 'flex' : 'none' });
    }
  }

  /** Drawn exactly when not hidden and (for a hand menu) the palm gate is open. */
  private applyPresentation(id: string): void {
    const state = this.states.get(id);
    const record = this.manager.get(id);
    if (state && record) {
      state.handle.group.visible = !record.hidden && state.gateOpen;
    }
  }

  private setContentCollapsed(id: string, collapsed: boolean): void {
    this.states
      .get(id)
      ?.content?.setProperties({ display: collapsed ? 'none' : 'flex' });
  }

  /** MIN when open, MAX when minimized - the label names the next action. */
  private syncMinimizeLabel(id: string): void {
    const record = this.manager.get(id);
    const minimize = this.states.get(id)?.minimize;
    if (record && minimize) {
      minimize.setProperties({ text: minimizeLabelFor(record) });
    }
  }

  private syncPinLabel(id: string): void {
    const record = this.manager.get(id);
    const pin = this.states.get(id)?.pin;
    if (record && pin) {
      pin.setProperties({ text: pinLabelFor(record) });
    }
  }
}
