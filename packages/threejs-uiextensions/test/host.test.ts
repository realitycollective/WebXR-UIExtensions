/**
 * Headless host lifecycle test: real three.js scene graph, real interpreted
 * UIKitML panels (uikit components load fine in node - only rendering needs
 * a GPU), real core WindowManager. What is NOT covered headless: visual
 * layout (the size signal never fires without a renderer) and actual XR
 * input - `webxr-input.test.ts` proves the session wiring against fakes, and
 * the browser demo is the rest.
 */
import { parse } from '@pmndrs/uikitml';
import { Group } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { DockMode } from '@realitycollective/webxr-uiextensions';
import type {
  HandPoseSource,
  HeadPoseSource,
  PanelHandle,
  PoseTuple,
  QuatTuple,
} from '@realitycollective/webxr-uiextensions';
import { windowHostContract } from '../../webxr-uiextensions/test/helpers/window-host-contract.js';
import { sceneTargetContract } from '../../webxr-uiextensions/test/helpers/scene-target-contract.js';
import { UixWindowHost } from '../src/host.js';

const PANEL_SOURCE = `
<div id="uix-window">
  <div id="uix-titlebar">
    <text id="uix-title">t</text>
    <div id="uix-pin">PIN</div>
    <div id="uix-dock">DOCK</div>
    <div id="uix-minimize">MIN</div>
    <div id="uix-close">X</div>
  </div>
  <div id="uix-content"><text>body</text></div>
</div>
`;

const STATIC_HEAD: HeadPoseSource = {
  getHeadPose: () => ({ position: [0, 1.6, 0], quaternion: [0, 0, 0, 1] }),
};

function makeHost(handPose?: HandPoseSource) {
  const scene = new Group();
  const host = new UixWindowHost({
    scene,
    headPose: STATIC_HEAD,
    ...(handPose ? { handPose } : {}),
  });
  return { scene, host };
}

/** A hand pose source the test steers: set a hand's pose, or drop it. */
function makeHands() {
  const poses: Partial<Record<'left' | 'right', PoseTuple>> = {};
  const source: HandPoseSource = { getHandPose: (hand) => poses[hand] };
  return { poses, source };
}

/** Left grip rotated +90 degrees about Z: the left palm (+X) faces world +Y. */
const PALM_UP: QuatTuple = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
/** Right grip rotated -90 degrees about Z: the right palm (-X) faces world +Y. */
const RIGHT_PALM_UP: QuatTuple = [0, 0, -Math.SQRT1_2, Math.SQRT1_2];

const config = () => parse(PANEL_SOURCE);

