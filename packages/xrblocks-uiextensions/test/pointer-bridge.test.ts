/**
 * Proves XR Blocks runs the IWSDK pointer rules: touch press,
 * controller poke, ray click on release, hover, title-bar drag (ray and
 * grab), billboard while dragging, drop capture, focus bias and a per-window
 * drag delay - each rule by rule, mirroring
 * `native-uiextensions/test/binding-rules.test.ts`.
 *
 * XR Blocks itself is not run here (no browser, no real controllers). Two
 * fakes stand in for it, both built to behave as a CORRECT xrblocks 0.21.1
 * does, from its source (`ScriptsManager.hasTargetHandler`,
 * `HitResolver.resolve`, `Interaction.startTargetCapture` and
 * `endSelection`):
 *
 * - `FakeXrBlocks` raycasts a scene, walks the hit's ancestors for a Script
 *   (`isXRScript === true` with `onObjectSelectStart`) and calls its hooks
 *   with 0.21-shaped events. It drives the geometry-level tests, and the
 *   negative test: an object carrying only the per-object callbacks this
 *   bridge used to attach (`onSelectStart` on the hit object, xrblocks 0.19's
 *   contract) gets nothing from it.
 * - The uikit-backed window tests call the hooks on the panel's Script node
 *   directly, with the same event shape naming the element hit, the way the
 *   SDK does once it has resolved a hit. uikit lays out asynchronously, so
 *   its elements are not raycast here; where a test needs a hit (touch, grab)
 *   it adds a plane mesh inside the element.
 *
 * Rays and fingertips reach the bridge through `xb.input.getFrame()`, faked
 * by `makeRayInput`.
 */
import { parse } from '@pmndrs/uikitml';
import { Group, Mesh, Object3D, PlaneGeometry, Quaternion, Raycaster, Vector3 } from 'three';
import { PointerArbiter } from '@realitycollective/webxr-input';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FOCUS_BIAS,
  DockMode,
  applyFocusBias,
  beginDrag,
  dragPosition,
  focusBiasAmount,
  intersectRayPlane,
  WINDOW_CHROME_IDS,
  type HeadPoseSource,
  type Vec3Tuple,
} from '@realitycollective/webxr-uiextensions';
import { UixWindowHost, type XrBlocksWindowHandle } from '../src/host.js';
import {
  XrBlocksPanelScript,
  XrBlocksPointerBridge,
  worldForwardOf,
  worldPositionOf,
  type XrBlocksController,
  type XrBlocksInteractionSource,
  type XrBlocksSelectEndEvent,
  type XrBlocksSelectEvent,
} from '../src/pointer-bridge.js';
import type { XBInputFrameLike, XrBlocksRayInputAccess } from '../src/ray-input.js';

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

/** A fake XR Blocks `Controller`: an `Object3D` a test can move like a real one. */
function fakeController(position: [number, number, number] = [0, 0, 0]): XrBlocksController {
  const object = new Object3D();
  object.position.set(...position);
  object.updateMatrixWorld(true);
  return object;
}

/** A fake XR Blocks controller; `handedness` is its input source's, omitted for none. */
function fakeSided(handedness?: string): XrBlocksController {
  const controller = fakeController();
  if (handedness !== undefined) (controller as unknown as { inputSource: { handedness: string } }).inputSource = { handedness };
  return controller;
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

/** `InteractionSource` as xrblocks builds it: the controller, its handedness and the kind of source. */
function sourceOf(controller: XrBlocksController, handedness: 'left' | 'right' | 'none' = 'none', type = 'controller-ray'): XrBlocksInteractionSource {
  return { type, handedness, controller };
}

/** The Script node the bridge inserted above a window's uikit root. */
function nodeOf(handle: XrBlocksWindowHandle): XrBlocksPanelScript {
  const node = handle.document.rootComponent.parent;
  if (!(node instanceof XrBlocksPanelScript)) throw new Error('the window has no XR Blocks Script node');
  return node;
}

/** `onObjectSelectStart` on `node` as xrblocks calls it once it resolved a hit on `element`. */
function selectOn(node: XrBlocksPanelScript, element: unknown, controller: XrBlocksController, handedness: 'left' | 'right' | 'none' = 'none', distance = 1): XrBlocksSelectEvent {
  const object = element as Object3D;
  const point = worldPositionOf(object);
  const event: XrBlocksSelectEvent = {
    source: sourceOf(controller, handedness),
    target: node,
    surface: object,
    intersection: { object, point: { x: point[0], y: point[1], z: point[2] }, distance },
    stopPropagation: () => {},
  };
  node.onObjectSelectStart(event);
  return event;
}

/** `onObjectSelectEnd` on `node` as xrblocks calls it: `completed` is its own "released over the same target". */
function releaseOn(node: XrBlocksPanelScript, controller: XrBlocksController, handedness: 'left' | 'right' | 'none' = 'none', completed = true): void {
  const event: XrBlocksSelectEndEvent = {
    source: sourceOf(controller, handedness),
    target: node,
    completed,
    reason: completed ? 'released' : 'released-outside',
    stopPropagation: () => {},
  };
  node.onObjectSelectEnd(event);
}

/**
 * A plane mesh inside `element`, so a fingertip or a grabbing hand can be cast
 * to it; its front is +Z as a uikit panel's is. uikit lays out asynchronously
 * and, with no font metrics here, gives its elements a zero size once it has
 * run, which would squash a child to nothing: the mesh keeps the window's own
 * world transform instead (at the window origin, facing its +Z, as the
 * element's face does) and stops following its parent.
 */
function hittable(handle: XrBlocksWindowHandle, element: unknown, width = 0.4, height = 0.2): Mesh {
  const mesh = new Mesh(new PlaneGeometry(width, height));
  // uikit refuses a plain three child through `add` (its `childadded` listener), so link it
  // into the tree directly: what the raycaster traverses and what `bubble` walks up.
  const parent = element as Object3D;
  parent.children.push(mesh);
  mesh.parent = parent;
  handle.group.updateWorldMatrix(true, false);
  mesh.matrixWorld.copy(handle.group.matrixWorld);
  mesh.matrixWorldAutoUpdate = false;
  return mesh;
}

/** A world point `z` metres in front of `mesh`'s face (negative: behind). */
function inFrontOf(mesh: Object3D, z: number, x = 0, y = 0): Vec3Tuple {
  const at = worldPositionOf(mesh);
  const normal = worldForwardOf(mesh);
  return [at[0] + normal[0] * z + x, at[1] + normal[1] * z + y, at[2] + normal[2] * z];
}

function makeHost(headPose: HeadPoseSource = STATIC_HEAD, rayInput?: XrBlocksRayInputAccess) {
  const scene = new Group();
  const host = new UixWindowHost({ scene, headPose, ...(rayInput ? { rayInput } : {}) });
  return { scene, host };
}

/**
 * A scriptable `xb.input` fake: `setRay` is this frame's ray for `controller`
 * and `setTouch` this frame's fingertip for a hand, read by `getFrame()`
 * exactly as `xb.input.getFrame()` reports `raySources` and `directTouches`.
 */
function makeRayInput() {
  let raySources: Array<{ controller: object; ray: { origin: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number } } }> = [];
  const touches = new Map<number, { handIndex: number; point: { x: number; y: number; z: number } }>();
  const input = {
    getFrame: (): XBInputFrameLike => ({ raySources, directTouches: [...touches.values()] }),
    setRay(controller: object, [ox, oy, oz]: Vec3Tuple, [dx, dy, dz]: Vec3Tuple) {
      raySources = [{ controller, ray: { origin: { x: ox, y: oy, z: oz }, direction: { x: dx, y: dy, z: dz } } }];
    },
    clear() {
      raySources = [];
    },
    setTouch(handIndex: number, point: Vec3Tuple | undefined) {
      if (point) touches.set(handIndex, { handIndex, point: { x: point[0], y: point[1], z: point[2] } });
      else touches.delete(handIndex);
    },
  };
  return input;
}

