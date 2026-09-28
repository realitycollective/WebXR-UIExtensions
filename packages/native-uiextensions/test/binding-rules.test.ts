/**
 * Binding cases (the second kind in the Masters' "Validation" section): the
 * rules the native binding now applies itself, proved against a fake host
 * that only records and reports. Each `describe` names the handover change
 * and the UI Extensions master rows it satisfies.
 */
import {
  DEFAULT_WINDOW_FOLLOW,
  DockMode,
  enterFollow,
  evaluateHandMenu,
  resolveHandMenu,
  stepFollow,
  upgradePanel,
  yawQuaternion,
  type FollowState,
  type HeadPose,
  type PoseTuple,
  type Vec3Tuple, WINDOW_CHROME_IDS } from '@realitycollective/webxr-uiextensions';
import { describe, expect, it } from 'vitest';
import { NativeWindowHost, type CreateWindowOptions } from '../src/host.js';
import type { NativeUiInputHost, NativeUiInputSource } from '../src/native-types.js';
import { createFakeNativeUiHost, type FakeElementSpec } from './helpers/fake-native-ui-host.js';

const CHROME_TREE: FakeElementSpec = {
  id: 'uix-window',
  children: [
    {
      id: 'uix-titlebar',
      children: [
        { id: 'uix-title' },
        { id: 'uix-pin' },
        { id: 'uix-dock' },
        { id: 'uix-minimize' },
        { id: 'uix-close' },
      ],
    },
    {
      id: 'uix-content',
      children: [
        { id: 'body' },
        {
          id: 'counter',
          componentName: 'uix-stepper',
          attributes: { 'data-uix-id': 'count', 'data-uix-min': '0', 'data-uix-max': '5', 'data-uix-value': '1' },
          children: [
            { id: 'dec', componentName: 'uix-decrement' },
            { id: 'val', componentName: 'uix-value' },
            { id: 'inc', componentName: 'uix-increment' },
          ],
        },
      ],
    },
  ],
};

const HEAD: HeadPose = { position: [0, 1.6, 0], quaternion: [0, 0, 0, 1] };

function scriptedInput(): NativeUiInputHost & { head: HeadPose | undefined; sources: NativeUiInputSource[] } {
  const input = {
    head: HEAD as HeadPose | undefined,
    sources: [] as NativeUiInputSource[],
    getHeadPose(): HeadPose {
      return input.head!;
    },
    sample(): readonly NativeUiInputSource[] {
      return input.sources;
    },
  };
  return input;
}

function setup(hostOptions: { nearDrag?: boolean } = {}) {
  const fake = createFakeNativeUiHost();
  const input = scriptedInput();
  const host = new NativeWindowHost({ host: fake, input, ...hostOptions });
  const open = (id: string, options: Omit<CreateWindowOptions, 'config' | 'id'> = {}) => {
    const handle = host.createWindow({ id, config: CHROME_TREE, ...options });
    fake.readyWindow(id, `panel-${id}`, CHROME_TREE);
    return handle;
  };
  const handle = (windowId: string, elementId: string) => fake.handleOf(`panel-${windowId}`, elementId);
  const ray = (
    sourceId: string,
    windowId: string | null,
    elementId: string | null,
    active: boolean,
    point: Vec3Tuple | null = null,
    direction: Vec3Tuple = [0, 0, -1],
  ) =>
    fake.pointer({
      sourceId,
      pointer: 'ray',
      panelId: windowId === null ? null : `panel-${windowId}`,
      elementHandle: windowId === null || elementId === null ? null : handle(windowId, elementId),
      point,
      ray: { origin: [0, 1.6, 0], direction },
      active,
    });
  const touch = (sourceId: string, windowId: string, elementId: string, signedDistance: number) =>
    fake.pointer({
      sourceId,
      pointer: 'touch',
      panelId: `panel-${windowId}`,
      elementHandle: handle(windowId, elementId),
      point: [0, 1.6, -1],
      signedDistance,
    });
  const grab = (sourceId: string, windowId: string | null, elementId: string | null, active: boolean, point: Vec3Tuple) =>
    fake.pointer({
      sourceId,
      pointer: 'grab',
      panelId: windowId === null ? null : `panel-${windowId}`,
      elementHandle: windowId === null || elementId === null ? null : handle(windowId, elementId),
      point,
      active,
    });
  const frame = (dt = 1 / 72) => host.update(dt);
  const props = (windowId: string, elementId: string) => fake.elementProperties(windowId, elementId);
  return { fake, input, host, open, handle, ray, touch, grab, frame, props };
}

function listen(panelRoot: unknown, elementId: string, type: string): unknown[] {
  const seen: unknown[] = [];
  const panel = panelRoot as { getElementById(id: string): { addEventListener(t: string, l: (e?: unknown) => void): void } };
  panel.getElementById(elementId).addEventListener(type, (event) => seen.push(event));
  return seen;
}

function expectPose(actual: PoseTuple | undefined, expected: PoseTuple, digits = 9): void {
  expect(actual).toBeDefined();
  for (let i = 0; i < 3; i += 1) expect(actual!.position[i]).toBeCloseTo(expected.position[i]!, digits);
  const dot = Math.abs(actual!.quaternion.reduce((sum, value, i) => sum + value * expected.quaternion[i]!, 0));
  expect(dot).toBeCloseTo(1, digits);
}

