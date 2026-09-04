/**
 * Scene-host behaviour against a REAL IWSDK world.
 *
 * `new World()` from `@iwsdk/core` constructs headlessly, so the readiness
 * system, its ECS query and the `qualify` subscription all run for real here.
 * The only stand-in is the `UIKitDocument`: building one needs a renderer, and
 * the host treats it as an opaque handle anyway.
 */
import {
  Follower,
  PanelDocument,
  PanelUI,
  PerspectiveCamera,
  PokeInteractable,
  RayInteractable,
  World,
  type Entity,
} from '@iwsdk/core';
import {
  DockMode,
  applyScene,
  type PanelReadyEvent,
  type SceneDescriptor,
  type UixElement,
} from '@realitycollective/webxr-uiextensions';
import { describe, expect, it, vi } from 'vitest';
import { windowHostContract } from '../../webxr-uiextensions/test/helpers/window-host-contract.js';
import {
  RegionFlowType,
  UIDockRegion,
  UIDockedTo,
  UIWindow,
} from '../src/components.js';
import { createUIWindow } from '../src/factory.js';
import {
  createSceneHost,
  getPanelHandle,
  type IwsdkWindowHandle,
} from '../src/scene-host.js';

function makeWorld(): World {
  const world = new World();
  for (const component of [
    PanelUI,
    PanelDocument,
    RayInteractable,
    PokeInteractable,
    Follower,
    UIWindow,
    UIDockRegion,
    UIDockedTo,
  ]) {
    world.registerComponent(component);
  }
  world.camera = new PerspectiveCamera();
  return world;
}

function makeElement(): UixElement {
  return {
    userData: {},
    children: [],
    addEventListener: () => {},
    setProperties: () => {},
  };
}

interface FakeDocument {
  rootElement: UixElement;
  title: UixElement;
  sized: Array<[number, number]>;
  getElementById(id: string): UixElement | null;
  setTargetDimensions(width: number, height: number): void;
}

/** Stands in for a `UIKitDocument` - the host only ever proxies it. */
function makeDocument(): FakeDocument {
  const title = makeElement();
  const sized: Array<[number, number]> = [];
  return {
    rootElement: makeElement(),
    title,
    sized,
    getElementById: (id) => (id === 'uix-title' ? title : null),
    setTargetDimensions: (width, height) => {
      sized.push([width, height]);
    },
  };
}

/** Entities carrying a component, straight off the ECS query manager. */
type AnyComponent = Parameters<World['registerComponent']>[0];

function entitiesWith(world: World, component: AnyComponent): Entity[] {
  return [...world.queryManager.registerQuery({ required: [component] }).entities];
}

/** What IWSDK's UI system does once the markup has loaded. */
function attachDocument(entity: Entity, document: unknown): void {
  entity.addComponent(PanelDocument, { document });
}

const FULL_SCENE: SceneDescriptor = {
  name: 'full',
  regions: [
    {
      id: 'rail',
      flow: 'grid',
      pitch: 0.4,
      columns: 3,
      capacity: 4,
      snapRadius: 0.7,
      position: [0.5, 1.2, -1.5],
      follow: true,
      followOffset: [0, -0.3, -1.6],
    },
  ],
  windows: [
    {
      id: 'log',
      title: 'Event log',
      config: '/ui/log.uikitml',
      position: [1, 1.4, -2],
      maxWidth: 0.8,
      maxHeight: 0.6,
      dockMode: DockMode.BodyFollow,
      region: 'rail',
      followOffset: [0.1, -0.2, -1],
      followSpeed: 5,
      followTolerance: 0.1,
      movable: false,
      closable: false,
      minimizable: false,
      pinnable: false,
    },
  ],
};

const MINIMAL_SCENE: SceneDescriptor = {
  regions: [{ id: 'rail' }],
  windows: [{ id: 'clicker', title: 'Clicker', config: '/ui/clicker.uikitml' }],
};

