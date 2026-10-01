/**
 * NativeWindowHost - the engine binding for a native app (OpenXR, visionOS)
 * that renders panels itself and installs `globalThis.__rcHost`. See
 * NATIVE_HOST_CONTRACT.md, section "ui", and `native-types.ts`.
 *
 * THIS BINDING APPLIES THE RULES; THE HOST RENDERS AND MEASURES. On IWSDK
 * five ECS systems apply the core's window rules to the engine. A native
 * host has no such systems, and a host that re-derives the rules drifts from
 * the web (that is how every native UI difference of September 2026 came
 * about). So everything those systems do runs here, from the same core
 * logic, and the host is handed results:
 *
 * - `UIWindowSystem`: the record opens when the panel attaches; title,
 *   chrome buttons, the PIN and MIN labels and the minimized content are
 *   written with `setProperties`; the chrome buttons are wired; hidden and
 *   the hand-menu palm gate combine into one "shown" flag; focus bias moves
 *   each window toward the viewer by its focus depth; DOCK returns home.
 * - `UIDockSystem`: dock-mode transitions (snap on entering a follow mode,
 *   follow from the current pose on unpin, face the viewer on pin), and hand
 *   menus placed from the input slice's grip poses by `evaluateHandMenu`.
 * - IWSDK's `FollowSystem`: the core's `stepFollow`, the same rule.
 * - `UIDockRegionSystem`: regions live here, in a core `RegionRegistry`;
 *   docked windows sit at their slot pose; following regions follow.
 * - `UIDragSystem`: hold-to-drag on the title bar (0.3 s for a ray, at once
 *   for a near grab), the core drag maths, billboarding, drop capture.
 * - `UITouchGuardSystem`: one core `TouchPress` per touch pointer, fed the
 *   signed distance the host measures; clicks on release, for rays too.
 * - `UIControlsSystem`: every panel's `data-uix` controls are upgraded.
 *
 * The host receives `setWindowPose` for placement, `applyWindow` for the
 * shown flag, `setProperties` for element state, and reports panels, hover
 * and pointer samples. It never places a window or decides a press.
 *
 * Frames: call `update(dt)` once per frame with seconds, or pass
 * `attachToHost: true` to be driven by `__rcHost.onFrame`, as
 * `createNativeInteractions` is.
 */
import { PointerDisplay, type PointerArbiter, type PointerDisplayConfig } from '@realitycollective/webxr-input';
import {
  PanelPointerOffers,
  type PanelPointerCandidate,
  DEFAULT_BILLBOARD_WHILE_DRAGGING,
  DEFAULT_DRAG_DELAY,
  DEFAULT_FOCUS_BIAS,
  DEFAULT_REGION_FOLLOW,
  DEFAULT_WINDOW_FOLLOW,
  DockMode,
  EdgePress,
  RegionRegistry,
  TitlebarDragController,
  TouchPress,
  WINDOW_CHROME_IDS,
  WindowManager,
  applyFocusBias,
  dispatchTouchUpdate,
  enterFollow,
  evaluateHandMenu,
  faceViewerYaw,
  focusBiasAmount,
  followOffsetFromPose,
  isDockMode,
  minimizeLabelFor,
  normalizeRegion,
  pinLabelFor,
  planTransition,
  recipeFor,
  regionSlotPose,
  resolveFollow,
  resolveTouchPress,
  stepFollow,
  upgradePanel,
  yawOf,
  yawQuaternion,
  type DockModeValue,
  type FollowOptions,
  type FollowState,
  type HandPoses,
  type HeadPose,
  type PanelHandle,
  type PanelReadyEvent,
  type PointerEventSink,
  type PoseTuple,
  type RegionDefinition,
  type SceneRegion,
  type SceneTarget,
  type SceneWindow,
  type TitlebarDragSample,
  type TouchPressOptions,
  type Vec3,
  type Vec3Tuple,
  type WindowChrome,
  type WindowHandle,
  type WindowHost,
  type WindowOptionsBase,
  type WindowRecord,
  HoverTracker,
  type HoverUpdate,
  ScrollState,
  TextEntry,
} from '@realitycollective/webxr-uiextensions';
import { NativeUixElement, flattenByHandle } from './element.js';
import {
  readNativeUiFrames,
  readNativeUiHost,
  readNativeUiInput,
  type NativeElementNode,
  type NativePointerKind,
  type NativePointerSample,
  type NativeUiFrameSource,
  type NativeUiHost,
  type NativeUiInputHost,
} from './native-types.js';

/** Options for {@link NativeWindowHost.createWindow}. */
export interface CreateWindowOptions extends WindowOptionsBase {
  /** Compiled UIKitML JSON, or a path string - the native app resolves it, so assets stay transparent. */
  config: unknown;
  /** Keep the window yawed toward the viewer while it is being dragged. Default `true`, as on IWSDK. */
  billboardWhileDragging?: boolean;
}

/**
 * Options for {@link NativeWindowHost}. The feature switches are
 * `registerUIExtensions`' options on IWSDK, with the same names and the same
 * defaults (every feature on).
 */
export interface NativeWindowHostOptions {
  /** The `ui` slice, for tests. Falls back to `globalThis.__rcHost.ui`. */
  host?: NativeUiHost;
  /** The `input` slice (head and hands). Falls back to `globalThis.__rcHost.input`; without one nothing follows or rides a hand. */
  input?: NativeUiInputHost;
  /** Drive `update(dt)` from the app's frame callback. Default `false`: call `update` yourself. */
  attachToHost?: boolean;
  /** Where frames come from for `attachToHost`. Falls back to `globalThis.__rcHost.onFrame`. */
  frames?: NativeUiFrameSource;
  /** Title-bar dragging. Default `true`. */
  drag?: boolean;
  /** Near dragging (grab pointer on the title bar, no hold delay). Default `true`. */
  nearDrag?: boolean;
  /** Dock regions. Default `true`. */
  regions?: boolean;
  /** `data-uix` control upgrades. Default `true`. */
  controls?: boolean;
  /** Touch press thresholds, metres, signed, positive in front. Default: the core's `DEFAULT_TOUCH_PRESS`. */
  touchPress?: Partial<TouchPressOptions>;
  /**
   * The pointer arbiter shared with `createNativeInteractions({ pointers })`,
   * so one decision per source covers panels and interactables (the core
   * `PanelPointerOffers`): this host offers each sample's panel and acts with
   * a pointer only while it owns the source; the Interactions binding then
   * hands the host a panel cursor through `applyPointerVisuals`. Omit when
   * the app has no interactables; the host then owns every source it sees
   * and presents the pointers itself (`pointerDisplay`).
   * Update this host before the Interactions binding each frame.
   */
  pointers?: PointerArbiter;
  /**
   * How the pointers are drawn when this host presents them, which is when
   * `pointers` is omitted: the app's settings, or a `PointerDisplay` the app
   * keeps and changes at run time. Defaults are the core's
   * (`POINTER_DISPLAY_DEFAULTS`, IWSDK 1.0's look: the ray only while it hits
   * something, a cursor on objects and on panels). With a shared arbiter the
   * Interactions binding presents and its own `pointerDisplay` applies; this
   * one is then unused.
   */
  pointerDisplay?: PointerDisplay | Partial<PointerDisplayConfig>;
}