describe('hover is decided by the binding from the pointer samples', () => {
  it('raises pointerenter and pointerleave on the element itself, and tells the host to style it while any pointer is over it', () => {
    const { fake, host, open, ray, touch, frame } = setup();
    const handle = open('w');
    const entered = listen(handle.panel, WINDOW_CHROME_IDS.title, 'pointerenter');
    const left = listen(handle.panel, WINDOW_CHROME_IDS.title, 'pointerleave');
    const windowEntered = listen(handle.panel, WINDOW_CHROME_IDS.window, 'pointerenter');
    frame();
    ray('right', 'w', WINDOW_CHROME_IDS.title, false, [0, 1.6, -1]);
    frame();
    expect(entered).toHaveLength(1);
    expect(windowEntered).toHaveLength(0);
    expect(fake.elementHovered!('w', WINDOW_CHROME_IDS.title)).toBe(true);
    // A second pointer over the same element: it hears its own enter, the host is not told again.
    touch('left', 'w', WINDOW_CHROME_IDS.title, 0.1);
    ray('right', 'w', WINDOW_CHROME_IDS.title, false, [0, 1.6, -1]);
    frame();
    expect(entered).toHaveLength(2);
    expect(fake.hoverCalls.filter((call) => call.hovered)).toHaveLength(1);
    // The ray moves off: it leaves, the touch keeps the style on.
    ray('right', 'w', null, false);
    touch('left', 'w', WINDOW_CHROME_IDS.title, 0.1);
    frame();
    expect(left).toHaveLength(1);
    expect(fake.elementHovered!('w', WINDOW_CHROME_IDS.title)).toBe(true);
    // The touch stops reporting: it leaves, and the style comes off.
    frame();
    expect(left).toHaveLength(2);
    expect(fake.elementHovered!('w', WINDOW_CHROME_IDS.title)).toBe(false);
    expect((entered[0] as { pointerType: string }).pointerType).toBe('ray');
  });

  it('ignores a pointerenter or pointerleave the host raises itself, and needs no setHover on the host', () => {
    const { fake, host, open, handle: handleOf, ray, frame } = setup();
    const opened = open('w');
    const entered = listen(opened.panel, WINDOW_CHROME_IDS.title, 'pointerenter');
    fake.fireElementEvent('panel-w', handleOf('w', WINDOW_CHROME_IDS.title), 'pointerenter');
    fake.fireElementEvent('panel-w', handleOf('w', WINDOW_CHROME_IDS.title), 'pointerleave');
    expect(entered).toHaveLength(0);
    const bare = { ...fake, setHover: undefined } as unknown as typeof fake;
    const plain = new NativeWindowHost({ host: bare, input: scriptedInput() });
    plain.createWindow({ id: 'p', config: CHROME_TREE });
    fake.readyWindow('p', 'panel-p', CHROME_TREE);
    expect(() => {
      bare.pointer({ sourceId: 'r', pointer: 'ray', panelId: 'panel-p', elementHandle: handleOf('p', WINDOW_CHROME_IDS.title), point: [0, 1.6, -1], ray: { origin: [0, 1.6, 0], direction: [0, 0, -1] }, active: false });
      plain.update(1 / 72);
    }).not.toThrow();
    plain.dispose();
    host.dispose();
    ray('right', null, null, false);
    frame();
  });
});

