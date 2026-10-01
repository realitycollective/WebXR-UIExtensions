/**
 * The three.js binding on the shared pointer arbiter: every slot's ray,
 * fingertip and grip offer the panel they reach, keyed by the session input
 * source's handedness, and hover, press and touch act only while this host
 * owns the source (IWSDK's MultiPointer over every pointer-event object).
 */
import { describe, expect, it } from 'vitest';
import { Mesh, Object3D, PlaneGeometry, Scene } from 'three';
import { PointerArbiter } from '@realitycollective/webxr-input';
import { UIX_POINTER_SET } from '@realitycollective/webxr-uiextensions';
import { ScenePointerBridge, connectWebXrPointerInput, type WebXRManagerLike } from '@realitycollective/threejs-uiextensions';

function fakeXrManager(handedness: Array<'left' | 'right' | undefined> = ['left', 'right']) {
  const controllers = [new Object3D(), new Object3D()];
  const grips = [new Object3D(), new Object3D()];
  const hands = [new Object3D() as Object3D & { joints: Record<string, Object3D | undefined> }, new Object3D() as Object3D & { joints: Record<string, Object3D | undefined> }];
  for (const hand of hands) hand.joints = {};
  for (const c of [...controllers, ...grips, ...hands]) c.visible = false;
  const session = { inputSources: handedness.map((h) => (h ? { handedness: h } : {})) } as unknown as XRSession;
  const xr: WebXRManagerLike = {
    getFrame: () => null,
    getReferenceSpace: () => null,
    getSession: () => session,
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

function dispatch(controller: Object3D, type: string): void {
  (controller as unknown as { dispatchEvent(e: { type: string }): void }).dispatchEvent({ type });
}

describe('connectWebXrPointerInput on a shared arbiter', () => {
  it('offers the ray hit under the side, the decision names the panel, and no cursor of its own is drawn', () => {
    const arbiter = new PointerArbiter();
    const { xr, controllers } = fakeXrManager();
    const bridge = new ScenePointerBridge();
    const mesh = wirePanel(bridge, [0, 0, -1]);
    controllers[0]!.visible = true;
    controllers[0]!.updateMatrixWorld(true);
    const scene = new Scene();
    const input = connectWebXrPointerInput({ renderer: { xr }, bridge, pointers: arbiter, scene });
    input.update();
    expect(arbiter.decision('left')).toMatchObject({ active: 'ray', candidate: { set: UIX_POINTER_SET, targetKind: 'panel', targetId: mesh.uuid } });
    expect(arbiter.decision('left')?.candidate?.distance).toBeCloseTo(1);
    expect(scene.children).toHaveLength(0);
    // A slot with no handedness keys by its index.
    const noSide = fakeXrManager([undefined, 'right']);
    noSide.controllers[0]!.visible = true;
    noSide.controllers[0]!.updateMatrixWorld(true);
    const other = new PointerArbiter();
    const bridge2 = new ScenePointerBridge();
    wirePanel(bridge2, [0, 0, -1]);
    const input2 = connectWebXrPointerInput({ renderer: { xr: noSide.xr }, bridge: bridge2, pointers: other });
    input2.update();
    expect(other.decision('slot:0')?.active).toBe('ray');
    input2.dispose();
    input.dispose();
    expect(arbiter.getSets()).toEqual([]);
  });

  it("an interactable's touch on the same side retires the panel's hover and press, and the press returns once the source is free", () => {
    const arbiter = new PointerArbiter();
    const objects = arbiter.registerSet('interactions', 'object');
    const { xr, controllers } = fakeXrManager();
    const bridge = new ScenePointerBridge();
    const mesh = wirePanel(bridge, [0, 0, -1]);
    controllers[0]!.visible = true;
    controllers[0]!.updateMatrixWorld(true);
    const events: string[] = [];
    for (const type of ['pointerenter', 'pointerleave', 'pointerdown', 'pointerup', 'click']) mesh.addEventListener(type as never, () => events.push(type));
    const input = connectWebXrPointerInput({ renderer: { xr }, bridge, pointers: arbiter });
    input.update();
    expect(events).toEqual(['pointerenter']);
    objects.offer('left', 'touch', { targetId: 'button', point: [0.3, 0, -0.4], distance: 0.01 });
    input.update();
    expect(events).toEqual(['pointerenter', 'pointerleave']);
    dispatch(controllers[0]!, 'selectstart');
    dispatch(controllers[0]!, 'selectend');
    expect(events).toEqual(['pointerenter', 'pointerleave']);
    objects.offer('left', 'touch', null);
    input.update();
    dispatch(controllers[0]!, 'selectstart');
    // While the ray presses, an object touch cannot take the source.
    objects.offer('left', 'touch', { targetId: 'button', point: [0.3, 0, -0.4], distance: 0.01 });
    input.update();
    expect(arbiter.decision('left')?.active).toBe('ray');
    dispatch(controllers[0]!, 'selectend');
    expect(events).toEqual(['pointerenter', 'pointerleave', 'pointerenter', 'pointerdown', 'pointerup', 'click']);
    input.update();
    expect(arbiter.decision('left')?.active).toBe('touch');
    input.dispose();
  });

  it('a fingertip on a panel is offered as touch and pressing locks it; a grip near a panel is offered as grab; a squeeze needs the grab to own the source', () => {
    const arbiter = new PointerArbiter();
    const objects = arbiter.registerSet('interactions', 'object');
    const { xr, controllers, grips, hands } = fakeXrManager();
    const bridge = new ScenePointerBridge();
    const mesh = wirePanel(bridge, [0, 0, -1]);
    const events: string[] = [];
    for (const type of ['pointerdown', 'pointerup', 'click']) mesh.addEventListener(type as never, () => events.push(type));
    const input = connectWebXrPointerInput({ renderer: { xr }, bridge, pointers: arbiter });
    hands[1]!.visible = true;
    const tip = new Object3D();
    tip.position.set(0, 0, -0.95);
    tip.updateMatrixWorld(true);
    hands[1]!.joints['index-finger-tip'] = tip;
    input.update();
    expect(arbiter.decision('right')).toMatchObject({ active: 'touch', candidate: { targetKind: 'panel' } });
    expect(arbiter.decision('right')?.candidate?.distance).toBeCloseTo(0.05);
    tip.position.set(0, 0, -0.99);
    tip.updateMatrixWorld(true);
    input.update();
    expect(events).toEqual(['pointerdown']);
    // Locked while pressing: a nearer object grab does not take the hand.
    objects.offer('right', 'grab', { targetId: 'ball', point: [0, 0, -1], distance: 0 });
    input.update();
    expect(arbiter.decision('right')?.active).toBe('touch');
    hands[1]!.visible = false;
    objects.offer('right', 'grab', null);
    input.update();
    // Contact lost ends the hold with no click (the core touch rule).
    expect(events).toEqual(['pointerdown', 'pointerup']);
    // The grip near the panel offers a grab; a squeeze while an object owns the grab presses nothing.
    grips[0]!.visible = true;
    grips[0]!.position.set(0, 0, -0.95);
    grips[0]!.updateMatrixWorld(true);
    objects.offer('left', 'grab', { targetId: 'ball', point: [0, 0, -1], distance: 0 });
    input.update();
    expect(arbiter.decision('left')?.candidate?.set).toBe('interactions');
    dispatch(controllers[0]!, 'squeezestart');
    dispatch(controllers[0]!, 'squeezeend');
    expect(events).toEqual(['pointerdown', 'pointerup']);
    objects.offer('left', 'grab', null);
    input.update();
    expect(arbiter.decision('left')).toMatchObject({ active: 'grab', candidate: { targetKind: 'panel' } });
    dispatch(controllers[0]!, 'squeezestart');
    expect(events).toEqual(['pointerdown', 'pointerup', 'pointerdown']);
    dispatch(controllers[0]!, 'squeezeend');
    expect(events).toEqual(['pointerdown', 'pointerup', 'pointerdown', 'pointerup', 'click']);
    input.dispose();
  });
});
