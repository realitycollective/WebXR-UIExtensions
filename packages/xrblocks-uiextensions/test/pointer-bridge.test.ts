/**
 * Proves XR Blocks runs the IWSDK pointer rules: touch press,
 * controller poke, ray click on release, hover, title-bar drag (ray and
 * grab), billboard while dragging, drop capture, focus bias and a per-window
 * drag delay - each rule by rule, mirroring
 * `native-uiextensions/test/binding-rules.test.ts`.
 *
 * XR Blocks itself is not run here (no browser, no real controllers). These
 * tests call the bridge's attached methods directly - `onSelectStart`,
 * `onObjectTouching`, `onHoverEnter` and so on - the same way the real SDK
 * calls them on the object it decided is involved (see `xrblocks.d.ts` and
 * `pointer-bridge.ts`'s own doc comment for the documented contract this
 * fakes). That is the kind of fake this repository already uses for a host
 * it cannot run either (`fake-native-ui-host.ts`): built to behave as a
 * CORRECT XR Blocks would, from its published type declarations.
 */
import { parse } from '@pmndrs/uikitml';
import { Group, Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FOCUS_BIAS,
  DockMode,
  applyFocusBias,
  beginDrag,
  dragPosition,
  focusBiasAmount,
  intersectRayPlane,
  type HeadPoseSource,
  type Vec3Tuple,
} from '@realitycollective/webxr-uiextensions';
import { UixWindowHost } from '../src/host.js';
import { worldForwardOf, worldPositionOf, type XrBlocksController } from '../src/pointer-bridge.js';
import type { XrBlocksRayInputAccess } from '../src/ray-input.js';

const PANEL_SOURCE = `
<div id="uix-window">
  <div id="uix-titlebar">
    <text id="uix-title">t</text>
    <div id="uix-pin">PIN</div>
    <div id="uix-dock">DOCK</div>
    <div id="uix-minimize">MIN</div>
    <div id="uix-close">X</div>
  </div>
  <div id="uix-content"><text id="body">body</text></div>
</div>
`;

const config = () => parse(PANEL_SOURCE);

const STATIC_HEAD: HeadPoseSource = {
  getHeadPose: () => ({ position: [0, 1.6, 0], quaternion: [0, 0, 0, 1] }),
};

function headAt(position: [number, number, number]): HeadPoseSource {
  return { getHeadPose: () => ({ position, quaternion: [0, 0, 0, 1] }) };
}

/** Every XR Blocks callback the bridge attaches, as the SDK would call them. */
interface Bridged {
  onSelectStart(event: { target: XrBlocksController }): boolean;
  onSelectEnd(): boolean;
  onObjectGrabStart(event: { handIndex: number; hand: Object3D }): boolean;
  onObjectGrabEnd(): boolean;
  onObjectTouching(event: { handIndex: number; touchPosition: { x: number; y: number; z: number } }): boolean;
  onObjectTouchEnd(event: { handIndex: number; touchPosition: { x: number; y: number; z: number } }): boolean;
  onHoverEnter(): boolean;
  onHoverExit(): boolean;
}

function bridged(element: unknown): Bridged {
  return element as unknown as Bridged;
}

/** A fake XR Blocks `Controller`: an `Object3D` a test can move like a real one. */
function fakeController(position: [number, number, number] = [0, 0, 0]): XrBlocksController {
  const object = new Object3D();
  object.position.set(...position);
  object.updateMatrixWorld(true);
  return object;
}

function moveWorld(object: Object3D, position: [number, number, number]): void {
  object.position.set(...position);
  object.updateMatrixWorld(true);
}

function listen(element: unknown, type: string): unknown[] {
  const seen: unknown[] = [];
  (element as { addEventListener(t: string, l: (e?: unknown) => void): void }).addEventListener(type, (event) => seen.push(event));
  return seen;
}

function makeHost(headPose: HeadPoseSource = STATIC_HEAD, rayInput?: XrBlocksRayInputAccess) {
  const scene = new Group();
  const host = new UixWindowHost({ scene, headPose, ...(rayInput ? { rayInput } : {}) });
  return { scene, host };
}