/** A pointer event the binding raises on an element. It bubbles to the panel root. */
export interface NativePointerEvent {
  type: 'pointerdown' | 'pointerup' | 'click';
  pointerType: NativePointerKind;
  sourceId: string;
  point: Vec3Tuple | null;
  ray?: { origin: Vec3Tuple; direction: Vec3Tuple };
  stopPropagation(): void;
}

interface PanelState {
  /** The host's panel id. */
  id: string;
  handle: PanelHandle;
  /** The host's raw node per handle, for what the element declared (scroll, input). */
  nodes: Map<string, NativeElementNode>;
  /** The core scroll rule per scrolling element, keyed by handle. */
  scrolls: Map<string, ScrollState>;
  /** Which scrolling element (handle) each pressed pointer is dragging. */
  scrollDrags: Map<string, string>;
  root: NativeUixElement;
  elements: Map<string, NativeUixElement>;
  byId: Map<string, NativeUixElement>;
  parents: Map<NativeUixElement, NativeUixElement | undefined>;
  /** The window this panel belongs to, when it is a window's. */
  windowId: string | undefined;
}

interface Target {
  panel: PanelState;
  element: NativeUixElement;
}

interface Home {
  dockMode: DockModeValue;
  region: string | undefined;
  position: Vec3Tuple;
  yaw: number;
}

/** One managed window, from `createWindow` until it closes. */
interface WindowState {
  readonly id: string;
  readonly options: CreateWindowOptions;
  panel: PanelHandle | undefined;
  panelId: string | undefined;
  readonly onReadyListeners: Set<(panel: PanelHandle) => void>;
  /**
   * The window's record, once it is open on the manager (the panel has
   * attached). The manager changes records in place, so this is always the
   * live record.
   */
  record: WindowRecord | undefined;
  /** The window's own pose, before focus bias. */
  pose: PoseTuple;
  appliedDockMode: DockModeValue | undefined;
  follow: FollowState | undefined;
  followOffset: Vec3Tuple;
  readonly followSpeed: number;
  readonly followTolerance: number;
  /** The hand-menu palm gate; always open for a window that is not a hand menu. */
  gateOpen: boolean;
  home: Home | undefined;
  readonly movable: boolean;
  /** Hold-to-drag, drag math, billboard and drop capture - the core `TitlebarDragController` (`titlebar-drag.ts`). */
  readonly drag: TitlebarDragController;
  /** The key of the pointer currently holding the title bar, while a press is candidate or dragging. */
  pressKey: string | undefined;
  sentHidden: boolean | undefined;
  sentPose: string | undefined;
}

interface PointerState {
  readonly key: string;
  readonly sourceId: string;
  readonly kind: NativePointerKind;
  last: NativePointerSample;
  touch: TouchPress<Target | undefined> | undefined;
  /** Ray/grab press-release-click timing - the core `EdgePress` (`pointer-events.ts`). */
  edge: EdgePress<Target> | undefined;
}

interface RegionState {
  readonly id: string;
  readonly definition: RegionDefinition;
  pose: PoseTuple;
  follow: { state: FollowState; options: FollowOptions } | undefined;
}

const IDENTITY: readonly [number, number, number, number] = [0, 0, 0, 1];
const CHROME_BUTTONS = [
  WINDOW_CHROME_IDS.pin,
  WINDOW_CHROME_IDS.dock,
  WINDOW_CHROME_IDS.minimize,
  WINDOW_CHROME_IDS.close,
] as const;

function copyPose(pose: PoseTuple): PoseTuple {
  return {
    position: [pose.position[0], pose.position[1], pose.position[2]],
    quaternion: [pose.quaternion[0], pose.quaternion[1], pose.quaternion[2], pose.quaternion[3]],
  };
}

function resolvedDockMode(options: CreateWindowOptions): DockModeValue {
  const requested = options.dockMode ?? DockMode.WorldLocked;
  if (!isDockMode(requested)) {
    throw new Error(`[uix] "${String(requested)}" is not a dock mode`);
  }
  // A window in a region is world-locked: the manager's rule, applied here
  // too because the record does not exist until the panel attaches.
  return options.region !== undefined ? DockMode.WorldLocked : requested;
}

/**
 * The plain-data snapshot passed to the host's `createWindow`, alongside
 * `config`. The title defaults to the window id, exactly as the record's
 * does, so the host never paints a blank title.
 */
function toPlainWindowOptions(
  id: string,
  options: CreateWindowOptions,
  dockMode: DockModeValue,
): Record<string, unknown> {
  return {
    id,
    title: options.title ?? id,
    dockMode,
    movable: options.movable ?? true,
    closable: options.closable ?? false,
    minimizable: options.minimizable ?? false,
    pinnable: options.pinnable ?? false,
    dockable: options.dockable ?? false,
    ...(options.position !== undefined ? { position: [...options.position] } : {}),
    ...(options.maxWidth !== undefined ? { maxWidth: options.maxWidth } : {}),
    ...(options.maxHeight !== undefined ? { maxHeight: options.maxHeight } : {}),
    ...(options.handMenu !== undefined ? { handMenu: options.handMenu } : {}),
    ...(options.followOffset !== undefined ? { followOffset: [...options.followOffset] } : {}),
    ...(options.followSpeed !== undefined ? { followSpeed: options.followSpeed } : {}),
    ...(options.followTolerance !== undefined
      ? { followTolerance: options.followTolerance }
      : {}),
    ...(options.region !== undefined ? { region: options.region } : {}),
  };
}

export class NativeWindowHost implements WindowHost, SceneTarget {
  /** Bare panels work here - `createPanel` on the `ui` slice is synchronous. */
  readonly supportsStandalonePanels = true;
  readonly manager = new WindowManager();

  private readonly host: NativeUiHost;
  private readonly input: NativeUiInputHost | undefined;
  private readonly features: {
    drag: boolean;
    nearDrag: boolean;
    regions: boolean;
    controls: boolean;
  };
  private readonly touchOptions: TouchPressOptions;
  /** Live panels, keyed by the host's panel id - both bare panels and windows'. */
  private readonly panels = new Map<string, PanelState>();
  /** Managed windows, keyed by window id. */
  private readonly windows = new Map<string, WindowState>();
  private readonly readyListeners = new Set<(event: PanelReadyEvent) => void>();
  /** Windows already reported ready - replayed to a late `onPanelReady` subscriber. */
  private readonly ready = new Map<string, PanelReadyEvent>();
  private readonly registry = new RegionRegistry();
  private readonly regions = new Map<string, RegionState>();
  /** This frame's pointer samples, by pointer key, until the next `update`. */
  private readonly samples = new Map<string, NativePointerSample>();
  private readonly pointers = new Map<string, PointerState>();
  /** The one pointer decision per source shared with the Interactions family. */
  private readonly offers: PanelPointerOffers;
  /** The app's pointer display settings, applied to what this host presents while it owns the arbiter. */
  private readonly pointerDisplay: PointerDisplay;
  private readonly hover = new HoverTracker<Target>((target) => target.element);
  private readonly textEntry = new TextEntry<Target>();
  /** Milliseconds of `update(dt)` so far, the clock the scroll drags measure velocity against. */
  private clockMs = 0;
  private head: HeadPose | undefined;
  private windowSequence = 0;
  private panelSequence = 0;
  /** Every host and manager subscription, released by {@link dispose}. */
  private readonly subscriptions: Array<() => void> = [];
  private disposed = false;

