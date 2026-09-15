/**
 * UIWindowSystem - wires window chrome, keeps the `WindowManager` in sync
 * with entities, and applies every manager event to the ECS: focus
 * ordering, minimize, hide/show, region docking, return-home, chrome
 * enablement and close.
 *
 * The manager is the API app code drives (a hand menu calls
 * `manager.hide(id)` or `manager.dockTo(id, region)`); this system is where
 * those calls become entity changes. The reverse direction is kept in step
 * too: a title-bar drag that docks a window, or a dock-mode change applied
 * by `UIDockSystem`, is written back into the record, so the record is
 * always what the scene shows.
 *
 * Reuse over recreation: the panel itself is loaded/rendered by the IWSDK's
 * `PanelUISystem`; this system only discovers the chrome elements by their
 * well-known ids and drives them.
 */
import {
  PanelDocument,
  PanelUI,
  PokeInteractable,
  RayInteractable,
  UIKitDocument,
  type Entity,
} from '@iwsdk/core';
import { createSystem } from '../create-system.js';
import { Vector3 } from 'three';
import { UIDockedTo, UIWindow, UIWindowState } from '../components.js';
import { WINDOW_CHROME_IDS } from '@realitycollective/webxr-uiextensions';
import { windowManagerFor } from '../manager-registry.js';
import {
  minimizeLabelFor,
  pinLabelFor,
  type WindowChrome,
  type WindowManager,
  type WindowRecord,
} from '@realitycollective/webxr-uiextensions';
import { DockMode, isDockMode, type DockModeValue } from '@realitycollective/webxr-uiextensions';

type UikitElement = {
  addEventListener: (type: string, listener: (event?: unknown) => void) => void;
  setProperties: (props: Record<string, unknown>) => void;
};

