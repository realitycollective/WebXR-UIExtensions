/**
 * WindowManager - pure window registry, focus ordering and window state.
 *
 * The manager knows nothing about entities, three.js or uikit. It deals in
 * opaque window ids and answers the questions the engine layer applies each
 * frame:
 *
 * 1. What is the focus (z) order? (`orderOf` → depth bias so the focused
 *    window renders nearest the user and receives pointer priority)
 * 2. What state is a window in? (minimized / hidden / focused / dock mode /
 *    region / which chrome buttons are enabled)
 *
 * It is also the ONE API app code calls to change a window: a hand menu that
 * hides, docks or pins a targeted window talks to the manager, and every
 * adapter applies the resulting events. Nothing here needs an engine handle.
 */
import { Emitter } from './events.js';
import { DockMode, DockModeValue, isDockMode, togglePinned } from './dock-state.js';

/**
 * Which title-bar buttons are enabled. Keys match the chrome element ids in
 * `WINDOW_CHROME_IDS`. A disabled button is hidden and its click ignored.
 * Every button is OFF unless the app turns it on.
 */
export interface WindowChrome {
  /** Body-follow ⇄ world-locked toggle. */
  pin: boolean;
  /** Return the window to its home (spawn region or original placement). */
  dock: boolean;
  /** Minimize / restore toggle. */
  minimize: boolean;
  /** Close (destroy) the window. */
  close: boolean;
}

export const NO_CHROME: Readonly<WindowChrome> = Object.freeze({
  pin: false,
  dock: false,
  minimize: false,
  close: false,
});

export interface WindowRecord {
  id: string;
  title: string;
  dockMode: DockModeValue;
  minimized: boolean;
  /** Not drawn and not hittable; everything else about the window is kept. */
  hidden: boolean;
  /** True while the user is actively dragging the window by its title bar. */
  dragging: boolean;
  /** The layout region the window is docked into, if any. */
  region: string | undefined;
  /** Which title-bar buttons are enabled. */
  chrome: WindowChrome;
}

export interface WindowManagerEvents extends Record<string, unknown> {
  opened: WindowRecord;
  closed: WindowRecord;
  focused: WindowRecord;
  minimized: WindowRecord;
  restored: WindowRecord;
  hidden: WindowRecord;
  shown: WindowRecord;
  dockChanged: { window: WindowRecord; previous: DockModeValue };
  /** The window entered, left or moved between regions. */
  regionChanged: { window: WindowRecord; previous: string | undefined };
  /** The app asked for the window to go back to where it spawned. */
  returnHome: WindowRecord;
  chromeChanged: { window: WindowRecord; previous: WindowChrome };
  dragStarted: WindowRecord;
  dragEnded: WindowRecord;
}

export interface OpenWindowOptions {
  title?: string;
  dockMode?: DockModeValue;
  /** Open hidden; `show()` reveals it. */
  hidden?: boolean;
  /** Open docked into this region. */
  region?: string;
  /** Buttons to enable; anything omitted stays off. */
  chrome?: Partial<WindowChrome>;
}

/**
 * What the pin affordance should read for a window's current state:
 * - dragging            → "PIN"   (the window is loose in your hand)
 * - placed/world-locked → "UNPIN" (click releases it to follow)
 * - following           → "PIN"   (click pins it where it is)
 */
export function pinLabelFor(record: Pick<WindowRecord, 'dockMode' | 'dragging'>): 'PIN' | 'UNPIN' {
  if (record.dragging) {
    return 'PIN';
  }
  return record.dockMode === DockMode.WorldLocked ? 'UNPIN' : 'PIN';
}

/**
 * What the minimize affordance should read for a window's current state -
 * the label always names what the NEXT click does, matching `pinLabelFor`:
 * - open      → "MIN" (click collapses the content)
 * - minimized → "MAX" (click restores it)
 */
export function minimizeLabelFor(record: Pick<WindowRecord, 'minimized'>): 'MIN' | 'MAX' {
  return record.minimized ? 'MAX' : 'MIN';
}

export class WindowManager {
  readonly events = new Emitter<WindowManagerEvents>();

  private windows = new Map<string, WindowRecord>();
  /** Most-recently-focused last (top of the stack). */
  private focusStack: string[] = [];

  open(id: string, options: OpenWindowOptions = {}): WindowRecord {
    if (this.windows.has(id)) {
      throw new Error(`[uix] window "${id}" is already open`);
    }
    const dockMode = options.dockMode ?? DockMode.WorldLocked;
    if (!isDockMode(dockMode)) {
      throw new Error(`[uix] "${String(dockMode)}" is not a dock mode`);
    }
    const record: WindowRecord = {
      id,
      title: options.title ?? id,
      dockMode,
      minimized: false,
      hidden: options.hidden ?? false,
      dragging: false,
      region: options.region,
      chrome: { ...NO_CHROME, ...options.chrome },
    };
    this.windows.set(id, record);
    this.focusStack.push(id);
    this.events.emit('opened', record);
    this.events.emit('focused', record);
    return record;
  }

  /**
   * Close a window. This is the one teardown call: adapters listen for
   * `closed` and dispose whatever they created for the window.
   */
  close(id: string): void {
    const record = this.require(id);
    this.windows.delete(id);
    this.focusStack = this.focusStack.filter((w) => w !== id);
    this.events.emit('closed', record);
    const top = this.focused;
    if (top) {
      this.events.emit('focused', top);
    }
  }

