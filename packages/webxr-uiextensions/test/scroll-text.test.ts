/**
 * The scroll rule (`src/core/scroll.ts`, uikit's drag, coast and rubber
 * band) and the text entry rule (`src/core/text-entry.ts`).
 */
import { describe, expect, it } from 'vitest';
import { SCROLL_DEFAULTS, ScrollState, TextEntry } from '../src/index.js';

function scrollable(): ScrollState {
  const state = new ScrollState();
  state.setExtent({ width: 200, height: 100, maxX: 300, maxY: 400 });
  return state;
}

describe('ScrollState', () => {
  it("has uikit's constants", () => {
    expect(SCROLL_DEFAULTS).toEqual({ damping: 0.9, stopBelow: 0.01, rubberBandReturn: 0.3, rubberBandRange: 100 });
    expect(new ScrollState({ damping: 0.5 }).options.damping).toBe(0.5);
  });

  it('scrolls by the drag delta, both axes negated so content follows the finger, and records the velocity', () => {
    const state = scrollable();
    state.beginDrag('ray', [50, 50], 0);
    expect(state.dragging).toBe(true);
    expect(state.moveDrag('ray', [40, 30], 10)).toEqual([10, 20]);
    expect(state.velocity).toEqual([1, 2]);
    expect(state.moveDrag('other', [0, 0], 20)).toEqual([10, 20]);
    // A move with no time between samples keeps the last velocity.
    state.moveDrag('ray', [40, 30], 10);
    expect(state.velocity).toEqual([1, 2]);
    state.endDrag('ray');
    expect(state.dragging).toBe(false);
    expect(state.settling).toBe(true);
  });

  it('coasts after a release, damping 10 % a frame, and stops below 10 px/s', () => {
    const state = scrollable();
    state.beginDrag('ray', [0, 0], 0);
    state.moveDrag('ray', [0, -10], 10);
    state.endDrag('ray');
    const first = state.frame(16);
    expect(first[1]).toBeCloseTo(10 + 1 * 16, 6);
    expect(state.velocity[1]).toBeCloseTo(0.9, 6);
    for (let i = 0; i < 60 && state.settling; i++) state.frame(16);
    expect(state.velocity).toEqual([0, 0]);
    expect(state.settling).toBe(false);
    // Nothing moves while a drag is held.
    state.beginDrag('ray', [0, 0], 0);
    const held = state.position;
    expect(state.frame(16)).toEqual(held);
  });

  it('meets a rubber band past the end and springs back 30 % a frame', () => {
    const state = scrollable();
    state.beginDrag('ray', [0, 0], 0);
    // Dragging content up 450 px at once: past maxY 400, so the last 50 shrink with the overshoot.
    state.moveDrag('ray', [0, -450], 100);
    const [, y] = state.position;
    expect(y).toBe(450);
    state.moveDrag('ray', [0, -550], 200);
    expect(state.position[1]).toBeLessThan(550);
    expect(state.position[1]).toBeGreaterThan(450);
    state.endDrag('ray');
    state.scrollTo(0, 450);
    // scrollTo clamps; force an overshoot through a drag instead.
    expect(state.position[1]).toBe(400);
    state.beginDrag('ray', [0, 0], 0);
    state.moveDrag('ray', [0, -50], 1000);
    state.endDrag('ray');
    expect(state.position[1]).toBe(450);
    const after = state.frame(16);
    expect(after[1]).toBeCloseTo(450 - 0.3 * 50 + 0.05 * 16, 3);
    // A pull past the far end past the whole range moves nothing further.
    state.scrollTo(0, 0);
    state.beginDrag('ray', [0, 0], 0);
    state.moveDrag('ray', [0, 150], 10);
    const stuck = state.position[1];
    state.moveDrag('ray', [0, 160], 20);
    expect(state.position[1]).toBe(stuck);
  });

  it('coasts sideways too, and stops each axis on its own', () => {
    const state = scrollable();
    state.beginDrag('ray', [0, 0], 0);
    state.moveDrag('ray', [-10, 0], 10);
    state.endDrag('ray');
    expect(state.velocity[0]).toBeCloseTo(1, 6);
    for (let i = 0; i < 80 && state.settling; i++) state.frame(16);
    expect(state.velocity).toEqual([0, 0]);
    expect(state.position[0]).toBeGreaterThan(10);
    // Settled: a further frame moves nothing.
    const rest = state.position;
    expect(state.frame(16)).toEqual(rest);
  });

  it('a wheel scrolls directly, clamped to the range', () => {
    const state = scrollable();
    expect(state.wheel(50, 500)).toEqual([50, 400]);
    expect(state.wheel(-100, 0)).toEqual([0, 400]);
    expect(state.wheel(0, 0)).toEqual([0, 400]);
    state.scrollTo(-5, 1000);
    expect(state.position).toEqual([0, 400]);
  });
});

describe('TextEntry', () => {
  it('focuses a field with its value, takes typed values while focused, and ends on blur', () => {
    const entry = new TextEntry<string>();
    expect(entry.input('x')).toBeUndefined();
    expect(entry.focus('name', 'Ada', { multiline: true, type: 'text' })).toEqual({ value: 'Ada', multiline: true, type: 'text' });
    expect(entry.focus('name', 'Ada')).toEqual({ value: 'Ada', multiline: false, type: 'text' });
    expect(entry.field).toBe('name');
    expect(entry.input('Ada L')).toBe('name');
    expect(entry.value).toBe('Ada L');
    expect(entry.blur()).toBe('name');
    expect(entry.field).toBeUndefined();
    expect(entry.blur()).toBeUndefined();
  });
});