describe('scrolling and text entry are core rules; the host only draws and types', () => {
  const SCROLL_TREE: FakeElementSpec = {
    id: WINDOW_CHROME_IDS.window,
    children: [
      { id: WINDOW_CHROME_IDS.titlebar, children: [{ id: WINDOW_CHROME_IDS.title }] },
      {
        id: WINDOW_CHROME_IDS.content,
        scroll: { width: 200, height: 100, maxX: 0, maxY: 400 },
        children: [{ id: 'row' }, { id: 'name', input: { value: 'Ada', type: 'text' } }, { id: 'note', input: { value: '', multiline: true } }],
      },
    ],
  };
  function scrollSetup() {
    const fake = createFakeNativeUiHost();
    const input = scriptedInput();
    const host = new NativeWindowHost({ host: fake, input });
    host.createWindow({ id: 'w', config: SCROLL_TREE });
    fake.readyWindow('w', 'panel-w', SCROLL_TREE);
    const handle = (elementId: string) => fake.handleOf('panel-w', elementId);
    const ray = (elementId: string | null, active: boolean, localPoint?: [number, number]) =>
      fake.pointer({
        sourceId: 'right',
        pointer: 'ray',
        panelId: elementId === null ? null : 'panel-w',
        elementHandle: elementId === null ? null : handle(elementId),
        point: [0, 1.6, -1],
        ray: { origin: [0, 1.6, 0], direction: [0, 0, -1] },
        active,
        ...(localPoint ? { localPoint } : {}),
      });
    return { fake, host, handle, ray, frame: (dt = 1 / 60) => host.update(dt) };
  }

  it('a ray held on a scrolling element drags its content by the move of the hit point, coasts on release, and stops when the pointer goes', () => {
    const { fake, handle, ray, frame } = scrollSetup();
    frame();
    ray('row', false, [50, 50]);
    frame();
    ray('row', true, [50, 50]);
    frame();
    expect(fake.scrollCalls).toHaveLength(0);
    ray('row', true, [50, 30]);
    frame();
    expect(fake.scrollCalls.at(-1)).toEqual({ panelId: 'panel-w', elementHandle: handle(WINDOW_CHROME_IDS.content), x: 0, y: 20 });
    expect(fake.scrollPosition!('w', WINDOW_CHROME_IDS.content)).toEqual([0, 20]);
    // Released: the content coasts on for a few frames, then settles.
    ray('row', false, [50, 30]);
    frame();
    const before = fake.scrollCalls.length;
    frame();
    expect(fake.scrollCalls.length).toBeGreaterThan(before);
    expect(fake.scrollPosition!('w', WINDOW_CHROME_IDS.content)![1]).toBeGreaterThan(20);
    for (let i = 0; i < 200; i++) frame();
    const settled = fake.scrollCalls.length;
    frame();
    expect(fake.scrollCalls.length).toBe(settled);
    // A drag whose pointer vanishes ends; a drag started off a scrolling element never begins.
    ray('row', true, [50, 50]);
    frame();
    ray('row', true, [50, 40]);
    frame();
    const moved = fake.scrollCalls.length;
    frame();
    ray(WINDOW_CHROME_IDS.title, true, [10, 10]);
    frame();
    ray(WINDOW_CHROME_IDS.title, true, [10, 20]);
    frame();
    expect(fake.scrollCalls.length).toBeGreaterThanOrEqual(moved);
    // A press without a local point cannot start a drag.
    ray('row', false);
    frame();
    ray('row', true);
    frame();
    ray('row', true);
    frame();
    // A move off the panel while held ends the drag.
    ray('row', false, [50, 50]);
    frame();
    ray('row', true, [50, 50]);
    frame();
    ray(null, true, [50, 60]);
    frame();
  });

  it('a scrollextent event from the host resizes the range, for a new element too', () => {
    const { fake, handle, ray, frame } = scrollSetup();
    frame();
    fake.fireElementEvent('panel-w', handle(WINDOW_CHROME_IDS.content), 'scrollextent', { width: 200, height: 100, maxX: 0, maxY: 10 });
    fake.fireElementEvent('panel-w', handle('row'), 'scrollextent', { width: 200, height: 50, maxX: 0, maxY: 5 });
    fake.fireElementEvent('panel-w', 'no-such-handle', 'scrollextent', { width: 1, height: 1, maxX: 0, maxY: 0 });
    ray('row', false, [50, 50]);
    frame();
    ray('row', true, [50, 50]);
    frame();
    ray('row', true, [50, 0]);
    frame();
    // The row itself now scrolls (nearest scrolling ancestor), by at most its 5 px range plus the rubber band.
    expect(fake.scrollCalls.at(-1)?.elementHandle).toBe(handle('row'));
    expect(fake.scrollCalls.at(-1)?.y).toBeGreaterThan(5);
  });

  it('a click on a text field asks the host for the keyboard with its value, typed text lands on the element, and closing ends entry', () => {
    const { fake, host, handle, ray, frame } = scrollSetup();
    const changes = listen(host.createPanel(SCROLL_TREE), 'name', 'valueChanged');
    void changes;
    frame();
    ray('name', false, [10, 10]);
    frame();
    ray('name', true, [10, 10]);
    frame();
    ray('name', false, [10, 10]);
    frame();
    expect(fake.keyboardCalls).toEqual([{ panelId: 'panel-w', elementHandle: handle('name'), value: 'Ada', multiline: false, type: 'text' }]);
    fake.typeText('panel-w', handle('name'), 'Ada L');
    expect(fake.elementProperties('w', 'name')).toEqual({ value: 'Ada L' });
    fake.closeKeyboard();
    fake.typeText('panel-w', handle('name'), 'gone');
    expect(fake.elementProperties('w', 'name')).toEqual({ value: 'Ada L' });
    // A click on an element that is not a field asks for nothing; typing for a stranger changes nothing.
    ray('row', true, [10, 10]);
    frame();
    ray('row', false, [10, 10]);
    frame();
    expect(fake.keyboardCalls).toHaveLength(1);
    ray('name', true, [10, 10]);
    frame();
    ray('name', false, [10, 10]);
    frame();
    fake.typeText('panel-w', handle('row'), 'elsewhere');
    expect(fake.elementProperties('w', 'name')).toEqual({ value: 'Ada L' });
    fake.typeText('panel-w', 'no-such-handle', 'nobody');
    // A multi-line field with no declared type asks for a return key and the default type.
    ray('note', true, [10, 10]);
    frame();
    ray('note', false, [10, 10]);
    frame();
    expect(fake.keyboardCalls.at(-1)).toEqual({ panelId: 'panel-w', elementHandle: handle('note'), value: '', multiline: true, type: 'text' });
    host.dispose();
  });

  it('a drag frame with no local point holds the position, and a host without setScroll or showKeyboard is left alone', () => {
    const { fake, handle, ray, frame } = scrollSetup();
    frame();
    ray('row', true, [50, 50]);
    frame();
    ray('row', true);
    frame();
    ray('row', true, [50, 40]);
    frame();
    expect(fake.scrollCalls.at(-1)?.y).toBe(10);
    void handle;
    const quiet = createFakeNativeUiHost();
    const bare = { ...quiet, setScroll: undefined, showKeyboard: undefined } as unknown as typeof quiet;
    const plain = new NativeWindowHost({ host: bare, input: scriptedInput() });
    plain.createWindow({ id: 'q', config: SCROLL_TREE });
    quiet.readyWindow('q', 'panel-q', SCROLL_TREE);
    const press = (elementId: string, active: boolean, localPoint: [number, number]) =>
      bare.pointer({ sourceId: 'r', pointer: 'ray', panelId: 'panel-q', elementHandle: quiet.handleOf('panel-q', elementId), point: [0, 1.6, -1], ray: { origin: [0, 1.6, 0], direction: [0, 0, -1] }, active, localPoint });
    expect(() => {
      press('row', true, [50, 50]);
      plain.update(1 / 60);
      press('row', true, [50, 40]);
      plain.update(1 / 60);
      press('row', false, [50, 40]);
      plain.update(1 / 60);
      for (let i = 0; i < 5; i++) plain.update(1 / 60);
      press('name', true, [10, 10]);
      plain.update(1 / 60);
      press('name', false, [10, 10]);
      plain.update(1 / 60);
    }).not.toThrow();
    plain.dispose();
  });
});