/** A Script as xrblocks 0.21 recognises one. */
interface ScriptLike extends Object3D {
  isXRScript?: boolean;
  onObjectSelectStart?(event: XrBlocksSelectEvent): void;
  onObjectSelectEnd?(event: XrBlocksSelectEndEvent): void;
}

/**
 * xrblocks 0.21.1's select dispatch, from its source: raycast the scene
 * (`HitRegistry.raycast`), skip a hit under a hidden ancestor
 * (`HitResolver.isExcluded`), take the nearest ancestor that is a Script with
 * a targeted hook (`ScriptsManager.hasTargetHandler`: `isXRScript` and
 * `onObjectSelectStart`), and call the hook with the select event
 * (`Interaction.startTargetCapture`). A hit no Script owns goes nowhere but
 * the global `onSelectStart`, which carries no target. The release is
 * `completed` when it resolves to the same Script (`Interaction.endSelection`).
 */
class FakeXrBlocks {
  private readonly raycaster = new Raycaster();
  private readonly captures = new Map<object, ScriptLike>();

  constructor(private readonly scene: Object3D) {}

  private resolve(origin: Vec3Tuple, direction: Vec3Tuple): { script: ScriptLike; hit: { object: Object3D; point: Vector3; distance: number } } | undefined {
    this.raycaster.set(new Vector3(...origin), new Vector3(...direction).normalize());
    for (const hit of this.raycaster.intersectObject(this.scene, true)) {
      let hidden = false;
      for (let at: Object3D | null = hit.object; at; at = at.parent) if (at.visible === false) hidden = true;
      if (hidden) continue;
      for (let at: Object3D | null = hit.object; at; at = at.parent) {
        const script = at as ScriptLike;
        if (script.isXRScript === true && typeof script.onObjectSelectStart === 'function') return { script, hit };
      }
      return undefined;
    }
    return undefined;
  }

  /** A press along a ray; true when a Script took it. */
  select(controller: XrBlocksController, origin: Vec3Tuple, direction: Vec3Tuple, handedness: 'left' | 'right' | 'none' = 'none', type = 'controller-ray'): boolean {
    const resolved = this.resolve(origin, direction);
    if (!resolved) return false;
    const { script, hit } = resolved;
    script.onObjectSelectStart!({
      source: sourceOf(controller, handedness, type),
      target: script,
      surface: hit.object,
      intersection: { object: hit.object, point: hit.point, distance: hit.distance },
      stopPropagation: () => {},
    });
    this.captures.set(controller, script);
    return true;
  }

  /** The release of a press, along the ray the controller now points; true when a Script took the press. */
  release(controller: XrBlocksController, origin: Vec3Tuple, direction: Vec3Tuple, handedness: 'left' | 'right' | 'none' = 'none', type = 'controller-ray'): boolean {
    const script = this.captures.get(controller);
    if (!script) return false;
    this.captures.delete(controller);
    const resolved = this.resolve(origin, direction);
    const completed = resolved?.script === script;
    script.onObjectSelectEnd!({
      source: sourceOf(controller, handedness, type),
      target: script,
      ...(resolved ? { surface: resolved.hit.object, intersection: { object: resolved.hit.object, point: resolved.hit.point, distance: resolved.hit.distance } } : {}),
      completed,
      reason: completed ? 'released' : 'released-outside',
      stopPropagation: () => {},
    });
    return true;
  }
}

/** A wired fake panel: a root group at `position` holding a 1 m plane, its normal +Z as a uikit panel's is. */
function fakePanel(bridge: XrBlocksPointerBridge, position: [number, number, number] = [0, 0, -2], parent?: Object3D) {
  const root = new Group();
  root.position.set(...position);
  const mesh = new Mesh(new PlaneGeometry(1, 1));
  root.add(mesh);
  parent?.add(root);
  root.updateMatrixWorld(true);
  bridge.wire(root);
  root.updateMatrixWorld(true);
  const script = bridge.scriptOf(root)!;
  return { root, mesh, script };
}

/** An `xb.input.getFrame()` value whose ray sources all point down -Z from x offsets. */
function frameOf(...sources: Array<{ controller: object; x?: number }>): XBInputFrameLike {
  return {
    raySources: sources.map(({ controller, x = 0 }) => ({
      controller,
      ray: { origin: { x, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } },
    })),
  };
}

