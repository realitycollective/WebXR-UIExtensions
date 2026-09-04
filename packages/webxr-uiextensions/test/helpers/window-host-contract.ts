/**
 * The shared `WindowHost` contract, as a reusable vitest suite.
 *
 * Every adapter promises the same four things, whatever engine sits behind
 * it: it says whether bare panels work and behaves accordingly, `createWindow`
 * hands back a `WindowHandle`, `onReady` fires exactly once and replays for a
 * late subscriber, and `onPanelReady` replays too. Running one suite from both
 * adapters is what keeps those promises from drifting apart, and gives a new
 * adapter a starting test for free.
 *
 * `createWindow` itself is adapter-specific - IWSDK takes a config PATH, the
 * three.js host takes parsed markup - so the caller supplies a `createWindow`
 * that only needs an id, and an `attach` for adapters whose panel arrives
 * later.
 */
import { describe, expect, it } from 'vitest';
import type { PanelHandle, WindowHandle, WindowHost } from '../../src/index.js';

export interface WindowHostContractSetup {
  /** A fresh host. The suite calls the factory once per case. */
  host: WindowHost;
  /** Spawn one window with this id, using whatever config the adapter needs. */
  createWindow(id: string): WindowHandle;
  /**
   * Attach the panel for a window, where the adapter attaches asynchronously.
   * Omit it when the panel exists as soon as the window does.
   */
  attach?: (id: string) => void;
  /** A config `createPanel` accepts, for hosts that support bare panels. */
  panelConfig?: unknown;
}

export function windowHostContract(
  name: string,
  factory: () => WindowHostContractSetup,
): void {
  describe(`WindowHost contract: ${name}`, () => {
    it('reports whether bare panels work, and createPanel agrees', () => {
      const setup = factory();
      expect(typeof setup.host.supportsStandalonePanels).toBe('boolean');
      if (setup.host.supportsStandalonePanels) {
        expect(() => setup.host.createPanel(setup.panelConfig)).not.toThrow();
      } else {
        expect(() => setup.host.createPanel(setup.panelConfig)).toThrow();
      }
    });

    it('createWindow returns a handle with an id and onReady', () => {
      const setup = factory();
      const handle = setup.createWindow('contract-a');
      expect(typeof handle.id).toBe('string');
      expect(handle.id).toBe('contract-a');
      expect(typeof handle.onReady).toBe('function');
    });

    it('onReady fires once when the panel attaches', () => {
      const setup = factory();
      const handle = setup.createWindow('contract-b');
      const seen: PanelHandle[] = [];
      handle.onReady((panel) => seen.push(panel));
      setup.attach?.('contract-b');
      expect(seen).toHaveLength(1);
      expect(handle.panel).toBe(seen[0]);
    });

    it('onReady replays for a subscriber that arrives late', () => {
      const setup = factory();
      const handle = setup.createWindow('contract-c');
      setup.attach?.('contract-c');
      const seen: PanelHandle[] = [];
      const stop = handle.onReady((panel) => seen.push(panel));
      expect(seen).toHaveLength(1);
      // Unsubscribing after the fact is a no-op, not an error.
      stop();
      expect(seen).toHaveLength(1);
    });

    it('onPanelReady replays for a subscriber that arrives late', () => {
      const setup = factory();
      setup.createWindow('contract-d');
      setup.attach?.('contract-d');
      const ids: string[] = [];
      const stop = setup.host.onPanelReady((event) => ids.push(event.id));
      expect(ids).toContain('contract-d');
      stop();
    });
  });
}