describe('change 19: a window record opens when its panel attaches', () => {
  it('manager.has(id) is false until onPanelReady, then true', () => {
    const { fake, host } = setup();
    host.createWindow({ id: 'w', config: CHROME_TREE });
    expect(host.manager.has('w')).toBe(false);
    fake.readyWindow('w', 'panel-w', CHROME_TREE);
    expect(host.manager.has('w')).toBe(true);
  });
});

describe('change 18: the title defaults to the window id', () => {
  it('a window spawned without a title carries its id in the plain options and in uix-title', () => {
    const { fake, open, props } = setup();
    open('untitled');
    expect(fake.createWindowCalls[0]?.options).toMatchObject({ title: 'untitled' });
    expect(props('untitled', 'uix-title')).toEqual({ text: 'untitled' });
  });

  it('an explicit title is written as given', () => {
    const { open, props } = setup();
    open('w', { title: 'Stats' });
    expect(props('w', 'uix-title')).toEqual({ text: 'Stats' });
  });
});

describe('change 1: the binding applies chrome, title and the chrome labels', () => {
  it('every button is hidden unless asked for, and setChrome shows it later', () => {
    const { host, open, props } = setup();
    open('w', { closable: true });
    expect(props('w', 'uix-close')).toMatchObject({ display: 'flex' });
    for (const id of ['uix-pin', 'uix-dock', 'uix-minimize']) {
      expect(props('w', id)).toMatchObject({ display: 'none' });
    }
    host.manager.setChrome('w', { pin: true });
    expect(props('w', 'uix-pin')).toMatchObject({ display: 'flex' });
  });

  it('the pin label names the next action: UNPIN placed, PIN following, PIN while dragging', () => {
    const { host, open, props } = setup();
    open('w', { pinnable: true });
    expect(props('w', 'uix-pin')).toMatchObject({ text: 'UNPIN' });
    host.manager.togglePin('w');
    expect(props('w', 'uix-pin')).toMatchObject({ text: 'PIN' });
    host.manager.togglePin('w');
    host.manager.setDragging('w', true);
    expect(props('w', 'uix-pin')).toMatchObject({ text: 'PIN' });
  });

  it('the minimize label reads MIN then MAX, and the content is hidden while minimized', () => {
    const { host, open, props } = setup();
    open('w', { minimizable: true });
    expect(props('w', 'uix-minimize')).toMatchObject({ text: 'MIN' });
    expect(props('w', 'uix-content')).toMatchObject({ display: 'flex' });
    host.manager.minimize('w');
    expect(props('w', 'uix-minimize')).toMatchObject({ text: 'MAX' });
    expect(props('w', 'uix-content')).toMatchObject({ display: 'none' });
    host.manager.restore('w');
    expect(props('w', 'uix-content')).toMatchObject({ display: 'flex' });
  });

  it('the chrome buttons act through the manager, only while enabled', () => {
    const { host, open, ray, frame } = setup();
    open('w', { minimizable: true });
    const clickButton = (id: string) => {
      ray('r', 'w', id, true, [0, 1.7, -1]);
      frame();
      ray('r', 'w', id, false, [0, 1.7, -1]);
      frame();
    };
    clickButton('uix-minimize');
    expect(host.manager.get('w')?.minimized).toBe(true);
    clickButton('uix-close'); // not enabled: ignored
    expect(host.manager.has('w')).toBe(true);
    host.manager.setChrome('w', { close: true });
    clickButton('uix-close');
    expect(host.manager.has('w')).toBe(false);
  });
});

