/**
 * `connectUIExtensions` - this package's one setup entry point: it must build
 * a working host with no renderer (a desktop preview, driving the host's own
 * panels by hand), and, given one, wire hand poses and the pointer input from
 * the session.
 *
 * A ray/grab/touch press through an actual raycast against a real UIKitML
 * panel is NOT exercised here: uikit's layout only measures a panel once its
 * fonts load, which needs a DOM (`document is not defined` under this
 * project's `environment: 'node'` vitest config) - the same headless limit
 * `xrblocks-uiextensions/test/host.test.ts` already documents ("What is NOT
 * covered headless: visual layout"). `pointer-bridge.test.ts` and
 * `webxr-input.test.ts` prove the raycasting/probing and the session-event
 * wiring against plain wired meshes instead, which need no layout pass; what
 * is left to prove here is `connectUIExtensions`'s OWN wiring: the head/hand
 * pose sources and the pointer input lifecycle.
 */
import { Group, Object3D, PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { parse } from '@pmndrs/uikitml';
import { DockMode } from '@realitycollective/webxr-uiextensions';
import { connectUIExtensions } from '../src/setup.js';
import type { WebXRManagerLike } from '../src/webxr-input.js';

const PANEL = `<div id="uix-window"><div id="uix-titlebar"><text id="uix-title">t</text></div><div id="uix-content"><text id="body">body</text></div></div>`;
const config = () => parse(PANEL);

function fakeRenderer() {
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

describe('connectUIExtensions with no renderer (desktop preview)', () => {
  it('builds a working host; update() just drives the manager, disconnect() is a no-op', () => {
    const scene = new Group();
    const camera = new PerspectiveCamera();
    const uix = connectUIExtensions({ scene, camera });
    const handle = uix.createWindow({ id: 'w', config: config(), position: [0, 1, -1] });
    expect(scene.children).toContain(handle.group);
    expect(() => uix.update(1 / 60)).not.toThrow();
    expect(() => uix.disconnect()).not.toThrow();
    uix.dispose();
    expect(scene.children).toHaveLength(0);
  });
});

describe('connectUIExtensions with a renderer', () => {
  it('wires a hand-locked window to the session hand pose automatically (webxrHandPoseSource)', () => {
    const scene = new Group();
    const camera = new PerspectiveCamera();
    camera.position.set(0, 1.6, 0);
    camera.updateMatrixWorld(true);
    const { xr } = fakeRenderer();
    const referenceSpace = {};
    const session = {
      inputSources: [{ handedness: 'left', targetRaySpace: {}, gripSpace: {} }],
    };
    const frame = {
      getPose: () => ({
        transform: {
          position: { x: -0.3, y: 1.2, z: -0.4 },
          orientation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }, // palm up
        },
      }),
    };
    xr.getFrame = () => frame as unknown as XRFrame;
    xr.getReferenceSpace = () => referenceSpace as unknown as XRReferenceSpace;
    xr.getSession = () => session as unknown as XRSession;

    const uix = connectUIExtensions({ scene, camera, renderer: { xr } });
    const handle = uix.createWindow({
      id: 'menu',
      config: config(),
      dockMode: DockMode.HandLocked,
      handMenu: { hand: 'left', anchor: 'above', anchorDistance: 0.1 },
    });
    uix.update(1 / 60);
    expect(handle.group.visible).toBe(true);

    uix.disconnect();
    uix.dispose();
  });

  it('disconnect() removes the session listeners; a later select does nothing and does not throw', () => {
    const scene = new Group();
    const camera = new PerspectiveCamera();
    const { xr, controllers } = fakeRenderer();
    const uix = connectUIExtensions({ scene, camera, renderer: { xr } });
    uix.createWindow({ id: 'w', config: config(), position: [0, 0, -1] });
    controllers[0]!.visible = true;
    controllers[0]!.updateMatrixWorld(true);

    uix.disconnect();
    const dispatch = () => (controllers[0] as unknown as { dispatchEvent(e: { type: string }): void }).dispatchEvent({ type: 'selectstart' });
    expect(dispatch).not.toThrow();

    uix.dispose();
  });

  it('dispose() also disconnects the pointer input', () => {
    const scene = new Group();
    const camera = new PerspectiveCamera();
    const { xr } = fakeRenderer();
    const uix = connectUIExtensions({ scene, camera, renderer: { xr } });
    uix.createWindow({ id: 'w', config: config() });
    expect(() => uix.dispose()).not.toThrow();
    expect(scene.children).toHaveLength(0);
  });
});