/** Which IWSDK interaction tags `hide()` stripped, so `show()` restores only those. */
interface HiddenTags {
  ray: boolean;
  poke: boolean;
}

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
  private hiddenTags = new Map<string, HiddenTags>();
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
      this.manager.events.on('closed', ({ id }) => this.destroyWindow(id)),
      this.manager.events.on('minimized', ({ id }) => this.applyMinimized(id, true)),
      this.manager.events.on('restored', ({ id }) => this.applyMinimized(id, false)),
      this.manager.events.on('minimized', (record) => this.syncMinimizeLabel(record)),
      this.manager.events.on('restored', (record) => this.syncMinimizeLabel(record)),
      this.manager.events.on('hidden', ({ id }) => this.applyHidden(id, true)),
      this.manager.events.on('shown', ({ id }) => this.applyHidden(id, false)),
      this.manager.events.on('dockChanged', ({ window }) => {
        const entity = this.entitiesById.get(window.id);
        if (entity && entity.getValue(UIWindow, 'dockMode') !== window.dockMode) {
          entity.setValue(UIWindow, 'dockMode', window.dockMode);
        }
        this.syncPinLabel(window);
      }),
      this.manager.events.on('regionChanged', ({ window }) => this.applyRegion(window)),
      this.manager.events.on('returnHome', ({ id }) => {
        const entity = this.entitiesById.get(id);
        if (entity) {
          this.returnHome(entity);
        }
      }),
      this.manager.events.on('chromeChanged', ({ window }) => this.applyChrome(window)),
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
      const record = this.manager.get(id);
      if (!record || record.hidden) {
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
    const region = entity.hasComponent(UIDockedTo)
      ? (entity.getValue(UIDockedTo, 'regionId') as string)
      : '';
    this.entitiesById.set(id, entity);
    if (!this.manager.has(id)) {
      this.manager.open(id, {
        title,
        dockMode,
        ...(region ? { region } : {}),
        chrome: this.chromeFlagsOf(entity),
      });
    }
    this.wireChrome(entity, id, title);

    // Snapshot "home" so the DOCK button can return the window: the spawn
    // region if it was born docked, otherwise its placement + dock mode.
    const object = entity.object3D;
    entity.addComponent(UIWindowState, {
      chromeWired: true,
      appliedDockMode: '',
      homeDockMode: dockMode,
      homeRegion: region,
      homePosition: object ? [object.position.x, object.position.y, object.position.z] : [0, 0, 0],
      homeYaw: object ? object.rotation.y : 0,
    });
    const record = this.manager.get(id);
    if (record) {
      this.applyChrome(record);
      this.syncPinLabel(record);
      this.syncMinimizeLabel(record);
      if (record.minimized) {
        this.applyMinimized(id, true);
      }
      if (record.hidden) {
        this.applyHidden(id, true);
      }
    }
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

  /** The chrome flags on the component, in the manager's vocabulary. */
  private chromeFlagsOf(entity: Entity): WindowChrome {
    return {
      close: Boolean(entity.getValue(UIWindow, 'closable')),
      minimize: Boolean(entity.getValue(UIWindow, 'minimizable')),
      pin: Boolean(entity.getValue(UIWindow, 'pinnable')),
      dock: Boolean(entity.getValue(UIWindow, 'dockable')),
    };
  }

  /**
   * Show exactly the enabled buttons, and keep the component flags equal to
   * the record so code reading either sees one answer.
   */
  private applyChrome(record: Pick<WindowRecord, 'id' | 'chrome'>): void {
    const entity = this.entitiesById.get(record.id);
    if (!entity) {
      return;
    }
    const { chrome } = record;
    entity.setValue(UIWindow, 'closable', chrome.close);
    entity.setValue(UIWindow, 'minimizable', chrome.minimize);
    entity.setValue(UIWindow, 'pinnable', chrome.pin);
    entity.setValue(UIWindow, 'dockable', chrome.dock);
    const document = this.documentOf(entity);
    if (!document) {
      return;
    }
    const buttons: Array<[string, boolean]> = [
      [WINDOW_CHROME_IDS.close, chrome.close],
      [WINDOW_CHROME_IDS.minimize, chrome.minimize],
      [WINDOW_CHROME_IDS.pin, chrome.pin],
      [WINDOW_CHROME_IDS.dock, chrome.dock],
    ];
    for (const [elementId, enabled] of buttons) {
      (document.getElementById(elementId) as UikitElement | undefined)?.setProperties({
        display: enabled ? 'flex' : 'none',
      });
    }
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

  /** The entity went away (destroyed, or lost its panel): close the record. */
  private releaseWindow(entity: Entity): void {
    const id = entity.getValue(UIWindow, 'windowId') as string;
    if (id && this.entitiesById.get(id) === entity) {
      this.entitiesById.delete(id);
      this.hiddenTags.delete(id);
      if (this.manager.has(id)) {
        this.manager.close(id);
      }
    }
  }

  /** The record was closed through the manager: tear the entity down. */
  private destroyWindow(id: string): void {
    const entity = this.entitiesById.get(id);
    if (!entity) {
      return; // closed from the entity side; releaseWindow already ran
    }
    this.entitiesById.delete(id);
    this.hiddenTags.delete(id);
    entity.destroy();
  }

  private applyHidden(id: string, hidden: boolean): void {
    const entity = this.entitiesById.get(id);
    if (!entity) {
      return;
    }
    const object = entity.object3D;
    if (object) {
      object.visible = !hidden;
    }
    if (hidden) {
      // Strip the interaction tags so no pointer can reach the window, and
      // remember which ones were there so show() puts back only those.
      const tags: HiddenTags = {
        ray: entity.hasComponent(RayInteractable),
        poke: entity.hasComponent(PokeInteractable),
      };
      if (tags.ray) {
        entity.removeComponent(RayInteractable);
      }
      if (tags.poke) {
        entity.removeComponent(PokeInteractable);
      }
      this.hiddenTags.set(id, tags);
      return;
    }
    const tags = this.hiddenTags.get(id);
    this.hiddenTags.delete(id);
    if (tags?.ray && !entity.hasComponent(RayInteractable)) {
      entity.addComponent(RayInteractable);
    }
    if (tags?.poke && !entity.hasComponent(PokeInteractable)) {
      entity.addComponent(PokeInteractable);
    }
  }

  /** Make the entity's `UIDockedTo` agree with the record's region. */
  private applyRegion(record: Pick<WindowRecord, 'id' | 'region'>): void {
    const entity = this.entitiesById.get(record.id);
    if (!entity) {
      return;
    }
    const current = entity.hasComponent(UIDockedTo)
      ? (entity.getValue(UIDockedTo, 'regionId') as string)
      : undefined;
    if (current === record.region) {
      return; // the ECS already shows it (drag-drop docked, or a write-back)
    }
    if (entity.hasComponent(UIDockedTo)) {
      entity.removeComponent(UIDockedTo);
    }
    if (record.region !== undefined) {
      entity.addComponent(UIDockedTo, { regionId: record.region });
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

    // Every button is wired once and gated on the record at click time, so
    // enabling a button later (manager.setChrome) needs no rewiring.
    const enabled = (key: keyof WindowChrome): boolean =>
      this.manager.get(id)?.chrome[key] === true;

    element(WINDOW_CHROME_IDS.close)?.addEventListener('click', () => {
      if (enabled('close')) {
        // One teardown path: the manager closes, destroyWindow removes the
        // entity, releaseWindow sees the record is already gone.
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
        this.manager.togglePin(id);
      }
    });
    element(WINDOW_CHROME_IDS.dock)?.addEventListener('click', () => {
      if (enabled('dock')) {
        this.manager.returnHome(id);
      }
    });
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