/** A scriptable `xb.input` fake: `setRay` is this frame's ray for `controller`, read by `getFrame()` exactly as `xb.input.getFrame().raySources` would report it. */
function makeRayInput(): XrBlocksRayInputAccess & { setRay(controller: object, origin: Vec3Tuple, direction: Vec3Tuple): void; clear(): void } {
  let raySources: Array<{ controller: object; ray: { origin: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number } } }> = [];
  return {
    getFrame: () => ({ raySources }),
    setRay(controller, [ox, oy, oz], [dx, dy, dz]) {
      raySources = [{ controller, ray: { origin: { x: ox, y: oy, z: oz }, direction: { x: dx, y: dy, z: dz } } }];
    },
    clear() {
      raySources = [];
    },
  };
}

describe('touch and controller-tip press run through the core TouchPress', () => {
  it('a fingertip from the front presses once, and pushing through and back is one click', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config() });
    const body = handle.document.getElementById('body')!;
    const clicks = listen(body, 'click');
    const downs = listen(body, 'pointerdown');
    const b = bridged(body);
    for (const signedDistance of [0.05, 0.015, -0.02, 0.01, 0.025, 0.05]) {
      b.onObjectTouching({ handIndex: 0, touchPosition: { x: 0, y: 0, z: signedDistance } });
    }
    expect(downs).toHaveLength(1);
    expect(clicks).toHaveLength(1);
  });

  it('a tip first seen behind the panel never presses', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config() });
    const body = handle.document.getElementById('body')!;
    const downs = listen(body, 'pointerdown');
    const b = bridged(body);
    for (const signedDistance of [-0.01, 0.0, 0.01, -0.02]) {
      b.onObjectTouching({ handIndex: 0, touchPosition: { x: 0, y: 0, z: signedDistance } });
    }
    expect(downs).toHaveLength(0);
  });

  it('a controller tip (a different hand index) presses too', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config() });
    const body = handle.document.getElementById('body')!;
    const clicks = listen(body, 'click');
    const b = bridged(body);
    for (const signedDistance of [0.05, 0.01, 0.05]) {
      b.onObjectTouching({ handIndex: 1, touchPosition: { x: 0, y: 0, z: signedDistance } });
    }
    expect(clicks).toHaveLength(1);
  });

  it('losing contact (onObjectTouchEnd) ends a hold with no click', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config() });
    const body = handle.document.getElementById('body')!;
    const clicks = listen(body, 'click');
    const ups = listen(body, 'pointerup');
    const b = bridged(body);
    b.onObjectTouching({ handIndex: 0, touchPosition: { x: 0, y: 0, z: 0.05 } });
    b.onObjectTouching({ handIndex: 0, touchPosition: { x: 0, y: 0, z: 0.01 } });
    b.onObjectTouchEnd({ handIndex: 0, touchPosition: { x: 0, y: 0, z: 0.01 } });
    expect(ups).toHaveLength(1);
    expect(clicks).toHaveLength(0);
  });

  it('a hidden window cannot be pressed by touch', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config() });
    const body = handle.document.getElementById('body')!;
    const downs = listen(body, 'pointerdown');
    host.manager.hide('w');
    bridged(body).onObjectTouching({ handIndex: 0, touchPosition: { x: 0, y: 0, z: 0.05 } });
    expect(downs).toHaveLength(0);
  });
});

describe('a ray clicks on release, not on select-start (intersection)', () => {
  it('select-start presses; select-end releases and clicks', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config() });
    const body = bridged(handle.document.getElementById('body')!);
    const downs = listen(handle.document.getElementById('body'), 'pointerdown');
    const clicks = listen(handle.document.getElementById('body'), 'click');
    body.onSelectStart({ target: fakeController() });
    expect(downs).toHaveLength(1);
    expect(clicks).toHaveLength(0); // not yet - a real click-on-intersect defect would fire here
    body.onSelectEnd();
    expect(clicks).toHaveLength(1);
  });

  it('a press anywhere on the window focuses it', () => {
    const { host } = makeHost();
    const a = host.createWindow({ id: 'a', config: config() });
    host.createWindow({ id: 'b', config: config() });
    expect(host.manager.focused?.id).toBe('b');
    bridged(a.document.getElementById('body')!).onSelectStart({ target: fakeController() });
    expect(host.manager.focused?.id).toBe('a');
  });

  it('a hidden window cannot be selected', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config() });
    const body = handle.document.getElementById('body')!;
    const downs = listen(body, 'pointerdown');
    host.manager.hide('w');
    bridged(body).onSelectStart({ target: fakeController() });
    expect(downs).toHaveLength(0);
  });
});