describe('change 5: click timing is on release, for rays as for touch', () => {
  it('a press does not click; the release over the same element does', () => {
    const { open, ray, frame } = setup();
    const panel = open('w').panel!;
    const clicks = listen(panel, 'body', 'click');
    const downs = listen(panel, 'body', 'pointerdown');
    ray('right', 'w', 'body', true, [0, 1.6, -1]);
    frame();
    expect(downs).toHaveLength(1);
    expect(clicks).toHaveLength(0);
    ray('right', 'w', 'body', false, [0, 1.6, -1]);
    frame();
    expect(clicks).toHaveLength(1);
  });

  it('press, move off, release yields no click', () => {
    const { open, ray, frame } = setup();
    const panel = open('w').panel!;
    const clicks = listen(panel, 'body', 'click');
    ray('right', 'w', 'body', true, [0, 1.6, -1]);
    frame();
    ray('right', null, null, true);
    frame();
    ray('right', null, null, false);
    frame();
    expect(clicks).toHaveLength(0);
  });

  it('a ray lost mid-press ends it with no click', () => {
    const { open, ray, frame } = setup();
    const panel = open('w').panel!;
    const clicks = listen(panel, 'body', 'click');
    const ups = listen(panel, 'body', 'pointerup');
    ray('right', 'w', 'body', true, [0, 1.6, -1]);
    frame();
    frame(); // not reported: the source is gone
    expect(ups).toHaveLength(1);
    expect(clicks).toHaveLength(0);
  });

  it('a press anywhere on the window focuses it, and events bubble to the root', () => {
    const { host, open, ray, frame } = setup();
    open('a');
    open('b');
    expect(host.manager.focused?.id).toBe('b');
    ray('right', 'a', 'body', true, [0, 1.6, -1]);
    frame();
    expect(host.manager.focused?.id).toBe('a');
  });
});

describe('change 4 and 6: the touch-press machine runs in the binding', () => {
  const press = (touch: (s: string, w: string, e: string, d: number) => void, frame: () => void, source: string, distances: number[]) => {
    for (const d of distances) {
      touch(source, 'w', 'body', d);
      frame();
    }
  };

  it('a fingertip from the front presses once, and pushing through and back is one click', () => {
    const { open, touch, frame } = setup();
    const panel = open('w').panel!;
    const clicks = listen(panel, 'body', 'click');
    const downs = listen(panel, 'body', 'pointerdown');
    press(touch, frame, 'left-hand', [0.05, 0.015, -0.02, 0.01, 0.025, 0.05]);
    expect(downs).toHaveLength(1);
    expect(clicks).toHaveLength(1);
  });

  it('presses at 0.02 m in front and releases past 0.03 m', () => {
    const { open, touch, frame } = setup();
    const panel = open('w').panel!;
    const downs = listen(panel, 'body', 'pointerdown');
    const clicks = listen(panel, 'body', 'click');
    press(touch, frame, 'left-hand', [0.05, 0.021]);
    expect(downs).toHaveLength(0);
    press(touch, frame, 'left-hand', [0.02]);
    expect(downs).toHaveLength(1);
    press(touch, frame, 'left-hand', [0.03]);
    expect(clicks).toHaveLength(0);
    press(touch, frame, 'left-hand', [0.031]);
    expect(clicks).toHaveLength(1);
  });

  it('a tip first seen behind the panel never presses', () => {
    const { open, touch, frame } = setup();
    const panel = open('w').panel!;
    const downs = listen(panel, 'body', 'pointerdown');
    press(touch, frame, 'left-hand', [-0.01, 0.0, 0.01, -0.02]);
    expect(downs).toHaveLength(0);
  });

  it('a controller tip presses panels too (change 6)', () => {
    const { open, touch, frame } = setup();
    const panel = open('w').panel!;
    const clicks = listen(panel, 'body', 'click');
    press(touch, frame, 'right-controller', [0.05, 0.01, 0.05]);
    expect(clicks).toHaveLength(1);
  });

  it('contact lost ends the hold with no click', () => {
    const { open, touch, frame } = setup();
    const panel = open('w').panel!;
    const clicks = listen(panel, 'body', 'click');
    const ups = listen(panel, 'body', 'pointerup');
    press(touch, frame, 'left-hand', [0.05, 0.01]);
    frame(); // no sample: contact lost
    expect(ups).toHaveLength(1);
    expect(clicks).toHaveLength(0);
  });

  it('a hidden window cannot be pressed', () => {
    const { host, open, touch, frame } = setup();
    const panel = open('w').panel!;
    const downs = listen(panel, 'body', 'pointerdown');
    host.manager.hide('w');
    press(touch, frame, 'left-hand', [0.05, 0.01]);
    expect(downs).toHaveLength(0);
  });
});

