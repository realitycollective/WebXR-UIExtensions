/**
 * NativeWindowHost: the shared WindowHost conformance suite, plus what is
 * specific to the native binding - proxy element wiring, event dispatch and
 * mirroring WindowManager state to the host.
 */
import { DockMode, applyScene, type SceneDescriptor } from '@realitycollective/webxr-uiextensions';
import { describe, expect, it, vi } from 'vitest';
import { windowHostContract } from '../../webxr-uiextensions/test/helpers/window-host-contract.js';
import { sceneTargetContract } from '../../webxr-uiextensions/test/helpers/scene-target-contract.js';
import { NativeUixElement } from '../src/element.js';
import { NativeWindowHost } from '../src/host.js';
import {
  createFakeNativeUiHost,
  type FakeElementSpec,
} from './helpers/fake-native-ui-host.js';

const PANEL_TREE: FakeElementSpec = {
  id: 'uix-window',
  children: [
    { id: 'uix-title' },
    {
      id: 'uix-content',
      children: [
        { id: 'uix-button', componentName: 'uix-toggle' },
        // No markup id - must not be reachable through getElementById.
        { children: [] },
      ],
    },
  ],
};

function makeSetup() {
  const fake = createFakeNativeUiHost();
  const host = new NativeWindowHost({ host: fake });
  return {
    fake,
    host,
    manager: host.manager,
    createWindow(id: string) {
      return host.createWindow({ id, config: PANEL_TREE });
    },
    attach(id: string) {
      fake.readyWindow(id, `panel-${id}`, PANEL_TREE);
    },
    panelConfig: PANEL_TREE,
  };
}

windowHostContract('NativeWindowHost', makeSetup);

