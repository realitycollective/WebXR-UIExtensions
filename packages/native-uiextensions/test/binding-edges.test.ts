/**
 * The native binding's edges: options it rejects, features switched off,
 * the frame hook, and the less travelled paths of the window rules.
 */
import { DockMode, upgradePanel, yawQuaternion, type HeadPose } from '@realitycollective/webxr-uiextensions';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeWindowHost } from '../src/host.js';
import { readNativeUiFrames, readNativeUiInput, type NativeUiInputSource } from '../src/native-types.js';
import { createFakeNativeUiHost, type FakeElementSpec } from './helpers/fake-native-ui-host.js';

const TREE: FakeElementSpec = {
  id: 'uix-window',
  children: [
    {
      id: 'uix-titlebar',
      children: [{ id: 'uix-title' }, { id: 'uix-pin' }, { id: 'uix-dock' }, { id: 'uix-minimize' }, { id: 'uix-close' }],
    },
    {
      id: 'uix-content',
      children: [
        { id: 'body' },
        {
          componentName: 'uix-stepper',
          attributes: { 'data-uix-id': 'count', 'data-uix-value': '1' },
          children: [{ id: 'val', componentName: 'uix-value' }],
        },
      ],
    },
  ],
};

const HEAD: HeadPose = { position: [0, 1.6, 0], quaternion: [0, 0, 0, 1] };

function make(options: ConstructorParameters<typeof NativeWindowHost>[0] = {}) {
  const fake = createFakeNativeUiHost();
  const input = { head: HEAD as HeadPose | undefined, sources: [] as NativeUiInputSource[] };
  const host = new NativeWindowHost({
    host: fake,
    input: { getHeadPose: () => input.head!, sample: () => input.sources },
    ...options,
  });
  const open = (id: string, extra: Record<string, unknown> = {}) => {
    host.createWindow({ id, config: TREE, ...extra });
    fake.readyWindow(id, `panel-${id}`, TREE);
  };
  const click = (id: string, element: string) => {
    const at = {
      sourceId: 'r',
      pointer: 'ray' as const,
      panelId: `panel-${id}`,
      elementHandle: fake.handleOf(`panel-${id}`, element),
      point: [0, 1.6, -1] as [number, number, number],
      ray: { origin: [0, 1.6, 0] as [number, number, number], direction: [0, 0, -1] as [number, number, number] },
    };
    fake.pointer({ ...at, active: true });
    host.update(1 / 72);
    fake.pointer({ ...at, active: false });
    host.update(1 / 72);
  };
  const grabDrag = (id: string, from: [number, number, number], to: [number, number, number]) => {
    const on = { sourceId: 'g', pointer: 'grab' as const, panelId: `panel-${id}`, elementHandle: fake.handleOf(`panel-${id}`, 'uix-titlebar') };
    fake.pointer({ ...on, point: from, active: true });
    host.update(1 / 72);
    fake.pointer({ ...on, point: to, active: true });
    host.update(1 / 72);
    fake.pointer({ ...on, point: to, active: false });
    host.update(1 / 72);
  };
  return { fake, input, host, open, click, grabDrag };
}

afterEach(() => {
  delete (globalThis as { __rcHost?: unknown }).__rcHost;
});

describe('options the binding rejects', () => {
  it('an unknown dock mode throws at createWindow, as the manager would', () => {
    const { host } = make();
    expect(() => host.createWindow({ id: 'w', config: TREE, dockMode: 'sideways' as never })).toThrow(/not a dock mode/);
  });

  it('a second window with the same id throws', () => {
    const { host } = make();
    host.createWindow({ id: 'w', config: TREE });
    expect(() => host.createWindow({ id: 'w', config: TREE })).toThrow(/already open/);
  });
});