describe('hover enter/leave reach the panel', () => {
  it('dispatches pointerenter and pointerleave', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config() });
    const body = handle.document.getElementById('body')!;
    const enters = listen(body, 'pointerenter');
    const leaves = listen(body, 'pointerleave');
    bridged(body).onHoverEnter();
    expect(enters).toHaveLength(1);
    bridged(body).onHoverExit();
    expect(leaves).toHaveLength(1);
  });

  it('a hidden window does not hover-enter', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config() });
    const body = handle.document.getElementById('body')!;
    const enters = listen(body, 'pointerenter');
    host.manager.hide('w');
    bridged(body).onHoverEnter();
    expect(enters).toHaveLength(0);
  });
});

describe('title-bar hold-to-drag (ray) and near drag (grab)', () => {
  it('a ray held past the default 0.3 s delay drags; a shorter press does not move the window', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1] });
    const titlebar = bridged(handle.document.getElementById('uix-titlebar')!);
    const controller = fakeController([0.05, 1.6, -1]);

    titlebar.onSelectStart({ target: controller });
    host.update(0.1);
    titlebar.onSelectEnd();
    host.update(0.1);
    expect(handle.group.position.toArray()).toEqual([0, 1.6, -1]);

    titlebar.onSelectStart({ target: controller });
    host.update(0.2);
    host.update(0.2); // past 0.3 s total
    // The window rides the controller's OWN movement (point-delta), keeping
    // the offset it was grabbed at: controller +0.35 in x -> window +0.35.
    moveWorld(controller, [0.4, 1.6, -1]);
    host.update(0.05);
    expect(handle.group.position.x).toBeCloseTo(0.35, 5);
    titlebar.onSelectEnd();
  });

  it('a per-window dragDelay begins the drag sooner', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1], dragDelay: 0.05 });
    const titlebar = bridged(handle.document.getElementById('uix-titlebar')!);
    const controller = fakeController([0, 1.6, -1]);
    titlebar.onSelectStart({ target: controller });
    host.update(0.06);
    moveWorld(controller, [0.3, 1.6, -1]);
    host.update(0.01);
    expect(handle.group.position.x).toBeCloseTo(0.3, 5);
  });

  it('a grab on the title bar drags at once (near drag)', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1] });
    const titlebar = bridged(handle.document.getElementById('uix-titlebar')!);
    const hand = fakeController([0, 1.7, -1]);
    titlebar.onObjectGrabStart({ handIndex: 0, hand });
    host.update(0.01);
    moveWorld(hand, [0.2, 1.7, -1]);
    host.update(0.01);
    expect(handle.group.position.x).toBeCloseTo(0.2, 5);
    titlebar.onObjectGrabEnd();
  });

  it('a grab off the title bar does nothing', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1] });
    const body = bridged(handle.document.getElementById('body')!);
    const hand = fakeController([0, 1.6, -1]);
    body.onObjectGrabStart({ handIndex: 0, hand });
    host.update(0.01);
    moveWorld(hand, [0.3, 1.6, -1]);
    host.update(0.01);
    expect(handle.group.position.toArray()).toEqual([0, 1.6, -1]);
  });

  it('a press on a chrome button never drags (it swallows its own press)', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1], closable: true });
    const close = bridged(handle.document.getElementById('uix-close')!);
    const hand = fakeController([0, 1.7, -1]);
    close.onObjectGrabStart({ handIndex: 0, hand });
    host.update(0.01);
    moveWorld(hand, [0.3, 1.7, -1]);
    host.update(0.01);
    expect(handle.group.position.toArray()).toEqual([0, 1.6, -1]);
  });

  it('movable: false never begins a title-bar drag', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1], movable: false });
    const titlebar = handle.document.getElementById('uix-titlebar');
    // No listener at all is registered for a non-movable window's title bar.
    const hand = fakeController([0, 1.7, -1]);
    bridged(titlebar!).onObjectGrabStart({ handIndex: 0, hand });
    host.update(0.01);
    moveWorld(hand, [0.3, 1.7, -1]);
    host.update(0.01);
    expect(handle.group.position.toArray()).toEqual([0, 1.6, -1]);
  });

  it('dropping within a region snap radius docks the window into it', () => {
    const { host } = makeHost();
    host.createRegion({ id: 'shelf', position: [1, 1.6, -1] });
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1] });
    const titlebar = bridged(handle.document.getElementById('uix-titlebar')!);
    const hand = fakeController([0, 1.7, -1]);
    titlebar.onObjectGrabStart({ handIndex: 0, hand });
    host.update(0.01);
    moveWorld(hand, [0.9, 1.7, -1]);
    host.update(0.01);
    titlebar.onObjectGrabEnd();
    host.update(0.01);
    expect(host.manager.get('w')?.region).toBe('shelf');
  });
});

