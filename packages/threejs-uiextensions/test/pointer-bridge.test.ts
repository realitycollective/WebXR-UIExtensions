/**
 * Rule-by-rule proof for the plain three.js binding: touch press, controller
 * poke, ray click on release, hover, title-bar drag (ray and grab), billboard
 * while dragging, drop capture, focus bias and a per-window drag delay -
 * mirroring `xrblocks-uiextensions/test/pointer-bridge.test.ts`, which proves
 * the same rules against the SAME shared host from XR Blocks' own callback
 * shape.
 *
 * `ScenePointerBridge` is not driven by a real WebXR session here (no
 * browser, no real controllers): these tests call its own public methods
 * directly - `pointerDown`, `pointerUp`, `touch`, `hoverEnter`, `hoverExit` -
 * exactly the calls `webxr-input.ts`'s `connectWebXrPointerInput` makes once
 * it has resolved a hit. That is the same kind of fake this repository
 * already uses for a host it cannot run either (`fake-native-ui-host.ts`),
 * and the same substitution `xrblocks-uiextensions`'s own suite makes for XR
 * Blocks' interaction manager: built to behave as a CORRECT resolver would,
 * so the rule under test - what the host does once told what was pressed -
 * is exercised for real. `webxr-input.test.ts` separately proves the
 * resolver itself (the raycasting and proximity probing) against a fake
 * session.
 */
import { parse } from '@pmndrs/uikitml';
import { Group, Mesh, Object3D, PlaneGeometry, Quaternion, Vector3 } from 'three';
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
import { ScenePointerBridge, worldForwardOf, worldPositionOf } from '../src/pointer-bridge.js';
import type { RayInputAccess } from '../src/ray-input.js';

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

/** A fake controller/hand: an `Object3D` a test can move like a real one. */
function fakeController(position: [number, number, number] = [0, 0, 0]): Object3D {
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

function asObject3D(element: unknown): Object3D {
  return element as unknown as Object3D;
}

function makeHost(headPose: HeadPoseSource = STATIC_HEAD, rayInput?: RayInputAccess) {
  const scene = new Group();
  let bridge!: ScenePointerBridge;
  const host = new UixWindowHost({
    scene,
    headPose,
    ...(rayInput ? { rayInput } : {}),
    pointerBridgeFactory: (isLive) => {
      bridge = new ScenePointerBridge({ isLive });
      return bridge;
    },
  });
  return { scene, host, bridge };
}

/** A scriptable ray input: `setRay` is this frame's ray for `controller`. */
function makeRayInput(): RayInputAccess & { setRay(controller: object, origin: Vec3Tuple, direction: Vec3Tuple): void; clear(): void } {
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

describe('ui/touch-press and ui/controller-poke: touch and controller-tip press run through the core TouchPress', () => {
  it('a fingertip from the front presses once, and pushing through and back is one click', () => {
    const { host, bridge } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config() });
    const body = handle.document.getElementById('body')!;
    const bodyObject = asObject3D(body);
    const clicks = listen(body, 'click');
    const downs = listen(body, 'pointerdown');
    for (const signedDistance of [0.05, 0.015, -0.02, 0.01, 0.025, 0.05]) {
      bridge.touch(0, { signedDistance, target: bodyObject });
    }
    expect(downs).toHaveLength(1);
    expect(clicks).toHaveLength(1);
  });

  it('a tip first seen behind the panel never presses', () => {
    const { host, bridge } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config() });
    const body = handle.document.getElementById('body')!;
    const bodyObject = asObject3D(body);
    const downs = listen(body, 'pointerdown');
    for (const signedDistance of [-0.01, 0.0, 0.01, -0.02]) {
      bridge.touch(0, { signedDistance, target: bodyObject });
    }
    expect(downs).toHaveLength(0);
  });

  it('a controller tip (a different hand index) presses too', () => {
    const { host, bridge } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config() });
    const body = handle.document.getElementById('body')!;
    const bodyObject = asObject3D(body);
    const clicks = listen(body, 'click');
    for (const signedDistance of [0.05, 0.01, 0.05]) {
      bridge.touch(1, { signedDistance, target: bodyObject });
    }
    expect(clicks).toHaveLength(1);
  });

  it('losing contact ends a hold with no click', () => {
    const { host, bridge } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config() });
    const body = handle.document.getElementById('body')!;
    const bodyObject = asObject3D(body);
    const clicks = listen(body, 'click');
    const ups = listen(body, 'pointerup');
    bridge.touch(0, { signedDistance: 0.05, target: bodyObject });
    bridge.touch(0, { signedDistance: 0.01, target: bodyObject });
    bridge.touch(0, undefined);
    expect(ups).toHaveLength(1);
    expect(clicks).toHaveLength(0);
  });

  it('a hidden window cannot be pressed by touch', () => {
    const { host, bridge } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config() });
    const body = handle.document.getElementById('body')!;
    const bodyObject = asObject3D(body);
    const downs = listen(body, 'pointerdown');
    host.manager.hide('w');
    bridge.touch(0, { signedDistance: 0.05, target: bodyObject });
    expect(downs).toHaveLength(0);
  });
});

