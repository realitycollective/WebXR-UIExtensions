/**
 * NativeWindowHost - the engine binding for a native app (OpenXR, visionOS)
 * that renders panels itself and installs `globalThis.__rcHost`. See
 * NATIVE_HOST_CONTRACT.md, section "ui".
 *
 * The core's real `WindowManager` still owns window state; every event it
 * emits is applied to the host through `applyWindow` (a plain snapshot of the
 * record) or `closeWindow`. `createPanel` and the panel side of `createWindow`
 * build a tree of proxy elements (`NativeUixElement`) over the host's
 * `NativeElementNode` tree, so `PanelHost`/`WindowHost` consumers - the
 * control upgraders, app wiring - see the same surface as on every other
 * adapter. No engine import here: every value crossing to `host` is plain
 * data, per "Rules for every slice" in the contract doc.
 */
import {
  DockMode,
  WindowManager,
  type DockModeValue,
  type PanelHandle,
  type PanelReadyEvent,
  type SceneRegion,
  type SceneTarget,
  type SceneWindow,
  type WindowHandle,
  type WindowHost,
  type WindowOptionsBase,
  type WindowRecord,
} from '@realitycollective/webxr-uiextensions';
import { NativeUixElement, flattenByHandle } from './element.js';
import { readNativeUiHost, type NativeElementNode, type NativeUiHost } from './native-types.js';

/** Options for {@link NativeWindowHost.createWindow}. */
export interface CreateWindowOptions extends WindowOptionsBase {
  /** Compiled UIKitML JSON, or a path string - the native app resolves it, so assets stay transparent. */
  config: unknown;
}

export interface NativeWindowHostOptions {
  /** The injected `ui` slice, for tests. Falls back to `globalThis.__rcHost.ui`. */
  host?: NativeUiHost;
}

/** One panel's live state: its proxy tree and the host id used to reach it. */
interface PanelState {
  handle: PanelHandle;
  elements: Map<string, NativeUixElement>;
}

/** One managed window's state, between `createWindow` and the panel attaching. */
interface WindowState {
  panel: PanelHandle | undefined;
  panelId: string | undefined;
  readonly onReadyListeners: Set<(panel: PanelHandle) => void>;
}

function byMarkupId(elements: Map<string, NativeUixElement>): Map<string, NativeUixElement> {
  const byId = new Map<string, NativeUixElement>();
  for (const element of elements.values()) {
    const id = element.userData['id'];
    if (typeof id === 'string') {
      byId.set(id, element);
    }
  }
  return byId;
}

/**
 * The plain-data snapshot passed to the host's `createWindow`, alongside
 * `config`. The dock mode is the manager's, which is world-locked for a
 * window opened into a region whatever the options asked for.
 */
