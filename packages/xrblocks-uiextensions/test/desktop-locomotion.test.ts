import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCOMOTION,
  NO_INPUT,
  createLocomotionState,
  intentForKey,
  moveDirection,
  stepLocomotion,
  targetStanceHeight,
  type MoveInput,
} from '../src/desktop-locomotion.js';

const input = (over: Partial<MoveInput> = {}): MoveInput => ({ ...NO_INPUT, ...over });

describe('moveDirection', () => {
  it('walks toward -Z when facing default yaw', () => {
    const [x, z] = moveDirection(input({ forward: true }), 0);
    expect(x).toBeCloseTo(0);
    expect(z).toBeCloseTo(-1);
  });

  it('walks backward toward +Z', () => {
    expect(moveDirection(input({ back: true }), 0)[1]).toBeCloseTo(1);
  });

  it('strafes along X', () => {
    expect(moveDirection(input({ right: true }), 0)[0]).toBeCloseTo(1);
    expect(moveDirection(input({ left: true }), 0)[0]).toBeCloseTo(-1);
  });

  it('normalises diagonals so they are not faster', () => {
    const [x, z] = moveDirection(input({ forward: true, right: true }), 0);
    expect(Math.hypot(x, z)).toBeCloseTo(1);
  });

  it('is stationary with no keys, and with opposing keys', () => {
    expect(moveDirection(input(), 0)).toEqual([0, 0]);
    expect(moveDirection(input({ forward: true, back: true }), 0)).toEqual([0, 0]);
  });

  it('rotates movement by the camera yaw', () => {
    // Yawed 90°, "forward" should now travel along -X.
    const [x, z] = moveDirection(input({ forward: true }), Math.PI / 2);
    expect(x).toBeCloseTo(-1);
    expect(z).toBeCloseTo(0);
  });
});

describe('stepLocomotion — walking', () => {
  it('moves at the configured speed', () => {
    const state = createLocomotionState();
    stepLocomotion(state, input({ forward: true }), 1, DEFAULT_LOCOMOTION, 0);
    expect(state.z).toBeCloseTo(-DEFAULT_LOCOMOTION.speed);
  });

  it('sprints faster by the multiplier', () => {
    const state = createLocomotionState();
    stepLocomotion(state, input({ forward: true, sprint: true }), 1);
    expect(state.z).toBeCloseTo(
      -DEFAULT_LOCOMOTION.speed * DEFAULT_LOCOMOTION.sprintMultiplier,
    );
  });

  it('is frame-rate independent for horizontal motion', () => {
    const a = createLocomotionState();
    for (let i = 0; i < 60; i += 1) {
      stepLocomotion(a, input({ forward: true }), 1 / 60);
    }
    const b = createLocomotionState();
    stepLocomotion(b, input({ forward: true }), 1);
    expect(a.z).toBeCloseTo(b.z, 6);
  });

  it('ignores non-positive deltas', () => {
    const state = createLocomotionState();
    stepLocomotion(state, input({ forward: true }), 0);
    expect(state.z).toBe(0);
  });
});

describe('stepLocomotion — crouch', () => {
  it('eases down toward the crouch height and back up', () => {
    const state = createLocomotionState();
    for (let i = 0; i < 120; i += 1) {
      stepLocomotion(state, input({ crouch: true }), 1 / 60);
    }
    expect(state.y).toBeCloseTo(DEFAULT_LOCOMOTION.crouchHeight, 2);

    for (let i = 0; i < 120; i += 1) {
      stepLocomotion(state, input(), 1 / 60);
    }
    expect(state.y).toBeCloseTo(DEFAULT_LOCOMOTION.standHeight, 2);
  });

  it('reports the stance height being targeted', () => {
    expect(targetStanceHeight(input({ crouch: true }), DEFAULT_LOCOMOTION)).toBe(
      DEFAULT_LOCOMOTION.crouchHeight,
    );
    expect(targetStanceHeight(input(), DEFAULT_LOCOMOTION)).toBe(
      DEFAULT_LOCOMOTION.standHeight,
    );
  });
});

describe('stepLocomotion — jump', () => {
  it('leaves the ground, arcs, and lands back at stand height', () => {
    const state = createLocomotionState();
    stepLocomotion(state, input({ jump: true }), 1 / 60);
    expect(state.grounded).toBe(false);
    expect(state.y).toBeGreaterThan(DEFAULT_LOCOMOTION.standHeight);

    let peak = state.y;
    for (let i = 0; i < 240 && !state.grounded; i += 1) {
      stepLocomotion(state, input(), 1 / 60);
      peak = Math.max(peak, state.y);
    }
    expect(peak).toBeGreaterThan(DEFAULT_LOCOMOTION.standHeight + 0.4);
    expect(state.grounded).toBe(true);
    expect(state.y).toBeCloseTo(DEFAULT_LOCOMOTION.standHeight, 5);
    expect(state.verticalVelocity).toBe(0);
  });

  it('cannot double-jump while airborne', () => {
    const state = createLocomotionState();
    stepLocomotion(state, input({ jump: true }), 1 / 60);
    const velocityAfterLaunch = state.verticalVelocity;
    stepLocomotion(state, input({ jump: true }), 1 / 60);
    // Still falling under gravity, not re-launched.
    expect(state.verticalVelocity).toBeLessThan(velocityAfterLaunch);
  });

  it('lands at crouch height when crouch is held on the way down', () => {
    const state = createLocomotionState();
    stepLocomotion(state, input({ jump: true }), 1 / 60);
    for (let i = 0; i < 240 && !state.grounded; i += 1) {
      stepLocomotion(state, input({ crouch: true }), 1 / 60);
    }
    expect(state.grounded).toBe(true);
    expect(state.y).toBeCloseTo(DEFAULT_LOCOMOTION.crouchHeight, 5);
  });

  it('can still move horizontally mid-air', () => {
    const state = createLocomotionState();
    stepLocomotion(state, input({ jump: true }), 1 / 60);
    const before = state.z;
    stepLocomotion(state, input({ forward: true }), 1 / 60);
    expect(state.z).toBeLessThan(before);
  });
});

describe('intentForKey', () => {
  it('maps WASD, arrows, space, crouch and sprint', () => {
    expect(intentForKey('KeyW')).toBe('forward');
    expect(intentForKey('ArrowUp')).toBe('forward');
    expect(intentForKey('KeyS')).toBe('back');
    expect(intentForKey('KeyA')).toBe('left');
    expect(intentForKey('KeyD')).toBe('right');
    expect(intentForKey('Space')).toBe('jump');
    expect(intentForKey('KeyC')).toBe('crouch');
    expect(intentForKey('ControlLeft')).toBe('crouch');
    expect(intentForKey('ShiftLeft')).toBe('sprint');
  });

  it('ignores unrelated keys', () => {
    expect(intentForKey('KeyQ')).toBeUndefined();
    expect(intentForKey('Enter')).toBeUndefined();
  });
});
