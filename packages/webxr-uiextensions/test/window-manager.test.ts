import { describe, expect, it, vi } from 'vitest';
import { DockMode } from '../src/core/dock-state.js';
import {
  WindowManager,
  minimizeLabelFor,
  pinLabelFor,
} from '../src/core/window-manager.js';

describe('WindowManager', () => {
  it('opens windows with defaults and emits opened + focused', () => {
    const manager = new WindowManager();
    const opened = vi.fn();
    const focused = vi.fn();
    manager.events.on('opened', opened);
    manager.events.on('focused', focused);
    const record = manager.open('hud');
    expect(record).toMatchObject({
      id: 'hud',
      title: 'hud',
      dockMode: DockMode.WorldLocked,
      minimized: false,
    });
    expect(opened).toHaveBeenCalledWith(record);
    expect(focused).toHaveBeenCalledWith(record);
    expect(manager.count).toBe(1);
    expect(manager.has('hud')).toBe(true);
    expect(manager.get('hud')).toBe(record);
  });

  it('rejects duplicate ids and invalid dock modes', () => {
    const manager = new WindowManager();
    manager.open('a');
    expect(() => manager.open('a')).toThrow(/already open/);
    expect(() =>
      manager.open('b', { dockMode: 'nope' as never }),
    ).toThrow(/not a dock mode/);
  });

  it('tracks focus order (orderOf, focused, list)', () => {
    const manager = new WindowManager();
    manager.open('a');
    manager.open('b');
    manager.open('c');
    expect(manager.focused?.id).toBe('c');
    expect(manager.orderOf('c')).toBe(0);
    expect(manager.orderOf('b')).toBe(1);
    expect(manager.orderOf('a')).toBe(2);

    manager.focus('a');
    expect(manager.focused?.id).toBe('a');
    expect(manager.orderOf('a')).toBe(0);
    expect(manager.orderOf('c')).toBe(1);
    expect(manager.list().map((w) => w.id)).toEqual(['a', 'c', 'b']);
  });

  it('re-focusing the top window emits nothing new', () => {
    const manager = new WindowManager();
    manager.open('a');
    const focused = vi.fn();
    manager.events.on('focused', focused);
    manager.focus('a');
    expect(focused).not.toHaveBeenCalled();
  });

  it('close removes the window and focuses the next one', () => {
    const manager = new WindowManager();
    manager.open('a');
    manager.open('b');
    const closed = vi.fn();
    const focused = vi.fn();
    manager.events.on('closed', closed);
    manager.events.on('focused', focused);
    manager.close('b');
    expect(closed).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
    expect(focused).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    expect(manager.has('b')).toBe(false);
    expect(manager.count).toBe(1);
  });

  it('closing the last window leaves nothing focused', () => {
    const manager = new WindowManager();
    manager.open('only');
    manager.close('only');
    expect(manager.focused).toBeUndefined();
    expect(manager.list()).toEqual([]);
  });

  it('minimize / restore / toggle emit and de-duplicate', () => {
    const manager = new WindowManager();
    manager.open('a');
    const minimized = vi.fn();
    const restored = vi.fn();
    manager.events.on('minimized', minimized);
    manager.events.on('restored', restored);

    manager.minimize('a');
    manager.minimize('a'); // no-op
    expect(minimized).toHaveBeenCalledTimes(1);
    expect(manager.get('a')?.minimized).toBe(true);

    manager.restore('a');
    manager.restore('a'); // no-op
    expect(restored).toHaveBeenCalledTimes(1);
    expect(manager.get('a')?.minimized).toBe(false);

    manager.toggleMinimized('a');
    expect(manager.get('a')?.minimized).toBe(true);
    manager.toggleMinimized('a');
    expect(manager.get('a')?.minimized).toBe(false);
  });

  it('restore refocuses the window', () => {
    const manager = new WindowManager();
    manager.open('a');
    manager.open('b');
    manager.minimize('a');
    manager.restore('a');
    expect(manager.focused?.id).toBe('a');
  });

  it('dock mode changes emit with the previous mode; same mode is a no-op', () => {
    const manager = new WindowManager();
    manager.open('a', { dockMode: DockMode.BodyFollow });
    const dockChanged = vi.fn();
    manager.events.on('dockChanged', dockChanged);

    manager.setDockMode('a', DockMode.BodyFollow); // no-op
    expect(dockChanged).not.toHaveBeenCalled();

    manager.setDockMode('a', DockMode.WorldLocked);
    expect(dockChanged).toHaveBeenCalledWith({
      window: expect.objectContaining({ id: 'a', dockMode: DockMode.WorldLocked }),
      previous: DockMode.BodyFollow,
    });

    expect(() => manager.setDockMode('a', 'sideways' as never)).toThrow(/not a dock mode/);
  });

  it('togglePin alternates world-locked and body-follow', () => {
    const manager = new WindowManager();
    manager.open('a');
    expect(manager.togglePin('a')).toBe(DockMode.BodyFollow);
    expect(manager.togglePin('a')).toBe(DockMode.WorldLocked);
  });

  it('tracks title-bar dragging and emits dragStarted/dragEnded once per change', () => {
    const manager = new WindowManager();
    manager.open('a');
    const started = vi.fn();
    const ended = vi.fn();
    manager.events.on('dragStarted', started);
    manager.events.on('dragEnded', ended);

    expect(manager.get('a')?.dragging).toBe(false);
    manager.setDragging('a', true);
    manager.setDragging('a', true); // no-op
    expect(manager.get('a')?.dragging).toBe(true);
    expect(started).toHaveBeenCalledTimes(1);

    manager.setDragging('a', false);
    manager.setDragging('a', false); // no-op
    expect(ended).toHaveBeenCalledTimes(1);
    expect(() => manager.setDragging('ghost', true)).toThrow(/unknown window/);
  });

  it('pinLabelFor: PIN while dragging or following, UNPIN when placed', () => {
    expect(pinLabelFor({ dockMode: DockMode.BodyFollow, dragging: false })).toBe('PIN');
    expect(pinLabelFor({ dockMode: DockMode.WorldLocked, dragging: false })).toBe('UNPIN');
    expect(pinLabelFor({ dockMode: DockMode.WorldLocked, dragging: true })).toBe('PIN');
    expect(pinLabelFor({ dockMode: DockMode.BodyFollow, dragging: true })).toBe('PIN');
    expect(pinLabelFor({ dockMode: DockMode.HeadLocked, dragging: false })).toBe('PIN');
  });

  it('minimizeLabelFor: MIN when open, MAX when minimized', () => {
    expect(minimizeLabelFor({ minimized: false })).toBe('MIN');
    expect(minimizeLabelFor({ minimized: true })).toBe('MAX');
  });

  it('minimizeLabelFor tracks a window through minimize/restore', () => {
    const manager = new WindowManager();
    manager.open('w');
    expect(minimizeLabelFor(manager.get('w')!)).toBe('MIN');
    manager.minimize('w');
    expect(minimizeLabelFor(manager.get('w')!)).toBe('MAX');
    manager.restore('w');
    expect(minimizeLabelFor(manager.get('w')!)).toBe('MIN');
  });

  it('throws for unknown window ids', () => {
    const manager = new WindowManager();
    expect(() => manager.focus('ghost')).toThrow(/unknown window/);
    expect(() => manager.orderOf('ghost')).toThrow(/unknown window/);
    expect(() => manager.close('ghost')).toThrow(/unknown window/);
  });
});