/** An `xb.input.getFrame()` value with one fingertip and no rays. */
function touchFrame(handIndex: number, point: Vec3Tuple): XBInputFrameLike {
  return { raySources: [], directTouches: [{ handIndex, point: { x: point[0], y: point[1], z: point[2] } }] };
}

describe('xrblocks 0.21 reaches a wired panel through its Script node, and nothing else', () => {
  it('wire inserts one Script node per panel above the uikit root, with init and dispose and no per-frame hooks', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config() });
    const node = nodeOf(handle);
    expect(node.isXRScript).toBe(true);
    expect(node.panelRoot).toBe(handle.document.rootComponent);
    expect(node.parent).toBe(handle.document);
    expect(typeof node.init).toBe('function');
    expect(typeof node.dispose).toBe('function');
    // xrblocks indexes any function under a hook name as that hook: the node must carry no `update`,
    // or xrblocks would step it every frame as it would a uikit root's own `update`.
    expect(Reflect.get(node, 'update')).toBeUndefined();
    expect(() => {
      node.init();
      node.dispose();
    }).not.toThrow();
  });

  it('a press and release resolved by the SDK presses and clicks the mesh it hit', () => {
    const scene = new Group();
    const bridge = new XrBlocksPointerBridge();
    const panel = fakePanel(bridge, [0, 0, -2], scene);
    const xb = new FakeXrBlocks(scene);
    const downs = listen(panel.mesh, 'pointerdown');
    const clicks = listen(panel.mesh, 'click');
    const controller = fakeController();
    expect(xb.select(controller, [0, 0, 0], [0, 0, -1])).toBe(true);
    expect(downs).toHaveLength(1);
    expect(clicks).toHaveLength(0); // not yet - a click-on-intersect defect would fire here
    expect(xb.release(controller, [0, 0, 0], [0, 0, -1])).toBe(true);
    expect(clicks).toHaveLength(1);
  });

  it('NEGATIVE: an object carrying only the per-object callbacks of xrblocks 0.19 gets nothing from 0.21', () => {
    const scene = new Group();
    const legacy = new Mesh(new PlaneGeometry(1, 1));
    legacy.position.set(0, 0, -2);
    let called = 0;
    Object.assign(legacy, { onSelectStart: () => (called += 1, true), onSelectEnd: () => (called += 1, true) });
    scene.add(legacy);
    scene.updateMatrixWorld(true);
    const xb = new FakeXrBlocks(scene);
    const controller = fakeController();
    expect(xb.select(controller, [0, 0, 0], [0, 0, -1])).toBe(false);
    expect(xb.release(controller, [0, 0, 0], [0, 0, -1])).toBe(false);
    expect(called).toBe(0);
  });

  it('a release off the panel is not completed: pointerup, no click', () => {
    const scene = new Group();
    const bridge = new XrBlocksPointerBridge();
    const panel = fakePanel(bridge, [0, 0, -2], scene);
    const xb = new FakeXrBlocks(scene);
    const ups = listen(panel.mesh, 'pointerup');
    const clicks = listen(panel.mesh, 'click');
    const controller = fakeController();
    xb.select(controller, [0, 0, 0], [0, 0, -1]);
    xb.release(controller, [5, 0, 0], [0, 0, -1]);
    expect(ups).toHaveLength(1);
    expect(clicks).toHaveLength(0);
  });

  it('a hidden panel is never resolved, as xrblocks excludes a hit under a hidden ancestor', () => {
    const scene = new Group();
    const bridge = new XrBlocksPointerBridge();
    const panel = fakePanel(bridge, [0, 0, -2], scene);
    const xb = new FakeXrBlocks(scene);
    const downs = listen(panel.mesh, 'pointerdown');
    panel.root.visible = false;
    expect(xb.select(fakeController(), [0, 0, 0], [0, 0, -1])).toBe(false);
    expect(downs).toHaveLength(0);
  });

  it("a select xrblocks raises for its own direct touch is ignored: touch is driven from the input frame", () => {
    const scene = new Group();
    const bridge = new XrBlocksPointerBridge();
    const panel = fakePanel(bridge, [0, 0, -2], scene);
    const xb = new FakeXrBlocks(scene);
    const downs = listen(panel.mesh, 'pointerdown');
    const controller = fakeController();
    xb.select(controller, [0, 0, 0], [0, 0, -1], 'left', 'direct-touch');
    xb.release(controller, [0, 0, 0], [0, 0, -1], 'left', 'direct-touch');
    expect(downs).toHaveLength(0);
  });

  it('the hooks stop propagation to ancestor Scripts', () => {
    const scene = new Group();
    const bridge = new XrBlocksPointerBridge();
    const panel = fakePanel(bridge, [0, 0, -2], scene);
    let stopped = 0;
    const event = { ...selectOn(panel.script, panel.mesh, fakeController()), stopPropagation: () => (stopped += 1) };
    panel.script.onObjectSelectStart(event);
    panel.script.onObjectSelectEnd({ ...event, completed: true, reason: 'released' });
    expect(stopped).toBe(2);
  });
});