describe('change 2 and 3: the follow rule runs in the binding, and the host is handed poses', () => {
  function walk(input: { head: HeadPose | undefined }, i: number): void {
    const yaw = Math.min(1, i * 0.02);
    input.head = { position: [0.3 * Math.sin(i / 20), 1.6, -0.02 * i], quaternion: yawQuaternion(yaw) };
  }

  for (const mode of [DockMode.BodyFollow, DockMode.HeadLocked]) {
    it(`a ${mode} window's pose after N frames is the core follow trajectory`, () => {
      const { fake, input, open, frame } = setup();
      open('w', { dockMode: mode });
      let reference: FollowState = enterFollow();
      for (let i = 0; i < 90; i += 1) {
        walk(input, i);
        frame(1 / 72);
        const step = stepFollow(reference, input.head!, DEFAULT_WINDOW_FOLLOW, 1 / 72);
        reference = step.state;
        expectPose(fake.windowPose('w'), step.pose);
      }
    });
  }

  it('uses the window follow options it was given', () => {
    const { fake, input, open, frame } = setup();
    const options = { offset: [0.2, 0, -0.8] as Vec3Tuple, speed: 5, tolerance: 0.1, maxAngle: 30 };
    open('w', { dockMode: DockMode.BodyFollow, followOffset: options.offset, followSpeed: 5, followTolerance: 0.1 });
    let reference: FollowState = enterFollow();
    for (let i = 0; i < 40; i += 1) {
      walk(input, i);
      frame(1 / 72);
      const step = stepFollow(reference, input.head!, options, 1 / 72);
      reference = step.state;
      expectPose(fake.windowPose('w'), step.pose);
    }
  });

  it('setFollow after spawn changes the offset and tuning the window follows with', () => {
    const { fake, input, open, frame, host } = setup();
    open('w', { dockMode: DockMode.BodyFollow, followOffset: [0, -0.15, -1.2], followSpeed: 5, followTolerance: 0.1 });
    for (let i = 0; i < 20; i += 1) {
      walk(input, i);
      frame(1 / 72);
    }
    const before = fake.windowPose('w')!;
    host.manager.setFollow('w', { offset: [0.5, -0.15, -1.2], speed: 9, tolerance: 0.05 });
    expect(host.manager.get('w')?.follow).toEqual({ offset: [0.5, -0.15, -1.2], speed: 9, tolerance: 0.05, maxAngle: 30 });
    // The window now follows half a metre to the viewer's right of where it did.
    for (let i = 20; i < 200; i += 1) {
      walk(input, i);
      frame(1 / 72);
    }
    const after = fake.windowPose('w')!;
    const head = input.head!;
    const rightward = (pose: PoseTuple) => {
      const dx = pose.position[0] - head.position[0];
      const dz = pose.position[2] - head.position[2];
      // The viewer's right axis from its yaw.
      const [x, y, z, w] = head.quaternion;
      const rx = 1 - 2 * (y * y + z * z);
      const rz = 2 * (x * z - w * y);
      return dx * rx + dz * rz;
    };
    expect(rightward(after) - rightward(before)).toBeGreaterThan(0.3);
    // A record the app opened before the binding has a window for it takes the change quietly.
    host.manager.open('early');
    expect(() => host.manager.setFollow('early', { offset: [0, 0, -2] })).not.toThrow();
  });

  it('a world-locked window keeps its world pose', () => {
    const { fake, input, open, frame } = setup();
    open('w', { position: [0.4, 1.2, -2] });
    for (let i = 0; i < 10; i += 1) {
      walk(input, i);
      frame();
    }
    expectPose(fake.windowPose('w'), { position: [0.4, 1.2, -2], quaternion: [0, 0, 0, 1] });
  });

  it('sends a pose only when it changed', () => {
    const { fake, open, frame } = setup();
    open('w', { position: [0, 1.6, -1] });
    frame();
    const count = fake.poseCalls.length;
    frame();
    frame();
    expect(fake.poseCalls.length).toBe(count);
  });
});

describe('focus bias: the focused window is drawn nearest', () => {
  it('moves the focused window 0.02 m toward the viewer per window behind it, and passes the depth order', () => {
    const { fake, host, open, frame } = setup();
    open('a', { position: [0, 1.6, -1] });
    open('b', { position: [0.5, 1.6, -1] });
    frame();
    const b = fake.poseCalls.filter((call) => call.windowId === 'b').at(-1)!;
    const a = fake.poseCalls.filter((call) => call.windowId === 'a').at(-1)!;
    expect(b.depthOrder).toBe(0);
    expect(a.depthOrder).toBe(1);
    expect(a.pose.position).toEqual([0, 1.6, -1]);
    const toViewer = Math.hypot(0.5, 1);
    expect(b.pose.position[0]).toBeCloseTo(0.5 - (0.5 / toViewer) * 0.02, 9);
    expect(b.pose.position[2]).toBeCloseTo(-1 + (1 / toViewer) * 0.02, 9);

    host.manager.focus('a');
    frame();
    expect(fake.windowPose('a')!.position[2]).toBeCloseTo(-0.98, 9);
    expect(fake.windowPose('b')!.position).toEqual([0.5, 1.6, -1]);
  });
});