describe('ui/ray-click-on-release: a ray clicks on release, not on select-start (intersection)', () => {
  it('a ray press-down presses; release releases and clicks', () => {
    const { host, bridge } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config() });
    const bodyObject = asObject3D(handle.document.getElementById('body')!);
    const downs = listen(handle.document.getElementById('body'), 'pointerdown');
    const clicks = listen(handle.document.getElementById('body'), 'click');
    bridge.pointerDown(bodyObject, { controller: fakeController() });
    expect(downs).toHaveLength(1);
    expect(clicks).toHaveLength(0); // not yet - a real click-on-intersect defect would fire here
    bridge.pointerUp(bodyObject);
    expect(clicks).toHaveLength(1);
  });

  it('a press anywhere on the window focuses it', () => {
    const { host, bridge } = makeHost();
    const a = host.createWindow({ id: 'a', config: config() });
    host.createWindow({ id: 'b', config: config() });
    expect(host.manager.focused?.id).toBe('b');
    bridge.pointerDown(asObject3D(a.document.getElementById('body')!), { controller: fakeController() });
    expect(host.manager.focused?.id).toBe('a');
  });

  it('a hidden window cannot be pressed', () => {
    const { host, bridge } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config() });
    const bodyObject = asObject3D(handle.document.getElementById('body')!);
    const downs = listen(handle.document.getElementById('body'), 'pointerdown');
    host.manager.hide('w');
    bridge.pointerDown(bodyObject, { controller: fakeController() });
    expect(downs).toHaveLength(0);
  });
});

describe('ui/hover-styles: hover enter/leave reach the panel', () => {
  it('dispatches pointerenter and pointerleave', () => {
    const { host, bridge } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config() });
    const body = handle.document.getElementById('body')!;
    const bodyObject = asObject3D(body);
    const enters = listen(body, 'pointerenter');
    const leaves = listen(body, 'pointerleave');
    bridge.hoverEnter(bodyObject);
    expect(enters).toHaveLength(1);
    bridge.hoverExit(bodyObject);
    expect(leaves).toHaveLength(1);
  });

  it('a hidden window does not hover-enter', () => {
    const { host, bridge } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config() });
    const body = handle.document.getElementById('body')!;
    const bodyObject = asObject3D(body);
    const enters = listen(body, 'pointerenter');
    host.manager.hide('w');
    bridge.hoverEnter(bodyObject);
    expect(enters).toHaveLength(0);
  });
});