describe('touch and controller-tip press run through the core TouchPress, from the input frame', () => {
  it('a fingertip from the front presses once, and pushing through and back is one click', () => {
    const rayInput = makeRayInput();
    const { host } = makeHost(STATIC_HEAD, rayInput);
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1] });
    const face = hittable(handle, handle.document.getElementById('body')!);
    const clicks = listen(face, 'click');
    const downs = listen(face, 'pointerdown');
    for (const signedDistance of [0.05, 0.015, -0.02, 0.01, 0.025, 0.05]) {
      rayInput.setTouch(0, inFrontOf(face, signedDistance));
      host.update(1 / 60);
    }
    expect(downs).toHaveLength(1);
    expect(clicks).toHaveLength(1);
  });

  it('a tip first seen behind the panel never presses', () => {
    const rayInput = makeRayInput();
    const { host } = makeHost(STATIC_HEAD, rayInput);
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1] });
    const face = hittable(handle, handle.document.getElementById('body')!);
    const downs = listen(face, 'pointerdown');
    for (const signedDistance of [-0.01, 0.0, 0.01, -0.02]) {
      rayInput.setTouch(0, inFrontOf(face, signedDistance));
      host.update(1 / 60);
    }
    expect(downs).toHaveLength(0);
  });

  it('a controller tip (a different hand index) presses too', () => {
    const rayInput = makeRayInput();
    const { host } = makeHost(STATIC_HEAD, rayInput);
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1] });
    const face = hittable(handle, handle.document.getElementById('body')!);
    const clicks = listen(face, 'click');
    for (const signedDistance of [0.05, 0.01, 0.05]) {
      rayInput.setTouch(1, inFrontOf(face, signedDistance));
      host.update(1 / 60);
    }
    expect(clicks).toHaveLength(1);
  });

  it('losing the fingertip ends a hold with no click', () => {
    const rayInput = makeRayInput();
    const { host } = makeHost(STATIC_HEAD, rayInput);
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1] });
    const face = hittable(handle, handle.document.getElementById('body')!);
    const clicks = listen(face, 'click');
    const ups = listen(face, 'pointerup');
    rayInput.setTouch(0, inFrontOf(face, 0.05));
    host.update(1 / 60);
    rayInput.setTouch(0, inFrontOf(face, 0.01));
    host.update(1 / 60);
    rayInput.setTouch(0, undefined);
    host.update(1 / 60);
    expect(ups).toHaveLength(1);
    expect(clicks).toHaveLength(0);
  });

  it('a fingertip beside the panel, or far in front of it, is over nothing', () => {
    const rayInput = makeRayInput();
    const { host } = makeHost(STATIC_HEAD, rayInput);
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1] });
    const face = hittable(handle, handle.document.getElementById('body')!);
    const downs = listen(face, 'pointerdown');
    for (const point of [inFrontOf(face, 0.05, 5), inFrontOf(face, 0.01, 5), inFrontOf(face, 0.5), inFrontOf(face, 0.3)]) {
      rayInput.setTouch(0, point);
      host.update(1 / 60);
    }
    expect(downs).toHaveLength(0);
  });

  it('a hidden window cannot be pressed by touch', () => {
    const rayInput = makeRayInput();
    const { host } = makeHost(STATIC_HEAD, rayInput);
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1] });
    const face = hittable(handle, handle.document.getElementById('body')!);
    const downs = listen(face, 'pointerdown');
    host.manager.hide('w');
    for (const signedDistance of [0.05, 0.01]) {
      rayInput.setTouch(0, inFrontOf(face, signedDistance));
      host.update(1 / 60);
    }
    expect(downs).toHaveLength(0);
  });
});

describe('a ray clicks on release, not on select-start (intersection)', () => {
  it('select-start presses; select-end releases and clicks', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config() });
    const body = handle.document.getElementById('body')!;
    const downs = listen(body, 'pointerdown');
    const clicks = listen(body, 'click');
    const controller = fakeController();
    selectOn(nodeOf(handle), body, controller);
    expect(downs).toHaveLength(1);
    expect(clicks).toHaveLength(0); // not yet - a real click-on-intersect defect would fire here
    releaseOn(nodeOf(handle), controller);
    expect(clicks).toHaveLength(1);
  });

  it('a release xrblocks reports as not completed raises pointerup but no click', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config() });
    const body = handle.document.getElementById('body')!;
    const ups = listen(body, 'pointerup');
    const clicks = listen(body, 'click');
    const controller = fakeController();
    selectOn(nodeOf(handle), body, controller);
    releaseOn(nodeOf(handle), controller, 'none', false);
    expect(ups).toHaveLength(1);
    expect(clicks).toHaveLength(0);
  });

  it('a press anywhere on the window focuses it', () => {
    const { host } = makeHost();
    const a = host.createWindow({ id: 'a', config: config() });
    host.createWindow({ id: 'b', config: config() });
    expect(host.manager.focused?.id).toBe('b');
    selectOn(nodeOf(a), a.document.getElementById('body')!, fakeController());
    expect(host.manager.focused?.id).toBe('a');
  });

  it('a hidden window cannot be selected', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config() });
    const body = handle.document.getElementById('body')!;
    const downs = listen(body, 'pointerdown');
    host.manager.hide('w');
    selectOn(nodeOf(handle), body, fakeController());
    expect(downs).toHaveLength(0);
  });

  it('a release with no press for that source does nothing', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config() });
    const ups = listen(handle.document.getElementById('body'), 'pointerup');
    releaseOn(nodeOf(handle), fakeController());
    expect(ups).toHaveLength(0);
  });
});