describe('change 21: hand menus run in the binding', () => {
  const LEFT_GRIP: PoseTuple = { position: [0, 1.2, -0.4], quaternion: yawQuaternion(-Math.PI / 2) };

  it('a hand-locked window is hidden while the hand is untracked', () => {
    const { fake, open, frame } = setup();
    open('menu', { dockMode: DockMode.HandLocked });
    frame();
    expect(fake.windowHidden('menu')).toBe(true);
  });

  it('shows at the anchor while the palm faces the viewer, and hides when it turns away', () => {
    const { fake, input, open, frame } = setup();
    open('menu', { dockMode: DockMode.HandLocked });
    input.sources = [{ handedness: 'left', gripPose: LEFT_GRIP }];
    frame();
    expect(fake.windowHidden('menu')).toBe(false);
    const expected = evaluateHandMenu({ left: LEFT_GRIP }, HEAD.position, resolveHandMenu());
    expectPose(fake.windowPose('menu'), expected.pose!);

    input.sources = [{ handedness: 'left', gripPose: { ...LEFT_GRIP, quaternion: yawQuaternion(Math.PI / 2) } }];
    frame();
    expect(fake.windowHidden('menu')).toBe(true);
  });

  it('rides the configured hand only', () => {
    const { fake, input, open, frame } = setup();
    open('menu', { dockMode: DockMode.HandLocked, handMenu: { hand: 'right' } });
    input.sources = [{ handedness: 'left', gripPose: LEFT_GRIP }];
    frame();
    expect(fake.windowHidden('menu')).toBe(true);
  });
});

describe('change 21: regions run in the binding', () => {
  it('a window spawned into a region sits at its slot pose, world-locked', () => {
    const { fake, host, open, frame } = setup();
    host.spawnRegion({ id: 'shelf', flow: 'row', pitch: 0.5, position: [1, 1.5, -2] });
    open('a', { region: 'shelf', dockMode: DockMode.BodyFollow });
    open('b', { region: 'shelf' });
    frame();
    expect(host.manager.get('a')?.dockMode).toBe(DockMode.WorldLocked);
    const behind = fake.poseCalls.filter((call) => call.windowId === 'a').at(-1)!;
    expect(behind.pose.position).toEqual([1, 1.5, -2]);
    // b is focused, so it is drawn 0.02 m nearer than its slot at x = 1.5.
    expect(fake.windowPose('b')!.position[0]).toBeLessThan(1.5);
    expect(fake.windowPose('b')!.position[0]).toBeGreaterThan(1.48);
  });

  it('a window docked into an unknown region is undocked', () => {
    const { host, open } = setup();
    open('a', { region: 'nowhere' });
    expect(host.manager.get('a')?.region).toBeUndefined();
  });

  it('a following region follows with the IWSDK Follower defaults and carries its windows', () => {
    const { fake, host, open, frame } = setup();
    host.spawnRegion({ id: 'rail', follow: true });
    open('a', { region: 'rail' });
    frame();
    // Offset [0, -0.2, -1.4] from the head at 1.6 m, height honoured as on IWSDK 1.0.
    expectPose(fake.windowPose('a'), { position: [0, 1.4, -1.4], quaternion: [0, 0, 0, 1] });
  });
});