describe('NativeWindowHost', () => {
  it('throws naming the "ui" slice when neither an injected host nor globalThis.__rcHost.ui is available', () => {
    expect(() => new NativeWindowHost()).toThrow(/__rcHost\.ui/);
  });

  it('reads an installed globalThis.__rcHost.ui when no host is injected', () => {
    const fake = createFakeNativeUiHost();
    (globalThis as { __rcHost?: unknown }).__rcHost = { ui: fake };
    try {
      const host = new NativeWindowHost();
      expect(host).toBeInstanceOf(NativeWindowHost);
    } finally {
      delete (globalThis as { __rcHost?: unknown }).__rcHost;
    }
  });

  it('a panel-ready listener that throws is caught and logged, without blocking the other listeners', () => {
    const { fake, host } = makeSetup();
    host.createWindow({ id: 'w1', config: PANEL_TREE });
    const seen: string[] = [];
    host.onPanelReady(() => {
      throw new Error('boom');
    });
    host.onPanelReady((event) => seen.push(event.id));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.readyWindow('w1', 'panel-w1', PANEL_TREE);
    expect(seen).toEqual(['w1']);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('createPanel builds a proxy tree synchronously, with userData wired from the node', () => {
    const { host } = makeSetup();
    const panel = host.createPanel(PANEL_TREE);
    expect(panel.root.userData['id']).toBe('uix-window');
    const button = panel.getElementById('uix-button');
    expect(button?.userData['customElement']).toEqual({ componentName: 'uix-toggle' });
    expect(panel.getElementById('does-not-exist')).toBeUndefined();
  });

  it('setProperties and event dispatch route through the host using the window panel id', () => {
    const { fake, host } = makeSetup();
    const handle = host.createWindow({ id: 'w1', config: PANEL_TREE });
    fake.readyWindow('w1', 'panel-w1', PANEL_TREE);
    const panel = handle.panel;
    expect(panel).toBeDefined();
    const button = panel!.getElementById('uix-button') as NativeUixElement;

    button.setProperties({ text: 'X' });
    expect(fake.propertyWrites).toEqual([
      { panelId: 'panel-w1', elementHandle: button.handle, props: { text: 'X' } },
    ]);

    const seen: unknown[] = [];
    button.addEventListener('press', (payload) => seen.push(payload));
    fake.fireElementEvent('panel-w1', button.handle, 'press', { ok: true });
    expect(seen).toEqual([{ ok: true }]);

    // A different panel id, or a different handle, must not dispatch here.
    fake.fireElementEvent('some-other-panel', button.handle, 'press', { ok: false });
    fake.fireElementEvent('panel-w1', 'no-such-handle', 'press', { ok: false });
    expect(seen).toEqual([{ ok: true }]);
  });

  it('a panel-ready report for an unknown or already-closed window is ignored', () => {
    const { fake, host } = makeSetup();
    // Never created:
    expect(() => fake.readyWindow('ghost', 'panel-ghost', PANEL_TREE)).not.toThrow();

    // Created, then closed before the host reports readiness:
    host.createWindow({ id: 'w1', config: PANEL_TREE });
    host.manager.close('w1');
    expect(() => fake.readyWindow('w1', 'panel-w1', PANEL_TREE)).not.toThrow();
    const ids: string[] = [];
    host.onPanelReady((event) => ids.push(event.id));
    expect(ids).not.toContain('w1');
  });

  it('unsubscribing onReady before the panel attaches drops the listener', () => {
    const { fake, host } = makeSetup();
    const handle = host.createWindow({ id: 'w1', config: PANEL_TREE });
    const seen: unknown[] = [];
    const stop = handle.onReady((panel) => seen.push(panel));
    stop();
    fake.readyWindow('w1', 'panel-w1', PANEL_TREE);
    expect(seen).toEqual([]);
  });

  it('createWindow names a window uix-window-<n> when no id is given', () => {
    const { host } = makeSetup();
    const handle = host.createWindow({ config: PANEL_TREE });
    expect(handle.id).toBe('uix-window-1');
  });

  it('createWindow forwards every option to the host as plain data, and defaults the rest', () => {
    const { fake, host } = makeSetup();
    host.createWindow({
      id: 'full',
      config: PANEL_TREE,
      title: 'Full',
      dockMode: DockMode.HandLocked,
      position: [1, 2, 3],
      maxWidth: 0.5,
      maxHeight: 0.4,
      movable: false,
      closable: true,
      minimizable: true,
      pinnable: true,
      dockable: true,
      handMenu: { hand: 'right' },
      followOffset: [0, -0.1, -1],
      followSpeed: 2,
      followTolerance: 0.1,
      region: 'wall',
    });
    expect(fake.createWindowCalls[0]).toEqual({
      windowId: 'full',
      config: PANEL_TREE,
      options: {
        id: 'full',
        title: 'Full',
        // In a region, so the manager makes it world-locked and says so.
        dockMode: DockMode.WorldLocked,
        movable: false,
        closable: true,
        minimizable: true,
        pinnable: true,
        dockable: true,
        position: [1, 2, 3],
        maxWidth: 0.5,
        maxHeight: 0.4,
        handMenu: { hand: 'right' },
        followOffset: [0, -0.1, -1],
        followSpeed: 2,
        followTolerance: 0.1,
        region: 'wall',
      },
    });

    host.createWindow({ id: 'minimal', config: PANEL_TREE });
    expect(fake.createWindowCalls[1]).toEqual({
      windowId: 'minimal',
      config: PANEL_TREE,
      options: {
        id: 'minimal',
        title: '',
        dockMode: DockMode.WorldLocked,
        movable: true,
        closable: false,
        minimizable: false,
        pinnable: false,
        dockable: false,
      },
    });

    host.createWindow({ id: 'follower', config: PANEL_TREE, dockMode: DockMode.HandLocked });
    expect(fake.createWindowCalls[2]?.options).toMatchObject({ dockMode: DockMode.HandLocked });
  });

  it('mirrors every WindowManager state change to the host as applyWindow', () => {
    const { fake, host } = makeSetup();
    host.createWindow({ id: 'w1', config: PANEL_TREE }); // opened, focused
    host.manager.minimize('w1'); // minimized
    host.manager.restore('w1'); // restored, focused
    host.manager.hide('w1'); // hidden
    host.manager.show('w1'); // shown, focused
    host.manager.setDockMode('w1', DockMode.HandLocked); // dockChanged
    host.manager.dockTo('w1', 'region-a'); // regionChanged
    host.manager.setChrome('w1', { close: true }); // chromeChanged
    host.manager.setHandMenu('w1', { hand: 'right' }); // handMenuChanged

    expect(fake.appliedWindows.length).toBeGreaterThanOrEqual(9);
    expect(fake.appliedWindows.every((record) => (record as { id: string }).id === 'w1')).toBe(
      true,
    );
  });

  it('closing a window with no attached panel yet still tells the host, without disposing a panel', () => {
    const { fake, host } = makeSetup();
    host.createWindow({ id: 'w1', config: PANEL_TREE });
    host.manager.close('w1');
    expect(fake.closedWindows).toEqual(['w1']);
    expect(fake.disposedPanels).toEqual([]);
  });

  it('closing an attached window disposes its panel and tells the host', () => {
    const { fake, host } = makeSetup();
    host.createWindow({ id: 'w1', config: PANEL_TREE });
    fake.readyWindow('w1', 'panel-w1', PANEL_TREE);
    host.manager.close('w1');
    expect(fake.closedWindows).toEqual(['w1']);
    expect(fake.disposedPanels).toEqual(['panel-w1']);
  });

  it('a bare panel disposes and constrains itself through its own panel id', () => {
    const { fake, host } = makeSetup();
    const panel = host.createPanel(PANEL_TREE);
    panel.setTargetDimensions(1, 2);
    panel.dispose();
    expect(fake.disposedPanels).toEqual(['uix-panel-1']);
  });
});

describe('NativeWindowHost dispose', () => {
  it('closes windows, disposes bare panels still live, and stops following the host', () => {
    const { fake, host } = makeSetup();
    host.createWindow({ id: 'w1', config: PANEL_TREE });
    fake.readyWindow('w1', 'p-w1', PANEL_TREE);
    const kept = host.createPanel(PANEL_TREE);
    const released = host.createPanel(PANEL_TREE);
    released.dispose();
    const clicks: unknown[] = [];
    kept.root.addEventListener('click', (event) => clicks.push(event));

    host.dispose();

    expect(fake.closedWindows).toEqual(['w1']);
    expect(fake.disposedPanels).toEqual(['uix-panel-2', 'p-w1', 'uix-panel-1']);
    expect(host.manager.has('w1')).toBe(false);

    // The host's subscriptions are gone: a late ready or element event lands nowhere.
    fake.readyWindow('w1', 'p-late', PANEL_TREE);
    const ids: string[] = [];
    host.onPanelReady((event) => ids.push(event.id));
    expect(ids).toEqual([]);
    expect(clicks).toEqual([]);

    host.dispose();
    expect(fake.closedWindows).toEqual(['w1']);
  });
});

describe('NativeWindowHost as a SceneTarget', () => {
  const SCENE: SceneDescriptor = {
    regions: [
      { id: 'shelf', flow: 'row', position: [0, 1.2, -1], follow: true, followOffset: [0, -0.2, -1] },
      { id: 'rail' },
    ],
    windows: [
      {
        id: 'stats',
        title: 'Stats',
        config: '/ui/stats.uikitml',
        region: 'shelf',
        position: [0.2, 1.4, -1],
        followOffset: [0, 0, -1],
        closable: true,
        maxWidth: 0.6,
        maxHeight: 0.4,
        dockMode: DockMode.HeadLocked,
        followSpeed: 4,
        followTolerance: 0.05,
        movable: false,
        minimizable: true,
        pinnable: true,
        dockable: true,
        handMenu: { hand: 'left' },
      },
      { id: 'log', title: 'Log', config: '/ui/log.uikitml' },
    ],
  };

  it('hands regions to the native app and spawns windows with the descriptor config path', () => {
    const fake = createFakeNativeUiHost();
    const host = new NativeWindowHost({ host: fake });

    applyScene(host, SCENE);

    expect(fake.createdRegions).toEqual([
      { id: 'shelf', flow: 'row', position: [0, 1.2, -1], follow: true, followOffset: [0, -0.2, -1] },
      { id: 'rail' },
    ]);
    expect(fake.createWindowCalls.map((call) => [call.windowId, call.config])).toEqual([
      ['stats', '/ui/stats.uikitml'],
      ['log', '/ui/log.uikitml'],
    ]);
    expect(host.manager.get('stats')?.region).toBe('shelf');
    expect(fake.createWindowCalls[0]?.options).toMatchObject({
      position: [0.2, 1.4, -1],
      followOffset: [0, 0, -1],
      closable: true,
    });
  });

  it('removes the regions it created on dispose', () => {
    const fake = createFakeNativeUiHost();
    const host = new NativeWindowHost({ host: fake });
    applyScene(host, SCENE);

    host.dispose();

    expect(fake.removedRegions).toEqual(['shelf', 'rail']);
    expect(fake.closedWindows).toEqual(['stats', 'log']);
  });
});

sceneTargetContract('NativeWindowHost', () => {
  const host = new NativeWindowHost({ host: createFakeNativeUiHost() });
  return { target: host, manager: host.manager };
});
