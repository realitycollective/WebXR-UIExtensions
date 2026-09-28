import { describe, expect, it } from 'vitest';
import { DockMode } from '../src/core/dock-state.js';
import { RegionRegistry } from '../src/core/region-registry.js';
import { TitlebarDragController } from '../src/core/titlebar-drag.js';
import { WindowManager } from '../src/core/window-manager.js';
import type { PoseTuple, Vec3Tuple } from '@realitycollective/webxr-input';

const IDENTITY: PoseTuple = { position: [0, 1.6, -1], quaternion: [0, 0, 0, 1] };

function setup(options: { registry?: RegionRegistry; holdDelaySeconds?: number; billboard?: boolean } = {}) {
  const manager = new WindowManager();
  manager.open('w', { dockMode: DockMode.WorldLocked });
  const controller = new TitlebarDragController({
    manager,
    windowId: 'w',
    ...(options.registry ? { registry: options.registry } : {}),
    ...(options.holdDelaySeconds !== undefined ? { holdDelaySeconds: options.holdDelaySeconds } : {}),
    ...(options.billboard !== undefined ? { billboard: options.billboard } : {}),
  });
  return { manager, controller };
}

describe('TitlebarDragController: hold-to-drag timing', () => {
  it('a ray press held past the delay drags; a shorter press does not move the window', () => {
    const { controller } = setup();
    controller.beginPress({ kind: 'ray', point: [0, 1.7, -1], ray: { origin: [0, 1.6, 0], direction: [0, 0, -1] } }, IDENTITY.position);
    let pose = IDENTITY;
    pose = controller.step(0.1, true, { ray: { origin: [0, 1.6, 0], direction: [0, 0, -1] } }, pose);
    pose = controller.step(0.1, false, undefined, pose); // released before the 0.3 s delay
    expect(pose).toEqual(IDENTITY);
    expect(controller.dragging).toBe(false);
  });

  it('crossing the default 0.3 s delay begins a ray drag', () => {
    const { controller } = setup();
    controller.beginPress({ kind: 'ray', point: [0.05, 1.6, -1], ray: { origin: [0, 1.6, 0], direction: [0.05, 0, -1] } }, IDENTITY.position);
    let pose = controller.step(0.2, true, { ray: { origin: [0, 1.6, 0], direction: [0.05, 0, -1] } }, IDENTITY);
    expect(controller.dragging).toBe(false);
    pose = controller.step(0.2, true, { ray: { origin: [0, 1.6, 0], direction: [0.6, 0, -0.8] } }, pose);
    expect(controller.dragging).toBe(true);
    expect(pose).not.toEqual(IDENTITY);
  });

  it('a shorter holdDelaySeconds (a per-window dragDelay) begins the drag sooner', () => {
    const { controller } = setup({ holdDelaySeconds: 0.05 });
    controller.beginPress({ kind: 'ray', point: [0.05, 1.6, -1], ray: { origin: [0, 1.6, 0], direction: [0.05, 0, -1] } }, IDENTITY.position);
    controller.step(0.06, true, { ray: { origin: [0, 1.6, 0], direction: [0.05, 0, -1] } }, IDENTITY);
    expect(controller.dragging).toBe(true);
  });

  it('a grab drags at once, ignoring the hold delay', () => {
    const { controller } = setup();
    controller.beginPress({ kind: 'grab', point: [0, 1.7, -1] }, IDENTITY.position);
    const pose = controller.step(0.001, true, { point: [0.1, 1.7, -1] }, IDENTITY);
    expect(controller.dragging).toBe(true);
    expect(pose.position[0]).toBeCloseTo(0.1, 9);
  });

  it('a second beginPress while one is already held is ignored (first press wins)', () => {
    const { controller } = setup();
    controller.beginPress({ kind: 'grab', point: [0, 1.7, -1] }, [0, 1.6, -1]);
    controller.beginPress({ kind: 'grab', point: [5, 5, 5] }, [9, 9, 9]);
    const pose = controller.step(0.01, true, { point: [0.2, 1.7, -1] }, IDENTITY);
    // Still riding the FIRST press's start point/position, not the second's.
    expect(pose.position[0]).toBeCloseTo(0.2, 9);
  });
});