describe('title-bar hold-to-drag (ray) and near drag (grab)', () => {
  it('a ray held past the default 0.3 s delay drags; a shorter press does not move the window', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1] });
    const titlebar = handle.document.getElementById('uix-titlebar')!;
    const node = nodeOf(handle);
    const controller = fakeController([0.05, 1.6, -1]);

    selectOn(node, titlebar, controller);
    host.update(0.1);
    releaseOn(node, controller);
    host.update(0.1);
    expect(handle.group.position.toArray()).toEqual([0, 1.6, -1]);

    selectOn(node, titlebar, controller);
    host.update(0.2);
    host.update(0.2); // past 0.3 s total
    // The window rides the controller's OWN movement (point-delta), keeping
    // the offset it was grabbed at: controller +0.35 in x -> window +0.35.
    moveWorld(controller, [0.4, 1.6, -1]);
    host.update(0.05);
    expect(handle.group.position.x).toBeCloseTo(0.35, 5);
    releaseOn(node, controller);
  });

  it('a per-window dragDelay begins the drag sooner', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1], dragDelay: 0.05 });
    const controller = fakeController([0, 1.6, -1]);
    selectOn(nodeOf(handle), handle.document.getElementById('uix-titlebar')!, controller);
    host.update(0.06);
    moveWorld(controller, [0.3, 1.6, -1]);
    host.update(0.01);
    expect(handle.group.position.x).toBeCloseTo(0.3, 5);
  });

  it('a grab on the title bar drags at once (near drag)', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1] });
    const grip = hittable(handle, handle.document.getElementById('uix-titlebar')!);
    const hand = fakeController([0, 1.7, -1]);
    nodeOf(handle).onObjectGrabStart({ handIndex: 0, hand, touchPosition: new Vector3(...inFrontOf(grip, 0.01)) });
    host.update(0.01);
    moveWorld(hand, [0.2, 1.7, -1]);
    host.update(0.01);
    expect(handle.group.position.x).toBeCloseTo(0.2, 5);
    nodeOf(handle).onObjectGrabEnd({ handIndex: 0, hand, touchPosition: new Vector3(...inFrontOf(grip, 0.01)) });
  });

  it('a grab off the title bar does nothing', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1] });
    const face = hittable(handle, handle.document.getElementById('body')!);
    const hand = fakeController([0, 1.6, -1]);
    nodeOf(handle).onObjectGrabStart({ handIndex: 0, hand, touchPosition: new Vector3(...inFrontOf(face, 0.01)) });
    host.update(0.01);
    moveWorld(hand, [0.3, 1.6, -1]);
    host.update(0.01);
    expect(handle.group.position.toArray()).toEqual([0, 1.6, -1]);
  });

  it('a press on a chrome button never drags (it swallows its own press)', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1], closable: true });
    const close = hittable(handle, handle.document.getElementById('uix-close')!);
    const hand = fakeController([0, 1.7, -1]);
    nodeOf(handle).onObjectGrabStart({ handIndex: 0, hand, touchPosition: new Vector3(...inFrontOf(close, 0.01)) });
    host.update(0.01);
    moveWorld(hand, [0.3, 1.7, -1]);
    host.update(0.01);
    expect(handle.group.position.toArray()).toEqual([0, 1.6, -1]);
  });

  it('movable: false never begins a title-bar drag', () => {
    const { host } = makeHost();
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1], movable: false });
    const grip = hittable(handle, handle.document.getElementById('uix-titlebar')!);
    // No listener at all is registered for a non-movable window's title bar.
    const hand = fakeController([0, 1.7, -1]);
    nodeOf(handle).onObjectGrabStart({ handIndex: 0, hand, touchPosition: new Vector3(...inFrontOf(grip, 0.01)) });
    host.update(0.01);
    moveWorld(hand, [0.3, 1.7, -1]);
    host.update(0.01);
    expect(handle.group.position.toArray()).toEqual([0, 1.6, -1]);
  });

  it('dropping within a region snap radius docks the window into it', () => {
    const { host } = makeHost();
    host.createRegion({ id: 'shelf', position: [1, 1.6, -1] });
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1] });
    const grip = hittable(handle, handle.document.getElementById('uix-titlebar')!);
    const hand = fakeController([0, 1.7, -1]);
    const at = new Vector3(...inFrontOf(grip, 0.01));
    nodeOf(handle).onObjectGrabStart({ handIndex: 0, hand, touchPosition: at });
    host.update(0.01);
    moveWorld(hand, [0.9, 1.7, -1]);
    host.update(0.01);
    nodeOf(handle).onObjectGrabEnd({ handIndex: 0, hand, touchPosition: at });
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
    selectOn(nodeOf(handle), titlebarElement, controller);
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
    releaseOn(nodeOf(handle), controller);
  });

  it('falls back to point-delta for a controller rayInput has no ray source for, even with rayInput wired', () => {
    const rayInput = makeRayInput(); // never given a ray for this controller
    const { host } = makeHost(STATIC_HEAD, rayInput);
    const handle = host.createWindow({ id: 'w', config: config(), position: [0, 1.6, -1] });
    const controller = fakeController([0.05, 1.6, -1]);
    selectOn(nodeOf(handle), handle.document.getElementById('uix-titlebar')!, controller);
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
    const grip = hittable(handle, handle.document.getElementById('uix-titlebar')!);
    const hand = fakeController([0, 1.7, -1]);
    nodeOf(handle).onObjectGrabStart({ handIndex: 0, hand, touchPosition: new Vector3(...inFrontOf(grip, 0.01)) });
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
    const grip = hittable(handle, handle.document.getElementById('uix-titlebar')!);
    const hand = fakeController([0, 1.7, -1]);
    nodeOf(handle).onObjectGrabStart({ handIndex: 0, hand, touchPosition: new Vector3(...inFrontOf(grip, 0.01)) });
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
    const grip = hittable(handle, handle.document.getElementById('uix-titlebar')!);
    const hand = fakeController([0, 1.6, -1.2]);
    const at = new Vector3(...inFrontOf(grip, 0.01));
    nodeOf(handle).onObjectGrabStart({ handIndex: 0, hand, touchPosition: at });
    host.update(0.01);
    expect(host.manager.get('w')?.dockMode).toBe(DockMode.WorldLocked);
    expect(host.manager.get('w')?.dragging).toBe(true);
    nodeOf(handle).onObjectGrabEnd({ handIndex: 0, hand, touchPosition: at });
    host.update(0.01);
    expect(host.manager.get('w')?.dragging).toBe(false);
  });
});