describe('laser-distance math: a ray drag rides the ray, as IWSDK and native, not the controller position', () => {
  it('with rayInput wired, the window rides the ray at the grab distance, using the shared core beginDrag/dragPosition', () => {
    const rayInput = makeRayInput();
    const { host } = makeHost(STATIC_HEAD, rayInput);
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1] });
    const titlebarElement = handle.document.getElementById('uix-titlebar')!;
    const titlebar = bridged(titlebarElement);
    // The controller itself never moves in this test - only the RAY it
    // reports does. Point-delta math (the fallback with no rayInput) would
    // therefore show no movement at all; laser-distance math rides the ray.
    const controller = fakeController([5, 5, 5]);
    const rayOrigin: Vec3Tuple = [0, 1.6, 0];

    // The plane this binding intersects: the title bar's own world position
    // and forward normal, read the same way `beginTitlebarDrag` does.
    const planePoint = worldPositionOf(titlebarElement as unknown as Object3D);
    const planeNormal = worldForwardOf(titlebarElement as unknown as Object3D);
    const startDirection: Vec3Tuple = [0, 0, -1];

    rayInput.setRay(controller, rayOrigin, startDirection);
    titlebar.onSelectStart({ target: controller });
    host.update(0.2);
    host.update(0.2); // past the default 0.3 s delay - dragging now

    const grabPoint = intersectRayPlane(rayOrigin, startDirection, planePoint, planeNormal)!;
    expect(grabPoint).toBeDefined();
    const session = beginDrag(rayOrigin, grabPoint, [0, 1.6, -1]);

    const swungDirection: Vec3Tuple = [0.6, 0, -0.8]; // unit length, as native's own ray-drag test uses
    rayInput.setRay(controller, rayOrigin, swungDirection);
    host.update(0.05);

    const expected = dragPosition(session, rayOrigin, swungDirection);
    expect(handle.group.position.toArray()).not.toEqual([0, 1.6, -1]); // it did move
    expect(handle.group.position.x).toBeCloseTo(expected[0], 9);
    expect(handle.group.position.y).toBeCloseTo(expected[1], 9);
    expect(handle.group.position.z).toBeCloseTo(expected[2], 9);
    titlebar.onSelectEnd();
  });

  it('falls back to point-delta for a controller rayInput has no ray source for, even with rayInput wired', () => {
    const rayInput = makeRayInput(); // never given a ray for this controller
    const { host } = makeHost(STATIC_HEAD, rayInput);
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1] });
    const titlebar = bridged(handle.document.getElementById('uix-titlebar')!);
    const controller = fakeController([0.05, 1.6, -1]);
    titlebar.onSelectStart({ target: controller });
    host.update(0.2);
    host.update(0.2);
    moveWorld(controller, [0.4, 1.6, -1]);
    host.update(0.05);
    expect(handle.group.position.x).toBeCloseTo(0.35, 5); // same point-delta result as with no rayInput at all
  });
});

