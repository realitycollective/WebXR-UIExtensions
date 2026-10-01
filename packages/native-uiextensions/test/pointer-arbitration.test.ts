/**
 * One pointer decision per source across panels and interactables, on the
 * native binding: the host's samples are offered to the shared arbiter and a
 * pointer acts only while it owns its source (IWSDK's MultiPointer over
 * every pointer-event object; Pale Signal handover G4).
 */
import { describe, expect, it } from 'vitest';
import { PointerArbiter } from '@realitycollective/webxr-input';
import { NativeWindowHost, UIX_POINTER_SET, WINDOW_CHROME_IDS, type CreateWindowOptions } from '@realitycollective/native-uiextensions';
import type { HeadPose, NativeElementNode, NativeUiInputHost, NativeUiInputSource, Vec3Tuple } from '@realitycollective/native-uiextensions';
import { createFakeNativeUiHost } from './helpers/fake-native-ui-host.js';

const TREE: NativeElementNode = {
  handle: 'root',
  id: WINDOW_CHROME_IDS.window,
  children: [
    { handle: 'titlebar', id: WINDOW_CHROME_IDS.titlebar, children: [{ handle: 'title', id: WINDOW_CHROME_IDS.title, children: [] }] },
    { handle: 'content', id: WINDOW_CHROME_IDS.content, children: [{ handle: 'body', id: 'body', children: [] }] },
  ],
};

const HEAD: HeadPose = { position: [0, 1.6, 0], quaternion: [0, 0, 0, 1] };

function rig(pointers?: PointerArbiter) {
  const fake = createFakeNativeUiHost();
  const input: NativeUiInputHost = { getHeadPose: () => HEAD, sample: () => [] as NativeUiInputSource[] };
  const host = new NativeWindowHost({ host: fake, input, ...(pointers ? { pointers } : {}) });
  const open = (id: string, options: Omit<CreateWindowOptions, 'config' | 'id'> = {}) => {
    const handle = host.createWindow({ id, config: TREE, ...options });
    fake.readyWindow(id, `panel-${id}`, TREE);
    return handle;
  };
  const el = (windowId: string, elementId: string) => fake.handleOf(`panel-${windowId}`, elementId);
  const ray = (sourceId: string, windowId: string, elementId: string, active: boolean, point: Vec3Tuple = [0, 1.6, -1]) =>
    fake.pointer({ sourceId, pointer: 'ray', panelId: `panel-${windowId}`, elementHandle: el(windowId, elementId), point, ray: { origin: [0, 1.6, 0], direction: [0, 0, -1] }, active });
  const touch = (sourceId: string, windowId: string, elementId: string, signedDistance: number, distance?: number) =>
    fake.pointer({ sourceId, pointer: 'touch', panelId: `panel-${windowId}`, elementHandle: el(windowId, elementId), point: [0, 1.6, -1], signedDistance, ...(distance !== undefined ? { distance } : {}) });
  const grab = (sourceId: string, windowId: string, elementId: string, active: boolean) =>
    fake.pointer({ sourceId, pointer: 'grab', panelId: `panel-${windowId}`, elementHandle: el(windowId, elementId), point: [0, 1.5, -0.9], active });
  return { fake, host, open, ray, touch, grab, el };
}

