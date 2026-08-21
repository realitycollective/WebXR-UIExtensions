/**
 * WindowManager - pure window registry, focus ordering and minimize state.
 *
 * The manager knows nothing about entities, three.js or uikit. It deals in
 * opaque window ids and answers two questions the ECS layer applies each
 * frame:
 *
 * 1. What is the focus (z) order? (`orderOf` → depth bias so the focused
 *    window renders nearest the user and receives pointer priority)
 * 2. What state is a window in? (minimized / focused / dock mode)
 */
import { Emitter } from './events.js';
import { DockMode, DockModeValue, isDockMode, togglePinned } from './dock-state.js';

export interface WindowRecord {
  id: string;
  title: string;
  dockMode: DockModeValue;
  minimized: boolean;
  /** True while the user is actively dragging the window by its title bar. */
  dragging: boolean;
}

export interface WindowManagerEvents extends Record<string, unknown> {
  opened: WindowRecord;
  closed: WindowRecord;
  focused: WindowRecord;
  minimized: WindowRecord;
  restored: WindowRecord;
  dockChanged: { window: WindowRecord; previous: DockModeValue };
  dragStarted: WindowRecord;
  dragEnded: WindowRecord;
}

export interface OpenWindowOptions {
  title?: string;
  dockMode?: DockModeValue;
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
      dragging: false,
    };
    this.windows.set(id, record);
    this.focusStack.push(id);
    this.events.emit('opened', record);
    this.events.emit('focused', record);
    return record;
  }

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
