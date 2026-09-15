/**
 * The window, dock-region and drag systems against a REAL IWSDK world.
 *
 * `new World()` from `@iwsdk/core` constructs headlessly and runs systems,
 * queries and `qualify`/`disqualify` subscriptions for real, so what is
 * asserted here is what the ECS does, not a fake's idea of it. The only
 * stand-in is the `UIKitDocument`, whose elements record the listeners and
 * properties the systems set on them.
 *
 * What these prove: every `WindowManager` call app code can make (close,
 * hide/show, dockTo/undock/returnHome, setChrome) lands on the entity, and
 * what the ECS does on its own (a drag-drop dock, a rejected dock) is
 * written back into the record.
 */
import {
  Follower,
  PanelDocument,
  PanelUI,
  PerspectiveCamera,
  PokeInteractable,
  RayInteractable,
  ScreenSpace,
  Transform,
  World,
  type Entity,
} from '@iwsdk/core';
import { DockMode, WINDOW_CHROME_IDS } from '@realitycollective/webxr-uiextensions';
import { Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  UIDockRegion,
  UIDockedTo,
  UIWindow,
  UIWindowState,
} from '../src/components.js';
import { createDockRegion, createUIWindow } from '../src/factory.js';
import { windowManagerFor } from '../src/manager-registry.js';
import { regionRegistryFor } from '../src/region-registry-store.js';
import { UIDockRegionSystem } from '../src/systems/dock-region-system.js';
import { UIDockSystem } from '../src/systems/dock-system.js';
import { UIDragSystem } from '../src/systems/drag-system.js';
import { UIWindowSystem } from '../src/systems/window-system.js';

/**
 * Same components in the same order in every world - see the note in
 * scene-host.test.ts on elics keeping `typeId` on the component object.
 */
function makeWorld(): World {
  const world = new World();
  for (const component of [
    Transform,
    PanelUI,
    PanelDocument,
    RayInteractable,
    PokeInteractable,
    Follower,
    ScreenSpace,
    UIWindow,
    UIWindowState,
    UIDockRegion,
    UIDockedTo,
  ]) {
    world.registerComponent(component);
  }
  world.camera = new PerspectiveCamera();
  // Systems capture `world.scene` when constructed, so it must exist first.
  world.scene = new Scene();
  world
    .registerSystem(UIWindowSystem)
    .registerSystem(UIDockSystem)
    .registerSystem(UIDragSystem)
    .registerSystem(UIDockRegionSystem);
  return world;
}

interface FakeElement {
  userData: Record<string, unknown>;
  children: never[];
  listeners: Map<string, Array<(event?: unknown) => void>>;
  props: Record<string, unknown>;
  addEventListener(type: string, listener: (event?: unknown) => void): void;
  setProperties(props: Record<string, unknown>): void;
  fire(type: string, event?: unknown): void;
}

function makeElement(): FakeElement {
  const element: FakeElement = {
    userData: {},
    children: [],
    listeners: new Map(),
    props: {},
    addEventListener(type, listener) {
      const list = element.listeners.get(type) ?? [];
      list.push(listener);
      element.listeners.set(type, list);
    },
    setProperties(props) {
      Object.assign(element.props, props);
    },
    fire(type, event) {
      for (const listener of element.listeners.get(type) ?? []) {
        listener(event);
      }
    },
  };
  return element;
}

/** A document with every chrome element, keyed by id. */
function makeDocument() {
  const elements = new Map<string, FakeElement>();
  for (const id of Object.values(WINDOW_CHROME_IDS)) {
    elements.set(id, makeElement());
  }
  return {
    position: new Vector3(),
    rootElement: makeElement(),
    getElementById: (id: string) => elements.get(id) ?? null,
    setTargetDimensions: () => {},
    element: (id: string) => elements.get(id)!,
  };
}

type Document = ReturnType<typeof makeDocument>;

/** Spawn a window and attach its (fake) panel, as IWSDK's UI system would. */
function spawn(
  world: World,
  options: Omit<Parameters<typeof createUIWindow>[1], 'config'> & { config?: string },
): { entity: Entity; document: Document } {
  const entity = createUIWindow(world, { config: '/ui/w.uikitml', ...options });
  const document = makeDocument();
  entity.addComponent(PanelDocument, { document });
  return { entity, document };
}

const display = (document: Document, id: string) => document.element(id).props['display'];

