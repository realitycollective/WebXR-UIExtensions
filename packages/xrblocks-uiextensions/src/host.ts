/**
 * UixWindowHost - the engine binding for plain three.js / XR Blocks scenes.
 *
 * Owns a core `WindowManager` + `RegionRegistry` and applies their decisions
 * to the scene graph: spawn UIKitML windows and dock regions, wire chrome
 * buttons (focus / PIN / DOCK / MIN / X), collapse content while minimized,
 * hide and show, place docked windows into their region's slots, return a
 * window to where it spawned, ease `body-follow` windows (and body-locked
 * regions) toward the viewer each frame, and ride `hand-locked` windows
 * (hand menus) on a tracked hand behind the palm gate.
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
  DockMode,
  RegionRegistry,
  WINDOW_CHROME_IDS,
  WindowManager,
  evaluateHandMenu,
  minimizeLabelFor,
  pinLabelFor,
  slotOffset,
  type HandPoseSource,
  type HandPoses,
  type HeadPoseSource,
  type PanelHandle,
  type PanelReadyEvent,
  type RegionDefinition,
  type WindowChrome,
  type WindowRecord,
  type SceneRegion,
  type SceneTarget,
  type SceneWindow,
  type UixElement,
  type Vec3Tuple,
  type WindowHandle as CoreWindowHandle,
  type WindowHost,
  type WindowOptionsBase,
} from '@realitycollective/webxr-uiextensions';
import {
  approach,
  approachAlpha,
  distanceSquared,
  followTarget,
} from './follow-math.js';
import { UixPanelDocument } from './panel-document.js';

/**
 * Options for {@link UixWindowHost.createWindow}.
 *
 * Everything but `config` comes from the portable {@link WindowOptionsBase},
 * so an option means the same thing here as on the IWSDK adapter. `id` is
 * optional: leave it out and the host names the window `uix-window-<n>`.
 *
 * One option is accepted but not acted on: `movable`. This host has no
 * title-bar drag of its own yet - dragging comes from the XR Blocks / desktop
 * input layer above it - so the flag is recorded and otherwise ignored.
 */
export interface CreateWindowOptions extends WindowOptionsBase {
  /** Compiled UIKitML JSON (the `{ element, classes }` shape). */
  config: unknown;
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
export interface XrBlocksWindowHandle extends CoreWindowHandle {
  readonly id: string;
  /** The scene-graph node - position/rotate freely. */
  group: Group;
  document: UixPanelDocument;
  /** Same object as {@link document}, under the portable name. */
  readonly panel: UixPanelDocument;
  onReady(listener: (panel: PanelHandle) => void): () => void;
}

/** Back-compatible name for {@link XrBlocksWindowHandle}. */
export type WindowHandle = XrBlocksWindowHandle;

export interface RegionHandle {
  id: string;
  group: Group;
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
}

interface FollowOptions {
  followOffset: Vec3Tuple;
  followSpeed: number;
  followTolerance: number;
}

interface WindowState {
  handle: XrBlocksWindowHandle;
  /** Where the window spawned, for `returnHome`. */
  home: { region: string | undefined; position: Vec3Tuple; dockMode: WindowRecord['dockMode'] };
  /**
   * Recorded from the create options and not acted on - see
   * {@link CreateWindowOptions}. Kept so a future drag path here, or a caller
   * inspecting the host, reads the value the scene descriptor asked for.
   */
  movable: boolean;
  options: FollowOptions;
  content: UixElement | undefined;
  pin: UixElement | undefined;
  minimize: UixElement | undefined;
  /** Every chrome button by its role, for `chromeChanged`. */
  buttons: Record<keyof WindowChrome, UixElement | undefined>;
  /** Hand-menu palm gate this frame; always open in the other dock modes. */
  gateOpen: boolean;
}

interface RegionState {
  handle: RegionHandle;
  follow: boolean;
  followOffset: Vec3Tuple;
}

const DEFAULT_FOLLOW_OFFSET: Vec3Tuple = [0, -0.15, -1.2];
const DEFAULT_REGION_FOLLOW_OFFSET: Vec3Tuple = [0, -0.2, -1.4];

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
  private readonly states = new Map<string, WindowState>();
  private readonly regionStates = new Map<string, RegionState>();
  private readonly readyListeners = new Set<(event: PanelReadyEvent) => void>();
  /** Panels already live - replayed to late `onPanelReady` subscribers. */
  private readonly ready = new Map<string, PanelReadyEvent>();
  /** Feeds `uix-window-<n>` ids to windows created without one. */
  private windowSequence = 0;
  /** Every manager subscription, released by {@link dispose}. */
  private readonly subscriptions: Array<() => void> = [];
  private disposed = false;