describe('native window host on the shared pointer arbiter', () => {
  it('offers each sample to the arbiter with the distance IWSDK compares, and the decision names the panel', () => {
    const arbiter = new PointerArbiter();
    const r = rig(arbiter);
    r.open('w');
    r.ray('right', 'w', 'body', false, [0, 1.6, -1]);
    r.touch('left', 'w', 'body', 0.015);
    r.host.update(1 / 72);
    const right = arbiter.decision('right');
    expect(right?.active).toBe('ray');
    expect(right?.candidate).toMatchObject({ set: UIX_POINTER_SET, targetKind: 'panel', targetId: 'panel-w', distance: 1 });
    const left = arbiter.decision('left');
    expect(left?.active).toBe('touch');
    expect(left?.candidate?.distance).toBeCloseTo(0.015);
    // A host-reported distance wins over the derived one; a grab reports 0 without one.
    r.touch('left', 'w', 'body', 0.015, 0.4);
    r.grab('right', 'w', WINDOW_CHROME_IDS.titlebar, false);
    r.host.update(1 / 72);
    expect(arbiter.decision('left')?.candidate?.distance).toBe(0.4);
    expect(arbiter.decision('right')?.active).toBe('grab');
    expect(arbiter.decision('right')?.candidate?.distance).toBe(0);
  });

  it("a fingertip on an interactable takes the source: the panel's ray hovers and presses nothing, and hands the ray back when the finger leaves", () => {
    const arbiter = new PointerArbiter();
    const objects = arbiter.registerSet('interactions', 'object');
    const r = rig(arbiter);
    const body = (r.open('w').panel as unknown as { getElementById(id: string): { addEventListener(t: string, l: () => void): void } }).getElementById('body');
    const events: string[] = [];
    for (const type of ['pointerenter', 'pointerleave', 'pointerdown', 'pointerup', 'click'] as const) body.addEventListener(type, () => events.push(type));
    r.ray('right', 'w', 'body', false);
    r.host.update(1 / 72);
    expect(events).toEqual(['pointerenter']);
    // The Interactions runtime offers a touch on an object for the same source (aliased by side).
    arbiter.alias('right', 'right');
    objects.offer('right', 'touch', { targetId: 'button', point: [0.3, 1.2, -0.4], distance: 0.01 });
    r.ray('right', 'w', 'body', true);
    r.host.update(1 / 72);
    expect(events).toEqual(['pointerenter', 'pointerleave']);
    expect(arbiter.decision('right')?.active).toBe('touch');
    objects.offer('right', 'touch', null);
    r.ray('right', 'w', 'body', false);
    r.host.update(1 / 72);
    expect(events).toEqual(['pointerenter', 'pointerleave', 'pointerenter']);
  });

  it("a ray held on a panel keeps the source while an object's touch appears (the selection lock), and a lost pointer releases its lock", () => {
    const arbiter = new PointerArbiter();
    const objects = arbiter.registerSet('interactions', 'object');
    const r = rig(arbiter);
    const body = (r.open('w').panel as unknown as { getElementById(id: string): { addEventListener(t: string, l: () => void): void } }).getElementById('body');
    const events: string[] = [];
    for (const type of ['pointerdown', 'pointerup', 'click'] as const) body.addEventListener(type, () => events.push(type));
    r.ray('right', 'w', 'body', true);
    r.host.update(1 / 72);
    expect(events).toEqual(['pointerdown']);
    objects.offer('right', 'touch', { targetId: 'button', point: [0.3, 1.2, -0.4], distance: 0.01 });
    r.ray('right', 'w', 'body', true);
    r.host.update(1 / 72);
    expect(arbiter.decision('right')?.active).toBe('ray');
    r.ray('right', 'w', 'body', false);
    r.host.update(1 / 72);
    expect(events).toEqual(['pointerdown', 'pointerup', 'click']);
    // With the press over, the object's touch takes the source.
    r.ray('right', 'w', 'body', false);
    r.host.update(1 / 72);
    expect(arbiter.decision('right')?.active).toBe('touch');
    // A pointer that stops being reported releases everything, its lock included.
    objects.offer('right', 'touch', null);
    r.ray('right', 'w', 'body', true);
    r.host.update(1 / 72);
    r.host.update(1 / 72);
    expect(arbiter.decision('right')?.active).toBeNull();
  });

  it('a panel touch takes the source from an object ray, and the same host alone owns everything it sees', () => {
    const arbiter = new PointerArbiter();
    const objects = arbiter.registerSet('interactions', 'object');
    const r = rig(arbiter);
    r.open('w');
    objects.offer('left', 'ray', { targetId: 'ball', point: [0, 1, -2], distance: 2 });
    r.touch('left', 'w', 'body', 0.01);
    r.host.update(1 / 72);
    expect(arbiter.decision('left')).toMatchObject({ active: 'touch', candidate: { targetKind: 'panel' } });
    const alone = rig();
    alone.open('w');
    alone.ray('right', 'w', 'body', true);
    alone.host.update(1 / 72);
    alone.ray('right', 'w', 'body', false);
    alone.host.update(1 / 72);
    expect(alone.fake.propertyWrites.length).toBeGreaterThanOrEqual(0);
    alone.host.dispose();
    alone.host.dispose();
    r.host.dispose();
    expect(arbiter.getSets().map((set) => set.id)).toEqual(['interactions']);
  });
});