function toPlainWindowOptions(
  id: string,
  options: CreateWindowOptions,
  dockMode: DockModeValue,
): Record<string, unknown> {
  return {
    id,
    title: options.title ?? '',
    dockMode,
    movable: options.movable ?? true,
    closable: options.closable ?? false,
    minimizable: options.minimizable ?? false,
    pinnable: options.pinnable ?? false,
    dockable: options.dockable ?? false,
    ...(options.position !== undefined ? { position: options.position } : {}),
    ...(options.maxWidth !== undefined ? { maxWidth: options.maxWidth } : {}),
    ...(options.maxHeight !== undefined ? { maxHeight: options.maxHeight } : {}),
    ...(options.handMenu !== undefined ? { handMenu: options.handMenu } : {}),
    ...(options.followOffset !== undefined ? { followOffset: options.followOffset } : {}),
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
  /** Live panels, keyed by the host's panel id - both bare panels and windows'. */
  private readonly panels = new Map<string, PanelState>();
  /** Managed windows, keyed by window id. */
  private readonly windows = new Map<string, WindowState>();
  private readonly readyListeners = new Set<(event: PanelReadyEvent) => void>();
  /** Windows already reported ready - replayed to a late `onPanelReady` subscriber. */
  private readonly ready = new Map<string, PanelReadyEvent>();
  private windowSequence = 0;
  private panelSequence = 0;
  /** Every host and manager subscription, released by {@link dispose}. */
  private readonly subscriptions: Array<() => void> = [];
  /** Regions this host created, removed by {@link dispose}. */
  private readonly regions = new Set<string>();
  private disposed = false;

  constructor(options: NativeWindowHostOptions = {}) {
    this.host = readNativeUiHost(options.host);

    this.subscriptions.push(
      this.host.onElementEvent((panelId, elementHandle, type, payload) => {
        this.panels.get(panelId)?.elements.get(elementHandle)?.dispatch(type, payload);
      }),
      this.host.onPanelReady((windowId, panelId, tree) => {
        this.attachWindowPanel(windowId, panelId, tree);
      }),
    );

    // Every state change the manager can make is mirrored to the host as a
    // plain WindowRecord snapshot, so the native app can update its own
    // chrome, dock and visibility without reaching back into this package.
    const events = this.manager.events;
    const apply = (record: WindowRecord): void => this.host.applyWindow(record);
    this.subscriptions.push(
      events.on('opened', apply),
      events.on('focused', apply),
      events.on('minimized', apply),
      events.on('restored', apply),
      events.on('hidden', apply),
      events.on('shown', apply),
      events.on('dockChanged', ({ window }) => apply(window)),
      events.on('regionChanged', ({ window }) => apply(window)),
      events.on('chromeChanged', ({ window }) => apply(window)),
      events.on('handMenuChanged', ({ window }) => apply(window)),
      events.on('closed', (record) => this.closeWindowState(record.id)),
    );
  }

  /**
   * Leave nothing behind: close every window through the manager, so each
   * goes down the normal close path, dispose any bare panels still live,
   * remove the regions this host created, then release every host and
   * manager subscription. Safe to call twice.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // A window is on the manager from createWindow until it closes, so
    // every id here is still open.
    for (const id of [...this.windows.keys()]) {
      this.manager.close(id);
    }
    for (const panelId of this.panels.keys()) {
      this.host.disposePanel(panelId);
    }
    for (const regionId of this.regions) {
      this.host.removeRegion(regionId);
    }
    this.regions.clear();
    this.panels.clear();
    this.windows.clear();
    this.ready.clear();
    this.readyListeners.clear();
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.length = 0;
  }

  // --- WindowHost / PanelHost -------------------------------------------

  createPanel(configJson: unknown): PanelHandle {
    const panelId = `uix-panel-${(this.panelSequence += 1)}`;
    const tree = this.host.createPanel(panelId, configJson);
    return this.registerPanel(panelId, tree).handle;
  }

  onPanelReady(listener: (event: PanelReadyEvent) => void): () => void {
    this.readyListeners.add(listener);
    for (const event of this.ready.values()) {
      listener(event);
    }
    return () => void this.readyListeners.delete(listener);
  }

  // --- SceneTarget (portable scene descriptors) -----------------------------

  /** Hand a descriptor's region to the native app, which owns the layout. */
  spawnRegion(region: SceneRegion): void {
    this.regions.add(region.id);
    this.host.createRegion({
      ...region,
      ...(region.position !== undefined ? { position: [...region.position] } : {}),
      ...(region.followOffset !== undefined ? { followOffset: [...region.followOffset] } : {}),
    });
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

  createWindow(options: CreateWindowOptions): WindowHandle {
    const id = options.id ?? `uix-window-${(this.windowSequence += 1)}`;
    const state: WindowState = {
      panel: undefined,
      panelId: undefined,
      onReadyListeners: new Set(),
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

    const record = this.manager.open(id, {
      title: options.title ?? id,
      dockMode: options.dockMode ?? DockMode.WorldLocked,
      chrome: {
        close: options.closable ?? false,
        minimize: options.minimizable ?? false,
        pin: options.pinnable ?? false,
        dock: options.dockable ?? false,
      },
      ...(options.region !== undefined ? { region: options.region } : {}),
      ...(options.handMenu !== undefined ? { handMenu: options.handMenu } : {}),
    });

    this.host.createWindow(id, options.config, toPlainWindowOptions(id, options, record.dockMode));

    return handle;
  }

  // --- internals ------------------------------------------------------------

  private registerPanel(panelId: string, tree: NativeElementNode): PanelState {
    const context = {
      setProperties: (elementHandle: string, props: Record<string, unknown>) =>
        this.host.setProperties(panelId, elementHandle, props),
    };
    const root = new NativeUixElement(tree, context);
    const elements = flattenByHandle(root);
    const ids = byMarkupId(elements);
    const handle: PanelHandle = {
      root,
      getElementById: (id) => ids.get(id),
      setTargetDimensions: (width, height) => this.host.setTargetDimensions(panelId, width, height),
      dispose: () => {
        this.panels.delete(panelId);
        this.host.disposePanel(panelId);
      },
    };
    const state: PanelState = { handle, elements };
    this.panels.set(panelId, state);
    return state;
  }

  private attachWindowPanel(windowId: string, panelId: string, tree: NativeElementNode): void {
    const state = this.windows.get(windowId);
    if (!state) {
      // The window was closed (or never existed) before the host reported
      // its panel ready - a benign race, not an error.
      return;
    }
    const panel = this.registerPanel(panelId, tree).handle;
    state.panel = panel;
    state.panelId = panelId;
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
    if (state?.panelId) {
      this.panels.delete(state.panelId);
      this.host.disposePanel(state.panelId);
    }
    this.host.closeWindow(id);
  }
}