describe('hover is per pointer, from the bridge own raycast', () => {
  it('each source enters and leaves on its own ray, and the ray is offered to the arbiter', () => {
    const arbiter = new PointerArbiter();
    const bridge = new XrBlocksPointerBridge({ pointers: arbiter });
    const panel = fakePanel(bridge);
    const enters = listen(panel.mesh, 'pointerenter');
    const leaves = listen(panel.mesh, 'pointerleave');
    const left = fakeSided('left');
    const right = fakeSided('right');

    bridge.updateFrame(frameOf({ controller: left }, { controller: right }));
    expect(enters).toHaveLength(2);
    const decision = arbiter.decision('left')!;
    expect(decision.active).toBe('ray');
    expect(decision.candidate?.targetId).toBe(panel.root.uuid);
    expect(decision.candidate?.distance).toBeCloseTo(2, 5);
    expect(decision.candidate?.point[2]).toBeCloseTo(-2, 5);

    bridge.updateFrame(frameOf({ controller: left }, { controller: right }));
    expect(enters).toHaveLength(2); // steady: no repeat events

    bridge.updateFrame(frameOf({ controller: left, x: 5 }, { controller: right }));
    expect(leaves).toHaveLength(1); // only the left pointer left

    bridge.updateFrame(frameOf({ controller: left, x: 5 }));
    expect(leaves).toHaveLength(2); // the right source vanished: it leaves too
    bridge.updateFrame(frameOf({ controller: left, x: 5 }));
    expect(leaves).toHaveLength(2);
  });

  it('raises hover only while the ray owns the source', () => {
    const arbiter = new PointerArbiter();
    const bridge = new XrBlocksPointerBridge({ pointers: arbiter });
    const panel = fakePanel(bridge);
    const enters = listen(panel.mesh, 'pointerenter');
    const other = arbiter.registerSet('interactions', 'object');
    other.offer('left', 'ray', { targetId: 'cube', point: [0, 0, -0.5], distance: 0.5 });
    bridge.updateFrame(frameOf({ controller: fakeSided('left') }));
    expect(enters).toHaveLength(0);
    expect(arbiter.decision('left')?.candidate?.targetId).toBe('cube');
  });

  it('a hidden panel is not raycast, and a hit element that is not live does not enter', () => {
    let live = true;
    let mute = false;
    const bridge = new XrBlocksPointerBridge({ isLive: (element) => live && !(mute && element instanceof Mesh) });
    const panel = fakePanel(bridge);
    const enters = listen(panel.mesh, 'pointerenter');
    mute = true;
    bridge.updateFrame(frameOf({ controller: fakeSided('left') }));
    expect(enters).toHaveLength(0);
    live = false;
    bridge.updateFrame(frameOf({ controller: fakeSided('left') }));
    expect(enters).toHaveLength(0);
  });

  it('the nearest wired panel wins, a missed panel is ignored, and unwire stops raycasting', () => {
    const arbiter = new PointerArbiter();
    const bridge = new XrBlocksPointerBridge({ pointers: arbiter });
    fakePanel(bridge, [0, 0, -4]);
    const near = fakePanel(bridge, [0, 0, -1]);
    fakePanel(bridge, [0, 0, -3]);
    fakePanel(bridge, [9, 0, -1]);
    const enters = listen(near.mesh, 'pointerenter');
    const frame = frameOf({ controller: fakeSided('left') });
    bridge.updateFrame(frame);
    expect(enters).toHaveLength(1);
    expect(arbiter.decision('left')?.candidate?.distance).toBeCloseTo(1, 5);
    bridge.unwire(near.root);
    bridge.updateFrame(frame);
    expect(arbiter.decision('left')?.candidate?.distance).toBeCloseTo(3, 5);
  });

  it('of coplanar hits the deepest element wins, even when the root itself is hit', () => {
    // A uikit panel is a mesh whose elements are coplanar meshes inside it, offset only by render
    // order: the ray through a button hits the window, the content and the button at one distance.
    const bridge = new XrBlocksPointerBridge();
    const root = new Mesh(new PlaneGeometry(1, 1));
    root.position.set(0, 0, -2);
    const content = new Mesh(new PlaneGeometry(0.8, 0.8));
    const button = new Mesh(new PlaneGeometry(0.3, 0.2));
    content.add(button);
    root.add(content);
    root.updateMatrixWorld(true);
    bridge.wire(root);
    const rootEnters = listen(root, 'pointerenter');
    const contentEnters = listen(content, 'pointerenter');
    const buttonEnters = listen(button, 'pointerenter');
    const rootDowns = listen(root, 'pointerdown');
    const buttonDowns = listen(button, 'pointerdown');
    const left = fakeSided('left');
    bridge.updateFrame(frameOf({ controller: left }));
    expect(buttonEnters).toHaveLength(1);
    expect(contentEnters).toHaveLength(0);
    expect(rootEnters).toHaveLength(0);
    // XR Blocks names the window (it skips uikit's hidden-flagged elements); the press still lands on the button.
    selectOn(bridge.scriptOf(root)!, root, left, 'left');
    expect(buttonDowns).toHaveLength(1);
    expect(rootDowns).toHaveLength(1); // bubbled up from the button
    // Beside the button, still on the panel: the content, not the root.
    bridge.updateFrame(frameOf({ controller: left, x: 0.3 }));
    expect(contentEnters).toHaveLength(1);
    expect(rootEnters).toHaveLength(0);
  });

  it('wiring a root twice inserts one node, and updateRays still drives the frame', () => {
    const bridge = new XrBlocksPointerBridge();
    const panel = fakePanel(bridge);
    bridge.wire(panel.root);
    expect(panel.root.parent).toBe(panel.script);
    expect(panel.script.parent).toBeNull();
    const enters = listen(panel.mesh, 'pointerenter');
    bridge.updateRays(frameOf({ controller: fakeSided('left') }));
    expect(enters).toHaveLength(1);
  });
});