describe('UIWindowSystem applies the manager', () => {
  it('opens a record on adoption, with the chrome the component asked for', () => {
    const world = makeWorld();
    const manager = windowManagerFor(world);
    spawn(world, { id: 'w', title: 'Window', pinnable: true, dockable: true });
    const record = manager.get('w');
    expect(record?.title).toBe('Window');
    expect(record?.chrome).toEqual({ pin: true, dock: true, minimize: false, close: false });
    expect(record?.region).toBeUndefined();
  });

  it('closing through the manager destroys the entity', () => {
    const world = makeWorld();
    const manager = windowManagerFor(world);
    const { entity } = spawn(world, { id: 'w' });
    expect(entity.hasComponent(UIWindow)).toBe(true);
    manager.close('w');
    expect(manager.has('w')).toBe(false);
    expect(entity.hasComponent(UIWindow)).toBe(false);
    expect(world.getSystem(UIWindowSystem)?.entityFor('w')).toBeUndefined();
  });

  it('destroying the entity closes the record (the other way round)', () => {
    const world = makeWorld();
    const manager = windowManagerFor(world);
    const { entity } = spawn(world, { id: 'w' });
    entity.destroy();
    expect(manager.has('w')).toBe(false);
  });

  it('chrome buttons are hidden and inert until enabled', () => {
    const world = makeWorld();
    const manager = windowManagerFor(world);
    const { entity, document } = spawn(world, { id: 'w' });
    for (const id of [
      WINDOW_CHROME_IDS.close,
      WINDOW_CHROME_IDS.minimize,
      WINDOW_CHROME_IDS.pin,
      WINDOW_CHROME_IDS.dock,
    ]) {
      expect(display(document, id)).toBe('none');
    }
    document.element(WINDOW_CHROME_IDS.close).fire('click');
    document.element(WINDOW_CHROME_IDS.minimize).fire('click');
    document.element(WINDOW_CHROME_IDS.pin).fire('click');
    expect(manager.has('w')).toBe(true);
    expect(manager.get('w')?.minimized).toBe(false);
    expect(manager.get('w')?.dockMode).toBe(DockMode.WorldLocked);

    manager.setChrome('w', { minimize: true, pin: true, close: true });
    expect(display(document, WINDOW_CHROME_IDS.minimize)).toBe('flex');
    expect(display(document, WINDOW_CHROME_IDS.pin)).toBe('flex');
    expect(display(document, WINDOW_CHROME_IDS.dock)).toBe('none');
    // The component flags follow the record, so either read gives one answer.
    expect(Boolean(entity.getValue(UIWindow, 'minimizable'))).toBe(true);
    expect(Boolean(entity.getValue(UIWindow, 'pinnable'))).toBe(true);
    expect(Boolean(entity.getValue(UIWindow, 'dockable'))).toBe(false);

    document.element(WINDOW_CHROME_IDS.minimize).fire('click');
    expect(manager.get('w')?.minimized).toBe(true);
    expect(display(document, WINDOW_CHROME_IDS.content)).toBe('none');
    expect(document.element(WINDOW_CHROME_IDS.minimize).props['text']).toBe('MAX');

    document.element(WINDOW_CHROME_IDS.pin).fire('click');
    expect(manager.get('w')?.dockMode).toBe(DockMode.BodyFollow);
    expect(entity.getValue(UIWindow, 'dockMode')).toBe(DockMode.BodyFollow);

    document.element(WINDOW_CHROME_IDS.close).fire('click');
    expect(manager.has('w')).toBe(false);
    expect(entity.hasComponent(UIWindow)).toBe(false);
  });

  it('hide strips visibility and the interaction tags; show restores only what was there', () => {
    const world = makeWorld();
    const manager = windowManagerFor(world);
    const { entity } = spawn(world, { id: 'w' });
    entity.removeComponent(PokeInteractable); // an app that wants ray only

    manager.hide('w');
    expect(entity.object3D?.visible).toBe(false);
    expect(entity.hasComponent(RayInteractable)).toBe(false);
    expect(entity.hasComponent(PokeInteractable)).toBe(false);
    expect(manager.has('w')).toBe(true);

    manager.show('w');
    expect(entity.object3D?.visible).toBe(true);
    expect(entity.hasComponent(RayInteractable)).toBe(true);
    expect(entity.hasComponent(PokeInteractable)).toBe(false);
  });

  it('a window opened hidden is applied hidden on adoption', () => {
    const world = makeWorld();
    const manager = windowManagerFor(world);
    manager.open('w', { hidden: true });
    const { entity } = spawn(world, { id: 'w' });
    expect(entity.object3D?.visible).toBe(false);
    expect(entity.hasComponent(RayInteractable)).toBe(false);
  });

  it('hidden windows keep their place in the focus bias loop without being nudged', () => {
    const world = makeWorld();
    const manager = windowManagerFor(world);
    const { document } = spawn(world, { id: 'a' });
    spawn(world, { id: 'b' });
    manager.hide('a');
    world.update(1 / 60, 0);
    expect(document.position.lengthSq()).toBe(0);
  });
});