describe('billboard while dragging', () => {
  it('yaws to face the viewer while dragging, unless disabled', () => {
    const { host } = makeHost(headAt([0, 1.6, 0]));
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1] });
    const titlebar = bridged(handle.document.getElementById('uix-titlebar')!);
    const hand = fakeController([0, 1.7, -1]);
    titlebar.onObjectGrabStart({ handIndex: 0, hand });
    host.update(0.01);
    moveWorld(hand, [0.6, 1.7, -1]);
    host.update(0.01);
    expect(handle.group.quaternion.equals(new Quaternion(0, 0, 0, 1))).toBe(false);
  });

  it('billboardWhileDragging: false never turns the window', () => {
    const { host } = makeHost(headAt([0, 1.6, 0]));
    const handle = host.createWindow({
      id: 'w',
      config: config(),
      position: [0, 1.6, -1],
      billboardWhileDragging: false,
    });
    const titlebar = bridged(handle.document.getElementById('uix-titlebar')!);
    const hand = fakeController([0, 1.7, -1]);
    titlebar.onObjectGrabStart({ handIndex: 0, hand });
    host.update(0.01);
    moveWorld(hand, [0.6, 1.7, -1]);
    host.update(0.01);
    expect(handle.group.quaternion.equals(new Quaternion(0, 0, 0, 1))).toBe(true);
  });
});

describe('focus bias', () => {
  it('moves the focused window toward the viewer per window behind it', () => {
    const { host } = makeHost();
    const a = host.createWindow({ id: 'a', config: config(), position: [0, 1.6, -1] });
    const b = host.createWindow({ id: 'b', config: config(), position: [0.5, 1.6, -1] });
    host.update(1 / 60);
    // b is focused (opened last): drawn 0.02 m nearer than its placed pose.
    expect(b.group.position.z).toBeGreaterThan(-1);
    expect(a.group.position.toArray()).toEqual([0, 1.6, -1]);

    host.manager.focus('a');
    host.update(1 / 60);
    expect(a.group.position.z).toBeGreaterThan(-1);
    expect(b.group.position.toArray()).toEqual([0.5, 1.6, -1]);
  });

  it('a lone focused window is not biased (nothing behind it)', () => {
    const { host } = makeHost();
    const a = host.createWindow({ id: 'a', config: config(), position: [0, 1.6, -1] });
    host.update(1 / 60);
    expect(a.group.position.toArray()).toEqual([0, 1.6, -1]);
  });

  it('a docked window is biased toward the viewer while focused, and settles back to its slot once another window takes focus', () => {
    const { host } = makeHost();
    host.createRegion({ id: 'shelf', position: [1, 1.6, -1] });
    const docked = host.createWindow({ id: 'docked', config: config(), region: 'shelf' });
    host.createWindow({ id: 'other', config: config(), position: [0, 1.6, -1] }); // focused (created last)
    host.update(1 / 60);
    // Not focused (depth 1 of 2): sits exactly at its region slot, unbiased.
    expect(docked.group.position.toArray()).toEqual([1, 1.6, -1]);

    host.manager.focus('docked');
    host.update(1 / 60);
    // Focused now (depth 0): nudged toward the viewer from its slot, by the
    // same core `applyFocusBias`/`focusBiasAmount` native uses.
    const amount = focusBiasAmount(DEFAULT_FOCUS_BIAS, host.manager.count, 0);
    const expected = applyFocusBias([1, 1.6, -1], STATIC_HEAD.getHeadPose().position, amount);
    expect(docked.group.position.toArray()).not.toEqual([1, 1.6, -1]);
    expect(docked.group.position.x).toBeCloseTo(expected[0], 9);
    expect(docked.group.position.y).toBeCloseTo(expected[1], 9);
    expect(docked.group.position.z).toBeCloseTo(expected[2], 9);

    host.manager.focus('other');
    host.update(1 / 60);
    // Defocused again: back to its slot exactly - no bias leak.
    expect(docked.group.position.toArray()).toEqual([1, 1.6, -1]);
  });
});

describe('DockMode still applies while these run', () => {
  it('a body-follow window keeps following once a drag ends', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config(), dockMode: DockMode.BodyFollow });
    host.update(1 / 60);
    const titlebar = bridged(handle.document.getElementById('uix-titlebar')!);
    const hand = fakeController([0, 1.6, -1.2]);
    titlebar.onObjectGrabStart({ handIndex: 0, hand });
    host.update(0.01);
    expect(host.manager.get('w')?.dockMode).toBe(DockMode.WorldLocked);
    expect(host.manager.get('w')?.dragging).toBe(true);
    titlebar.onObjectGrabEnd();
    host.update(0.01);
    expect(host.manager.get('w')?.dragging).toBe(false);
  });
});
