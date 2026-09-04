/**
 * IWSDK implementation of the core's `WindowHost` + `SceneTarget`.
 *
 * This is what makes a portable `SceneDescriptor` build the SAME playground
 * on IWSDK as on plain three.js, and lets app behaviour be wired through
 * `onPanelReady` instead of hand-written ECS queries:
 *
 *   const host = createSceneHost(world);
 *   applyScene(host, PLAYGROUND);
 *   host.onPanelReady(({ id, panel }) => wireMyPanel(id, panel));
 *
 * Readiness is detected with a single ECS query on `PanelUI + PanelDocument`
 * - the engine-specific mechanism stays here, behind the portable interface.
 * Bare panels (a `PanelUI` entity with no `UIWindow`) are announced too, with
 * `kind: 'panel'` and their config path as the id, so devtools and hand-built
 * entities show up in the same stream as managed windows.
 */
import {
  PanelDocument,
  PanelUI,
  UIKitDocument,
  createSystem,
  type Entity,
  type World,
} from '@iwsdk/core';
import {
  upgradePanel,
  type PanelHandle,
  type PanelReadyEvent,
  type SceneRegion,
  type SceneTarget,
  type SceneWindow,
  type UixElement,
  type WindowHandle,
  type WindowHost,
} from '@realitycollective/webxr-uiextensions';
import {
  createDockRegion,
  createUIWindow,
  type CreateWindowOptions,
} from './factory.js';
import { UIWindow } from './components.js';

/** Panel handle over an IWSDK `UIKitDocument`. */
function panelHandleFor(document: UIKitDocument): PanelHandle {
  return {
    get root(): UixElement {
      return document.rootElement as unknown as UixElement;
    },
    getElementById: (id) =>
      (document.getElementById(id) as UixElement | null) ?? undefined,
    setTargetDimensions: (width, height) =>
      document.setTargetDimensions(width, height),
    dispose: () => {
      /* IWSDK owns the document lifecycle via the entity. */
    },
  };
}

/**
 * The live panel on an entity, or `undefined` while IWSDK is still loading
 * its document. Use it to reach a panel from an entity you already hold;
 * `onPanelReady` stays the way to be TOLD when one appears.
 */
export function getPanelHandle(entity: Entity): PanelHandle | undefined {
  const document = PanelDocument.data.document[entity.index] as
    | UIKitDocument
    | undefined;
  return document ? panelHandleFor(document) : undefined;
}

/**
 * Bridges panel loading into `onPanelReady`. Registered once per host; the
 * query fires as each panel's document is attached by IWSDK's UI system.
 */
function createReadySystem(onReady: (entity: Entity) => void) {
  return class UixPanelReadySystem extends createSystem({
    panels: { required: [PanelUI, PanelDocument] },
  }) {
    override init(): void {
      this.cleanupFuncs.push(
        this.queries.panels.subscribe('qualify', (entity) => onReady(entity)),
      );
      this.queries.panels.entities.forEach((entity) => onReady(entity));
    }
  };
}

/** A window spawned by {@link IwsdkSceneHost.createWindow}. */
export interface IwsdkWindowHandle extends WindowHandle {
  /** The ECS entity carrying `PanelUI`, `UIWindow` and the interaction tags. */
  readonly entity: Entity;
}

export interface IwsdkSceneHost extends WindowHost, SceneTarget {
  readonly world: World;
  /**
   * Spawn a managed window and get a handle back straight away. IWSDK loads
   * the markup over later frames, so `handle.panel` is `undefined` at first
   * and `handle.onReady` is how you wait for it without an ECS query.
   */
  createWindow(options: CreateWindowOptions): IwsdkWindowHandle;
}

/**
 * Create the host for a world. Call AFTER `registerUIExtensions(world)`.
 */
export function createSceneHost(world: World): IwsdkSceneHost {
  const readyListeners = new Set<(event: PanelReadyEvent) => void>();
  const ready = new Map<string, PanelReadyEvent>();
  const seen = new WeakSet<object>();

  const announce = (entity: Entity): void => {
    const document = PanelDocument.data.document[entity.index] as
      | UIKitDocument
      | undefined;
    if (!document || seen.has(document)) {
      return;
    }
    seen.add(document);
    // Window id comes from the UIWindow component the factory attached. A
    // panel without one is a bare panel - still worth announcing, keyed by
    // its config path, which is the only stable id IWSDK gives it.
    const windowId = entity.hasComponent(UIWindow)
      ? (UIWindow.data.windowId[entity.index] as string)
      : '';
    const kind: 'window' | 'panel' = windowId ? 'window' : 'panel';
    const id = windowId || (PanelUI.data.config[entity.index] as string);
    const panel = panelHandleFor(document);
    // Upgrade `data-uix` controls exactly as the ECS controls system does,
    // so wiring code sees the same handles on every adapter (idempotent).
    upgradePanel(document, document.rootElement as unknown as UixElement);
    const event: PanelReadyEvent = { id, panel, kind };
    ready.set(id, event);
    for (const listener of readyListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error(`[uix] panel-ready listener failed for "${id}":`, error);
      }
    }
  };

  world.registerSystem(createReadySystem(announce));

  let windowSequence = 0;

  const host: IwsdkSceneHost = {
    world,

    // IWSDK owns panel lifecycles through the ECS, so there is no bare-panel
    // path here - `createPanel` throws rather than half-working.
    supportsStandalonePanels: false,

    createPanel(): PanelHandle {
      throw new Error(
        '[uix] createPanel() is not supported on the IWSDK host - spawn a window ' +
          '(spawnWindow/createUIWindow) so IWSDK owns the panel lifecycle.',
      );
    },

    onPanelReady(listener) {
      readyListeners.add(listener);
      for (const event of ready.values()) {
        listener(event);
      }
      return () => void readyListeners.delete(listener);
    },

    createWindow(options: CreateWindowOptions): IwsdkWindowHandle {
      const id = options.id ?? `uix-window-${(windowSequence += 1)}`;
      const entity = createUIWindow(world, { ...options, id });
      return {
        entity,
        id,
        get panel(): PanelHandle | undefined {
          return ready.get(id)?.panel;
        },
        onReady(listener: (panel: PanelHandle) => void): () => void {
          const existing = ready.get(id)?.panel;
          if (existing) {
            listener(existing);
            return () => {};
          }
          // `onPanelReady` replays panels that are already live, but this id
          // is not one of them, so the callback only ever runs later.
          const unsubscribe = host.onPanelReady((event) => {
            if (event.id === id) {
              unsubscribe();
              listener(event.panel);
            }
          });
          return unsubscribe;
        },
      };
    },

    spawnRegion(region: SceneRegion): void {
      createDockRegion(world, {
        id: region.id,
        ...(region.flow !== undefined ? { flow: region.flow } : {}),
        ...(region.pitch !== undefined ? { pitch: region.pitch } : {}),
        ...(region.columns !== undefined ? { columns: region.columns } : {}),
        ...(region.capacity !== undefined ? { capacity: region.capacity } : {}),
        ...(region.snapRadius !== undefined
          ? { snapRadius: region.snapRadius }
          : {}),
        ...(region.position !== undefined
          ? { position: [...region.position] as [number, number, number] }
          : {}),
        ...(region.follow !== undefined ? { follow: region.follow } : {}),
        ...(region.followOffset !== undefined
          ? { followOffset: [...region.followOffset] as [number, number, number] }
          : {}),
      });
    },

    spawnWindow(window: SceneWindow): void {
      host.createWindow({
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
      });
    },
  };

  return host;
}