describe('ui/hold-to-drag and ui/near-drag: title-bar hold-to-drag (ray) and near drag (grab)', () => {
  it('a ray held past the default 0.3 s delay drags; a shorter press does not move the window', () => {
    const { host, bridge } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1] });
    const titlebar = asObject3D(handle.document.getElementById('uix-titlebar')!);
    const controller = fakeController([0.05, 1.6, -1]);

    bridge.pointerDown(titlebar, { controller });
    host.update(0.1);
    bridge.pointerUp(titlebar);
    host.update(0.1);
    expect(handle.group.position.toArray()).toEqual([0, 1.6, -1]);

    bridge.pointerDown(titlebar, { controller });
    host.update(0.2);
    host.update(0.2); // past 0.3 s total
    // The window rides the controller's OWN movement (point-delta), keeping
    // the offset it was grabbed at: controller +0.35 in x -> window +0.35.
    moveWorld(controller, [0.4, 1.6, -1]);
    host.update(0.05);
    expect(handle.group.position.x).toBeCloseTo(0.35, 5);
    bridge.pointerUp(titlebar);
  });

  it('a per-window dragDelay begins the drag sooner (ui/drag-delay-per-window)', () => {
    const { host, bridge } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1], dragDelay: 0.05 });
    const titlebar = asObject3D(handle.document.getElementById('uix-titlebar')!);
    const controller = fakeController([0, 1.6, -1]);
    bridge.pointerDown(titlebar, { controller });
    host.update(0.06);
    moveWorld(controller, [0.3, 1.6, -1]);
    host.update(0.01);
    expect(handle.group.position.x).toBeCloseTo(0.3, 5);
  });

  it('a grab on the title bar drags at once (near drag)', () => {
    const { host, bridge } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1] });
    const titlebar = asObject3D(handle.document.getElementById('uix-titlebar')!);
    const hand = fakeController([0, 1.7, -1]);
    bridge.pointerDown(titlebar, { hand });
    host.update(0.01);
    moveWorld(hand, [0.2, 1.7, -1]);
    host.update(0.01);
    expect(handle.group.position.x).toBeCloseTo(0.2, 5);
    bridge.pointerUp(titlebar);
  });

  it('a grab off the title bar does nothing', () => {
    const { host, bridge } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1] });
    const body = asObject3D(handle.document.getElementById('body')!);
    const hand = fakeController([0, 1.6, -1]);
    bridge.pointerDown(body, { hand });
    host.update(0.01);
    moveWorld(hand, [0.3, 1.6, -1]);
    host.update(0.01);
    expect(handle.group.position.toArray()).toEqual([0, 1.6, -1]);
  });

  it('a press on a chrome button never drags (it swallows its own press)', () => {
    const { host, bridge } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1], closable: true });
    const close = asObject3D(handle.document.getElementById('uix-close')!);
    const hand = fakeController([0, 1.7, -1]);
    bridge.pointerDown(close, { hand });
    host.update(0.01);
    moveWorld(hand, [0.3, 1.7, -1]);
    host.update(0.01);
    expect(handle.group.position.toArray()).toEqual([0, 1.6, -1]);
  });

  it('movable: false never begins a title-bar drag', () => {
    const { host, bridge } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1], movable: false });
    const titlebar = asObject3D(handle.document.getElementById('uix-titlebar')!);
    const hand = fakeController([0, 1.7, -1]);
    bridge.pointerDown(titlebar, { hand });
    host.update(0.01);
    moveWorld(hand, [0.3, 1.7, -1]);
    host.update(0.01);
    expect(handle.group.position.toArray()).toEqual([0, 1.6, -1]);
  });

  it('dropping within a region snap radius docks the window into it (ui/drop-capture)', () => {
    const { host, bridge } = makeHost();
    host.createRegion({ id: 'shelf', position: [1, 1.6, -1] });
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1] });
    const titlebar = asObject3D(handle.document.getElementById('uix-titlebar')!);
    const hand = fakeController([0, 1.7, -1]);
    bridge.pointerDown(titlebar, { hand });
    host.update(0.01);
    moveWorld(hand, [0.9, 1.7, -1]);
    host.update(0.01);
    bridge.pointerUp(titlebar);
    host.update(0.01);
    expect(host.manager.get('w')?.region).toBe('shelf');
  });
});

describe('ui/hold-to-drag laser-distance math: a ray drag rides the ray, as IWSDK and native, not the controller position', () => {
  it('with rayInput wired, the window rides the ray at the grab distance, using the shared core beginDrag/dragPosition', () => {
    const rayInput = makeRayInput();
    const { host, bridge } = makeHost(STATIC_HEAD, rayInput);
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1] });
    const titlebarElement = handle.document.getElementById('uix-titlebar')!;
    const titlebar = asObject3D(titlebarElement);
    // The controller itself never moves in this test - only the RAY it
    // reports does. Point-delta math (the fallback with no rayInput) would
    // therefore show no movement at all; laser-distance math rides the ray.
    const controller = fakeController([5, 5, 5]);
    const rayOrigin: Vec3Tuple = [0, 1.6, 0];

    const planePoint = worldPositionOf(titlebar);
    const planeNormal = worldForwardOf(titlebar);
    const startDirection: Vec3Tuple = [0, 0, -1];

    rayInput.setRay(controller, rayOrigin, startDirection);
    bridge.pointerDown(titlebar, { controller });
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
    bridge.pointerUp(titlebar);
  });

  it('falls back to point-delta for a controller rayInput has no ray source for, even with rayInput wired', () => {
    const rayInput = makeRayInput(); // never given a ray for this controller
    const { host, bridge } = makeHost(STATIC_HEAD, rayInput);
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1] });
    const titlebar = asObject3D(handle.document.getElementById('uix-titlebar')!);
    const controller = fakeController([0.05, 1.6, -1]);
    bridge.pointerDown(titlebar, { controller });
    host.update(0.2);
    host.update(0.2);
    moveWorld(controller, [0.4, 1.6, -1]);
    host.update(0.05);
    expect(handle.group.position.x).toBeCloseTo(0.35, 5); // same point-delta result as with no rayInput at all
  });
});

