import { describe, expect, it } from 'vitest';
import { HoldToDrag } from '../src/core/hold-to-drag.js';

describe('HoldToDrag', () => {
  it('rejects negative delays', () => {
    expect(() => new HoldToDrag(-1)).toThrow(/drag delay/);
  });

  it('stays idle while not held', () => {
    const hold = new HoldToDrag(0.3);
    expect(hold.update(false, 0.016)).toEqual({ phase: 'idle', began: false, ended: false });
    expect(hold.current).toBe('idle');
  });

  it('a press shorter than the delay never becomes a drag (it is a click)', () => {
    const hold = new HoldToDrag(0.3);
    expect(hold.update(true, 0.1).phase).toBe('pending');
    expect(hold.update(true, 0.1).phase).toBe('pending');
    const release = hold.update(false, 0.016);
    expect(release).toEqual({ phase: 'idle', began: false, ended: false });
  });

  it('crossing the delay begins the drag exactly once', () => {
    const hold = new HoldToDrag(0.3);
    hold.update(true, 0.2);
    const crossing = hold.update(true, 0.2);
    expect(crossing).toEqual({ phase: 'dragging', began: true, ended: false });
    // Subsequent held updates stay dragging without re-beginning.
    expect(hold.update(true, 0.2)).toEqual({ phase: 'dragging', began: false, ended: false });
    expect(hold.current).toBe('dragging');
  });

  it('releasing an active drag ends it and resets the timer', () => {
    const hold = new HoldToDrag(0.2);
    hold.update(true, 0.3); // dragging
    expect(hold.update(false, 0.016)).toEqual({ phase: 'idle', began: false, ended: true });
    // A fresh press must accumulate the delay again from zero.
    expect(hold.update(true, 0.1).phase).toBe('pending');
  });

  it('zero delay drags on the first held update', () => {
    const hold = new HoldToDrag(0);
    expect(hold.update(true, 0.016)).toEqual({ phase: 'dragging', began: true, ended: false });
  });
});
