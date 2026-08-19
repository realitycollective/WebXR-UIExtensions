/**
 * UIWindowSystem - wires window chrome, keeps the `WindowManager` in sync
 * with entities, applies focus ordering and minimize state.
 *
 * Reuse over recreation: the panel itself is loaded/rendered by the IWSDK's
 * `PanelUISystem`; this system only discovers the chrome elements by their
 * well-known ids and drives them.
 */
import {
  PanelDocument,
  PanelUI,
  UIKitDocument,
  Vector3,
  createSystem,
  type Entity,
} from '@iwsdk/core';
import { UIDockedTo, UIWindow, UIWindowState } from '../components.js';
import { WINDOW_CHROME_IDS } from '@realitycollective/webxr-uiextensions';
import { windowManagerFor } from '../manager-registry.js';
import {
  minimizeLabelFor,
  pinLabelFor,
  type WindowManager,
  type WindowRecord,
} from '@realitycollective/webxr-uiextensions';
import { DockMode, isDockMode, type DockModeValue } from '@realitycollective/webxr-uiextensions';

type UikitElement = {
  addEventListener: (type: string, listener: (event?: unknown) => void) => void;
  setProperties: (props: Record<string, unknown>) => void;
};

let autoId = 0;

export class UIWindowSystem extends createSystem({
  pendingWindows: {
    required: [UIWindow, PanelUI, PanelDocument],
    excluded: [UIWindowState],
  },
  windows: { required: [UIWindow, UIWindowState, PanelDocument] },
}) {
  private manager!: WindowManager;
  private entitiesById = new Map<string, Entity>();
  private localCamera = new Vector3();

  override init(): void {
    this.manager = windowManagerFor(this.world);

    this.cleanupFuncs.push(
      this.queries.pendingWindows.subscribe('qualify', (entity) => {
        this.adoptWindow(entity);
      }),
      this.queries.windows.subscribe('disqualify', (entity) => {
        this.releaseWindow(entity);
      }),
      this.manager.events.on('minimized', ({ id }) => this.applyMinimized(id, true)),
      this.manager.events.on('restored', ({ id }) => this.applyMinimized(id, false)),
      this.manager.events.on('minimized', (record) => this.syncMinimizeLabel(record)),
      this.manager.events.on('restored', (record) => this.syncMinimizeLabel(record)),
      this.manager.events.on('dockChanged', ({ window }) => {
        const entity = this.entitiesById.get(window.id);
        if (entity && entity.getValue(UIWindow, 'dockMode') !== window.dockMode) {
          entity.setValue(UIWindow, 'dockMode', window.dockMode);
        }
        this.syncPinLabel(window);
      }),
      this.manager.events.on('dragStarted', (window) => this.syncPinLabel(window)),
      this.manager.events.on('dragEnded', (window) => this.syncPinLabel(window)),
    );
  }

  override update(): void {
    // Focus bias: nudge each window's document toward the viewer by a small
    // amount inversely related to focus depth, so overlapping windows resolve
    // in focus order. Computed in entity-local space so it holds for any
    // window orientation.
    for (const entity of this.queries.windows.entities) {
      const id = entity.getValue(UIWindow, 'windowId') as string;
      if (!this.manager.has(id)) {
        continue;
      }
      const document = this.documentOf(entity);
      const object = entity.object3D;
      if (!document || !object) {
        continue;
      }
      const bias = entity.getValue(UIWindow, 'focusBias') as number;
      const depth = this.manager.orderOf(id);
      const amount = bias * Math.max(0, this.manager.count - 1 - depth);
      if (amount === 0) {
        document.position.set(0, 0, 0);
        continue;
      }
      this.camera.getWorldPosition(this.localCamera);
      object.worldToLocal(this.localCamera);
      if (this.localCamera.lengthSq() === 0) {
        continue;
      }
      document.position.copy(this.localCamera.normalize().multiplyScalar(amount));
    }
  }

  entityFor(windowId: string): Entity | undefined {
    return this.entitiesById.get(windowId);
  }

  private adoptWindow(entity: Entity): void {
    let id = entity.getValue(UIWindow, 'windowId') as string;
    if (!id) {
      id = `uix-window-${autoId++}`;
      entity.setValue(UIWindow, 'windowId', id);
    }
    const title = entity.getValue(UIWindow, 'title') as string;
    const dockMode = entity.getValue(UIWindow, 'dockMode') as DockModeValue;
    this.entitiesById.set(id, entity);
    if (!this.manager.has(id)) {
      this.manager.open(id, { title, dockMode });
    }
    this.wireChrome(entity, id, title);

    // Snapshot "home" so the DOCK button can return the window: the spawn
    // region if it was born docked, otherwise its placement + dock mode.
    const object = entity.object3D;
    entity.addComponent(UIWindowState, {
      chromeWired: true,
      appliedDockMode: '',
      homeDockMode: dockMode,
      homeRegion: entity.hasComponent(UIDockedTo)
        ? (entity.getValue(UIDockedTo, 'regionId') as string)
        : '',
      homePosition: object ? [object.position.x, object.position.y, object.position.z] : [0, 0, 0],
      homeYaw: object ? object.rotation.y : 0,
    });
    this.syncPinLabel({ id, dockMode, dragging: false });
  }

  /** Return a window to its home: spawn region, or original placement/mode. */
  returnHome(entity: Entity): void {
    const homeRegion = entity.getValue(UIWindowState, 'homeRegion') as string;
    if (homeRegion) {
      if (
        entity.hasComponent(UIDockedTo) &&
        entity.getValue(UIDockedTo, 'regionId') === homeRegion
      ) {
        return; // already home
      }
      if (entity.hasComponent(UIDockedTo)) {
        entity.removeComponent(UIDockedTo);
      }
      entity.addComponent(UIDockedTo, { regionId: homeRegion });
      return;
    }
    if (entity.hasComponent(UIDockedTo)) {
      entity.removeComponent(UIDockedTo);
    }
    const homeDockMode = entity.getValue(UIWindowState, 'homeDockMode') as string;
    if (isDockMode(homeDockMode)) {
      entity.setValue(UIWindow, 'dockMode', homeDockMode);
    }
    if (homeDockMode === DockMode.WorldLocked) {
      const object = entity.object3D;
      const home = entity.getVectorView(UIWindowState, 'homePosition');
      if (object) {
        object.position.set(home[0] ?? 0, home[1] ?? 0, home[2] ?? 0);
        object.rotation.set(0, entity.getValue(UIWindowState, 'homeYaw') as number, 0);
      }
    }
    // Follow modes re-snap on their own (the dock system syncs the Follower).
  }

  /** MIN when open, MAX when minimized - the label names the next action. */
  private syncMinimizeLabel(record: Pick<WindowRecord, 'id' | 'minimized'>): void {
    const entity = this.entitiesById.get(record.id);
    const minimize = entity
      ? (this.documentOf(entity)?.getElementById(WINDOW_CHROME_IDS.minimize) as
          | UikitElement
          | undefined)
      : undefined;
    minimize?.setProperties({ text: minimizeLabelFor(record) });
  }

  private syncPinLabel(record: Pick<WindowRecord, 'id' | 'dockMode' | 'dragging'>): void {
    const entity = this.entitiesById.get(record.id);
    const pin = entity
      ? (this.documentOf(entity)?.getElementById(WINDOW_CHROME_IDS.pin) as
          | UikitElement
          | undefined)
      : undefined;
    pin?.setProperties({ text: pinLabelFor(record) });
  }

  private releaseWindow(entity: Entity): void {
    const id = entity.getValue(UIWindow, 'windowId') as string;
    if (id && this.entitiesById.get(id) === entity) {
      this.entitiesById.delete(id);
      if (this.manager.has(id)) {
        this.manager.close(id);
      }
    }
  }

  private wireChrome(entity: Entity, id: string, title: string): void {
    const document = this.documentOf(entity);
    if (!document) {
      return;
    }

    // IWSDK 0.5 removed PanelUI.maxWidth/maxHeight; world size is now the
    // document's own concern. Fit into the requested box, preserving aspect
    // ratio. Zero means "leave intrinsic" so the entity transform owns scale.
    const targetWidth = entity.getValue(UIWindow, 'targetWidth') ?? 0;
    const targetHeight = entity.getValue(UIWindow, 'targetHeight') ?? 0;
    if (targetWidth > 0 && targetHeight > 0) {
      document.setTargetDimensions(targetWidth, targetHeight);
    }

    const element = (elementId: string): UikitElement | undefined =>
      document.getElementById(elementId) as UikitElement | undefined;

    const titleEl = element(WINDOW_CHROME_IDS.title);
    if (titleEl && title) {
      titleEl.setProperties({ text: title });
    }

    // Chrome buttons live on the drag surface - keep their presses out of
    // the title-bar drag handle so clicks never turn into (or arm) drags.
    const swallowPress = (button: UikitElement | undefined): void => {
      button?.addEventListener('pointerdown', (event) => {
        (event as { stopPropagation?: () => void } | undefined)?.stopPropagation?.();
      });
    };
    swallowPress(element(WINDOW_CHROME_IDS.pin));
    swallowPress(element(WINDOW_CHROME_IDS.dock));
    swallowPress(element(WINDOW_CHROME_IDS.minimize));
    swallowPress(element(WINDOW_CHROME_IDS.close));

    // Any press anywhere on the window brings it to the front.
    const root = element(WINDOW_CHROME_IDS.window);
    root?.addEventListener('pointerdown', () => {
      if (this.manager.has(id)) {
        this.manager.focus(id);
      }
    });

    const close = element(WINDOW_CHROME_IDS.close);
    if (close) {
      if (entity.getValue(UIWindow, 'closable')) {
        close.addEventListener('click', () => {
          // Destroying the entity disqualifies it everywhere; releaseWindow
          // then closes the manager record.
          entity.destroy();
        });
      } else {
        close.setProperties({ display: 'none' });
      }
    }

    const minimize = element(WINDOW_CHROME_IDS.minimize);
    if (minimize) {
      if (entity.getValue(UIWindow, 'minimizable')) {
        minimize.addEventListener('click', () => {
          if (this.manager.has(id)) {
            this.manager.toggleMinimized(id);
          }
        });
      } else {
        minimize.setProperties({ display: 'none' });
      }
    }

    const pin = element(WINDOW_CHROME_IDS.pin);
    if (pin) {
      if (entity.getValue(UIWindow, 'pinnable')) {
        pin.addEventListener('click', () => {
          if (this.manager.has(id)) {
            this.manager.togglePin(id);
          }
        });
      } else {
        pin.setProperties({ display: 'none' });
      }
    }

    const dock = element(WINDOW_CHROME_IDS.dock);
    dock?.addEventListener('click', () => this.returnHome(entity));
  }

  private applyMinimized(id: string, minimized: boolean): void {
    const entity = this.entitiesById.get(id);
    const document = entity ? this.documentOf(entity) : undefined;
    const content = document?.getElementById(WINDOW_CHROME_IDS.content) as
      | UikitElement
      | undefined;
    content?.setProperties({ display: minimized ? 'none' : 'flex' });
  }

  private documentOf(entity: Entity): UIKitDocument | undefined {
    return PanelDocument.data.document[entity.index] as UIKitDocument | undefined;
  }
}