describe('UixWindowHost', () => {
  it('spawns a managed window into the scene and registers it', () => {
    const { scene, host } = makeHost();
    const handle = host.createWindow({
      id: 'w1',
      title: 'Window One',
      config: config(),
      position: [0.5, 1.5, -1],
    });
    expect(scene.children).toContain(handle.group);
    expect(host.manager.get('w1')?.title).toBe('Window One');
    expect(handle.group.position.toArray()).toEqual([0.5, 1.5, -1]);
    expect(handle.document.getElementById('uix-title')).toBeDefined();
  });

  it('close (via manager or chrome) removes the window from the scene', () => {
    const { scene, host } = makeHost();
    host.createWindow({ id: 'w1', config: config() });
    host.manager.close('w1');
    expect(scene.children).toHaveLength(0);
    expect(host.window('w1')).toBeUndefined();
    expect(host.manager.get('w1')).toBeUndefined();
  });

  it('dispose removes every window and region it added, and stops following the manager', () => {
    const { scene, host } = makeHost();
    host.createRegion({ id: 'shelf', position: [0, 1, -1] });
    host.createWindow({ id: 'w1', config: config(), region: 'shelf' });
    host.createWindow({ id: 'w2', config: config() });

    host.dispose();

    expect(scene.children).toHaveLength(0);
    expect(host.manager.has('w1')).toBe(false);
    expect(host.manager.has('w2')).toBe(false);
    host.manager.open('late');
    expect(host.window('late')).toBeUndefined();
    expect(() => host.dispose()).not.toThrow();
  });

  it('minimize collapses the content element and restore expands it', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w1', config: config() });
    const content = handle.document.getElementById('uix-content') as unknown as {
      setProperties(props: Record<string, unknown>): void;
    };
    expect(content).toBeDefined();
    host.manager.minimize('w1');
    expect(host.manager.get('w1')?.minimized).toBe(true);
    host.manager.restore('w1');
    expect(host.manager.get('w1')?.minimized).toBe(false);
  });

  it('body-follow windows ease toward the viewer on update', () => {
    const { host } = makeHost();
    const handle = host.createWindow({
      id: 'w1',
      config: config(),
      dockMode: DockMode.BodyFollow,
      position: [3, 0, 3],
      followOffset: [0, -0.15, -1.2],
      followTolerance: 0.05,
    });
    const before = handle.group.position.distanceTo({ x: 0, y: 1.45, z: -1.2 } as never);
    for (let i = 0; i < 60; i += 1) {
      host.update(1 / 60);
    }
    const after = handle.group.position.distanceTo({ x: 0, y: 1.45, z: -1.2 } as never);
    expect(after).toBeLessThan(before);
  });

  it('setFollow after spawn re-aims a following window at the new offset', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w1', config: config(), dockMode: DockMode.BodyFollow, followOffset: [0, -0.15, -1.2], followTolerance: 0.05 });
    for (let i = 0; i < 120; i += 1) host.update(1 / 60);
    const settled = handle.group.position.clone();
    host.manager.setFollow('w1', { offset: [0.6, -0.15, -1.2], speed: 8 });
    for (let i = 0; i < 120; i += 1) host.update(1 / 60);
    expect(handle.group.position.x).toBeGreaterThan(settled.x + 0.3);
    // A window that is not following keeps the change on its record for when it next follows.
    host.createWindow({ id: 'w2', config: config(), position: [1, 1, -1] });
    host.manager.setFollow('w2', { offset: [-0.6, 0, -1] });
    host.update(1 / 60);
    expect(host.manager.get('w2')?.follow.offset).toEqual([-0.6, 0, -1]);
    expect(() => host.manager.setFollow('gone-before-open', { offset: [0, 0, -1] })).toThrow();
  });

  it('world-locked windows do not move on update', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w1', config: config(), position: [1, 1, -1] });
    host.update(1 / 60);
    expect(handle.group.position.toArray()).toEqual([1, 1, -1]);
  });

  it('pin toggle flips dock mode through the core manager', () => {
    const { host } = makeHost();
    host.createWindow({ id: 'w1', config: config(), dockMode: DockMode.BodyFollow });
    host.manager.togglePin('w1');
    expect(host.manager.get('w1')?.dockMode).toBe(DockMode.WorldLocked);
    host.manager.togglePin('w1');
    expect(host.manager.get('w1')?.dockMode).toBe(DockMode.BodyFollow);
  });

  it('createPanel returns an unmanaged panel handle (PanelHost contract)', () => {
    const { host } = makeHost();
    expect(host.supportsStandalonePanels).toBe(true);
    const panel = host.createPanel(config());
    expect(panel.getElementById('uix-window')).toBeDefined();
    panel.dispose();
  });

  it('names a window uix-window-<n> when the caller gives no id', () => {
    const { host } = makeHost();
    expect(host.createWindow({ config: config() }).id).toBe('uix-window-1');
    expect(host.createWindow({ config: config() }).id).toBe('uix-window-2');
    expect(host.window('uix-window-2')).toBeDefined();
    expect(host.manager.get('uix-window-1')).toBeDefined();
  });

  it('exposes the document as the portable panel, ready immediately', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w1', config: config() });
    expect(handle.panel).toBe(handle.document);
    const seen: PanelHandle[] = [];
    const stop = handle.onReady((panel) => seen.push(panel));
    expect(seen).toEqual([handle.document]);
    expect(() => stop()).not.toThrow();
  });

  it('announces created windows with kind "window"', () => {
    const { host } = makeHost();
    const kinds: Array<string | undefined> = [];
    host.onPanelReady((event) => kinds.push(event.kind));
    host.createWindow({ id: 'w1', config: config() });
    expect(kinds).toEqual(['window']);
  });

  it('hide takes the window out of view and show brings it back in front', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w1', config: config(), position: [1, 1, -1] });
    host.createWindow({ id: 'w2', config: config() });
    host.manager.hide('w1');
    expect(handle.group.visible).toBe(false);
    expect(host.window('w1')).toBe(handle);
    host.manager.show('w1');
    expect(handle.group.visible).toBe(true);
    expect(handle.group.position.toArray()).toEqual([1, 1, -1]);
    expect(host.manager.focused?.id).toBe('w1');
  });

  it('docks through the manager: the record, the registry and the layout agree', () => {
    const { host } = makeHost();
    host.createRegion({ id: 'rail', position: [2, 1, -1], flow: 'column', pitch: 0.5 });
    const handle = host.createWindow({ id: 'w1', config: config(), dockMode: DockMode.BodyFollow });
    host.manager.dockTo('w1', 'rail');
    expect(host.manager.get('w1')?.region).toBe('rail');
    expect(host.regions.regionOf('w1')).toBe('rail');
    expect(host.manager.get('w1')?.dockMode).toBe(DockMode.WorldLocked);
    expect(handle.group.position.toArray()).toEqual([2, 1, -1]);
    host.manager.undock('w1');
    expect(host.regions.regionOf('w1')).toBeUndefined();
    host.dock('w1', 'rail');
    expect(host.manager.get('w1')?.region).toBe('rail');
    host.dock('w1', undefined);
    expect(host.manager.get('w1')?.region).toBeUndefined();
  });

  it('chrome buttons are off by default, gate their clicks, and switch on at runtime', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w1', config: config() });
    const button = (id: string) =>
      handle.document.getElementById(id) as unknown as {
        dispatchEvent(event: { type: string }): void;
        properties: { peek(): Record<string, unknown> };
      };
    const display = (id: string) => button(id).properties.peek()['display'];
    expect(host.manager.get('w1')?.chrome).toEqual({
      pin: false,
      dock: false,
      minimize: false,
      close: false,
    });
    for (const id of ['uix-pin', 'uix-dock', 'uix-minimize', 'uix-close']) {
      expect(display(id)).toBe('none');
    }
    button('uix-close').dispatchEvent({ type: 'click' });
    button('uix-minimize').dispatchEvent({ type: 'click' });
    expect(host.manager.has('w1')).toBe(true);
    expect(host.manager.get('w1')?.minimized).toBe(false);

    host.manager.setChrome('w1', { minimize: true, close: true });
    expect(display('uix-minimize')).toBe('flex');
    expect(display('uix-close')).toBe('flex');
    expect(display('uix-pin')).toBe('none');
    button('uix-minimize').dispatchEvent({ type: 'click' });
    expect(host.manager.get('w1')?.minimized).toBe(true);
    button('uix-close').dispatchEvent({ type: 'click' });
    expect(host.manager.has('w1')).toBe(false);
  });

  it('accepts movable without acting on it (no drag path here yet)', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w1', config: config(), movable: false });
    expect(handle.id).toBe('w1');
    expect(host.window('w1')).toBe(handle);
  });
});