describe('the frame hook', () => {
  it('attachToHost drives update from the frame source, never with a negative delta', () => {
    let tick: ((timestampMs: number, deltaS: number) => void) | undefined;
    const unsubscribe = vi.fn();
    const frames = { onFrame: (cb: (t: number, d: number) => void) => ((tick = cb), unsubscribe) };
    const { fake, host, open } = make({ attachToHost: true, frames });
    open('w', { dockMode: DockMode.BodyFollow });
    tick!(0, -1);
    // The default offset [0, -0.15, -1.2] from the head at 1.6 m, height honoured as on IWSDK 1.0.
    expect(fake.windowPose('w')!.position).toEqual([0, 1.6 + -0.15, -1.2]);
    host.dispose();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('reads globalThis.__rcHost.onFrame and input, and names what is missing', () => {
    expect(() => readNativeUiFrames()).toThrow(/__rcHost\.onFrame/);
    const onFrame = vi.fn(() => () => {});
    const input = { sample: () => [] };
    (globalThis as { __rcHost?: unknown }).__rcHost = { onFrame, input };
    readNativeUiFrames().onFrame(() => {});
    expect(onFrame).toHaveBeenCalled();
    expect(readNativeUiInput()).toBe(input);
    const given = { onFrame: vi.fn() };
    expect(readNativeUiFrames(given)).toBe(given);
  });

  it('update after dispose does nothing, and dispose twice is safe', () => {
    const { fake, host, open } = make();
    open('w');
    host.dispose();
    const calls = fake.poseCalls.length;
    host.update(1 / 72);
    host.dispose();
    expect(fake.poseCalls.length).toBe(calls);
  });
});

describe('chrome buttons', () => {
  it('PIN toggles the dock mode and DOCK returns home, only while enabled', () => {
    const { host, open, click } = make();
    open('w');
    click('w', 'uix-pin');
    click('w', 'uix-dock');
    expect(host.manager.get('w')?.dockMode).toBe(DockMode.WorldLocked);
    host.manager.setChrome('w', { pin: true, dock: true });
    click('w', 'uix-pin');
    expect(host.manager.get('w')?.dockMode).toBe(DockMode.BodyFollow);
    click('w', 'uix-dock');
    expect(host.manager.get('w')?.dockMode).toBe(DockMode.WorldLocked);
  });

  it('sizes the panel to maxWidth x maxHeight when both are given', () => {
    const { fake, open } = make();
    open('w', { maxWidth: 0.6, maxHeight: 0.4 });
    open('v', { maxWidth: 0.6 });
    expect(fake.dimensionCalls).toEqual([{ panelId: 'panel-w', width: 0.6, height: 0.4 }]);
  });
});

describe('regions', () => {
  it('DOCK returns a window to its spawn region; already home is a no-op', () => {
    const { host, open, grabDrag } = make();
    host.spawnRegion({ id: 'shelf', position: [1, 1.6, -1] });
    open('w', { region: 'shelf' });
    const changes = vi.fn();
    host.manager.events.on('regionChanged', changes);
    host.manager.returnHome('w');
    expect(changes).not.toHaveBeenCalled();
    grabDrag('w', [1, 1.7, -1], [3, 1.7, -1]);
    expect(host.manager.get('w')?.region).toBeUndefined();
    host.manager.returnHome('w');
    expect(host.manager.get('w')?.region).toBe('shelf');
  });

  it('a full region rejects the next window', () => {
    const { host, open } = make();
    host.spawnRegion({ id: 'one', capacity: 1 });
    open('a', { region: 'one' });
    open('b', { region: 'one' });
    expect(host.manager.get('a')?.region).toBe('one');
    expect(host.manager.get('b')?.region).toBeUndefined();
  });

  it('a second region with the same id is ignored', () => {
    const { host } = make();
    host.spawnRegion({ id: 'r', position: [1, 0, 0] });
    expect(() => host.spawnRegion({ id: 'r' })).not.toThrow();
  });

  it('regions off: regions are ignored, windows are undocked, and a drop docks nowhere', () => {
    const { host, open, grabDrag } = make({ regions: false });
    host.spawnRegion({ id: 'shelf', position: [0, 1.6, -1] });
    open('w', { region: 'shelf', position: [0, 1.6, -1] });
    expect(host.manager.get('w')?.region).toBeUndefined();
    grabDrag('w', [0, 1.7, -1], [0.01, 1.7, -1]);
    expect(host.manager.get('w')?.region).toBeUndefined();
  });
});

describe('transitions and missing input', () => {
  it('leaving a hand opens the gate and faces the viewer', () => {
    const { fake, host, open } = make();
    open('menu', { dockMode: DockMode.HandLocked, position: [0.5, 1.6, -1] });
    host.update(1 / 72);
    expect(fake.windowHidden('menu')).toBe(true);
    host.manager.setDockMode('menu', DockMode.WorldLocked);
    host.update(1 / 72);
    expect(fake.windowHidden('menu')).toBe(false);
    const q = fake.windowPose('menu')!.quaternion;
    const expected = yawQuaternion(Math.atan2(-0.5, 1));
    expect(Math.abs(q[1] * expected[1] + q[3] * expected[3])).toBeCloseTo(1, 9);
  });

  it('without a head nothing follows, nothing is biased, and a hand menu stays hidden', () => {
    const { fake, input, host, open } = make();
    input.head = undefined;
    open('f', { dockMode: DockMode.BodyFollow, position: [0.2, 1, -1] });
    open('menu', { dockMode: DockMode.HandLocked });
    input.sources = [{ handedness: 'left', gripPose: { position: [0, 1.2, -0.4], quaternion: [0, 0, 0, 1] } }];
    host.update(1 / 72);
    host.manager.togglePin('f'); // pin with no head: no facing change
    host.update(1 / 72);
    expect(fake.windowPose('f')!.position).toEqual([0.2, 1, -1]);
    expect(fake.windowHidden('menu')).toBe(true);
  });

  it('no input slice at all is allowed: windows are simply placed', () => {
    const fake = createFakeNativeUiHost();
    const host = new NativeWindowHost({ host: fake });
    host.createWindow({ id: 'w', config: TREE, position: [1, 2, 3] });
    fake.readyWindow('w', 'panel-w', TREE);
    host.update(1 / 72);
    expect(fake.windowPose('w')!.position).toEqual([1, 2, 3]);
  });

  it('a second source on the same side does not replace the first hand', () => {
    const { fake, input, host, open } = make();
    open('menu', { dockMode: DockMode.HandLocked });
    const facing = { position: [0, 1.2, -0.4] as [number, number, number], quaternion: yawQuaternion(-Math.PI / 2) };
    input.sources = [
      { handedness: 'none' },
      { handedness: 'left', gripPose: facing },
      { handedness: 'left', gripPose: { ...facing, quaternion: yawQuaternion(Math.PI / 2) } },
    ];
    host.update(1 / 72);
    expect(fake.windowHidden('menu')).toBe(false);
  });
});

describe('pointer samples the binding ignores or ends', () => {
  it('a sample for an unknown panel or element, or a touch with no distance, is no contact', () => {
    const { fake, host, open } = make();
    open('w');
    const downs: unknown[] = [];
    host.onPanelReady(({ panel }) => {
      panel.getElementById('body')!.addEventListener('pointerdown', (event) => downs.push(event));
    });
    const body = { panel: `panel-w`, handle: fake.handleOf('panel-w', 'body') };
    fake.pointer({ sourceId: 'a', pointer: 'ray', panelId: 'nope', elementHandle: 'x', point: null, active: true });
    fake.pointer({ sourceId: 'b', pointer: 'ray', panelId: body.panel, elementHandle: 'nope', point: null, active: true });
    fake.pointer({ sourceId: 'c', pointer: 'touch', panelId: body.panel, elementHandle: body.handle, point: null });
    host.update(1 / 72);
    expect(downs).toEqual([]);
  });

  it('a ray released off every element ends the press where it began, without a click', () => {
    const { fake, host, open } = make();
    open('w');
    const handle = fake.handleOf('panel-w', 'body');
    const events: string[] = [];
    const base = { sourceId: 'r', pointer: 'ray' as const, point: [0, 1.6, -1] as [number, number, number] };
    host.onPanelReady(({ panel }) => {
      panel.getElementById('body')!.addEventListener('pointerup', () => events.push('up'));
      panel.getElementById('body')!.addEventListener('click', () => events.push('click'));
    });
    fake.pointer({ ...base, panelId: 'panel-w', elementHandle: handle, active: true });
    host.update(1 / 72);
    fake.pointer({ ...base, panelId: null, elementHandle: null, active: false });
    host.update(1 / 72);
    expect(events).toEqual(['up']);
  });
});

describe('controls off', () => {
  it('controls: false leaves the markup alone', () => {
    const { fake, host, open } = make({ controls: false });
    open('w');
    expect(fake.elementProperties('w', 'val')).toBeUndefined();
    const panel = host.createPanel(TREE);
    // A client may still upgrade by hand.
    expect(upgradePanel(panel.root, panel.root).ids()).toEqual(['count']);
  });
});

describe('records, presses and drags off the main path', () => {
  it('a window that has not attached yet is left out of every frame', () => {
    const { fake, host } = make();
    host.createWindow({ id: 'late', config: TREE });
    host.update(1 / 72);
    expect(fake.poseCalls).toEqual([]);
  });

  it('adopts a record the app opened first, as IWSDK does', () => {
    const { fake, host } = make();
    host.createWindow({ id: 'w', config: TREE });
    host.manager.open('w', { title: 'Mine' });
    fake.readyWindow('w', 'panel-w', TREE);
    expect(fake.elementProperties('w', 'uix-title')).toEqual({ text: 'Mine' });
  });

  it('ignores records on its manager that it did not open', () => {
    const { fake, host } = make();
    host.manager.open('foreign');
    host.manager.setChrome('foreign', { close: true });
    host.manager.returnHome('foreign');
    expect(fake.appliedWindows).toEqual([]);
  });

  it('writes no title for an empty title, and tolerates markup without chrome', () => {
    const { fake, host, open } = make();
    open('w', { title: '' });
    expect(fake.elementProperties('w', 'uix-title')).toBeUndefined();
    host.createWindow({ id: 'bare', config: { id: 'plain' } });
    expect(() => fake.readyWindow('bare', 'panel-bare', { id: 'plain' })).not.toThrow();
  });

  it('the minimize button does nothing while disabled', () => {
    const { host, open, click } = make();
    open('w');
    click('w', 'uix-minimize');
    expect(host.manager.get('w')?.minimized).toBe(false);
  });

  it('a pointerdown listener that closes the window stops the focus that would follow', () => {
    const { fake, host, open } = make();
    open('w', { closable: true });
    host.onPanelReady(({ panel }) => {
      panel.getElementById('body')!.addEventListener('pointerdown', () => host.manager.close('w'));
    });
    const handle = fake.handleOf('panel-w', 'body');
    fake.pointer({ sourceId: 'r', pointer: 'ray', panelId: 'panel-w', elementHandle: handle, point: null, active: true });
    expect(() => host.update(1 / 72)).not.toThrow();
    expect(host.manager.has('w')).toBe(false);
  });

  it('DOCK returns a following window to following', () => {
    const { host, open, grabDrag } = make();
    open('w', { dockMode: DockMode.BodyFollow });
    host.update(1 / 72);
    grabDrag('w', [0, 1.7, -1.2], [0.5, 1.7, -1.2]);
    expect(host.manager.get('w')?.dockMode).toBe(DockMode.WorldLocked);
    host.manager.returnHome('w');
    expect(host.manager.get('w')?.dockMode).toBe(DockMode.BodyFollow);
  });

  it('a press on a bare panel reaches its element', () => {
    const { fake, host } = make();
    const panel = host.createPanel(TREE);
    const clicks: unknown[] = [];
    panel.getElementById('body')!.addEventListener('click', (event) => clicks.push(event));
    const handle = (panel.getElementById('body') as unknown as { handle: string }).handle;
    const at = { sourceId: 'r', pointer: 'ray' as const, panelId: 'uix-panel-1', elementHandle: handle, point: null };
    fake.pointer({ ...at, active: true });
    host.update(1 / 72);
    fake.pointer({ ...at, active: false });
    host.update(1 / 72);
    expect(clicks).toHaveLength(1);
  });

  it('a release over a different element is a pointerup there and no click', () => {
    const { fake, host, open } = make();
    open('w');
    const events: string[] = [];
    host.onPanelReady(({ panel }) => {
      panel.getElementById('body')!.addEventListener('click', () => events.push('body click'));
      panel.getElementById('uix-title')!.addEventListener('pointerup', () => events.push('title up'));
      panel.getElementById('uix-title')!.addEventListener('click', () => events.push('title click'));
    });
    const base = { sourceId: 'r', pointer: 'ray' as const, panelId: 'panel-w', point: null };
    fake.pointer({ ...base, elementHandle: fake.handleOf('panel-w', 'body'), active: true });
    host.update(1 / 72);
    fake.pointer({ ...base, elementHandle: fake.handleOf('panel-w', 'uix-title'), active: false });
    host.update(1 / 72);
    expect(events).toEqual(['title up']);
  });

  it('a touch that leaves without ever pressing ends quietly', () => {
    const { fake, host, open } = make();
    open('w');
    const events: string[] = [];
    host.onPanelReady(({ panel }) => {
      panel.getElementById('body')!.addEventListener('pointerup', () => events.push('up'));
    });
    fake.pointer({
      sourceId: 't', pointer: 'touch', panelId: 'panel-w',
      elementHandle: fake.handleOf('panel-w', 'body'), point: null, signedDistance: 0.05,
    });
    host.update(1 / 72);
    host.update(1 / 72);
    expect(events).toEqual([]);
  });

  it('a second pointer on a held title bar does not take the drag over', () => {
    const { fake, host, open } = make();
    open('w', { position: [0, 1.6, -1] });
    const bar = { panelId: 'panel-w', elementHandle: fake.handleOf('panel-w', 'uix-titlebar') };
    fake.pointer({ sourceId: 'a', pointer: 'grab', ...bar, point: [0, 1.7, -1], active: true });
    host.update(1 / 72);
    fake.pointer({ sourceId: 'a', pointer: 'grab', ...bar, point: [0.1, 1.7, -1], active: true });
    fake.pointer({ sourceId: 'b', pointer: 'grab', ...bar, point: [5, 1.7, -1], active: true });
    host.update(1 / 72);
    expect(fake.windowPose('w')!.position[0]).toBeCloseTo(0.1, 9);
  });

  it('a drag frame with no pointer position keeps the window, and billboarding can be off', () => {
    const { fake, host, open } = make();
    open('w', { position: [0.5, 1.6, -1], billboardWhileDragging: false });
    const bar = { sourceId: 'a', pointer: 'grab' as const, panelId: 'panel-w', elementHandle: fake.handleOf('panel-w', 'uix-titlebar') };
    fake.pointer({ ...bar, point: [0.5, 1.7, -1], active: true });
    host.update(1 / 72);
    fake.pointer({ ...bar, point: null, active: true });
    host.update(1 / 72);
    const held = fake.windowPose('w')!;
    [0.5, 1.6, -1].forEach((value, i) => expect(held.position[i]).toBeCloseTo(value, 9));
    expect(held.quaternion).toEqual([0, 0, 0, 1]);
    fake.pointer({ ...bar, point: [0.5, 1.7, -1], active: false });
    host.update(1 / 72);
    expect(fake.windowPose('w')!.quaternion).toEqual([0, 0, 0, 1]);
  });
});
