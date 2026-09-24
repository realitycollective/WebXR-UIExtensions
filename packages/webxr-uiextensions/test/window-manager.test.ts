import { describe, expect, it, vi } from 'vitest';
import { DockMode } from '../src/core/dock-state.js';
import {
  NO_CHROME,
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
    expect(() => manager.hide('ghost')).toThrow(/unknown window/);
    expect(() => manager.dockTo('ghost', 'rail')).toThrow(/unknown window/);
    expect(() => manager.returnHome('ghost')).toThrow(/unknown window/);
    expect(() => manager.setChrome('ghost', { pin: true })).toThrow(/unknown window/);
  });

  it('opens with every chrome button off, and honours the open options', () => {
    const manager = new WindowManager();
    expect(manager.open('plain')).toMatchObject({
      hidden: false,
      region: undefined,
      chrome: NO_CHROME,
    });
    expect(NO_CHROME).toEqual({ pin: false, dock: false, minimize: false, close: false });
    const full = manager.open('full', {
      hidden: true,
      region: 'rail',
      chrome: { pin: true, close: true },
    });
    expect(full.hidden).toBe(true);
    expect(full.region).toBe('rail');
    expect(full.chrome).toEqual({ pin: true, dock: false, minimize: false, close: true });
    // The record owns its chrome; the frozen default is never handed out.
    expect(manager.get('plain')?.chrome).not.toBe(NO_CHROME);
  });

  it('hides and shows, keeping dock mode and region, and shows to the front', () => {
    const manager = new WindowManager();
    const hidden = vi.fn();
    const shown = vi.fn();
    manager.events.on('hidden', hidden);
    manager.events.on('shown', shown);
    const w = manager.open('w', { dockMode: DockMode.BodyFollow, region: 'rail' });
    manager.open('other');
    expect(manager.focused?.id).toBe('other');

    manager.hide('w');
    expect(w.hidden).toBe(true);
    expect(hidden).toHaveBeenCalledTimes(1);
    manager.hide('w'); // idempotent
    expect(hidden).toHaveBeenCalledTimes(1);
    expect(w.dockMode).toBe(DockMode.WorldLocked); // in a region, so world-locked
    expect(w.region).toBe('rail');
    expect(manager.has('w')).toBe(true);

    manager.show('w');
    expect(w.hidden).toBe(false);
    expect(shown).toHaveBeenCalledTimes(1);
    expect(manager.focused?.id).toBe('w');
    manager.show('w'); // idempotent
    expect(shown).toHaveBeenCalledTimes(1);

    manager.toggleHidden('w');
    expect(w.hidden).toBe(true);
    manager.toggleHidden('w');
    expect(w.hidden).toBe(false);
  });

  it('docks into and out of regions with regionChanged', () => {
    const manager = new WindowManager();
    const regionChanged = vi.fn();
    manager.events.on('regionChanged', regionChanged);
    const w = manager.open('w');

    manager.undock('w'); // not docked: nothing to say
    expect(regionChanged).not.toHaveBeenCalled();

    manager.dockTo('w', 'rail');
    expect(w.region).toBe('rail');
    expect(regionChanged).toHaveBeenLastCalledWith({ window: w, previous: undefined });
    manager.dockTo('w', 'rail'); // already there
    expect(regionChanged).toHaveBeenCalledTimes(1);

    manager.dockTo('w', 'belt');
    expect(regionChanged).toHaveBeenLastCalledWith({ window: w, previous: 'rail' });

    manager.undock('w');
    expect(w.region).toBeUndefined();
    expect(regionChanged).toHaveBeenLastCalledWith({ window: w, previous: 'belt' });
    expect(regionChanged).toHaveBeenCalledTimes(3);

    expect(() => manager.dockTo('w', '')).toThrow(/needs a region id/);
  });

  it('opens a window given a region and a follow mode world-locked in that region', () => {
    const manager = new WindowManager();
    const record = manager.open('w', { region: 'rail', dockMode: DockMode.HeadLocked });
    expect(record).toMatchObject({ region: 'rail', dockMode: DockMode.WorldLocked });
    expect(() => manager.open('bad', { region: 'rail', dockMode: 'sideways' as never })).toThrow(/not a dock mode/);
  });

  it('dockTo makes a following window world-locked, announcing the region first', () => {
    const manager = new WindowManager();
    const seen: string[] = [];
    manager.events.on('regionChanged', ({ window }) => seen.push(`region:${window.region}:${window.dockMode}`));
    manager.events.on('dockChanged', ({ window, previous }) => seen.push(`dock:${previous}->${window.dockMode}`));
    manager.open('w', { dockMode: DockMode.BodyFollow });
    manager.dockTo('w', 'rail');
    expect(seen).toEqual([
      `region:rail:${DockMode.WorldLocked}`,
      `dock:${DockMode.BodyFollow}->${DockMode.WorldLocked}`,
    ]);
    manager.dockTo('w', 'belt'); // already world-locked: no dock change
    expect(seen).toHaveLength(3);
  });

  it('a follow mode takes a docked window out of its region first', () => {
    const manager = new WindowManager();
    const seen: string[] = [];
    manager.events.on('regionChanged', ({ window }) => seen.push(`region:${String(window.region)}`));
    manager.events.on('dockChanged', ({ window }) => seen.push(`dock:${window.dockMode}`));
    const record = manager.open('w', { region: 'rail' });

    manager.setDockMode('w', DockMode.HeadLocked);
    expect(record).toMatchObject({ region: undefined, dockMode: DockMode.HeadLocked });
    expect(seen).toEqual(['region:undefined', `dock:${DockMode.HeadLocked}`]);

    manager.dockTo('w', 'rail');
    manager.togglePin('w'); // world-locked -> follow, so it leaves the region
    expect(record.region).toBeUndefined();
    expect(record.dockMode).not.toBe(DockMode.WorldLocked);
  });

  it('returnHome only announces; the adapter owns the home snapshot', () => {
    const manager = new WindowManager();
    const returnHome = vi.fn();
    manager.events.on('returnHome', returnHome);
    const w = manager.open('w');
    manager.returnHome('w');
    expect(returnHome).toHaveBeenCalledWith(w);
  });

  it('carries hand-menu options and setHandMenu emits only on change', () => {
    const manager = new WindowManager();
    const changed = vi.fn();
    manager.events.on('handMenuChanged', changed);
    const w = manager.open('w', { handMenu: { hand: 'right' } });
    expect(w.handMenu).toMatchObject({ hand: 'right', anchor: 'above', palmGate: true });

    manager.setHandMenu('w', { hand: 'right' }); // nothing new
    manager.setHandMenu('w', { offset: [0, 0, 0] }); // same offset, new array
    expect(changed).not.toHaveBeenCalled();

    const before = w.handMenu;
    manager.setHandMenu('w', { anchor: 'inside', offset: [0, 0.02, 0] });
    expect(w.handMenu).toMatchObject({ hand: 'right', anchor: 'inside', offset: [0, 0.02, 0] });
    expect(changed).toHaveBeenCalledWith({ window: w, previous: before });
    manager.setHandMenu('w', { palmGate: false });
    manager.setHandMenu('w', { palmAngle: 45 });
    manager.setHandMenu('w', { anchorDistance: 0.2 });
    expect(changed).toHaveBeenCalledTimes(4);
    expect(() => manager.setHandMenu('ghost', {})).toThrow(/unknown window/);
  });

  it('setChrome merges, emits only on change, and hands back the previous set', () => {
    const manager = new WindowManager();
    const chromeChanged = vi.fn();
    manager.events.on('chromeChanged', chromeChanged);
    const w = manager.open('w', { chrome: { close: true } });

    manager.setChrome('w', { close: true }); // nothing new
    expect(chromeChanged).not.toHaveBeenCalled();

    const before = w.chrome;
    manager.setChrome('w', { pin: true, dock: true });
    expect(w.chrome).toEqual({ pin: true, dock: true, minimize: false, close: true });
    expect(chromeChanged).toHaveBeenCalledWith({ window: w, previous: before });
    expect(before).toEqual({ pin: false, dock: false, minimize: false, close: true });

    manager.setChrome('w', { minimize: true });
    manager.setChrome('w', { close: false });
    expect(w.chrome).toEqual({ pin: true, dock: true, minimize: true, close: false });
    expect(chromeChanged).toHaveBeenCalledTimes(3);
  });
});