  constructor(options: NativeWindowHostOptions = {}) {
    this.host = readNativeUiHost(options.host);
    this.input = readNativeUiInput(options.input);
    this.offers = new PanelPointerOffers(options.pointers);
    this.pointerDisplay = options.pointerDisplay instanceof PointerDisplay ? options.pointerDisplay : new PointerDisplay(options.pointerDisplay);
    // Whoever owns the arbiter presents the pointers (the core rule in `pointer-offers.ts`). The host keeps the settings too.
    const applyDisplay = this.offers.ownArbiter ? this.input?.applyPointerDisplay?.bind(this.input) : undefined;
    if (applyDisplay) {
      applyDisplay({ ...this.pointerDisplay.get() });
      this.subscriptions.push(this.pointerDisplay.onChange((config) => applyDisplay({ ...config })));
    }
    this.features = {
      drag: options.drag !== false,
      nearDrag: options.nearDrag !== false,
      regions: options.regions !== false,
      controls: options.controls !== false,
    };
    this.touchOptions = resolveTouchPress(options.touchPress);

    this.subscriptions.push(
      this.host.onElementEvent((panelId, elementHandle, type, payload) => {
        // Hover is the binding's decision (the core rule below); a host that
        // still raises it is ignored so an element never hears it twice.
        if (type === 'pointerenter' || type === 'pointerleave') return;
        const panel = this.panels.get(panelId);
        const element = panel?.elements.get(elementHandle);
        if (!panel || !element) return;
        if (type === 'scrollextent') {
          const extent = payload as { width: number; height: number; maxX: number; maxY: number };
          let scroll = panel.scrolls.get(elementHandle);
          if (!scroll) {
            scroll = new ScrollState();
            panel.scrolls.set(elementHandle, scroll);
          }
          scroll.setExtent(extent);
          return;
        }
        if (type === 'input') {
          // The keyboard reported the whole value: the core rule writes it
          // onto the focused field and raises its `onValueChange`, the
          // callback property uikit's Input calls on the web, then the
          // `valueChanged` event for a listener.
          const value = (payload as { value: string }).value;
          const field = this.textEntry.input(value);
          if (field && field.element === element) {
            element.setProperties({ value });
            element.call('onValueChange', value);
            element.dispatch('valueChanged', { value });
          }
          return;
        }
        if (type === 'keyboardclosed') {
          this.textEntry.blur();
          return;
        }
        element.dispatch(type, payload);
      }),
      this.host.onPanelReady((windowId, panelId, tree) => {
        this.attachWindowPanel(windowId, panelId, tree);
      }),
      this.host.onPointerSample((sample) => {
        this.samples.set(`${sample.sourceId}|${sample.pointer}`, sample);
      }),
    );

    // Every record change reaches the host as a plain snapshot for the shown
    // flag, and the element state the IWSDK window system writes is written
    // here, from the same core label functions.
    const events = this.manager.events;
    const push = (record: WindowRecord): void => this.pushRecord(record.id);
    this.subscriptions.push(
      events.on('opened', push),
      events.on('focused', push),
      events.on('minimized', (record) => {
        push(record);
        this.applyMinimized(record);
      }),
      events.on('restored', (record) => {
        push(record);
        this.applyMinimized(record);
      }),
      events.on('hidden', push),
      events.on('shown', push),
      events.on('dockChanged', ({ window }) => {
        push(window);
        this.syncPinLabel(window);
      }),
      events.on('regionChanged', ({ window }) => {
        push(window);
        this.applyRegion(window);
      }),
      events.on('chromeChanged', ({ window }) => {
        push(window);
        this.applyChrome(window);
      }),
      events.on('handMenuChanged', ({ window }) => push(window)),
      events.on('followChanged', ({ window }) => {
        const state = this.windows.get(window.id);
        if (state) state.followOffset = [...window.follow.offset] as Vec3Tuple;
        push(window);
      }),
      events.on('dragStarted', (record) => this.syncPinLabel(record)),
      events.on('dragEnded', (record) => this.syncPinLabel(record)),
      events.on('returnHome', ({ id }) => this.returnHome(id)),
      events.on('closed', (record) => this.closeWindowState(record.id)),
    );

    if (options.attachToHost) {
      const frames = readNativeUiFrames(options.frames);
      this.subscriptions.push(
        frames.onFrame((_timestampMs, deltaS) => this.update(Math.max(0, deltaS))),
      );
    }
  }

  /**
   * Advance one frame of `dt` seconds: consume the pointer samples the host
   * reported, apply dock transitions and hand menus, move dragged, docked
   * and following windows, then hand the host every changed pose and shown
   * flag. The order is the IWSDK systems' order.
   */
  update(dt: number): void {
    if (this.disposed) return;
    this.clockMs += dt * 1000;
    this.head = this.readHead();
    this.processPointers();
    const hands = this.readHands();
    for (const state of this.windows.values()) {
      if (state.record) this.applyDock(state, state.record, hands);
    }
    this.stepDrags(dt);
    this.stepScrolls(dt);
    this.stepRegions(dt);
    this.stepFollow(dt);
    for (const state of this.windows.values()) {
      if (state.record) this.present(state, state.record);
    }
  }

  /**
   * Leave nothing behind: close every window through the manager, so each
   * goes down the normal close path, dispose any bare panels still live,
   * drop the regions, then release every host and manager subscription.
   * Safe to call twice.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.offers.dispose();
    for (const [id, state] of [...this.windows]) {
      if (state.record && this.manager.has(id)) {
        this.manager.close(id);
      } else {
        this.closeWindowState(id);
      }
    }
    for (const panelId of this.panels.keys()) {
      this.host.disposePanel(panelId);
    }
    for (const id of this.regions.keys()) {
      this.registry.unregister(id);
    }
    this.regions.clear();
    this.panels.clear();
    this.windows.clear();
    this.pointers.clear();
    this.samples.clear();
    this.hover.clear();
    this.textEntry.blur();
    this.ready.clear();
    this.readyListeners.clear();
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.length = 0;
  }

  // --- WindowHost / PanelHost -------------------------------------------

  createPanel(configJson: unknown): PanelHandle {
    const panelId = `uix-panel-${(this.panelSequence += 1)}`;
    const tree = this.host.createPanel(panelId, configJson);
    return this.registerPanel(panelId, tree, undefined).handle;
  }

  onPanelReady(listener: (event: PanelReadyEvent) => void): () => void {
    this.readyListeners.add(listener);
    for (const event of this.ready.values()) {
      listener(event);
    }
    return () => void this.readyListeners.delete(listener);
  }

  // --- SceneTarget (portable scene descriptors) -----------------------------

  /**
   * Create a descriptor's region. The binding owns the layout, as
   * `UIDockRegionSystem` does on IWSDK: the host is told nothing about
   * regions and only receives the resulting window poses. A second region
   * with the same id is ignored, as there.
   */
  spawnRegion(region: SceneRegion): void {
    if (!this.features.regions || this.regions.has(region.id)) return;
    const { id, position, follow, followOffset, ...definition } = region;
    const normalized = normalizeRegion(definition);
    this.registry.register(id, normalized);
    const state: RegionState = {
      id,
      definition: normalized,
      pose: {
        position: position !== undefined ? [position[0], position[1], position[2]] : [0, 0, 0],
        quaternion: [...IDENTITY] as PoseTuple['quaternion'],
      },
      follow: follow
        ? {
            state: enterFollow(),
            options: resolveFollow(
              followOffset !== undefined ? { offset: [...followOffset] as Vec3Tuple } : {},
              DEFAULT_REGION_FOLLOW,
            ),
          }
        : undefined,
    };
    this.regions.set(id, state);
  }