describe('TitlebarDragController: drag math', () => {
  it('a ray drag rides the ray at the grab distance, keeping the grab offset', () => {
    const { controller } = setup();
    controller.beginPress({ kind: 'ray', point: [0.05, 1.6, -1], ray: { origin: [0, 1.6, 0], direction: [0.05, 0, -1] } }, IDENTITY.position);
    controller.step(0.3, true, { ray: { origin: [0, 1.6, 0], direction: [0.05, 0, -1] } }, IDENTITY);
    const pose = controller.step(0.01, true, { ray: { origin: [0, 1.6, 0], direction: [0.6, 0, -0.8] } }, IDENTITY);
    const distance = Math.hypot(0.05, 1);
    expect(pose.position[0]).toBeCloseTo(0.6 * distance - 0.05, 9);
    expect(pose.position[2]).toBeCloseTo(-0.8 * distance, 9);
  });

  it('a ray press reporting no hit point cannot move the window (nothing to drag from)', () => {
    const { controller } = setup();
    controller.beginPress({ kind: 'ray', point: null, ray: { origin: [0, 1.6, 0], direction: [0, 0, -1] } }, IDENTITY.position);
    controller.step(0.3, true, { ray: { origin: [0, 1.6, 0], direction: [0, 0, -1] } }, IDENTITY);
    const pose = controller.step(0.01, true, { ray: { origin: [0, 1.6, 0], direction: [0.6, 0, -0.8] } }, IDENTITY);
    expect(controller.dragging).toBe(true);
    expect(pose).toEqual(IDENTITY);
  });

  it('a point-based drag (touch or grab) moves the window by the point delta', () => {
    const { controller } = setup();
    controller.beginPress({ kind: 'grab', point: [0, 1.7, -1] }, IDENTITY.position);
    controller.step(0.01, true, { point: [0, 1.7, -1] }, IDENTITY);
    const pose = controller.step(0.01, true, { point: [0.3, 1.7, -0.5] }, IDENTITY);
    expect(pose.position[0]).toBeCloseTo(0.3, 9);
    expect(pose.position[1]).toBeCloseTo(1.6, 9);
    expect(pose.position[2]).toBeCloseTo(-0.5, 9);
  });
});

describe('TitlebarDragController: window-manager side effects', () => {
  it('starting a drag focuses, undocks, world-locks and marks dragging; dropping clears dragging', () => {
    const { manager, controller } = setup();
    manager.open('other'); // steal focus and dock a region-less state
    manager.setDockMode('w', DockMode.BodyFollow);
    controller.beginPress({ kind: 'grab', point: [0, 1.7, -1] }, IDENTITY.position);
    controller.step(0.01, true, { point: [0, 1.7, -1] }, IDENTITY);
    expect(manager.focused?.id).toBe('w');
    expect(manager.get('w')?.dragging).toBe(true);
    expect(manager.get('w')?.dockMode).toBe(DockMode.WorldLocked);

    controller.step(0.01, false, undefined, IDENTITY);
    expect(manager.get('w')?.dragging).toBe(false);
    expect(controller.dragging).toBe(false);
  });

  it('billboards while dragging and once more settling at the drop, unless disabled', () => {
    const { controller } = setup();
    controller.beginPress({ kind: 'grab', point: [0, 1.7, -1] }, IDENTITY.position);
    let pose = controller.step(0.01, true, { point: [0.5, 1.7, -1] }, IDENTITY, [0, 1.6, 0]);
    // Billboarded: no longer the identity orientation.
    expect(pose.quaternion).not.toEqual(IDENTITY.quaternion);
    pose = controller.step(0.01, false, undefined, pose, [0, 1.6, 0]);
    expect(pose.quaternion).not.toEqual(IDENTITY.quaternion);
  });

  it('billboard: false never turns the window, even mid-drag', () => {
    const { controller } = setup({ billboard: false });
    controller.beginPress({ kind: 'grab', point: [0, 1.7, -1] }, IDENTITY.position);
    const pose = controller.step(0.01, true, { point: [0.5, 1.7, -1] }, IDENTITY, [0, 1.6, 0]);
    expect(pose.quaternion).toEqual(IDENTITY.quaternion);
  });

  it('dropping within a region snap radius docks the window into it', () => {
    const registry = new RegionRegistry();
    registry.register('shelf');
    const { manager, controller } = setup({ registry });
    controller.beginPress({ kind: 'grab', point: [0, 1.7, -1] }, IDENTITY.position);
    controller.step(0.01, true, { point: [0, 1.7, -1] }, IDENTITY);
    const pose = controller.step(0.01, true, { point: [1, 1.7, -1] }, IDENTITY);
    const origins = new Map<string, Vec3Tuple>([['shelf', [1, 1.6, -1]]]);
    controller.step(0.01, false, undefined, pose, undefined, origins);
    expect(manager.get('w')?.region).toBe('shelf');
  });

  it('a drop outside every region\'s snap radius does not dock', () => {
    const registry = new RegionRegistry();
    registry.register('shelf');
    const { manager, controller } = setup({ registry });
    controller.beginPress({ kind: 'grab', point: [0, 1.7, -1] }, IDENTITY.position);
    controller.step(0.01, true, { point: [0, 1.7, -1] }, IDENTITY);
    const pose = controller.step(0.01, true, { point: [1, 1.7, -1] }, IDENTITY);
    const origins = new Map<string, Vec3Tuple>([['shelf', [100, 100, 100]]]);
    controller.step(0.01, false, undefined, pose, undefined, origins);
    expect(manager.get('w')?.region).toBeUndefined();
  });

  it('a drop with no registry never captures', () => {
    const { manager, controller } = setup();
    controller.beginPress({ kind: 'grab', point: [0, 1.7, -1] }, IDENTITY.position);
    controller.step(0.01, true, { point: [0, 1.7, -1] }, IDENTITY);
    const pose = controller.step(0.01, true, { point: [1, 1.7, -1] }, IDENTITY);
    controller.step(0.01, false, undefined, pose);
    expect(manager.get('w')?.region).toBeUndefined();
  });
});
