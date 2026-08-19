/**
 * Headless host lifecycle test: real three.js scene graph, real interpreted
 * UIKitML panels (uikit components load fine in node — only rendering needs
 * a GPU), real core WindowManager. What is NOT covered headless: visual
 * layout (the size signal never fires without a renderer) and actual XR
 * input — those need the browser demo.
 */
import { parse } from '@pmndrs/uikitml';
import { Group } from 'three';
import { describe, expect, it } from 'vitest';
import { DockMode } from '@realitycollective/webxr-uiextensions';
import type { HeadPoseSource } from '@realitycollective/webxr-uiextensions';
import { UixWindowHost } from '../src/host.js';

const PANEL_SOURCE = `
<div id="uix-window">
  <div id="uix-titlebar">
    <text id="uix-title">t</text>
    <div id="uix-pin">PIN</div>
    <div id="uix-minimize">MIN</div>
    <div id="uix-close">X</div>
  </div>
  <div id="uix-content"><text>body</text></div>
</div>
`;

const STATIC_HEAD: HeadPoseSource = {
  getHeadPose: () => ({ position: [0, 1.6, 0], quaternion: [0, 0, 0, 1] }),
};

function makeHost() {
  const scene = new Group();
  const host = new UixWindowHost({ scene, headPose: STATIC_HEAD });
  return { scene, host };
}

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
    // Chrome discovered through userData ids:
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
      position: [3, 0, 3], // far outside tolerance
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

  it('world-locked windows do not move on update', () => {
    const { host } = makeHost();
    const handle = host.createWindow({
      id: 'w1',
      config: config(),
      position: [1, 1, -1],
    });
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
    const panel = host.createPanel(config());
    expect(panel.getElementById('uix-window')).toBeDefined();
    panel.dispose();
  });
});
