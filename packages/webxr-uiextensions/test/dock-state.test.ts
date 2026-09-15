import { describe, expect, it } from 'vitest';
import {
  DockMode,
  isDockMode,
  planTransition,
  recipeFor,
  togglePinned,
} from '../src/core/dock-state.js';

describe('dock-state', () => {
  it('recognises dock modes', () => {
    expect(isDockMode(DockMode.WorldLocked)).toBe(true);
    expect(isDockMode(DockMode.BodyFollow)).toBe(true);
    expect(isDockMode(DockMode.HeadLocked)).toBe(true);
    expect(isDockMode('floating')).toBe(false);
    expect(isDockMode(undefined)).toBe(false);
  });

  it('exposes engine recipes per mode', () => {
    expect(recipeFor(DockMode.WorldLocked)).toEqual({
      follower: false,
      screenSpace: false,
      handAnchor: false,
      snapOnEnter: false,
    });
    expect(recipeFor(DockMode.BodyFollow).follower).toBe(true);
    expect(recipeFor(DockMode.HeadLocked)).toEqual({
      follower: true,
      screenSpace: true,
      handAnchor: false,
      snapOnEnter: true,
    });
    expect(recipeFor(DockMode.HandLocked)).toEqual({
      follower: false,
      screenSpace: false,
      handAnchor: true,
      snapOnEnter: false,
    });
    expect(isDockMode(DockMode.HandLocked)).toBe(true);
  });

  it('plans body-follow ⇄ hand-locked (follower swaps for the hand anchor)', () => {
    expect(planTransition(DockMode.BodyFollow, DockMode.HandLocked)).toMatchObject({
      removeFollower: true,
      addHandAnchor: true,
      removeHandAnchor: false,
      snap: false,
    });
    expect(planTransition(DockMode.HandLocked, DockMode.WorldLocked)).toMatchObject({
      addFollower: false,
      removeHandAnchor: true,
      addHandAnchor: false,
    });
    expect(togglePinned(DockMode.HandLocked)).toBe(DockMode.WorldLocked);
  });

  it('plans world-locked → body-follow (add follower, snap)', () => {
    const plan = planTransition(DockMode.WorldLocked, DockMode.BodyFollow);
    expect(plan).toEqual({
      from: DockMode.WorldLocked,
      to: DockMode.BodyFollow,
      addFollower: true,
      removeFollower: false,
      addScreenSpace: false,
      removeScreenSpace: false,
      addHandAnchor: false,
      removeHandAnchor: false,
      snap: true,
    });
  });

  it('plans body-follow → world-locked (remove follower, keep transform)', () => {
    const plan = planTransition(DockMode.BodyFollow, DockMode.WorldLocked);
    expect(plan).toMatchObject({
      addFollower: false,
      removeFollower: true,
      addScreenSpace: false,
      removeScreenSpace: false,
      snap: false,
    });
  });

  it('plans body-follow ⇄ head-locked (screen space toggles, follower stays)', () => {
    expect(planTransition(DockMode.BodyFollow, DockMode.HeadLocked)).toMatchObject({
      addFollower: false,
      removeFollower: false,
      addScreenSpace: true,
      snap: true,
    });
    expect(planTransition(DockMode.HeadLocked, DockMode.BodyFollow)).toMatchObject({
      removeScreenSpace: true,
      removeFollower: false,
    });
  });

  it('same-mode transition is a no-op', () => {
    expect(planTransition(DockMode.WorldLocked, DockMode.WorldLocked)).toBeUndefined();
  });

  it('pin toggle: world-locked ⇄ body-follow, head-locked unpins to world', () => {
    expect(togglePinned(DockMode.WorldLocked)).toBe(DockMode.BodyFollow);
    expect(togglePinned(DockMode.BodyFollow)).toBe(DockMode.WorldLocked);
    expect(togglePinned(DockMode.HeadLocked)).toBe(DockMode.WorldLocked);
  });
});