  focus(id: string): void {
    const record = this.require(id);
    const top = this.focusStack[this.focusStack.length - 1];
    if (top === id) {
      return;
    }
    this.focusStack = this.focusStack.filter((w) => w !== id);
    this.focusStack.push(id);
    this.events.emit('focused', record);
  }

  minimize(id: string): void {
    const record = this.require(id);
    if (record.minimized) {
      return;
    }
    record.minimized = true;
    this.events.emit('minimized', record);
  }

  restore(id: string): void {
    const record = this.require(id);
    if (!record.minimized) {
      return;
    }
    record.minimized = false;
    this.events.emit('restored', record);
    this.focus(id);
  }

  toggleMinimized(id: string): void {
    if (this.require(id).minimized) {
      this.restore(id);
    } else {
      this.minimize(id);
    }
  }

  /**
   * Take a window out of view without closing it. Dock mode, region slot and
   * minimized state are all kept, so `show()` brings it back exactly where
   * it was. A hidden docked window keeps its slot.
   */
  hide(id: string): void {
    const record = this.require(id);
    if (record.hidden) {
      return;
    }
    record.hidden = true;
    this.events.emit('hidden', record);
  }

  /** Reveal a hidden window and bring it to the front. */
  show(id: string): void {
    const record = this.require(id);
    if (!record.hidden) {
      return;
    }
    record.hidden = false;
    this.events.emit('shown', record);
    this.focus(id);
  }

  toggleHidden(id: string): void {
    if (this.require(id).hidden) {
      this.show(id);
    } else {
      this.hide(id);
    }
  }

  setDockMode(id: string, mode: DockModeValue): void {
    if (!isDockMode(mode)) {
      throw new Error(`[uix] "${String(mode)}" is not a dock mode`);
    }
    const record = this.require(id);
    if (record.dockMode === mode) {
      return;
    }
    const previous = record.dockMode;
    record.dockMode = mode;
    this.events.emit('dockChanged', { window: record, previous });
  }

  /**
   * Dock a window into a layout region. The manager records the intent and
   * emits `regionChanged`; the adapter places the window in a slot (and may
   * call `undock` back if the region is full or unknown).
   */
  dockTo(id: string, regionId: string): void {
    if (!regionId) {
      throw new Error('[uix] dockTo needs a region id; use undock() to leave a region');
    }
    const record = this.require(id);
    if (record.region === regionId) {
      return;
    }
    const previous = record.region;
    record.region = regionId;
    this.events.emit('regionChanged', { window: record, previous });
  }

  /** Take a window out of its region. No-op when it is not docked. */
  undock(id: string): void {
    const record = this.require(id);
    if (record.region === undefined) {
      return;
    }
    const previous = record.region;
    record.region = undefined;
    this.events.emit('regionChanged', { window: record, previous });
  }

  /**
   * Ask for the window to go back to where it spawned: its spawn region, or
   * its original placement and dock mode. The adapter owns that snapshot,
   * so this only emits `returnHome`; this is also what the DOCK title-bar
   * button does.
   */
  returnHome(id: string): void {
    this.events.emit('returnHome', this.require(id));
  }

  /** Enable or disable title-bar buttons after the window is open. */
  setChrome(id: string, chrome: Partial<WindowChrome>): void {
    const record = this.require(id);
    const next: WindowChrome = { ...record.chrome, ...chrome };
    if (
      next.pin === record.chrome.pin &&
      next.dock === record.chrome.dock &&
      next.minimize === record.chrome.minimize &&
      next.close === record.chrome.close
    ) {
      return;
    }
    const previous = record.chrome;
    record.chrome = next;
    this.events.emit('chromeChanged', { window: record, previous });
  }

  /** Track an active title-bar drag; emits dragStarted/dragEnded on change. */
  setDragging(id: string, dragging: boolean): void {
    const record = this.require(id);
    if (record.dragging === dragging) {
      return;
    }
    record.dragging = dragging;
    this.events.emit(dragging ? 'dragStarted' : 'dragEnded', record);
  }

  /** Title-bar pin button behaviour: place in space ↔ follow the player. */
  togglePin(id: string): DockModeValue {
    const next = togglePinned(this.require(id).dockMode);
    this.setDockMode(id, next);
    return next;
  }

  get(id: string): WindowRecord | undefined {
    return this.windows.get(id);
  }

  has(id: string): boolean {
    return this.windows.has(id);
  }

  get focused(): WindowRecord | undefined {
    const top = this.focusStack[this.focusStack.length - 1];
    return top === undefined ? undefined : this.windows.get(top);
  }

  /**
   * Focus depth of a window: 0 = focused (topmost), 1 = next, and so on.
   * The ECS layer converts this into a small z bias toward the viewer so
   * overlapping panels resolve in focus order.
   */
  orderOf(id: string): number {
    this.require(id);
    // focusStack is bottom→top; depth counts down from the top.
    const index = this.focusStack.lastIndexOf(id);
    return this.focusStack.length - 1 - index;
  }

  get count(): number {
    return this.windows.size;
  }

  list(): WindowRecord[] {
    // Top-of-stack first - the natural order for "window list" UIs.
    return [...this.focusStack]
      .reverse()
      .map((id) => this.windows.get(id))
      .filter((record): record is WindowRecord => record !== undefined);
  }

  private require(id: string): WindowRecord {
    const record = this.windows.get(id);
    if (!record) {
      throw new Error(`[uix] unknown window "${id}"`);
    }
    return record;
  }
}