describe('a ray press takes part in the shared arbitration', () => {
  it('presses and clicks when the ray owns the source, keyed by handedness', () => {
    const arbiter = new PointerArbiter();
    const bridge = new XrBlocksPointerBridge({ pointers: arbiter });
    const panel = fakePanel(bridge);
    const downs = listen(panel.mesh, 'pointerdown');
    const clicks = listen(panel.mesh, 'click');
    const left = fakeSided('left');
    bridge.updateFrame(frameOf({ controller: left }));
    selectOn(panel.script, panel.mesh, left, 'left');
    expect(downs).toHaveLength(1);
    // The press locks the source: a nearer object offer no longer takes it.
    const other = arbiter.registerSet('interactions', 'object');
    other.offer('left', 'ray', { targetId: 'cube', point: [0, 0, -0.5], distance: 0.5 });
    bridge.updateFrame(frameOf({ controller: left }));
    expect(arbiter.decision('left')?.candidate?.targetId).toBe(panel.root.uuid);
    releaseOn(panel.script, left, 'left');
    expect(clicks).toHaveLength(1);
    bridge.updateFrame(frameOf({ controller: left }));
    expect(arbiter.decision('left')?.candidate?.targetId).toBe('cube'); // released: the nearer object wins
  });

  it('with the frame wired, a release while the ray has moved off the pressed element does not click', () => {
    const bridge = new XrBlocksPointerBridge();
    const panel = fakePanel(bridge);
    const clicks = listen(panel.mesh, 'click');
    const ups = listen(panel.mesh, 'pointerup');
    const left = fakeSided('left');
    bridge.updateFrame(frameOf({ controller: left }));
    selectOn(panel.script, panel.mesh, left, 'left');
    bridge.updateFrame(frameOf({ controller: left, x: 5 })); // the ray left the panel before the release
    releaseOn(panel.script, left, 'left', true);
    expect(ups).toHaveLength(1);
    expect(clicks).toHaveLength(0);
  });

  it('does not press while another set owns the ray, and the release does not click', () => {
    const arbiter = new PointerArbiter();
    const bridge = new XrBlocksPointerBridge({ pointers: arbiter });
    const panel = fakePanel(bridge);
    const downs = listen(panel.mesh, 'pointerdown');
    const clicks = listen(panel.mesh, 'click');
    const other = arbiter.registerSet('interactions', 'object');
    other.offer('right', 'ray', { targetId: 'cube', point: [0, 0, -0.5], distance: 0.5 });
    const right = fakeSided('right');
    bridge.updateFrame(frameOf({ controller: right }));
    selectOn(panel.script, panel.mesh, right, 'right');
    releaseOn(panel.script, right, 'right');
    expect(downs).toHaveLength(0);
    expect(clicks).toHaveLength(0);
  });

  it('without the frame the SDK hit is offered at select time, and a nearer object still wins', () => {
    const arbiter = new PointerArbiter();
    const bridge = new XrBlocksPointerBridge({ pointers: arbiter });
    const panel = fakePanel(bridge);
    const downs = listen(panel.mesh, 'pointerdown');
    const right = fakeSided('right');
    selectOn(panel.script, panel.mesh, right, 'right', 2);
    expect(downs).toHaveLength(1);
    expect(arbiter.decision('right')?.candidate?.distance).toBeCloseTo(2, 5);
    releaseOn(panel.script, right, 'right');

    const other = arbiter.registerSet('interactions', 'object');
    other.offer('left', 'ray', { targetId: 'cube', point: [0, 0, -0.5], distance: 0.5 });
    selectOn(panel.script, panel.mesh, fakeSided('left'), 'left', 2);
    expect(downs).toHaveLength(1);
  });

  it('a hidden element is not pressed, and a release after hiding raises no events', () => {
    let live = true;
    const bridge = new XrBlocksPointerBridge({ isLive: () => live });
    const panel = fakePanel(bridge);
    const downs = listen(panel.mesh, 'pointerdown');
    const ups = listen(panel.mesh, 'pointerup');
    const left = fakeSided('left');
    live = false;
    selectOn(panel.script, panel.mesh, left, 'left');
    expect(downs).toHaveLength(0);
    live = true;
    selectOn(panel.script, panel.mesh, left, 'left');
    expect(downs).toHaveLength(1);
    live = false;
    releaseOn(panel.script, left, 'left');
    expect(ups).toHaveLength(0);
  });

  it('a source with no handedness is keyed by its controller position in the ray sources', () => {
    const arbiter = new PointerArbiter();
    const bridge = new XrBlocksPointerBridge({ pointers: arbiter });
    const panel = fakePanel(bridge);
    const downs = listen(panel.mesh, 'pointerdown');
    const first = fakeSided();
    const second = fakeSided('none');
    bridge.updateFrame(frameOf({ controller: first, x: 5 }, { controller: second }));
    expect(arbiter.decision('controller:0')?.active).toBeNull();
    expect(arbiter.decision('controller:1')?.active).toBe('ray');
    selectOn(panel.script, panel.mesh, second, 'none');
    expect(downs).toHaveLength(1);
    releaseOn(panel.script, second, 'none');
    // A controller the frame does not list gets an unknown-position key of its own.
    selectOn(panel.script, panel.mesh, fakeSided(), 'none');
    expect(arbiter.decision('controller:-1')?.active).toBe('ray');
  });

  it('a select event with no intersection and no surface is ignored', () => {
    const bridge = new XrBlocksPointerBridge();
    const panel = fakePanel(bridge);
    const downs = listen(panel.mesh, 'pointerdown');
    panel.script.onObjectSelectStart({ source: sourceOf(fakeController()), stopPropagation: () => {} });
    expect(downs).toHaveLength(0);
  });
});

describe('a touch takes part in the shared arbitration', () => {
  const touchAt = (z: number, handIndex = 0): XBInputFrameLike => touchFrame(handIndex, [0, 0, -2 + z]);

  it('offers touch for the hand and presses once it owns the source', () => {
    const arbiter = new PointerArbiter();
    const bridge = new XrBlocksPointerBridge({ pointers: arbiter });
    const panel = fakePanel(bridge);
    const downs = listen(panel.mesh, 'pointerdown');
    const clicks = listen(panel.mesh, 'click');
    bridge.updateFrame(touchAt(0.05, 1));
    bridge.updateFrame(touchAt(0.01, 1));
    expect(downs).toHaveLength(1);
    const decision = arbiter.decision('right')!;
    expect(decision.active).toBe('touch');
    expect(decision.candidate?.distance).toBeCloseTo(0.01, 5);
    bridge.updateFrame(touchAt(0.05, 1));
    expect(clicks).toHaveLength(1);
    bridge.updateFrame({ raySources: [] });
    expect(arbiter.decision('right')?.active).toBeNull();
  });

  it('does not press when another set has the nearer touch, and never steals a held press', () => {
    const arbiter = new PointerArbiter();
    const bridge = new XrBlocksPointerBridge({ pointers: arbiter });
    const panel = fakePanel(bridge);
    const downs = listen(panel.mesh, 'pointerdown');
    const other = arbiter.registerSet('interactions', 'object');
    other.offer('left', 'touch', { targetId: 'cube', point: [0, 0, 0], distance: 0.005 });
    bridge.updateFrame(touchAt(0.05));
    bridge.updateFrame(touchAt(0.01));
    expect(downs).toHaveLength(0);
    expect(arbiter.decision('left')?.candidate?.targetId).toBe('cube');

    // The object touch ends; the panel presses; a nearer object touch later cannot take the hold.
    other.offer('left', 'touch', null);
    bridge.updateFrame(touchAt(0.05));
    bridge.updateFrame(touchAt(0.01));
    expect(downs).toHaveLength(1);
    other.offer('left', 'touch', { targetId: 'cube', point: [0, 0, 0], distance: 0.001 });
    bridge.updateFrame(touchAt(0.012));
    expect(arbiter.decision('left')?.candidate?.targetId).toBe(panel.root.uuid);
  });

  it('a hidden element offers nothing', () => {
    const arbiter = new PointerArbiter();
    const bridge = new XrBlocksPointerBridge({ pointers: arbiter, isLive: () => false });
    const panel = fakePanel(bridge);
    bridge.updateFrame(touchAt(0.01));
    expect(arbiter.decision('left')).toBeUndefined();
    expect(panel.root.visible).toBe(true);
  });

  it('the nearest panel under the fingertip wins', () => {
    const arbiter = new PointerArbiter();
    const bridge = new XrBlocksPointerBridge({ pointers: arbiter });
    const far = fakePanel(bridge, [0, 0, -2.1]);
    const near = fakePanel(bridge, [0, 0, -2]);
    const nearDowns = listen(near.mesh, 'pointerdown');
    const farDowns = listen(far.mesh, 'pointerdown');
    bridge.updateFrame(touchAt(0.05));
    bridge.updateFrame(touchAt(0.01));
    expect(nearDowns).toHaveLength(1);
    expect(farDowns).toHaveLength(0);
  });
});

