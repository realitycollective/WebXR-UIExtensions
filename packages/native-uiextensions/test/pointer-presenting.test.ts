/**
 * Who draws the pointers on a native host. IWSDK draws every hand's ray and
 * cursor itself, so an app with windows and no interactables shows where it
 * points. A native host draws only what it is told, so the window host tells
 * it while it owns the pointer arbiter, and leaves it to the Interactions
 * binding when the arbiter is shared (the core rule in `pointer-offers.ts`).
 */
import { describe, expect, it } from 'vitest';
import { POINTER_DISPLAY_DEFAULTS, PointerArbiter, PointerDisplay, type PointerDisplayConfig } from '@realitycollective/webxr-input';
import { NativeWindowHost, WINDOW_CHROME_IDS, type NativeWindowHostOptions, type PresentedPointer } from '@realitycollective/native-uiextensions';
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

interface InputParts {
  visuals?: boolean;
  display?: boolean;
}

/** A window host over a fake `ui` slice and an `input` slice that records what it is told to draw. */
function rig(options: Partial<NativeWindowHostOptions> = {}, parts: InputParts = { visuals: true, display: true }) {
  const fake = createFakeNativeUiHost();
  const drawn: Array<[string, PresentedPointer]> = [];
  const displays: PointerDisplayConfig[] = [];
  const input: NativeUiInputHost = {
    getHeadPose: () => HEAD,
    sample: () => [] as NativeUiInputSource[],
    ...(parts.visuals ? { applyPointerVisuals: (sourceId: string, visuals: PresentedPointer) => void drawn.push([sourceId, visuals]) } : {}),
    ...(parts.display ? { applyPointerDisplay: (config: PointerDisplayConfig) => void displays.push(config) } : {}),
  };
  const host = new NativeWindowHost({ host: fake, input, ...options });
  host.createWindow({ id: 'w', config: TREE });
  fake.readyWindow('w', 'panel-w', TREE);
  const body = fake.handleOf('panel-w', 'body');
  const ray = (sourceId: string, active: boolean, onPanel = true, point: Vec3Tuple = [0, 1.6, -1]) =>
    fake.pointer({ sourceId, pointer: 'ray', panelId: onPanel ? 'panel-w' : null, elementHandle: onPanel ? body : null, point: onPanel ? point : null, ray: { origin: [0, 1.6, 0], direction: [0, 0, -1] }, active });
  const touch = (sourceId: string, signedDistance: number) =>
    fake.pointer({ sourceId, pointer: 'touch', panelId: 'panel-w', elementHandle: body, point: [0, 1.6, -1], signedDistance });
  const grab = (sourceId: string) => fake.pointer({ sourceId, pointer: 'grab', panelId: 'panel-w', elementHandle: fake.handleOf('panel-w', WINDOW_CHROME_IDS.titlebar), point: [0, 1.5, -0.9], active: false });
  const frame = (): Array<[string, PresentedPointer]> => {
    drawn.length = 0;
    host.update(1 / 72);
    return [...drawn];
  };
  return { fake, host, drawn, displays, ray, touch, grab, frame };
}