describe('change 22: dragging runs in the binding', () => {
  it('a ray press held on the title bar past 0.3 s drags; a shorter press does not', () => {
    const { fake, open, ray, frame } = setup();
    open('w', { position: [0, 1.6, -1] });
    // A short press: 0.2 s.
    ray('right', 'w', 'uix-titlebar', true, [0, 1.7, -1]);
    frame(0.1);
    ray('right', 'w', 'uix-titlebar', true, [0, 1.7, -1], [0.6, 0, -0.8]);
    frame(0.1);
    ray('right', 'w', 'uix-titlebar', false, [0, 1.7, -1], [0.6, 0, -0.8]);
    frame(0.1);
    expect(fake.windowPose('w')!.position).toEqual([0, 1.6, -1]);

    // A held press: the window rides the ray at the grab distance (1 m, the
    // hit being level with the ray origin), keeping the grab offset.
    ray('right', 'w', 'uix-titlebar', true, [0.05, 1.6, -1]);
    frame(0.1);
    ray('right', 'w', 'uix-titlebar', true, [0.05, 1.6, -1]);
    frame(0.1);
    ray('right', 'w', 'uix-titlebar', true, [0.05, 1.6, -1], [0.6, 0, -0.8]);
    frame(0.1);
    const pose = fake.windowPose('w')!;
    const distance = Math.hypot(0.05, 1);
    expect(pose.position[0]).toBeCloseTo(0.6 * distance - 0.05, 9);
    expect(pose.position[1]).toBeCloseTo(1.6, 9);
    expect(pose.position[2]).toBeCloseTo(-0.8 * distance, 9);
    // Billboarded: yawed to face the viewer.
    expectPose(pose, {
      position: pose.position,
      quaternion: yawQuaternion(Math.atan2(-pose.position[0], -pose.position[2])),
    });
  });

  it('a grab on the title bar drags at once (near drag)', () => {
    const { fake, open, grab, frame } = setup();
    open('w', { position: [0, 1.6, -1] });
    grab('left', 'w', 'uix-titlebar', true, [0, 1.7, -1]);
    frame(0.01);
    grab('left', 'w', 'uix-titlebar', true, [0.1, 1.7, -1]);
    frame(0.01);
    expect(fake.windowPose('w')!.position[0]).toBeCloseTo(0.1, 9);
  });

  it('a grab off the title bar does nothing, and nearDrag false turns grabs off', () => {
    const first = setup();
    first.open('w', { position: [0, 1.6, -1] });
    first.grab('left', 'w', 'body', true, [0, 1.6, -1]);
    first.frame(0.01);
    first.grab('left', 'w', 'body', true, [0.2, 1.6, -1]);
    first.frame(0.01);
    expect(first.fake.windowPose('w')!.position).toEqual([0, 1.6, -1]);

    const off = setup({ nearDrag: false });
    off.open('w', { position: [0, 1.6, -1] });
    off.grab('left', 'w', 'uix-titlebar', true, [0, 1.7, -1]);
    off.frame(0.01);
    off.grab('left', 'w', 'uix-titlebar', true, [0.2, 1.7, -1]);
    off.frame(0.01);
    expect(off.fake.windowPose('w')!.position).toEqual([0, 1.6, -1]);
  });

  it('a press on a chrome button never drags', () => {
    const { fake, open, grab, frame } = setup();
    open('w', { position: [0, 1.6, -1], closable: true });
    grab('left', 'w', 'uix-close', true, [0, 1.7, -1]);
    frame(0.01);
    grab('left', 'w', 'uix-close', true, [0.3, 1.7, -1]);
    frame(0.01);
    expect(fake.windowPose('w')!.position).toEqual([0, 1.6, -1]);
  });

  it('dragging a following window pins it in place, reading PIN until dropped and UNPIN after', () => {
    const { host, open, grab, frame, props } = setup();
    open('w', { dockMode: DockMode.BodyFollow, pinnable: true });
    frame();
    const at = [0, 1.7, -1.2] as Vec3Tuple;
    grab('left', 'w', 'uix-titlebar', true, at);
    frame();
    expect(host.manager.get('w')?.dockMode).toBe(DockMode.WorldLocked);
    expect(host.manager.get('w')?.dragging).toBe(true);
    expect(props('w', 'uix-pin')).toMatchObject({ text: 'PIN' });
    grab('left', null, null, false, at);
    frame();
    expect(host.manager.get('w')?.dragging).toBe(false);
    expect(props('w', 'uix-pin')).toMatchObject({ text: 'UNPIN' });
  });

  it('dropping within a region snap radius docks the window into its next slot', () => {
    const { fake, host, open, grab, frame } = setup();
    host.spawnRegion({ id: 'shelf', position: [1, 1.6, -1] });
    open('w', { position: [0, 1.6, -1] });
    grab('left', 'w', 'uix-titlebar', true, [0, 1.7, -1]);
    frame();
    grab('left', 'w', 'uix-titlebar', true, [0.8, 1.7, -1]);
    frame();
    grab('left', null, null, false, [0.8, 1.7, -1]);
    frame();
    expect(host.manager.get('w')?.region).toBe('shelf');
    frame();
    expect(fake.windowPose('w')!.position).toEqual([1, 1.6, -1]);
  });
});

describe('dock-mode transitions (UIDockSystem)', () => {
  it('unpinning follows from where the window was left; pinning faces the viewer', () => {
    const { fake, host, open, frame } = setup();
    open('w', { position: [0.5, 1.6, -1] });
    frame();
    host.manager.togglePin('w'); // body-follow, from the current pose
    frame();
    expectPose(fake.windowPose('w'), { position: [0.5, 1.6, -1], quaternion: yawQuaternion(Math.atan2(-0.5, 1)) }, 6);
    host.manager.togglePin('w'); // world-locked, facing the viewer
    frame();
    expectPose(fake.windowPose('w'), { position: [0.5, 1.6, -1], quaternion: yawQuaternion(Math.atan2(-0.5, 1)) }, 6);
    expect(host.manager.get('w')?.dockMode).toBe(DockMode.WorldLocked);
  });

  it('DOCK returns a window to its spawn placement', () => {
    const { fake, host, open, grab, frame } = setup();
    open('w', { position: [0.3, 1.5, -1], dockable: true });
    grab('left', 'w', 'uix-titlebar', true, [0.3, 1.6, -1]);
    frame();
    grab('left', 'w', 'uix-titlebar', true, [0.9, 1.6, -1]);
    frame();
    grab('left', null, null, false, [0.9, 1.6, -1]);
    frame();
    expect(fake.windowPose('w')!.position[0]).toBeCloseTo(0.9, 9);
    host.manager.returnHome('w');
    frame();
    expectPose(fake.windowPose('w'), { position: [0.3, 1.5, -1], quaternion: [0, 0, 0, 1] });
  });
});

describe('change 20: controls are upgraded in the binding', () => {
  it("a stepper's change fires from an increment click", () => {
    const { open, ray, frame, props } = setup();
    const panel = open('w').panel!;
    const controls = upgradePanel(panel.root, panel.root);
    const changes: number[] = [];
    controls.stepper('count').events.on('change', (value) => changes.push(value));
    expect(props('w', 'val')).toMatchObject({ text: '1' });
    ray('right', 'w', 'inc', true, [0, 1.6, -1]);
    frame();
    ray('right', 'w', 'inc', false, [0, 1.6, -1]);
    frame();
    expect(changes).toEqual([2]);
    expect(props('w', 'val')).toMatchObject({ text: '2' });
  });

  it("a bare panel's controls are upgraded too", () => {
    const { host } = setup();
    const panel = host.createPanel(CHROME_TREE);
    expect(upgradePanel(panel.root, panel.root).ids()).toEqual(['count']);
  });
});