describe('regions through the manager and back', () => {
  function withRegion(world: World, id: string, capacity = 0) {
    return createDockRegion(world, { id, capacity, position: [2, 1, -1] });
  }

  it('dockTo adds UIDockedTo and the registry places it; undock removes it', () => {
    const world = makeWorld();
    const manager = windowManagerFor(world);
    withRegion(world, 'rail');
    const { entity } = spawn(world, { id: 'w', dockMode: DockMode.BodyFollow });

    manager.dockTo('w', 'rail');
    expect(entity.hasComponent(UIDockedTo)).toBe(true);
    expect(entity.getValue(UIDockedTo, 'regionId')).toBe('rail');
    expect(regionRegistryFor(world).regionOf('w')).toBe('rail');
    expect(manager.get('w')?.region).toBe('rail');
    // Docked windows are world-locked; the record follows the ECS.
    expect(entity.getValue(UIWindow, 'dockMode')).toBe(DockMode.WorldLocked);
    world.update(1 / 60, 0);
    expect(manager.get('w')?.dockMode).toBe(DockMode.WorldLocked);

    manager.undock('w');
    expect(entity.hasComponent(UIDockedTo)).toBe(false);
    expect(regionRegistryFor(world).regionOf('w')).toBeUndefined();
    expect(manager.get('w')?.region).toBeUndefined();
  });

  it('a dock the ECS rejects (unknown or full region) is not claimed by the record', () => {
    const world = makeWorld();
    const manager = windowManagerFor(world);
    withRegion(world, 'one', 1);
    spawn(world, { id: 'first', region: 'one' });
    const { entity } = spawn(world, { id: 'w' });

    manager.dockTo('w', 'nowhere');
    expect(entity.hasComponent(UIDockedTo)).toBe(false);
    expect(manager.get('w')?.region).toBeUndefined();

    manager.dockTo('w', 'one'); // full
    expect(entity.hasComponent(UIDockedTo)).toBe(false);
    expect(manager.get('w')?.region).toBeUndefined();
    expect(manager.get('first')?.region).toBe('one');
  });

  it('a dock made by the ECS (drag-drop, spawn) is written into the record', () => {
    const world = makeWorld();
    const manager = windowManagerFor(world);
    withRegion(world, 'rail');
    const born = spawn(world, { id: 'born', region: 'rail' });
    expect(manager.get('born')?.region).toBe('rail');

    const { entity } = spawn(world, { id: 'w' });
    entity.addComponent(UIDockedTo, { regionId: 'rail' }); // what a drop does
    expect(manager.get('w')?.region).toBe('rail');
    entity.removeComponent(UIDockedTo); // what a drag start does
    expect(manager.get('w')?.region).toBeUndefined();
    expect(born.entity.hasComponent(UIDockedTo)).toBe(true);
  });

  it('returnHome goes back to the spawn region, or to the spawn placement', () => {
    const world = makeWorld();
    const manager = windowManagerFor(world);
    withRegion(world, 'rail');
    const born = spawn(world, { id: 'born', region: 'rail' });
    const free = spawn(world, { id: 'free', position: [0, 1.5, -1] });

    manager.undock('born');
    expect(born.entity.hasComponent(UIDockedTo)).toBe(false);
    manager.returnHome('born');
    expect(born.entity.getValue(UIDockedTo, 'regionId')).toBe('rail');
    expect(manager.get('born')?.region).toBe('rail');
    manager.returnHome('born'); // already home: nothing to do
    expect(manager.get('born')?.region).toBe('rail');

    manager.dockTo('free', 'rail');
    free.entity.object3D?.position.set(4, 4, 4);
    manager.returnHome('free');
    expect(free.entity.hasComponent(UIDockedTo)).toBe(false);
    expect(manager.get('free')?.region).toBeUndefined();
    expect(free.entity.object3D?.position.toArray()).toEqual([0, 1.5, -1]);

    // The DOCK button is the same call.
    manager.setChrome('free', { dock: true });
    manager.dockTo('free', 'rail');
    free.document.element(WINDOW_CHROME_IDS.dock).fire('click');
    expect(manager.get('free')?.region).toBeUndefined();
  });
});

describe('UIDragSystem near grab', () => {
  it('registers without XR input, and offers title bars to the grab pointer list', () => {
    const world = makeWorld();
    const { document } = spawn(world, { id: 'w' });
    const scene = world.scene as unknown as { grabDescendants?: unknown[] };
    // Without lists (no InputSystem this frame) nothing is touched.
    world.update(1 / 60, 0);
    expect(scene.grabDescendants).toBeUndefined();
    // With IWSDK's per-frame lists present, the title bar is appended once.
    scene.grabDescendants = [];
    world.update(1 / 60, 0);
    world.update(1 / 60, 0);
    expect(scene.grabDescendants).toEqual([document.element(WINDOW_CHROME_IDS.titlebar)]);
  });

  it('leaves hidden windows out of the grab list', () => {
    const world = makeWorld();
    spawn(world, { id: 'w' });
    windowManagerFor(world).hide('w');
    const scene = world.scene as unknown as { grabDescendants?: unknown[] };
    scene.grabDescendants = [];
    world.update(1 / 60, 0);
    expect(scene.grabDescendants).toEqual([]);
  });

  it('can be registered with near drag off', () => {
    const world = new World();
    world.camera = new PerspectiveCamera();
    world.scene = new Scene();
    world.registerSystem(UIDragSystem, { configData: { nearDrag: false } });
    const scene = world.scene as unknown as { grabDescendants?: unknown[] };
    scene.grabDescendants = [];
    world.update(1 / 60, 0);
    expect(scene.grabDescendants).toEqual([]);
  });
});