  /**
   * Spawn a descriptor's window. The config stays the descriptor's path: the
   * native app resolves it against its own content, as IWSDK does, so the
   * same descriptor works on every platform.
   */
  spawnWindow(window: SceneWindow): void {
    this.createWindow({
      id: window.id,
      title: window.title,
      config: window.config,
      ...(window.position !== undefined
        ? { position: [...window.position] as [number, number, number] }
        : {}),
      ...(window.maxWidth !== undefined ? { maxWidth: window.maxWidth } : {}),
      ...(window.maxHeight !== undefined ? { maxHeight: window.maxHeight } : {}),
      ...(window.dockMode !== undefined ? { dockMode: window.dockMode } : {}),
      ...(window.region !== undefined ? { region: window.region } : {}),
      ...(window.followOffset !== undefined
        ? { followOffset: [...window.followOffset] as [number, number, number] }
        : {}),
      ...(window.followSpeed !== undefined ? { followSpeed: window.followSpeed } : {}),
      ...(window.followTolerance !== undefined
        ? { followTolerance: window.followTolerance }
        : {}),
      ...(window.movable !== undefined ? { movable: window.movable } : {}),
      ...(window.closable !== undefined ? { closable: window.closable } : {}),
      ...(window.minimizable !== undefined ? { minimizable: window.minimizable } : {}),
      ...(window.pinnable !== undefined ? { pinnable: window.pinnable } : {}),
      ...(window.dockable !== undefined ? { dockable: window.dockable } : {}),
      ...(window.handMenu !== undefined ? { handMenu: window.handMenu } : {}),
    });
  }

  // --- Windows ------------------------------------------------------------

  /**
   * Spawn a managed window. The host builds its panel; the window's
   * `WindowManager` record opens when the panel attaches, as on IWSDK, so
   * `manager.has(id)` is false until `onReady` fires.
   */
  createWindow(options: CreateWindowOptions): WindowHandle {
    const id = options.id ?? `uix-window-${(this.windowSequence += 1)}`;
    if (this.windows.has(id)) {
      throw new Error(`[uix] window "${id}" is already open`);
    }
    const dockMode = resolvedDockMode(options);
    const follow = resolveFollow({
      ...(options.followOffset !== undefined ? { offset: [...options.followOffset] as Vec3Tuple } : {}),
      ...(options.followSpeed !== undefined ? { speed: options.followSpeed } : {}),
      ...(options.followTolerance !== undefined ? { tolerance: options.followTolerance } : {}),
    });
    const state: WindowState = {
      id,
      options,
      panel: undefined,
      panelId: undefined,
      onReadyListeners: new Set(),
      record: undefined,
      pose: {
        position: options.position !== undefined
          ? [options.position[0], options.position[1], options.position[2]]
          : [0, 0, 0],
        quaternion: [...IDENTITY] as PoseTuple['quaternion'],
      },
      appliedDockMode: undefined,
      follow: undefined,
      followOffset: follow.offset,
      followSpeed: follow.speed,
      followTolerance: follow.tolerance,
      gateOpen: dockMode !== DockMode.HandLocked,
      home: undefined,
      movable: options.movable ?? true,
      drag: new TitlebarDragController({
        manager: this.manager,
        ...(this.features.regions ? { registry: this.registry } : {}),
        windowId: id,
        holdDelaySeconds: options.dragDelay ?? DEFAULT_DRAG_DELAY,
        billboard: options.billboardWhileDragging ?? DEFAULT_BILLBOARD_WHILE_DRAGGING,
      }),
      pressKey: undefined,
      sentHidden: undefined,
      sentPose: undefined,
    };
    this.windows.set(id, state);

    const handle: WindowHandle = {
      id,
      get panel(): PanelHandle | undefined {
        return state.panel;
      },
      onReady: (listener: (panel: PanelHandle) => void): (() => void) => {
        if (state.panel) {
          listener(state.panel);
          return () => {};
        }
        state.onReadyListeners.add(listener);
        return () => void state.onReadyListeners.delete(listener);
      },
    };

    this.host.createWindow(id, options.config, toPlainWindowOptions(id, options, dockMode));
    return handle;
  }

  // --- panels -------------------------------------------------------------

  private registerPanel(panelId: string, tree: NativeElementNode, windowId: string | undefined): PanelState {
    const context = {
      setProperties: (elementHandle: string, props: Record<string, unknown>) =>
        this.host.setProperties(panelId, elementHandle, props),
    };
    const root = new NativeUixElement(tree, context);
    const elements = flattenByHandle(root);
    const byId = new Map<string, NativeUixElement>();
    const parents = new Map<NativeUixElement, NativeUixElement | undefined>();
    const visit = (element: NativeUixElement, parent: NativeUixElement | undefined): void => {
      parents.set(element, parent);
      const markupId = element.userData['id'];
      if (typeof markupId === 'string') byId.set(markupId, element);
      for (const child of element.children) visit(child, element);
    };
    visit(root, undefined);
    const handle: PanelHandle = {
      root,
      getElementById: (id) => byId.get(id),
      setTargetDimensions: (width, height) => this.host.setTargetDimensions(panelId, width, height),
      dispose: () => {
        this.panels.delete(panelId);
        this.host.disposePanel(panelId);
      },
    };
    const scrolls = new Map<string, ScrollState>();
    const nodes = new Map<string, NativeElementNode>();
    const seed = (node: NativeElementNode): void => {
      nodes.set(node.handle, node);
      if (node.scroll) {
        const scroll = new ScrollState();
        scroll.setExtent(node.scroll);
        scrolls.set(node.handle, scroll);
      }
      for (const child of node.children) seed(child);
    };
    seed(tree);
    const state: PanelState = { id: panelId, handle, root, elements, byId, parents, windowId, nodes, scrolls, scrollDrags: new Map() };
    this.panels.set(panelId, state);
    if (this.features.controls) {
      // Keyed by the root, so a portable client's own
      // `upgradePanel(panel.root, panel.root)` returns these same handles.
      upgradePanel(root, root);
    }
    return state;
  }