  constructor(options: UixWindowHostOptions) {
    this.scene = options.scene;
    this.headPose = options.headPose;
    this.handPose = options.handPose;
    this.kit = options.kit;
    this.loadConfig = options.loadConfig ?? loadUikitmlSource;

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
    return new UixPanelDocument(configJson, this.kit);
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
      state.handle.group.position.set(...home.position);
    }
    // Follow modes ease back to the viewer on their own in update().
  }

  // --- Windows --------------------------------------------------------------

  /** Spawn a managed window from compiled UIKitML JSON. */
  createWindow(options: CreateWindowOptions): XrBlocksWindowHandle {
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

    const handle: XrBlocksWindowHandle = {
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
        followSpeed: options.followSpeed ?? 3,
        followTolerance: options.followTolerance ?? 0.35,
      },
      content: undefined,
      pin: undefined,
      minimize: undefined,
      buttons: { pin: undefined, dock: undefined, minimize: undefined, close: undefined },
      gateOpen: true,
    });

    const record = this.manager.open(id, {
      title: options.title ?? '',
      dockMode,
      // Chrome buttons are opt-in - see WindowOptionsBase.
      chrome: {
        close: options.closable ?? false,
        minimize: options.minimizable ?? false,
        pin: options.pinnable ?? false,
        dock: options.dockable ?? false,
      },
      ...(options.handMenu !== undefined ? { handMenu: options.handMenu } : {}),
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

  window(id: string): XrBlocksWindowHandle | undefined {
    return this.states.get(id)?.handle;
  }

  /** Drive per-frame from the engine loop (delta in SECONDS). */
  update(deltaSeconds: number): void {
    let hands: HandPoses | undefined;
    for (const [id, state] of this.states) {
      state.handle.document.update(deltaSeconds);
      const record = this.manager.get(id);
      if (!record) {
        continue;
      }
      const docked = this.regions.regionOf(id) !== undefined;
      if (record.dockMode === DockMode.HandLocked && !record.dragging && !docked) {
        if (this.handPose && (this.handPose.hasHands?.() ?? true)) {
          hands ??= this.readHands();
          this.placeOnHand(id, state, hands);
        } else {
          // No hands here (a desktop, or no session yet): the menu follows
          // the body instead, and the gate does not apply.
          state.gateOpen = true;
          this.applyPresentation(id);
          this.applyFollow(state.handle.group, state.options, deltaSeconds, true);
        }
        continue;
      }
      if (record.dockMode === DockMode.BodyFollow && !record.dragging && !docked) {
        this.applyFollow(state.handle.group, state.options, deltaSeconds, true);
      }
    }
    for (const state of this.regionStates.values()) {
      if (state.follow) {
        this.applyFollow(
          state.handle.group,
          {
            followOffset: state.followOffset,
            followSpeed: 3,
            followTolerance: 0.2,
          },
          deltaSeconds,
          false,
        );
        this.layoutRegion(state.handle.id);
      }
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

  private placeOnHand(id: string, state: WindowState, hands: HandPoses): void {
    const record = this.manager.get(id);
    if (!record) {
      return;
    }
    const placement = evaluateHandMenu(hands, this.headPose.getHeadPose().position, record.handMenu);
    state.gateOpen = placement.visible;
    if (placement.pose) {
      state.handle.group.position.set(...placement.pose.position);
      state.handle.group.quaternion.set(...placement.pose.quaternion);
    }
    this.applyPresentation(id);
  }

  private applyFollow(
    group: Group,
    options: FollowOptions,
    deltaSeconds: number,
    faceViewer: boolean,
  ): void {
    const pose = this.headPose.getHeadPose();
    const target = followTarget(pose, options.followOffset);
    const position = group.position;
    const current: Vec3Tuple = [position.x, position.y, position.z];
    const tolerance = options.followTolerance;
    if (distanceSquared(current, target) <= tolerance * tolerance) {
      return;
    }
    const next = approach(
      current,
      target,
      approachAlpha(options.followSpeed, deltaSeconds),
    );
    position.set(...next);
    if (faceViewer) {
      group.lookAt(pose.position[0], position.y, pose.position[2]);
    }
  }

  /** Re-place every docked window into its region's slot. */
  private layoutRegions(): void {
    for (const id of this.regionStates.keys()) {
      this.layoutRegion(id);
    }
  }

  private layoutRegion(regionId: string): void {
    const regionState = this.regionStates.get(regionId);
    const registered = this.regions.get(regionId);
    if (!regionState || !registered) {
      return;
    }
    const origin = regionState.handle.group.position;
    registered.members.forEach((windowId, index) => {
      const windowState = this.states.get(windowId);
      if (!windowState) {
        return;
      }
      const [dx, dy, dz] = slotOffset(registered.definition, index);
      windowState.handle.group.position.set(
        origin.x + dx,
        origin.y + dy,
        origin.z + dz,
      );
      windowState.handle.group.quaternion.copy(regionState.handle.group.quaternion);
    });
  }

  private wireChrome(
    options: CreateWindowOptions,
    handle: XrBlocksWindowHandle,
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
