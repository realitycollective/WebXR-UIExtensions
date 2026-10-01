/**
 * The hover rule (`src/core/hover.ts`): per-pointer enter and leave, and an
 * element's hover style held while any pointer is over it.
 */
import { describe, expect, it } from 'vitest';
import { HoverTracker } from '../src/index.js';

describe('HoverTracker', () => {
  it('raises enter and leave per pointer, once per change, and nothing while the pointer stays', () => {
    const hover = new HoverTracker<string>();
    expect(hover.update('ray', 'a')).toEqual({ pointerEnter: 'a', pointerLeave: undefined, hoverOn: 'a', hoverOff: undefined });
    expect(hover.update('ray', 'a')).toEqual({ pointerEnter: undefined, pointerLeave: undefined, hoverOn: undefined, hoverOff: undefined });
    expect(hover.isHovered('a')).toBe(true);
    expect(hover.update('ray', 'b')).toEqual({ pointerEnter: 'b', pointerLeave: 'a', hoverOn: 'b', hoverOff: 'a' });
    expect(hover.update('ray', undefined)).toEqual({ pointerEnter: undefined, pointerLeave: 'b', hoverOn: undefined, hoverOff: 'b' });
    expect(hover.update('ray', undefined)).toEqual({ pointerEnter: undefined, pointerLeave: undefined, hoverOn: undefined, hoverOff: undefined });
    expect(hover.hovered()).toEqual([]);
  });

  it('holds the hover style while any pointer is over the element', () => {
    const hover = new HoverTracker<string>();
    hover.update('left', 'a');
    expect(hover.update('right', 'a')).toEqual({ pointerEnter: 'a', pointerLeave: undefined, hoverOn: undefined, hoverOff: undefined });
    expect(hover.update('left', undefined).hoverOff).toBeUndefined();
    expect(hover.isHovered('a')).toBe(true);
    expect(hover.remove('right').hoverOff).toBe('a');
    expect(hover.isHovered('a')).toBe(false);
    expect(hover.remove('right').pointerLeave).toBeUndefined();
  });

  it('compares targets by the key given, keeping the latest value', () => {
    const hover = new HoverTracker<{ id: string }>((target) => target.id);
    const first = { id: 'x' };
    const again = { id: 'x' };
    expect(hover.update('p', first).hoverOn).toBe(first);
    expect(hover.update('p', again).pointerEnter).toBeUndefined();
    expect(hover.hovered()[0]).toBe(again);
    expect(hover.isHovered({ id: 'x' })).toBe(true);
    hover.clear();
    expect(hover.hovered()).toEqual([]);
    expect(hover.update('p', again).hoverOn).toBe(again);
  });
});