describe('a grab takes part in the shared arbitration', () => {
  const gripAt = (panel: { mesh: Mesh }, z = 0.01) => new Vector3(...inFrontOf(panel.mesh, z));

  it('offers the grip position at distance 0 and locks the source until released', () => {
    const arbiter = new PointerArbiter();
    const bridge = new XrBlocksPointerBridge({ pointers: arbiter });
    const panel = fakePanel(bridge);
    panel.mesh.userData['id'] = WINDOW_CHROME_IDS.titlebar;
    const downs = listen(panel.mesh, 'pointerdown');
    const clicks = listen(panel.mesh, 'click');
    const hand = fakeController([0.1, 0.2, -1.9]);
    panel.script.onObjectGrabStart({ handIndex: 1, hand, touchPosition: gripAt(panel) });
    expect(downs).toHaveLength(1);
    const decision = arbiter.decision('right')!;
    expect(decision.active).toBe('grab');
    expect(decision.candidate?.distance).toBe(0);
    expect(decision.candidate?.point[0]).toBeCloseTo(0.1, 5);
    expect(decision.candidate?.point[1]).toBeCloseTo(0.2, 5);
    expect(decision.candidate?.point[2]).toBeCloseTo(-1.9, 5);
    panel.script.onObjectGrabEnd({ handIndex: 1, hand, touchPosition: gripAt(panel) });
    expect(clicks).toHaveLength(1);
    expect(arbiter.decision('right')?.active).toBeNull();
    panel.script.onObjectGrabEnd({ handIndex: 1, hand, touchPosition: gripAt(panel) }); // a second release is ignored
    expect(clicks).toHaveLength(1);
  });

  it('a grab off the title bar locks the hand but presses nothing', () => {
    const bridge = new XrBlocksPointerBridge();
    const panel = fakePanel(bridge);
    const downs = listen(panel.mesh, 'pointerdown');
    const clicks = listen(panel.mesh, 'click');
    panel.script.onObjectGrabStart({ handIndex: 0, hand: fakeController(), touchPosition: gripAt(panel) });
    panel.script.onObjectGrabEnd({ handIndex: 0, hand: fakeController(), touchPosition: gripAt(panel) });
    expect(downs).toHaveLength(0);
    expect(clicks).toHaveLength(0);
  });

  it('a grab beside the panel holds the panel itself, which is no title bar', () => {
    const bridge = new XrBlocksPointerBridge();
    const panel = fakePanel(bridge);
    panel.mesh.userData['id'] = WINDOW_CHROME_IDS.titlebar;
    const downs = listen(panel.mesh, 'pointerdown');
    panel.script.onObjectGrabStart({ handIndex: 0, hand: fakeController(), touchPosition: new Vector3(5, 0, -2) });
    expect(downs).toHaveLength(0);
  });

  it('does not grab while another set owns the hand with a higher-priority pointer', () => {
    const arbiter = new PointerArbiter();
    const bridge = new XrBlocksPointerBridge({ pointers: arbiter });
    const panel = fakePanel(bridge);
    panel.mesh.userData['id'] = WINDOW_CHROME_IDS.titlebar;
    const downs = listen(panel.mesh, 'pointerdown');
    const other = arbiter.registerSet('interactions', 'object');
    other.offer('left', 'touch', { targetId: 'cube', point: [0, 0, 0], distance: 0.01 });
    panel.script.onObjectGrabStart({ handIndex: 0, hand: fakeController(), touchPosition: gripAt(panel) });
    panel.script.onObjectGrabEnd({ handIndex: 0, hand: fakeController(), touchPosition: gripAt(panel) });
    expect(downs).toHaveLength(0);
  });

  it('a hidden element is not grabbed, and a release after hiding raises no events', () => {
    let live = true;
    const bridge = new XrBlocksPointerBridge({ isLive: () => live });
    const panel = fakePanel(bridge);
    panel.mesh.userData['id'] = WINDOW_CHROME_IDS.titlebar;
    const ups = listen(panel.mesh, 'pointerup');
    live = false;
    panel.script.onObjectGrabStart({ handIndex: 0, hand: fakeController(), touchPosition: gripAt(panel) });
    panel.script.onObjectGrabEnd({ handIndex: 0, hand: fakeController(), touchPosition: gripAt(panel) });
    live = true;
    panel.script.onObjectGrabStart({ handIndex: 0, hand: fakeController(), touchPosition: gripAt(panel) });
    live = false;
    panel.script.onObjectGrabEnd({ handIndex: 0, hand: fakeController(), touchPosition: gripAt(panel) });
    expect(ups).toHaveLength(0);
  });
});