describe('ui/billboard-drag: billboard while dragging', () => {
  it('yaws to face the viewer while dragging, unless disabled', () => {
    const { host, bridge } = makeHost(headAt([0, 1.6, 0]));
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1] });
    const titlebar = asObject3D(handle.document.getElementById('uix-titlebar')!);
    const hand = fakeController([0, 1.7, -1]);
    bridge.pointerDown(titlebar, { hand });
    host.update(0.01);
    moveWorld(hand, [0.6, 1.7, -1]);
    host.update(0.01);
    expect(handle.group.quaternion.equals(new Quaternion(0, 0, 0, 1))).toBe(false);
  });

  it('billboardWhileDragging: false never turns the window', () => {
    const { host, bridge } = makeHost(headAt([0, 1.6, 0]));
    const handle = host.createWindow({
      id: 'w',
      config: config(),
      position: [0, 1.6, -1],
      billboardWhileDragging: false,
    });
    const titlebar = asObject3D(handle.document.getElementById('uix-titlebar')!);
    const hand = fakeController([0, 1.7, -1]);
    bridge.pointerDown(titlebar, { hand });
    host.update(0.01);
    moveWorld(hand, [0.6, 1.7, -1]);
    host.update(0.01);
    expect(handle.group.quaternion.equals(new Quaternion(0, 0, 0, 1))).toBe(true);
  });
});

describe('ui/focus-bias', () => {
  it('moves the focused window toward the viewer per window behind it', () => {
    const { host } = makeHost();
    const a = host.createWindow({ id: 'a', config: config(), position: [0, 1.6, -1] });
    const b = host.createWindow({ id: 'b', config: config(), position: [0.5, 1.6, -1] });
    host.update(1 / 60);
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
    expect(docked.group.position.toArray()).toEqual([1, 1.6, -1]);

    host.manager.focus('docked');
    host.update(1 / 60);
    const amount = focusBiasAmount(DEFAULT_FOCUS_BIAS, host.manager.count, 0);
    const expected = applyFocusBias([1, 1.6, -1], STATIC_HEAD.getHeadPose().position, amount);
    expect(docked.group.position.toArray()).not.toEqual([1, 1.6, -1]);
    expect(docked.group.position.x).toBeCloseTo(expected[0], 9);
    expect(docked.group.position.y).toBeCloseTo(expected[1], 9);
    expect(docked.group.position.z).toBeCloseTo(expected[2], 9);

    host.manager.focus('other');
    host.update(1 / 60);
    expect(docked.group.position.toArray()).toEqual([1, 1.6, -1]);
  });
});

describe('DockMode still applies while these run', () => {
  it('a body-follow window keeps following once a drag ends', () => {
    const { host, bridge } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config(), dockMode: DockMode.BodyFollow });
    host.update(1 / 60);
    const titlebar = asObject3D(handle.document.getElementById('uix-titlebar')!);
    const hand = fakeController([0, 1.6, -1.2]);
    bridge.pointerDown(titlebar, { hand });
    host.update(0.01);
    expect(host.manager.get('w')?.dockMode).toBe(DockMode.WorldLocked);
    expect(host.manager.get('w')?.dragging).toBe(true);
    bridge.pointerUp(titlebar);
    host.update(0.01);
    expect(host.manager.get('w')?.dragging).toBe(false);
  });
});