describe('createSceneHost readiness', () => {
  it('announces a managed window under its id, as a window', () => {
    const world = makeWorld();
    const host = createSceneHost(world);
    const events: PanelReadyEvent[] = [];
    host.onPanelReady((event) => events.push(event));

    const entity = createUIWindow(world, {
      config: '/ui/clicker.uikitml',
      id: 'clicker',
    });
    attachDocument(entity, makeDocument());

    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe('clicker');
    expect(events[0]?.kind).toBe('window');
    expect(events[0]?.panel.getElementById('uix-title')).toBeDefined();
  });

  it('announces a bare panel under its config path, as a panel', () => {
    const world = makeWorld();
    const host = createSceneHost(world);
    const events: PanelReadyEvent[] = [];
    host.onPanelReady((event) => events.push(event));

    const entity = world
      .createTransformEntity()
      .addComponent(PanelUI, { config: '/ui/hud.uikitml' });
    attachDocument(entity, makeDocument());

    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe('/ui/hud.uikitml');
    expect(events[0]?.kind).toBe('panel');
  });

  it('treats a window entity with no windowId as a bare panel', () => {
    const world = makeWorld();
    const host = createSceneHost(world);
    const events: PanelReadyEvent[] = [];
    host.onPanelReady((event) => events.push(event));

    // createUIWindow leaves windowId empty when no id is asked for.
    const entity = createUIWindow(world, { config: '/ui/anon.uikitml' });
    attachDocument(entity, makeDocument());

    expect(events[0]?.id).toBe('/ui/anon.uikitml');
    expect(events[0]?.kind).toBe('panel');
  });

  it('picks up panels that were already live when the host was made', () => {
    const world = makeWorld();
    const entity = createUIWindow(world, { config: '/ui/a.uikitml', id: 'a' });
    attachDocument(entity, makeDocument());

    // The host arrives second, so its query replays rather than qualifies.
    const host = createSceneHost(world);
    const ids: string[] = [];
    host.onPanelReady((event) => ids.push(event.id));
    expect(ids).toEqual(['a']);
  });

  it('replays live panels to a subscriber that arrives late', () => {
    const world = makeWorld();
    const host = createSceneHost(world);
    const entity = createUIWindow(world, { config: '/ui/a.uikitml', id: 'a' });
    attachDocument(entity, makeDocument());

    const ids: string[] = [];
    const stop = host.onPanelReady((event) => ids.push(event.id));
    expect(ids).toEqual(['a']);
    stop();

    const second = createUIWindow(world, { config: '/ui/b.uikitml', id: 'b' });
    attachDocument(second, makeDocument());
    expect(ids).toEqual(['a']);
  });

  it('ignores an entity whose document has not landed yet', () => {
    const world = makeWorld();
    const host = createSceneHost(world);
    const events: PanelReadyEvent[] = [];
    host.onPanelReady((event) => events.push(event));

    const entity = createUIWindow(world, { config: '/ui/a.uikitml', id: 'a' });
    entity.addComponent(PanelDocument, {});

    expect(events).toHaveLength(0);
  });

  it('announces each document once, however often its entity requalifies', () => {
    const world = makeWorld();
    const host = createSceneHost(world);
    const events: PanelReadyEvent[] = [];
    host.onPanelReady((event) => events.push(event));

    const entity = createUIWindow(world, { config: '/ui/a.uikitml', id: 'a' });
    attachDocument(entity, makeDocument());
    // Drop out of the query and back in: same document, no second announce.
    entity.removeComponent(PanelUI);
    entity.addComponent(PanelUI, { config: '/ui/a.uikitml' });

    expect(events).toHaveLength(1);
  });

  it('logs a listener that throws and keeps announcing to the rest', () => {
    const world = makeWorld();
    const host = createSceneHost(world);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: string[] = [];
    host.onPanelReady(() => {
      throw new Error('listener blew up');
    });
    host.onPanelReady((event) => seen.push(event.id));

    const entity = createUIWindow(world, { config: '/ui/a.uikitml', id: 'a' });
    attachDocument(entity, makeDocument());

    expect(seen).toEqual(['a']);
    expect(error).toHaveBeenCalledWith(
      '[uix] panel-ready listener failed for "a":',
      expect.any(Error),
    );
    error.mockRestore();
  });
});

describe('createSceneHost panel access', () => {
  it('refuses to make a bare panel', () => {
    const host = createSceneHost(makeWorld());
    expect(host.supportsStandalonePanels).toBe(false);
    expect(() => host.createPanel({})).toThrow(/not supported on the IWSDK host/);
  });

  it('getPanelHandle proxies the document once it is attached', () => {
    const world = makeWorld();
    createSceneHost(world);
    const entity = createUIWindow(world, { config: '/ui/a.uikitml', id: 'a' });
    expect(getPanelHandle(entity)).toBeUndefined();

    const document = makeDocument();
    attachDocument(entity, document);

    const panel = getPanelHandle(entity);
    expect(panel?.root).toBe(document.rootElement);
    expect(panel?.getElementById('uix-title')).toBe(document.title);
    expect(panel?.getElementById('missing')).toBeUndefined();
    panel?.setTargetDimensions(0.8, 0.6);
    expect(document.sized).toEqual([[0.8, 0.6]]);
    // Disposal is IWSDK's job through the entity, so this is a no-op.
    expect(() => panel?.dispose()).not.toThrow();
  });
});