  private attachWindowPanel(windowId: string, panelId: string, tree: NativeElementNode): void {
    const state = this.windows.get(windowId);
    if (!state || state.panelId !== undefined) {
      // The window was closed (or never existed, or already attached)
      // before the host reported its panel ready - a benign race.
      return;
    }
    const panelState = this.registerPanel(panelId, tree, windowId);
    const panel = panelState.handle;
    state.panel = panel;
    state.panelId = panelId;

    const { options } = state;
    const dockMode = resolvedDockMode(options);
    state.home = {
      dockMode,
      region: options.region,
      position: [...state.pose.position] as Vec3Tuple,
      yaw: yawOf(state.pose.quaternion),
    };
    // `open` emits `opened` and `focused` before it returns, while
    // `state.record` is still unset, so those two reach the host as the
    // first snapshot `present` sends below.
    if (!this.manager.has(windowId)) {
      state.record = this.manager.open(windowId, {
        title: options.title ?? windowId,
        dockMode: options.dockMode ?? DockMode.WorldLocked,
        chrome: {
          close: options.closable ?? false,
          minimize: options.minimizable ?? false,
          pin: options.pinnable ?? false,
          dock: options.dockable ?? false,
        },
        ...(options.region !== undefined ? { region: options.region } : {}),
        ...(options.handMenu !== undefined ? { handMenu: options.handMenu } : {}),
        follow: {
          ...(options.followOffset !== undefined ? { offset: [...options.followOffset] as Vec3Tuple } : {}),
          ...(options.followSpeed !== undefined ? { speed: options.followSpeed } : {}),
          ...(options.followTolerance !== undefined ? { tolerance: options.followTolerance } : {}),
        },
      });
    } else {
      // The app opened the record itself first; adopt it, as IWSDK does.
      state.record = this.manager.get(windowId);
    }
    const record = state.record!;

    if ((options.maxWidth ?? 0) > 0 && (options.maxHeight ?? 0) > 0) {
      panel.setTargetDimensions(options.maxWidth!, options.maxHeight!);
    }
    this.wireChrome(state, panelState);
    this.applyChrome(record);
    this.syncPinLabel(record);
    this.applyMinimized(record);
    this.applyRegion(record);
    this.applyDock(state, record, this.readHands());
    this.present(state, record);

    for (const listener of state.onReadyListeners) {
      listener(panel);
    }
    state.onReadyListeners.clear();

    const event: PanelReadyEvent = { id: windowId, panel, kind: 'window' };
    this.ready.set(windowId, event);
    for (const listener of this.readyListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error(`[uix] panel-ready listener failed for "${windowId}":`, error);
      }
    }
  }

  private closeWindowState(id: string): void {
    const state = this.windows.get(id);
    this.windows.delete(id);
    this.ready.delete(id);
    this.registry.undock(id);
    if (state?.panelId) {
      this.panels.delete(state.panelId);
      this.host.disposePanel(state.panelId);
    }
    this.host.closeWindow(id);
  }

  // --- chrome (UIWindowSystem) ---------------------------------------------

  private element(id: string, markupId: string): NativeUixElement | undefined {
    const panelId = this.windows.get(id)?.panelId;
    return panelId === undefined ? undefined : this.panels.get(panelId)?.byId.get(markupId);
  }

  private wireChrome(state: WindowState, panel: PanelState): void {
    const { id } = state;
    const element = (markupId: string) => panel.byId.get(markupId);
    // The buttons sit on the drag surface: their presses stop there, so a
    // click never arms a drag.
    for (const button of CHROME_BUTTONS) {
      element(button)?.addEventListener('pointerdown', (event) => {
        (event as { stopPropagation?: () => void } | undefined)?.stopPropagation?.();
      });
    }
    // Any press anywhere on the window brings it to the front.
    element(WINDOW_CHROME_IDS.window)?.addEventListener('pointerdown', () => {
      if (this.manager.has(id)) this.manager.focus(id);
    });
    // A press on the title bar is a drag candidate.
    if (this.features.drag && state.movable) {
      element(WINDOW_CHROME_IDS.titlebar)?.addEventListener('pointerdown', (event) => {
        this.beginTitlebarPress(state, event as NativePointerEvent);
      });
    }
    // Wired once, gated on the record at click time.
    const enabled = (key: keyof WindowChrome): boolean => this.manager.get(id)?.chrome[key] === true;
    element(WINDOW_CHROME_IDS.close)?.addEventListener('click', () => {
      if (enabled('close')) this.manager.close(id);
    });
    element(WINDOW_CHROME_IDS.minimize)?.addEventListener('click', () => {
      if (enabled('minimize')) this.manager.toggleMinimized(id);
    });
    element(WINDOW_CHROME_IDS.pin)?.addEventListener('click', () => {
      if (enabled('pin')) this.manager.togglePin(id);
    });
    element(WINDOW_CHROME_IDS.dock)?.addEventListener('click', () => {
      if (enabled('dock')) this.manager.returnHome(id);
    });
  }

  /** Title and exactly the enabled buttons, as `applyChrome` and `wireChrome` write them. */
  private applyChrome(record: WindowRecord): void {
    const title = this.element(record.id, WINDOW_CHROME_IDS.title);
    if (title && record.title) {
      title.setProperties({ text: record.title });
    }
    const buttons: Array<[string, boolean]> = [
      [WINDOW_CHROME_IDS.close, record.chrome.close],
      [WINDOW_CHROME_IDS.minimize, record.chrome.minimize],
      [WINDOW_CHROME_IDS.pin, record.chrome.pin],
      [WINDOW_CHROME_IDS.dock, record.chrome.dock],
    ];
    for (const [markupId, enabled] of buttons) {
      this.element(record.id, markupId)?.setProperties({ display: enabled ? 'flex' : 'none' });
    }
  }

  private syncPinLabel(record: WindowRecord): void {
    this.element(record.id, WINDOW_CHROME_IDS.pin)?.setProperties({ text: pinLabelFor(record) });
  }

  /** MIN or MAX on the button, and the content hidden while minimized. */
  private applyMinimized(record: WindowRecord): void {
    this.element(record.id, WINDOW_CHROME_IDS.minimize)?.setProperties({
      text: minimizeLabelFor(record),
    });
    this.element(record.id, WINDOW_CHROME_IDS.content)?.setProperties({
      display: record.minimized ? 'none' : 'flex',
    });
  }

  /** The record with `hidden` meaning "not shown": hidden, or a closed palm gate. */
  private pushRecord(id: string): void {
    const state = this.windows.get(id);
    const record = state?.record;
    // A record the app opened on this manager without a window here has
    // nothing on the host to update.
    if (!state || !record) return;
    const hidden = record.hidden || !state.gateOpen;
    state.sentHidden = hidden;
    this.host.applyWindow({
      ...record,
      chrome: { ...record.chrome },
      handMenu: { ...record.handMenu, offset: [...record.handMenu.offset] },
      hidden,
    });
  }

  /** Return a window home: its spawn region, or its spawn placement and dock mode. */
  private returnHome(id: string): void {
    const state = this.windows.get(id);
    const record = state?.record;
    if (!state?.home || !record) return; // a record this host did not open
    const { home } = state;
    if (home.region !== undefined) {
      if (record.region === home.region) return;
      this.manager.dockTo(id, home.region);
      return;
    }
    this.manager.undock(id);
    if (home.dockMode === DockMode.WorldLocked) {
      state.pose = { position: [...home.position] as Vec3Tuple, quaternion: yawQuaternion(home.yaw) };
    }
    // A follow mode re-snaps on its own through the transition.
    this.manager.setDockMode(id, home.dockMode);
  }

  // --- regions (UIDockRegionSystem) ------------------------------------------

  /** Make the registry agree with the record's region, rejecting an unknown or full one. */
  private applyRegion(record: WindowRecord): void {
    const current = this.registry.regionOf(record.id);
    if (current === record.region) return;
    if (current !== undefined) this.registry.undock(record.id);
    if (record.region === undefined) return;
    if (!this.features.regions || this.registry.get(record.region) === undefined) {
      this.manager.undock(record.id);
      return;
    }
    try {
      this.registry.dock(record.id, record.region);
    } catch {
      this.manager.undock(record.id); // full
    }
  }

  private stepRegions(dt: number): void {
    const head = this.head;
    for (const region of this.regions.values()) {
      if (region.follow && head) {
        const step = stepFollow(region.follow.state, head, region.follow.options, dt);
        region.follow.state = step.state;
        region.pose = step.pose;
      }
    }
    for (const state of this.windows.values()) {
      const regionId = this.registry.regionOf(state.id);
      const region = regionId === undefined ? undefined : this.regions.get(regionId);
      const registered = regionId === undefined ? undefined : this.registry.get(regionId);
      if (!region || !registered) continue;
      state.pose = regionSlotPose(region.pose, region.definition, registered.members.indexOf(state.id));
    }
  }

  // --- dock modes and hand menus (UIDockSystem) ------------------------------

  private applyDock(state: WindowState, record: WindowRecord, hands: HandPoses): void {
    if (state.appliedDockMode !== record.dockMode) {
      this.applyTransition(state, state.appliedDockMode, record.dockMode);
    }
    if (record.dockMode === DockMode.HandLocked) {
      const viewer = this.head?.position;
      const placement = viewer
        ? evaluateHandMenu(hands, viewer, record.handMenu)
        : { visible: false, pose: undefined };
      state.gateOpen = placement.visible;
      if (placement.pose) state.pose = placement.pose;
    }
  }

  private applyTransition(state: WindowState, from: DockModeValue | undefined, to: DockModeValue): void {
    if (from !== undefined) {
      // Only called when the mode changed, so there is always a plan.
      const plan = planTransition(from, to)!;
      {
        if (plan.removeFollower) state.follow = undefined;
        if (plan.removeFollower && to === DockMode.WorldLocked) {
          // Pinned in place: face the viewer where it was pinned.
          this.faceViewer(state);
        }
        if (plan.removeHandAnchor) {
          // Off the hand: the gate no longer applies; face the viewer.
          state.gateOpen = true;
          this.faceViewer(state);
        }
        if (plan.addFollower) {
          // Unpinned: follow from where the user left it.
          this.addFollower(state, true);
        }
        if (plan.snap && state.follow) state.follow.synced = false;
      }
    } else {
      // First application after the panel attached.
      const recipe = recipeFor(to);
      if (recipe.follower && !state.follow) this.addFollower(state, false);
      if (!recipe.follower) state.follow = undefined;
    }
    if (to !== DockMode.HandLocked) state.gateOpen = true;
    state.appliedDockMode = to;
  }

  private addFollower(state: WindowState, fromCurrentPose: boolean): void {
    const configured = resolveFollow({
      ...(state.options.followOffset !== undefined
        ? { offset: [...state.options.followOffset] as Vec3Tuple }
        : {}),
    }).offset;
    state.followOffset =
      fromCurrentPose && this.head
        ? followOffsetFromPose(state.pose.position, this.head, configured)
        : configured;
    // A new follower snaps on its first step, as IWSDK's `needsPositionSync`.
    state.follow = enterFollow(state.pose.position);
  }

  private faceViewer(state: WindowState): void {
    const head = this.head;
    if (!head) return;
    const yaw = faceViewerYaw(state.pose.position as Vec3, head.position as Vec3, yawOf(state.pose.quaternion));
    state.pose = { position: [...state.pose.position] as Vec3Tuple, quaternion: yawQuaternion(yaw) };
  }

  private stepFollow(dt: number): void {
    const head = this.head;
    if (!head) return;
    for (const state of this.windows.values()) {
      if (!state.record || !state.follow || state.drag.dragging) continue;
      // Speed, dead zone and angle are the record's, so `manager.setFollow`
      // changes them on the next frame; the offset is re-aimed on a change.
      const step = stepFollow(
        state.follow,
        head,
        {
          offset: state.followOffset,
          speed: state.record.follow.speed,
          tolerance: state.record.follow.tolerance,
          maxAngle: state.record.follow.maxAngle,
        },
        dt,
      );
      state.follow = step.state;
      state.pose = step.pose;
    }
  }

  // --- presenting to the host ------------------------------------------------

  private present(state: WindowState, record: WindowRecord): void {
    const hidden = record.hidden || !state.gateOpen;
    if (hidden !== state.sentHidden) this.pushRecord(state.id);

    const depth = this.manager.orderOf(state.id);
    const amount = focusBiasAmount(DEFAULT_FOCUS_BIAS, this.manager.count, depth);
    const position = this.head
      ? applyFocusBias(state.pose.position, this.head.position, amount)
      : ([...state.pose.position] as Vec3Tuple);
    const pose: PoseTuple = { position, quaternion: [...state.pose.quaternion] as PoseTuple['quaternion'] };
    const key = JSON.stringify([pose.position, pose.quaternion, depth]);
    if (key === state.sentPose) return;
    state.sentPose = key;
    this.host.setWindowPose(state.id, pose, depth);
  }

  // --- input -----------------------------------------------------------------

  private readHead(): HeadPose | undefined {
    const pose = this.input?.getHeadPose?.();
    return pose ? copyPose(pose) : undefined;
  }

  /** This frame's grip poses per hand: the first tracked source on each side, as IWSDK's primary source. */
  private readHands(): HandPoses {
    const poses: HandPoses = {};
    for (const source of this.input?.sample() ?? []) {
      if (source.handedness === 'none' || !source.gripPose || poses[source.handedness]) continue;
      poses[source.handedness] = copyPose(source.gripPose);
    }
    return poses;
  }

  /** The element a sample points at, on a window that is shown, or a bare panel. */
  private resolveTarget(sample: NativePointerSample): Target | undefined {
    if (sample.panelId === null || sample.elementHandle === null) return undefined;
    const panel = this.panels.get(sample.panelId);
    const element = panel?.elements.get(sample.elementHandle);
    if (!panel || !element) return undefined;
    if (panel.windowId !== undefined) {
      // A window's panel exists only once its record is open.
      const state = this.windows.get(panel.windowId)!;
      if (state.record!.hidden || !state.gateOpen) return undefined;
    }
    return { panel, element };
  }

  /** Whether `target` is a window's title bar or inside it: the only thing a grab pointer can hold. */
  private onTitlebar(target: Target): boolean {
    const titlebar = target.panel.byId.get(WINDOW_CHROME_IDS.titlebar);
    for (let at: NativeUixElement | undefined = target.element; at; at = target.panel.parents.get(at)) {
      if (at === titlebar) return true;
    }
    return false;
  }

  private dispatch(target: Target, type: NativePointerEvent['type'], pointer: PointerState): void {
    let stopped = false;
    const sample = pointer.last;
    const event: NativePointerEvent = {
      type,
      pointerType: pointer.kind,
      sourceId: pointer.sourceId,
      point: sample.point ? [...sample.point] as Vec3Tuple : null,
      ...(sample.ray
        ? { ray: { origin: [...sample.ray.origin] as Vec3Tuple, direction: [...sample.ray.direction] as Vec3Tuple } }
        : {}),
      stopPropagation: () => {
        stopped = true;
      },
    };
    for (let at: NativeUixElement | undefined = target.element; at && !stopped; at = target.panel.parents.get(at)) {
      at.dispatch(type, event);
    }
    if (type === 'click') this.focusText(target);
  }

  /** The core press machines dispatch through this - one object per pointer, closing over it for `dispatch`'s event shape. */
  private sinkFor(pointer: PointerState): PointerEventSink<Target> {
    return {
      dispatch: (type, target) => this.dispatch(target, type, pointer),
    };
  }

  private static readonly SAME_TARGET = (a: Target, b: Target): boolean => a.element === b.element;
  /** Same comparison, for `TouchPress<Target | undefined>`'s generic (a target is always defined in practice). */
  private static readonly SAME_OPTIONAL_TARGET = (a: Target | undefined, b: Target | undefined): boolean =>
    a?.element === b?.element;

  private processPointers(): void {
    const seen = new Set<string>();
    // The arbitration first: every sample's panel is offered, then each
    // source is decided across panels and interactables, and a pointer acts
    // below only while it owns its source (IWSDK's MultiPointer over every
    // pointer-event object).
    const sources = new Set<string>();
    // What this host presents per source this frame: whether it carries a ray, and whether its owning pointer is pressing.
    const presented = new Map<string, { hasRay: boolean; selecting: boolean }>();
    for (const sample of this.samples.values()) {
      if (sample.pointer === 'grab' && !this.features.nearDrag) continue;
      sources.add(sample.sourceId);
      const shown = presented.get(sample.sourceId) ?? { hasRay: false, selecting: false };
      if (sample.ray) shown.hasRay = true;
      presented.set(sample.sourceId, shown);
      const target = this.resolveTarget(sample);
      this.offers.offer(sample.sourceId, sample.pointer, target ? this.candidateOf(sample, target) : undefined);
    }
    for (const sourceId of sources) this.offers.resolve(sourceId);
    for (const [key, sample] of this.samples) {
      if (sample.pointer === 'grab' && !this.features.nearDrag) continue;
      seen.add(key);
      let pointer = this.pointers.get(key);
      if (!pointer) {
        pointer = {
          key,
          sourceId: sample.sourceId,
          kind: sample.pointer,
          last: sample,
          touch: undefined,
          edge: undefined,
        };
        this.pointers.set(key, pointer);
      }
      pointer.last = sample;
      // A pointer that does not own its source (an interactable's touch took
      // the hand, or another kind of pointer holds it) hovers, presses and
      // drags nothing here: it is treated as reaching no panel.
      const owned = this.offers.owns(sample.sourceId, sample.pointer);
      const target = owned ? this.resolveTarget(sample) : undefined;
      this.applyHover(pointer, this.hover.update(key, target));
      switch (sample.pointer) {
        case 'touch':
          this.touch(pointer, sample, target);
          break;
        case 'ray':
          this.edge(pointer, sample.active === true, target);
          this.scrollDrag(pointer, key, sample, target);
          break;
        case 'grab':
          this.edge(pointer, sample.active === true, target && this.onTitlebar(target) ? target : undefined);
          break;
      }
      // The selection lock: a pressing pointer keeps its source.
      const pressing = sample.pointer === 'touch' ? pointer.touch?.held === true : pointer.edge?.isPressed === true;
      this.offers.setSelecting(sample.sourceId, sample.pointer, pressing);
      if (pressing && owned) presented.get(sample.sourceId)!.selecting = true;
    }
    this.samples.clear();
    for (const [key, pointer] of [...this.pointers]) {
      if (seen.has(key)) continue;
      // Not reported this frame: the pointer is gone, and so is its press, its hover and its scroll drag.
      this.applyHover(pointer, this.hover.remove(key));
      this.endScrollDrags(key);
      if (pointer.touch) {
        dispatchTouchUpdate(pointer.touch.update(undefined), this.sinkFor(pointer) as PointerEventSink<Target | undefined>, NativeWindowHost.SAME_OPTIONAL_TARGET);
      } else if (pointer.edge?.isPressed) {
        pointer.edge.update(false, undefined, this.sinkFor(pointer), NativeWindowHost.SAME_TARGET);
      }
      this.pointers.delete(key);
      this.offers.offer(pointer.sourceId, pointer.kind, undefined);
      this.offers.setSelecting(pointer.sourceId, pointer.kind, false);
      this.offers.resolve(pointer.sourceId);
      // A source that stopped reporting is presented once more, with nothing to draw.
      if (!presented.has(pointer.sourceId)) presented.set(pointer.sourceId, { hasRay: false, selecting: false });
    }
    this.presentPointers(presented);
  }

  /**
   * Hand the host each source's ray and cursor drawing. Only while this host
   * owns the arbiter: with a shared one the Interactions binding presents
   * every source, panel cursor included. The drawing is the core's
   * (`PanelPointerOffers.present`); nothing is decided here.
   */
  private presentPointers(presented: Map<string, { hasRay: boolean; selecting: boolean }>): void {
    const input = this.input;
    if (!this.offers.ownArbiter || !input?.applyPointerVisuals) return;
    for (const [sourceId, shown] of presented) {
      input.applyPointerVisuals(sourceId, this.offers.present(sourceId, shown.hasRay, shown.selecting, this.pointerDisplay));
    }
  }

  /** The pointer display settings this host presents with while it owns the arbiter. Change them with `set`. */
  getPointerDisplay(): PointerDisplay {
    return this.pointerDisplay;
  }

  /**
   * What this sample offers the arbiter: the panel, the point the cursor
   * sits at, and the distance IWSDK's pointer of that kind would compare
   * (the host's `distance`, else derived: the ray parameter from `ray` and
   * `point`, the unsigned `signedDistance` for a touch, 0 for a grab).
   */
  private candidateOf(sample: NativePointerSample, target: Target): PanelPointerCandidate {
    // A hit with no measured point is a host defect the contract names; it is
    // still offered (at the ray's origin, or the world origin) so the press
    // machines behave as before, rather than silently losing the panel.
    const point = sample.point ?? sample.ray?.origin ?? [0, 0, 0];
    let distance = sample.distance;
    if (distance === undefined) {
      if (sample.pointer === 'ray' && sample.ray && sample.point) {
        const o = sample.ray.origin;
        distance = Math.hypot(point[0] - o[0], point[1] - o[1], point[2] - o[2]);
      } else if (sample.pointer === 'touch' && sample.signedDistance !== undefined) {
        distance = Math.abs(sample.signedDistance);
      } else {
        distance = 0;
      }
    }
    return { panelId: target.panel.id, point: [point[0], point[1], point[2]], distance };
  }

  /**
   * Hover per element is the core rule (`HoverTracker`, IWSDK's pointer
   * events): each pointer raises `pointerenter` on the element it moves onto
   * and `pointerleave` on the one it left, on that element alone, and the
   * host is told to style an element while any pointer is over it.
   */
  private applyHover(pointer: PointerState, change: HoverUpdate<Target>): void {
    if (change.pointerLeave) this.dispatchOn(change.pointerLeave, 'pointerleave', pointer);
    if (change.hoverOff) this.host.setHover?.(change.hoverOff.panel.id, change.hoverOff.element.handle, false);
    if (change.hoverOn) this.host.setHover?.(change.hoverOn.panel.id, change.hoverOn.element.handle, true);
    if (change.pointerEnter) this.dispatchOn(change.pointerEnter, 'pointerenter', pointer);
  }

  /** An event delivered to one element only, without bubbling, as `pointerenter` and `pointerleave` are. */
  private dispatchOn(target: Target, type: 'pointerenter' | 'pointerleave', pointer: PointerState): void {
    const sample = pointer.last;
    target.element.dispatch(type, {
      type,
      pointerType: pointer.kind,
      sourceId: pointer.sourceId,
      point: sample.point ? ([...sample.point] as Vec3Tuple) : null,
    });
  }

  /**
   * Scrolling is the core rule (`ScrollState`, uikit's drag): a ray held on
   * an element that scrolls, or inside one, drags its content by the move
   * of the hit point in the element's pixel space; releasing lets it coast.
   * The host is told the new offset and draws it.
   */
  private scrollDrag(pointer: PointerState, key: string, sample: NativePointerSample, target: Target | undefined): void {
    const active = sample.active === true;
    for (const panel of this.panels.values()) {
      const dragging = panel.scrollDrags.get(key);
      if (dragging === undefined) continue;
      // A drag always names a scrolling element the panel still has.
      const scroll = panel.scrolls.get(dragging)!;
      if (!active || target?.panel !== panel) {
        scroll.endDrag(key);
        panel.scrollDrags.delete(key);
        continue;
      }
      if (sample.localPoint) {
        const [x, y] = scroll.moveDrag(key, sample.localPoint, this.nowMs());
        this.host.setScroll?.(panel.id, dragging, x, y);
      }
      return;
    }
    if (!active || !target || !sample.localPoint || pointer.edge?.isPressed !== true) return;
    const handle = this.scrollingAncestor(target);
    const scroll = handle === undefined ? undefined : target.panel.scrolls.get(handle);
    if (handle === undefined || !scroll) return;
    scroll.beginDrag(key, sample.localPoint, this.nowMs());
    target.panel.scrollDrags.set(key, handle);
  }

  /** The nearest element that scrolls, from `target` up, by handle. */
  private scrollingAncestor(target: Target): string | undefined {
    for (let at: NativeUixElement | undefined = target.element; at; at = target.panel.parents.get(at)) {
      if (target.panel.scrolls.has(at.handle)) return at.handle;
    }
    return undefined;
  }

  /** Coasting and rubber-band return for every scrolling element not being dragged. */
  private stepScrolls(dt: number): void {
    for (const panel of this.panels.values()) {
      for (const [handle, scroll] of panel.scrolls) {
        if (scroll.dragging || !scroll.settling) continue;
        const [x, y] = scroll.frame(dt * 1000);
        this.host.setScroll?.(panel.id, handle, x, y);
      }
    }
  }

  /** A pointer left: its scroll drag ends too. */
  private endScrollDrags(key: string): void {
    for (const panel of this.panels.values()) {
      const dragging = panel.scrollDrags.get(key);
      if (dragging === undefined) continue;
      panel.scrolls.get(dragging)?.endDrag(key);
      panel.scrollDrags.delete(key);
    }
  }

  /**
   * Text entry is the core rule (`TextEntry`, uikit's `Input`): a click on
   * a text field focuses it and asks the host for the system keyboard with
   * the field's value; the host's `"input"` reports replace the value.
   */
  private focusText(target: Target): void {
    const node = target.panel.nodes.get(target.element.handle);
    if (!node?.input) return;
    const request = this.textEntry.focus(target, node.input.value, {
      ...(node.input.multiline !== undefined ? { multiline: node.input.multiline } : {}),
      ...(node.input.type !== undefined ? { type: node.input.type } : {}),
    });
    this.host.showKeyboard?.(target.panel.id, target.element.handle, request);
  }

  private nowMs(): number {
    return this.clockMs;
  }

  /** A touch pointer: the core `TouchPress` decides from the signed distance, `dispatchTouchUpdate` raises the events. */
  private touch(pointer: PointerState, sample: NativePointerSample, target: Target | undefined): void {
    pointer.touch ??= new TouchPress<Target | undefined>(this.touchOptions);
    const result = pointer.touch.update(
      target && sample.signedDistance !== undefined
        ? { signedDistance: sample.signedDistance, target }
        : undefined,
    );
    dispatchTouchUpdate(result, this.sinkFor(pointer) as PointerEventSink<Target | undefined>, NativeWindowHost.SAME_OPTIONAL_TARGET);
  }

  /** A ray or grab pointer: the core `EdgePress` presses on the rising edge, clicks on release. */
  private edge(pointer: PointerState, active: boolean, target: Target | undefined): void {
    pointer.edge ??= new EdgePress<Target>();
    pointer.edge.update(active, target, this.sinkFor(pointer), NativeWindowHost.SAME_TARGET);
  }

  // --- dragging (UIDragSystem) -------------------------------------------------

  private beginTitlebarPress(state: WindowState, event: NativePointerEvent): void {
    if (state.pressKey !== undefined) return; // another pointer holds the bar
    state.pressKey = `${event.sourceId}|${event.pointerType}`;
    state.drag.beginPress(
      { kind: event.pointerType, point: event.point, ...(event.ray ? { ray: event.ray } : {}) },
      [...state.pose.position] as Vec3Tuple,
    );
  }

  /** Every registered region's current world-space origin, for drop capture. */
  private regionOrigins(): Map<string, Vec3> {
    const origins = new Map<string, Vec3>();
    for (const region of this.regions.values()) {
      origins.set(region.id, region.pose.position as Vec3);
    }
    return origins;
  }

  private stepDrags(dt: number): void {
    for (const state of this.windows.values()) {
      if (!state.record) continue;
      const pointer = state.pressKey ? this.pointers.get(state.pressKey) : undefined;
      const held = pointer?.edge?.isPressed === true;
      const sample = pointer?.last;
      // Region origins are only needed the frame a drop can happen, so they
      // are built lazily rather than on every window every frame.
      const aboutToDrop = !held && state.drag.dragging && this.features.regions;
      state.pose = state.drag.step(
        dt,
        held,
        sample ? { ...(sample.ray ? { ray: sample.ray } : {}), ...(sample.point ? { point: sample.point } : {}) } : undefined,
        state.pose,
        this.head?.position,
        aboutToDrop ? this.regionOrigins() : undefined,
      );
      if (!held) state.pressKey = undefined;
    }
  }
}
