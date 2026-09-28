/**
 * The WebXR session wiring: `cameraHeadPoseSource`, `webxrHandPoseSource`
 * (the same logic `xrblocks-uiextensions`'s own `xrblocks.ts` carries its own
 * copy of, for a scene with no `renderer.xr`) and `connectWebXrPointerInput`,
 * proved against fakes built from real three.js `Object3D`s dispatching real
 * events - the same substitution `pointer-bridge.test.ts` uses for the bridge
 * itself, one layer further out: here the fake stands in for `renderer.xr`,
 * not for a resolved hit.
 */
import { Group, Mesh, Object3D, PerspectiveCamera, PlaneGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { ScenePointerBridge } from '../src/pointer-bridge.js';
import {
  cameraHeadPoseSource,
  connectWebXrPointerInput,
  webxrHandPoseSource,
  type WebXRManagerLike,
} from '../src/webxr-input.js';

describe('cameraHeadPoseSource', () => {
  it('reads the camera world position and orientation', () => {
    const camera = new PerspectiveCamera();
    camera.position.set(0, 1.6, 0.5);
    camera.updateMatrixWorld(true);
    const pose = cameraHeadPoseSource(camera).getHeadPose();
    expect(pose.position).toEqual([0, 1.6, 0.5]);
    expect(pose.quaternion).toEqual([0, 0, 0, 1]);
  });
});

describe('webxrHandPoseSource', () => {
  type FakeSource = { handedness: string; gripSpace?: object; targetRaySpace: object };

  function makeXR(sources: FakeSource[], posed = true) {
    const referenceSpace = {};
    const frame = {
      getPose: (space: object) =>
        posed
          ? {
              transform: {
                position: { x: 1, y: 2, z: 3 },
                orientation: { x: 0, y: 0, z: 1, w: 0 },
                space,
              },
            }
          : null,
    };
    const session = { inputSources: sources };
    const asked: object[] = [];
    const xr = {
      getFrame: () => ({ getPose: (space: object, ref: object) => (asked.push(space), ref === referenceSpace ? frame.getPose(space) : null) }),
      getReferenceSpace: () => referenceSpace,
      getSession: () => session,
    };
    return { xr: xr as unknown as Parameters<typeof webxrHandPoseSource>[0], asked };
  }

  it('reads the grip space of the matching input source', () => {
    const grip = {};
    const { xr, asked } = makeXR([{ handedness: 'left', gripSpace: grip, targetRaySpace: {} }]);
    const pose = webxrHandPoseSource(xr).getHandPose('left');
    expect(pose).toEqual({ position: [1, 2, 3], quaternion: [0, 0, 1, 0] });
    expect(asked).toEqual([grip]);
  });

  it('falls back to the target ray space when a hand has no grip space', () => {
    const ray = {};
    const { xr, asked } = makeXR([{ handedness: 'right', targetRaySpace: ray }]);
    expect(webxrHandPoseSource(xr).getHandPose('right')).toBeDefined();
    expect(asked).toEqual([ray]);
  });

  it('is undefined for an untracked hand, an unposed space, or outside a session', () => {
    const { xr } = makeXR([{ handedness: 'left', targetRaySpace: {} }]);
    expect(webxrHandPoseSource(xr).getHandPose('right')).toBeUndefined();
    const { xr: unposed } = makeXR([{ handedness: 'left', targetRaySpace: {} }], false);
    expect(webxrHandPoseSource(unposed).getHandPose('left')).toBeUndefined();
    const none = { getFrame: () => null, getReferenceSpace: () => null, getSession: () => null };
    expect(webxrHandPoseSource(none).getHandPose('left')).toBeUndefined();
  });
});

/** A fake `renderer.xr`: real three.js controller/grip/hand `Object3D`s a test drives like a real session would. */
function fakeXrManager() {
  const controllers = [new Object3D(), new Object3D()];
  const grips = [new Object3D(), new Object3D()];
  const hands = [new Object3D() as Object3D & { joints: Record<string, Object3D | undefined> }, new Object3D() as Object3D & { joints: Record<string, Object3D | undefined> }];
  for (const hand of hands) hand.joints = {};
  for (const c of [...controllers, ...grips, ...hands]) c.visible = false;
  const xr: WebXRManagerLike = {
    getFrame: () => null,
    getReferenceSpace: () => null,
    getSession: () => null,
    getController: (i) => controllers[i]!,
    getControllerGrip: (i) => grips[i]!,
    getHand: (i) => hands[i]!,
  };
  return { xr, controllers, grips, hands };
}

function wirePanel(bridge: ScenePointerBridge, position: [number, number, number]): Mesh {
  const mesh = new Mesh(new PlaneGeometry(1, 1));
  mesh.position.set(...position);
  mesh.updateMatrixWorld(true);
  bridge.wire(mesh);
  return mesh;
}

describe('connectWebXrPointerInput', () => {
  it('a selectstart/selectend pair on a visible controller presses and releases whatever its ray hits', () => {
    const { xr, controllers } = fakeXrManager();
    const bridge = new ScenePointerBridge();
    const mesh = wirePanel(bridge, [0, 0, -1]);
    controllers[0]!.visible = true;
    controllers[0]!.position.set(0, 0, 0);
    controllers[0]!.updateMatrixWorld(true); // faces local -Z -> world -Z, straight at the mesh

    const downs: unknown[] = [];
    const ups: unknown[] = [];
    mesh.addEventListener('pointerdown', (e) => downs.push(e));
    mesh.addEventListener('pointerup', (e) => ups.push(e));

    const input = connectWebXrPointerInput({ renderer: { xr }, bridge });
    (controllers[0] as unknown as { dispatchEvent(e: { type: string }): void }).dispatchEvent({ type: 'selectstart' });
    expect(downs).toHaveLength(1);
    (controllers[0] as unknown as { dispatchEvent(e: { type: string }): void }).dispatchEvent({ type: 'selectend' });
    expect(ups).toHaveLength(1);
    input.dispose();
  });

  it('a selectstart with nothing in the ray never presses, and the matching selectend is a no-op', () => {
    const { xr, controllers } = fakeXrManager();
    const bridge = new ScenePointerBridge();
    const mesh = wirePanel(bridge, [5, 5, 5]); // well off the controller's ray
    controllers[0]!.visible = true;
    controllers[0]!.updateMatrixWorld(true);
    const downs: unknown[] = [];
    const ups: unknown[] = [];
    mesh.addEventListener('pointerdown', (e) => downs.push(e));
    mesh.addEventListener('pointerup', (e) => ups.push(e));

    const input = connectWebXrPointerInput({ renderer: { xr }, bridge });
    const dispatch = (type: string) => (controllers[0] as unknown as { dispatchEvent(e: { type: string }): void }).dispatchEvent({ type });
    dispatch('selectstart');
    expect(downs).toHaveLength(0);
    expect(() => dispatch('selectend')).not.toThrow();
    expect(ups).toHaveLength(0);
    input.dispose();
  });

  it('a squeezestart/squeezeend pair near a panel presses and releases, sampled from the GRIP position - three dispatches squeeze on the controller object, same as select', () => {
    const { xr, controllers, grips } = fakeXrManager();
    const bridge = new ScenePointerBridge();
    const mesh = wirePanel(bridge, [0, 0, -1]);
    // The grip (not the controller/ray) is where a near/grab press is sampled from.
    grips[0]!.position.set(0, 0, -1.05); // within the default 0.12 m grab distance
    grips[0]!.updateMatrixWorld(true);

    const downs: unknown[] = [];
    mesh.addEventListener('pointerdown', (e) => downs.push(e));

    const input = connectWebXrPointerInput({ renderer: { xr }, bridge });
    const dispatch = (type: string) => (controllers[0] as unknown as { dispatchEvent(e: { type: string }): void }).dispatchEvent({ type });
    dispatch('squeezestart');
    expect(downs).toHaveLength(1);
    dispatch('squeezeend');
    input.dispose();
  });

  it('update() dispatches hover enter/leave as a visible controller ray moves on and off a panel', () => {
    const { xr, controllers } = fakeXrManager();
    const bridge = new ScenePointerBridge();
    const mesh = wirePanel(bridge, [0, 0, -1]);
    controllers[0]!.visible = true;
    controllers[0]!.position.set(0, 0, 0);
    controllers[0]!.updateMatrixWorld(true);

    const enters: unknown[] = [];
    const leaves: unknown[] = [];
    mesh.addEventListener('pointerenter', (e) => enters.push(e));
    mesh.addEventListener('pointerleave', (e) => leaves.push(e));

    const input = connectWebXrPointerInput({ renderer: { xr }, bridge });
    input.update();
    expect(enters).toHaveLength(1);
    input.update();
    expect(enters).toHaveLength(1); // still hovering - no repeat enter

    controllers[0]!.rotation.set(0, Math.PI / 2, 0); // turn away from the mesh
    controllers[0]!.updateMatrixWorld(true);
    input.update();
    expect(leaves).toHaveLength(1);
    input.dispose();
  });

  it('update() drives touch from a tracked hand joint, pressing and releasing through the core TouchPress', () => {
    const { xr, hands } = fakeXrManager();
    const bridge = new ScenePointerBridge();
    const mesh = wirePanel(bridge, [0, 0, -1]);
    const tip = new Object3D();
    hands[0]!.joints['index-finger-tip'] = tip;
    hands[0]!.visible = true;

    const downs: unknown[] = [];
    const clicks: unknown[] = [];
    mesh.addEventListener('pointerdown', (e) => downs.push(e));
    mesh.addEventListener('click', (e) => clicks.push(e));

    const input = connectWebXrPointerInput({ renderer: { xr }, bridge });
    for (const z of [-0.97, -0.995, -0.97]) {
      tip.position.set(0, 0, z);
      tip.updateMatrixWorld(true);
      input.update();
    }
    expect(downs).toHaveLength(1);
    expect(clicks).toHaveLength(1);
    input.dispose();
  });

  it('update() reports no touch once a hand is no longer tracked', () => {
    const { xr, hands } = fakeXrManager();
    const bridge = new ScenePointerBridge();
    wirePanel(bridge, [0, 0, -1]);
    const tip = new Object3D();
    hands[0]!.joints['index-finger-tip'] = tip;
    hands[0]!.visible = false; // not tracked this frame
    tip.position.set(0, 0, -0.99);
    tip.updateMatrixWorld(true);
    const input = connectWebXrPointerInput({ renderer: { xr }, bridge });
    expect(() => input.update()).not.toThrow();
    input.dispose();
  });

  it('dispose() removes the session listeners, so a later select does nothing', () => {
    const { xr, controllers } = fakeXrManager();
    const bridge = new ScenePointerBridge();
    const mesh = wirePanel(bridge, [0, 0, -1]);
    controllers[0]!.visible = true;
    controllers[0]!.updateMatrixWorld(true);
    const downs: unknown[] = [];
    mesh.addEventListener('pointerdown', (e) => downs.push(e));
    const input = connectWebXrPointerInput({ renderer: { xr }, bridge });
    input.dispose();
    (controllers[0] as unknown as { dispatchEvent(e: { type: string }): void }).dispatchEvent({ type: 'selectstart' });
    expect(downs).toHaveLength(0);
  });

  describe('ui/pointer-cursor: a disc at every ray hit, whatever presence says', () => {
    it('update() shows a cursor disc at the ray hit on a panel, given a scene', () => {
      const { xr, controllers } = fakeXrManager();
      const bridge = new ScenePointerBridge();
      wirePanel(bridge, [0, 0, -1]);
      controllers[0]!.visible = true;
      controllers[0]!.position.set(0, 0, 0);
      controllers[0]!.updateMatrixWorld(true);

      const scene = new Group();
      const input = connectWebXrPointerInput({ renderer: { xr }, bridge, scene });
      input.update();
      const cursor = scene.children.find((child) => child.name === 'uix-cursor')!;
      expect(cursor).toBeDefined();
      expect(cursor.visible).toBe(true);
      expect(cursor.position.z).toBeGreaterThan(-1); // nudged off the panel, toward the controller
      input.dispose();
    });

    it('the cursor hides once the ray no longer hits anything - the negative case', () => {
      const { xr, controllers } = fakeXrManager();
      const bridge = new ScenePointerBridge();
      wirePanel(bridge, [0, 0, -1]);
      controllers[0]!.visible = true;
      controllers[0]!.position.set(0, 0, 0);
      controllers[0]!.updateMatrixWorld(true);

      const scene = new Group();
      const input = connectWebXrPointerInput({ renderer: { xr }, bridge, scene });
      input.update();
      const cursor = scene.children.find((child) => child.name === 'uix-cursor')!;
      expect(cursor.visible).toBe(true);

      controllers[0]!.rotation.set(0, Math.PI, 0); // turn away - the ray now hits nothing
      controllers[0]!.updateMatrixWorld(true);
      input.update();
      expect(cursor.visible).toBe(false);
      input.dispose();
    });

    it('presence (hover) never hides the cursor - it stays shown the same frame hover also fires', () => {
      const { xr, controllers } = fakeXrManager();
      const bridge = new ScenePointerBridge();
      const mesh = wirePanel(bridge, [0, 0, -1]);
      controllers[0]!.visible = true;
      controllers[0]!.position.set(0, 0, 0);
      controllers[0]!.updateMatrixWorld(true);
      const enters: unknown[] = [];
      mesh.addEventListener('pointerenter', (e) => enters.push(e));

      const scene = new Group();
      const input = connectWebXrPointerInput({ renderer: { xr }, bridge, scene });
      input.update();
      const cursor = scene.children.find((child) => child.name === 'uix-cursor')!;
      expect(enters).toHaveLength(1); // hover fired...
      expect(cursor.visible).toBe(true); // ...and the cursor is shown regardless, not gated on it
      input.dispose();
    });

    it('with no scene, cursors are skipped entirely - no disc is created, and nothing throws', () => {
      const { xr, controllers } = fakeXrManager();
      const bridge = new ScenePointerBridge();
      wirePanel(bridge, [0, 0, -1]);
      controllers[0]!.visible = true;
      controllers[0]!.updateMatrixWorld(true);
      const input = connectWebXrPointerInput({ renderer: { xr }, bridge });
      expect(() => input.update()).not.toThrow();
      expect(() => input.dispose()).not.toThrow();
    });

    it('dispose() removes every cursor disc from the scene', () => {
      const { xr, controllers } = fakeXrManager();
      const bridge = new ScenePointerBridge();
      wirePanel(bridge, [0, 0, -1]);
      controllers[0]!.visible = true;
      controllers[0]!.updateMatrixWorld(true);
      const scene = new Group();
      const input = connectWebXrPointerInput({ renderer: { xr }, bridge, scene, controllerCount: 1 });
      input.update();
      expect(scene.children).toHaveLength(1);
      input.dispose();
      expect(scene.children).toHaveLength(0);
    });
  });
});