describe('createSceneHost createWindow', () => {
  it('resolves panel and onReady when the document attaches', () => {
    const world = makeWorld();
    const host = createSceneHost(world);
    const handle = host.createWindow({ config: '/ui/a.uikitml', id: 'a' });

    expect(handle.id).toBe('a');
    expect(handle.panel).toBeUndefined();
    expect(UIWindow.data.windowId[handle.entity.index]).toBe('a');

    const seen: unknown[] = [];
    handle.onReady((panel) => seen.push(panel));
    expect(seen).toHaveLength(0);

    // Another window announcing first must not resolve this handle.
    const other = host.createWindow({ config: '/ui/b.uikitml', id: 'b' });
    attachDocument(other.entity, makeDocument());
    expect(seen).toHaveLength(0);

    attachDocument(handle.entity, makeDocument());
    expect(seen).toHaveLength(1);
    expect(handle.panel).toBe(seen[0]);
  });

  it('generates an id for a window that was not given one', () => {
    const host = createSceneHost(makeWorld());
    expect(host.createWindow({ config: '/ui/a.uikitml' }).id).toBe('uix-window-1');
    expect(host.createWindow({ config: '/ui/b.uikitml' }).id).toBe('uix-window-2');
  });

  it('can be unsubscribed before the panel arrives', () => {
    const world = makeWorld();
    const host = createSceneHost(world);
    const handle = host.createWindow({ config: '/ui/a.uikitml', id: 'a' });
    const seen: unknown[] = [];
    const stop = handle.onReady((panel) => seen.push(panel));
    stop();
    attachDocument(handle.entity, makeDocument());
    expect(seen).toHaveLength(0);
  });
});

describe('createSceneHost as a SceneTarget', () => {
  it('applies every field of a full descriptor', () => {
    const world = makeWorld();
    const host = createSceneHost(world);
    applyScene(host, FULL_SCENE);

    const region = entitiesWith(world, UIDockRegion)[0];
    const window = entitiesWith(world, UIWindow)[0];
    expect(region).toBeDefined();
    expect(window).toBeDefined();
    if (!region || !window) {
      return;
    }

    expect(UIDockRegion.data.regionId[region.index]).toBe('rail');
    expect(UIDockRegion.data.flow[region.index]).toBe(RegionFlowType.Grid);
    expect(UIDockRegion.data.columns[region.index]).toBe(3);
    expect(region.hasComponent(Follower)).toBe(true);
    expect(region.object3D?.position.toArray()).toEqual([0.5, 1.2, -1.5]);

    expect(UIWindow.data.windowId[window.index]).toBe('log');
    expect(UIWindow.data.title[window.index]).toBe('Event log');
    expect(UIWindow.data.dockMode[window.index]).toBe(DockMode.BodyFollow);
    expect(UIWindow.data.followSpeed[window.index]).toBe(5);
    expect(UIDockedTo.data.regionId[window.index]).toBe('rail');
    expect(window.object3D?.position.toArray()).toEqual([1, 1.4, -2]);
  });

  it('applies a descriptor that sets nothing optional', () => {
    const world = makeWorld();
    const host = createSceneHost(world);
    applyScene(host, MINIMAL_SCENE);

    const region = entitiesWith(world, UIDockRegion)[0];
    const window = entitiesWith(world, UIWindow)[0];
    expect(UIDockRegion.data.regionId[region?.index ?? -1]).toBe('rail');
    expect(UIDockRegion.data.flow[region?.index ?? -1]).toBe(RegionFlowType.Column);
    expect(region?.hasComponent(Follower)).toBe(false);
    expect(UIWindow.data.windowId[window?.index ?? -1]).toBe('clicker');
    expect(UIWindow.data.dockMode[window?.index ?? -1]).toBe(DockMode.WorldLocked);
    expect(window?.hasComponent(UIDockedTo)).toBe(false);
  });
});

windowHostContract('IWSDK scene host', () => {
  const world = makeWorld();
  const host = createSceneHost(world);
  const handles = new Map<string, IwsdkWindowHandle>();
  return {
    host,
    createWindow(id: string) {
      const handle = host.createWindow({ id, config: `/ui/${id}.uikitml` });
      handles.set(id, handle);
      return handle;
    },
    attach(id: string) {
      const handle = handles.get(id);
      if (handle) {
        attachDocument(handle.entity, makeDocument());
      }
    },
  };
});