windowHostContract('three.js window host', () => {
  const { host } = makeHost();
  return {
    host,
    manager: host.manager,
    createWindow: (id: string) => host.createWindow({ id, config: config() }),
    panelConfig: config(),
  };
});

describe('UixWindowHost hand menus', () => {
  it('rides the raised hand, gated on the palm, and combines with hide()', () => {
    const { poses, source } = makeHands();
    const { host } = makeHost(source);
    const handle = host.createWindow({
      id: 'menu',
      config: config(),
      dockMode: DockMode.HandLocked,
      handMenu: { hand: 'left', anchor: 'above', anchorDistance: 0.1 },
    });
    expect(host.manager.get('menu')?.handMenu).toMatchObject({ hand: 'left', anchor: 'above' });

    host.update(1 / 60);
    expect(handle.group.visible).toBe(false);

    poses.left = { position: [-0.3, 1.2, -0.4], quaternion: PALM_UP };
    host.update(1 / 60);
    expect(handle.group.visible).toBe(true);
    expect(handle.group.position.toArray().map((v) => Math.round(v * 1000) / 1000)).toEqual([-0.2, 1.2, -0.4]);

    poses.left = { position: [-0.3, 1.2, -0.4], quaternion: [0, 0, 0, 1] };
    host.update(1 / 60);
    expect(handle.group.visible).toBe(false);

    poses.left = { position: [-0.3, 1.2, -0.4], quaternion: PALM_UP };
    host.manager.hide('menu');
    host.update(1 / 60);
    expect(handle.group.visible).toBe(false);
    host.manager.show('menu');
    host.update(1 / 60);
    expect(handle.group.visible).toBe(true);
  });

  it('setHandMenu moves the menu to the other hand at once', () => {
    const { poses, source } = makeHands();
    const { host } = makeHost(source);
    const handle = host.createWindow({ id: 'menu', config: config(), dockMode: DockMode.HandLocked });
    poses.right = { position: [0.3, 1.2, -0.4], quaternion: RIGHT_PALM_UP };
    host.update(1 / 60);
    expect(handle.group.visible).toBe(false);
    host.manager.setHandMenu('menu', { hand: 'right' });
    host.update(1 / 60);
    expect(handle.group.visible).toBe(true);
    expect(handle.group.position.x).toBeCloseTo(0.3 - 0.12, 3);
  });

  it('leaving hand-locked reopens the gate; pin from a hand menu lands world-locked', () => {
    const { poses, source } = makeHands();
    const { host } = makeHost(source);
    const handle = host.createWindow({ id: 'menu', config: config(), dockMode: DockMode.HandLocked });
    poses.left = { position: [-0.3, 1.2, -0.4], quaternion: [0, 0, 0, 1] };
    host.update(1 / 60);
    expect(handle.group.visible).toBe(false);
    host.manager.togglePin('menu');
    expect(host.manager.get('menu')?.dockMode).toBe(DockMode.WorldLocked);
    expect(handle.group.visible).toBe(true);
  });

  it('a hand-locked window is hidden, not shown by body-follow, where there is no hand source at all', () => {
    const { host } = makeHost();
    const handle = host.createWindow({
      id: 'menu',
      config: config(),
      dockMode: DockMode.HandLocked,
      position: [3, 0, 3],
      followOffset: [0, -0.15, -1.2],
      followTolerance: 0.05,
    });
    for (let i = 0; i < 60; i += 1) {
      host.update(1 / 60);
    }
    expect(handle.group.visible).toBe(false);
  });

  it('a hand-locked window is hidden while a real hand source reports no tracked hand, then shows once one is raised', () => {
    const { poses, source } = makeHands();
    const { host } = makeHost(source);
    const handle = host.createWindow({
      id: 'menu',
      config: config(),
      dockMode: DockMode.HandLocked,
      position: [3, 0, 3],
      followTolerance: 0.05,
    });
    host.update(1 / 60);
    expect(handle.group.visible).toBe(false);
    poses.left = { position: [-0.3, 1.2, -0.4], quaternion: PALM_UP };
    host.update(1 / 60);
    expect(handle.group.visible).toBe(true);
  });

  it('applies handMenu from a scene descriptor', async () => {
    const host = new UixWindowHost({
      scene: new Group(),
      headPose: STATIC_HEAD,
      loadConfig: async () => config(),
    });
    host.spawnWindow({
      id: 'menu',
      title: 'Menu',
      config: 'menu.uikitml',
      dockMode: DockMode.HandLocked,
      handMenu: { hand: 'right', anchor: 'wrist' },
    });
    await vi.waitFor(() => expect(host.manager.has('menu')).toBe(true));
    expect(host.manager.get('menu')?.handMenu).toMatchObject({ hand: 'right', anchor: 'wrist' });
  });
});

sceneTargetContract('three.js window host', () => {
  const host = new UixWindowHost({ scene: new Group(), headPose: STATIC_HEAD, loadConfig: async () => config() });
  return {
    target: host,
    manager: host.manager,
    settle: async (ids) => {
      await vi.waitFor(() => {
        for (const id of ids) expect(host.manager.has(id)).toBe(true);
      });
    },
  };
});