describe('ScenePointerBridge.rayHit and touchHit resolve a real raycast/probe against wired geometry', () => {
  // A real mesh (not a headless uikit panel, whose geometry is only sized
  // once layout measures it asynchronously) proves the raycasting/probing
  // mechanics themselves, independent of uikit timing.
  function wiredPlane(bridge: ScenePointerBridge, position: [number, number, number]): Object3D {
    const geometry = new PlaneGeometry(1, 1);
    const mesh = new Mesh(geometry);
    mesh.position.set(...position);
    mesh.updateMatrixWorld(true);
    bridge.wire(mesh);
    return mesh;
  }

  it('rayHit finds the nearest wired mesh a ray actually intersects', () => {
    const bridge = new ScenePointerBridge();
    const mesh = wiredPlane(bridge, [0, 1.6, -1]);
    // Straight down the -Z axis from the origin at y1.6 hits the plane at z -1.
    const hit = bridge.rayHit([0, 1.6, 0], [0, 0, -1]);
    expect(hit).toBe(mesh);
  });

  it('rayHit finds nothing when the ray misses every wired mesh', () => {
    const bridge = new ScenePointerBridge();
    wiredPlane(bridge, [0, 1.6, -1]);
    const hit = bridge.rayHit([0, 1.6, 0], [1, 0, 0]);
    expect(hit).toBeUndefined();
  });

  it('rayHit ignores a mesh isLive says is not live', () => {
    const live = { current: true };
    const bridge = new ScenePointerBridge({ isLive: () => live.current });
    wiredPlane(bridge, [0, 1.6, -1]);
    live.current = false;
    const hit = bridge.rayHit([0, 1.6, 0], [0, 0, -1]);
    expect(hit).toBeUndefined();
  });

  it('touchHit resolves the mesh in front of a point within maxDistance, along the mesh normal', () => {
    const bridge = new ScenePointerBridge();
    const mesh = wiredPlane(bridge, [0, 1.6, -1]);
    // The plane faces +Z by default; a point 0.02 m in front of it (z -0.98) is a touch.
    const hit = bridge.touchHit([0, 1.6, -0.98], 0.08);
    expect(hit?.target).toBe(mesh);
    expect(hit?.signedDistance).toBeCloseTo(0.02, 5);
  });

  it('touchHit finds nothing further than maxDistance from any wired mesh', () => {
    const bridge = new ScenePointerBridge();
    wiredPlane(bridge, [0, 1.6, -5]);
    const hit = bridge.touchHit([0, 1.6, -1], 0.08);
    expect(hit).toBeUndefined();
  });

  it('rayCast reports the hit point and world-space surface normal - ui/pointer-cursor’s placement input', () => {
    const bridge = new ScenePointerBridge();
    const mesh = wiredPlane(bridge, [0, 1.6, -1]);
    const detail = bridge.rayCast([0, 1.6, 0], [0, 0, -1]);
    expect(detail?.target).toBe(mesh);
    expect(detail?.point[0]).toBeCloseTo(0, 9);
    expect(detail?.point[1]).toBeCloseTo(1.6, 9);
    expect(detail?.point[2]).toBeCloseTo(-1, 9);
    expect(detail?.normal?.[0]).toBeCloseTo(0, 9);
    expect(detail?.normal?.[1]).toBeCloseTo(0, 9);
    expect(detail?.normal?.[2]).toBeCloseTo(1, 9);
  });

  it('rayCast carries the normal through a rotated mesh, in world space', () => {
    const bridge = new ScenePointerBridge();
    const mesh = wiredPlane(bridge, [0, 1.6, -1]);
    mesh.rotation.set(0, Math.PI / 2, 0); // yaw 90deg: local +Z normal -> world +X
    mesh.updateMatrixWorld(true);
    const detail = bridge.rayCast([5, 1.6, -1], [-1, 0, 0]);
    expect(detail?.normal?.[0]).toBeCloseTo(1, 5);
    expect(detail?.normal?.[1]).toBeCloseTo(0, 5);
    expect(detail?.normal?.[2]).toBeCloseTo(0, 5);
  });

  it('rayCast is undefined when the ray hits nothing - the negative case ui/pointer-cursor relies on to hide the disc', () => {
    const bridge = new ScenePointerBridge();
    wiredPlane(bridge, [0, 1.6, -1]);
    expect(bridge.rayCast([0, 1.6, 0], [1, 0, 0])).toBeUndefined();
  });

  it('rayHit is a thin projection of rayCast’s target, for a caller that needs only that', () => {
    const bridge = new ScenePointerBridge();
    const mesh = wiredPlane(bridge, [0, 1.6, -1]);
    expect(bridge.rayHit([0, 1.6, 0], [0, 0, -1])).toBe(mesh);
  });
});