describe('native window host presenting the pointers', () => {
  it('owning the arbiter, tells the host the ray and the cursor on the panel for each source, every frame', () => {
    const r = rig();
    r.ray('right-controller', false);
    const first = r.frame();
    expect(first).toHaveLength(1);
    const [sourceId, shown] = first[0]!;
    expect(sourceId).toBe('right-controller');
    expect(shown).toMatchObject({ sourceId: 'right-controller', ray: true, cursor: true, cursorPoint: [0, 1.6, -1], activePointer: 'ray', targetKind: 'panel', targetId: 'panel-w', hitDistance: 1 });
    expect(shown.rayColor).toEqual([...POINTER_DISPLAY_DEFAULTS.rayColor]);
    expect(shown.rayTo).toBeGreaterThan(shown.rayFrom);
    // The same source again next frame: told again, so a host that draws per frame needs no memory.
    r.ray('right-controller', false);
    expect(r.frame()).toHaveLength(1);
  });

  it('a pressing pointer takes its selected look', () => {
    const r = rig();
    r.ray('right-controller', false);
    r.frame();
    r.ray('right-controller', true);
    const [, pressed] = r.frame()[0]!;
    expect(pressed.rayColor).toEqual([...POINTER_DISPLAY_DEFAULTS.raySelectedColor]);
    expect(pressed.cursorOpacity).toBe(POINTER_DISPLAY_DEFAULTS.cursorSelectedOpacity);
  });

  it('a ray that reaches no panel draws no cursor, and no ray under the default "only while it hits" setting', () => {
    const r = rig();
    r.ray('left-hand', false, false);
    const [, shown] = r.frame()[0]!;
    expect(shown).toMatchObject({ ray: false, cursor: false, cursorPoint: null, activePointer: null, targetKind: null, targetId: null, hitDistance: null });
  });

  it('a fingertip on the panel puts the cursor there and retires the ray, as IWSDK does', () => {
    const r = rig();
    r.ray('right-hand', false);
    r.touch('right-hand', 0.01);
    const shown = r.frame();
    expect(shown).toHaveLength(1);
    expect(shown[0]![1]).toMatchObject({ activePointer: 'touch', ray: false, cursor: true, cursorPoint: [0, 1.6, -1], targetKind: 'panel' });
    // The fingertip leaves, the ray stays: the touch pointer is gone but the source is still presented once, from its ray.
    r.ray('right-hand', false);
    const next = r.frame();
    expect(next).toHaveLength(1);
    expect(next[0]![1]).toMatchObject({ activePointer: 'ray', ray: true });
  });

  it('a touch alone carries no ray', () => {
    const r = rig();
    r.touch('right-hand', 0.01);
    expect(r.frame()[0]![1]).toMatchObject({ ray: false, cursor: true, activePointer: 'touch' });
  });

  it('a source that stops reporting is told once more, with nothing to draw, and then never again', () => {
    const r = rig();
    r.ray('right-controller', false);
    r.frame();
    const gone = r.frame();
    expect(gone).toHaveLength(1);
    expect(gone[0]![0]).toBe('right-controller');
    expect(gone[0]![1]).toMatchObject({ ray: false, cursor: false, cursorPoint: null });
    expect(r.frame()).toEqual([]);
  });

  it('a pointer kind the app switched off is not presented', () => {
    const r = rig({ nearDrag: false });
    r.grab('right-hand');
    expect(r.frame()).toEqual([]);
  });

  it('with a shared arbiter it presents nothing and hands over no settings: the Interactions binding does', () => {
    const r = rig({ pointers: new PointerArbiter(), pointerDisplay: { ray: 'always' } });
    r.ray('right-controller', false);
    expect(r.frame()).toEqual([]);
    expect(r.displays).toEqual([]);
  });

  it('a host with no applyPointerVisuals, or no input slice at all, is left alone', () => {
    const silent = rig({}, {});
    silent.ray('right-controller', false);
    expect(() => silent.frame()).not.toThrow();
    expect(silent.displays).toEqual([]);

    const fake = createFakeNativeUiHost();
    const bare = new NativeWindowHost({ host: fake });
    bare.createWindow({ id: 'w', config: TREE });
    fake.readyWindow('w', 'panel-w', TREE);
    fake.pointer({ sourceId: 'right-controller', pointer: 'ray', panelId: 'panel-w', elementHandle: fake.handleOf('panel-w', 'body'), point: [0, 1.6, -1], ray: { origin: [0, 1.6, 0], direction: [0, 0, -1] }, active: false });
    expect(() => bare.update(1 / 72)).not.toThrow();
  });

  it("the app's pointer display settings shape what is presented, and reach a host that keeps them, at creation and on every change", () => {
    const r = rig({ pointerDisplay: { ray: 'always' } });
    expect(r.displays).toHaveLength(1);
    expect(r.displays[0]!.ray).toBe('always');
    // "always": a ray that reaches nothing is still drawn.
    r.ray('left-hand', false, false);
    expect(r.frame()[0]![1].ray).toBe(true);
    // The app changes a setting at run time: the host is told, and the next drawing follows it.
    r.host.getPointerDisplay().set({ cursorOnPanels: false });
    expect(r.displays).toHaveLength(2);
    expect(r.displays[1]!.cursorOnPanels).toBe(false);
    r.ray('left-hand', false);
    expect(r.frame()[0]![1].cursor).toBe(false);
    // After dispose the host hears no more.
    r.host.dispose();
    r.host.getPointerDisplay().set({ ray: 'never' });
    expect(r.displays).toHaveLength(2);
  });

  it('takes a PointerDisplay the app keeps, so one object can drive the look everywhere', () => {
    const display = new PointerDisplay({ ray: 'never' });
    const r = rig({ pointerDisplay: display });
    expect(r.host.getPointerDisplay()).toBe(display);
    r.ray('right-controller', false);
    expect(r.frame()[0]![1]).toMatchObject({ ray: false, cursor: true });
  });
});
