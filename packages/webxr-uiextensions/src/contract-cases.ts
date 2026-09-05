/**
 * The shared `WindowHost` contract, shipped as data rather than as tests.
 *
 * Every adapter promises the same four things, whatever engine sits behind
 * it: it says whether bare panels work and behaves accordingly,
 * `createWindow` hands back a {@link WindowHandle}, `onReady` fires exactly
 * once and replays for a late subscriber, and `onPanelReady` replays too.
 * Running one suite from every adapter is what keeps those promises from
 * drifting apart, and gives a new adapter a starting test for free.
 *
 * The suite is runner-free on purpose. Every adapter repository already has
 * its own test runner, and an adapter written outside this repository cannot
 * reach into this one's `test/` folder, so the checks ship as plain objects
 * that throw an `Error` on failure and the adapter iterates them.
 *
 * `createWindow` itself is adapter-specific - IWSDK takes a config PATH, the
 * three.js host takes parsed markup - so the caller supplies a
 * {@link WindowHostContractSetup} that wraps those differences.
 */
import type { PanelHandle, WindowHandle, WindowHost } from './adapter.js';

/**
 * Everything a case needs to drive one adapter. Build a FRESH one per case:
 * cases spawn windows of their own and do not clean up after themselves.
 */
export interface WindowHostContractSetup {
  /** The host under test. */
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

/**
 * One check a {@link WindowHost} implementation must pass. `run` returns
 * silently on success and throws an `Error` describing the failure
 * otherwise, so any test runner can host it.
 */
export interface WindowHostContractCase {
  name: string;
  run(setup: WindowHostContractSetup): void;
}

/**
 * The shared host conformance suite. An adapter's test file is a loop:
 *
 * ```ts
 * for (const contractCase of windowHostContractCases()) {
 *   it(contractCase.name, () => contractCase.run(makeSetup()));
 * }
 * ```
 *
 * `makeSetup()` runs per case, so each case gets a host of its own.
 */
export function windowHostContractCases(): readonly WindowHostContractCase[] {
  return CASES;
}

const CASES: readonly WindowHostContractCase[] = [
  {
    name: 'reports whether bare panels work, and createPanel agrees',
    run(setup) {
      const supported = setup.host.supportsStandalonePanels;
      assert(
        typeof supported === 'boolean',
        `supportsStandalonePanels must be a boolean, got ${typeof supported}`,
      );
      if (supported) {
        try {
          setup.host.createPanel(setup.panelConfig);
        } catch (error) {
          throw new Error(
            `supportsStandalonePanels is true, so createPanel() must work, it threw: ${String(error)}`,
          );
        }
        return;
      }
      assert(
        threw(() => setup.host.createPanel(setup.panelConfig)),
        'supportsStandalonePanels is false, so createPanel() must throw rather than return an unusable panel',
      );
    },
  },
  {
    name: 'createWindow returns a handle with an id and onReady',
    run(setup) {
      const handle = setup.createWindow('contract-a');
      assert(
        typeof handle.id === 'string',
        `WindowHandle.id must be a string, got ${typeof handle.id}`,
      );
      assert(
        handle.id === 'contract-a',
        `createWindow("contract-a") must keep the id it was given, got "${handle.id}"`,
      );
      assert(
        typeof handle.onReady === 'function',
        'a WindowHandle must implement onReady()',
      );
    },
  },
  {
    name: 'onReady fires once when the panel attaches',
    run(setup) {
      const handle = setup.createWindow('contract-b');
      const seen: PanelHandle[] = [];
      handle.onReady((panel) => seen.push(panel));
      setup.attach?.('contract-b');
      assert(
        seen.length === 1,
        `onReady must fire exactly once when the panel attaches, it fired ${String(seen.length)} time(s)`,
      );
      assert(
        handle.panel === seen[0],
        'the panel passed to onReady must be the same one the handle reports',
      );
    },
  },
  {
    name: 'onReady replays for a subscriber that arrives late',
    run(setup) {
      const handle = setup.createWindow('contract-c');
      setup.attach?.('contract-c');
      const seen: PanelHandle[] = [];
      const stop = handle.onReady((panel) => seen.push(panel));
      assert(
        seen.length === 1,
        `onReady must replay for a subscriber that arrives after the panel, it fired ${String(seen.length)} time(s)`,
      );
      // Unsubscribing after the fact is a no-op, not an error.
      detach(stop, 'onReady');
      assert(
        seen.length === 1,
        'unsubscribing after onReady has replayed must not deliver the panel again',
      );
    },
  },
  {
    name: 'onPanelReady replays for a subscriber that arrives late',
    run(setup) {
      setup.createWindow('contract-d');
      setup.attach?.('contract-d');
      const ids: string[] = [];
      const stop = setup.host.onPanelReady((event) => ids.push(event.id));
      assert(
        ids.includes('contract-d'),
        `onPanelReady must replay the windows already live, expected "contract-d" among [${ids.join(', ')}]`,
      );
      detach(stop, 'onPanelReady');
    },
  },
];

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** Whether `run` threw, without caring what it threw. */
function threw(run: () => unknown): boolean {
  try {
    run();
    return false;
  } catch {
    return true;
  }
}

function detach(stop: () => void, label: string): void {
  try {
    stop();
  } catch (error) {
    throw new Error(
      `the unsubscribe returned by ${label}() threw: ${String(error)}`,
    );
  }
}
