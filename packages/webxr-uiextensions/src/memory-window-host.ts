/**
 * An in-memory `WindowHost`: the family's mock, for headless tests and for
 * checking a new adapter against the same reference.
 *
 * It needs no engine and no renderer, and it passes every case in
 * `windowHostContractCases()`. Windows are opened on a real
 * {@link WindowManager}, and a window's panel attaches when the test calls
 * {@link MemoryWindowHost.attach}, the way IWSDK attaches one on a later
 * frame. {@link createMemoryWindowHostSetup} builds a fresh setup for the
 * contract suite:
 *
 * ```ts
 * for (const contractCase of windowHostContractCases()) {
 *   it(contractCase.name, () => contractCase.run(createMemoryWindowHostSetup()));
 * }
 * ```
 */
import type {
  PanelHandle,
  PanelReadyEvent,
  WindowHandle,
  WindowHost,
} from './adapter.js';
import type { WindowHostContractSetup } from './contract-cases.js';
import type { UixElement } from './controls/element.js';
import { WindowManager } from './core/window-manager.js';

/** A panel with an empty root. It records whether it was disposed. */
export class MemoryPanel implements PanelHandle {
  readonly root: UixElement = {
    userData: {},
    children: [],
    addEventListener: () => {},
    setProperties: () => {},
  };
  disposed = false;

  getElementById(_id: string): UixElement | undefined {
    return undefined;
  }

  setTargetDimensions(_width: number, _height: number): void {}

  dispose(): void {
    this.disposed = true;
  }
}

/** A window whose panel arrives when {@link MemoryWindowHandle.attach} is called. */
export class MemoryWindowHandle implements WindowHandle {
  panel: PanelHandle | undefined;
  private listeners: Array<(panel: PanelHandle) => void> = [];

  constructor(readonly id: string) {}

  onReady(listener: (panel: PanelHandle) => void): () => void {
    if (this.panel) {
      listener(this.panel);
      return () => {};
    }
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((entry) => entry !== listener);
    };
  }

  /** Attach the panel and run every waiting `onReady` listener once. */
  attach(panel: PanelHandle): void {
    this.panel = panel;
    const waiting = this.listeners;
    this.listeners = [];
    for (const listener of waiting) listener(panel);
  }
}

/**
 * A host whose windows live on the {@link WindowManager} it is given.
 * Closing a window through the manager disposes its panel and drops it from
 * `onPanelReady` replay, as the engine adapters do.
 */
export class MemoryWindowHost implements WindowHost {
  readonly supportsStandalonePanels = true;
  private readonly handles = new Map<string, MemoryWindowHandle>();
  private readyListeners: Array<(event: PanelReadyEvent) => void> = [];
  private readonly stopClosed: () => void;

  constructor(readonly manager: WindowManager) {
    this.stopClosed = manager.events.on('closed', (record) => {
      this.handles.get(record.id)?.panel?.dispose();
      this.handles.delete(record.id);
    });
  }

  createPanel(_configJson: unknown): PanelHandle {
    return new MemoryPanel();
  }

  onPanelReady(listener: (event: PanelReadyEvent) => void): () => void {
    for (const [id, handle] of this.handles) {
      if (handle.panel) listener({ id, panel: handle.panel, kind: 'window' });
    }
    this.readyListeners.push(listener);
    return () => {
      this.readyListeners = this.readyListeners.filter((entry) => entry !== listener);
    };
  }

  /** Open a window on the manager. Its panel arrives on {@link attach}. */
  createWindow(id: string): MemoryWindowHandle {
    const handle = new MemoryWindowHandle(id);
    this.handles.set(id, handle);
    this.manager.open(id, { title: id });
    return handle;
  }

  /** Attach a panel to an open window. Does nothing if it has one already. */
  attach(id: string): void {
    const handle = this.handles.get(id);
    if (!handle || handle.panel) return;
    const panel = new MemoryPanel();
    handle.attach(panel);
    for (const listener of this.readyListeners) listener({ id, panel, kind: 'window' });
  }

  /**
   * Leave nothing behind: close every window through the manager, so each
   * panel is disposed on the normal close path, then stop following the
   * manager and forget every listener. Safe to call twice.
   */
  dispose(): void {
    // A handle is dropped the moment its window closes, so every id here is open.
    for (const id of [...this.handles.keys()]) this.manager.close(id);
    this.stopClosed();
    this.handles.clear();
    this.readyListeners = [];
  }
}

/** A fresh host on a fresh manager, shaped for `windowHostContractCases()`. */
export function createMemoryWindowHostSetup(): WindowHostContractSetup {
  const manager = new WindowManager();
  const host = new MemoryWindowHost(manager);
  return {
    host,
    manager,
    createWindow: (id) => host.createWindow(id),
    attach: (id) => host.attach(id),
    panelConfig: {},
  };
}
