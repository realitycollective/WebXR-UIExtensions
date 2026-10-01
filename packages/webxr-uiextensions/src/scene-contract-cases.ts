/**
 * The shared `SceneTarget` contract, shipped as data rather than as tests.
 *
 * A client builds its UI with the core's `applyScene(target, descriptor)` and
 * never asks which platform draws it. That only holds if every host turns the
 * same descriptor into the same windows: each one opened on the host's
 * `WindowManager` under its own id and title, in its region, with its dock
 * mode and chrome. These cases check exactly that, through the manager every
 * client already reads, so they need nothing platform-specific beyond a way
 * to let a host finish what it does over later frames.
 *
 * When a descriptor gives a window both a region and a dock mode, the region
 * wins and the window is world-locked. The core `WindowManager` holds that
 * rule, and a case checks every host keeps it.
 *
 * The suite is runner-free, like `windowHostContractCases()`: each case
 * resolves on success and rejects with a plain `Error` otherwise.
 *
 * ```ts
 * for (const contractCase of sceneTargetContractCases()) {
 *   it(contractCase.name, () => contractCase.run(makeSetup()));
 * }
 * ```
 */
import type { WindowManager } from './core/window-manager.js';
import { DockMode } from './core/dock-state.js';
import { applyScene, type SceneDescriptor, type SceneTarget } from './scene.js';

/** Everything a case needs to drive one host. Build a FRESH one per case. */
export interface SceneTargetContractSetup {
  /** The host under test. */
  target: SceneTarget;
  /** The manager the host opens its windows on. */
  manager: WindowManager;
  /**
   * Let the host finish building the windows with these ids: load their
   * configs, attach their panels, run a frame. Omit it when windows exist as
   * soon as `applyScene` returns.
   */
  settle?: (windowIds: readonly string[]) => void | Promise<void>;
}

/** One check a {@link SceneTarget} host must pass. */
export interface SceneTargetContractCase {
  name: string;
  run(setup: SceneTargetContractSetup): Promise<void>;
}

/** The descriptor every case applies: two regions, three windows. */
export const CONTRACT_SCENE: SceneDescriptor = {
  name: 'contract',
  regions: [{ id: 'contract-shelf' }, { id: 'contract-rail' }],
  windows: [
    {
      id: 'contract-stats',
      title: 'Stats',
      config: '/ui/contract-stats.uikitml',
      region: 'contract-shelf',
    },
    {
      id: 'contract-log',
      title: 'Log',
      config: '/ui/contract-log.uikitml',
      dockMode: DockMode.HeadLocked,
      closable: true,
      minimizable: true,
    },
    {
      id: 'contract-docked',
      title: 'Docked',
      config: '/ui/contract-docked.uikitml',
      region: 'contract-rail',
      dockMode: DockMode.HeadLocked,
    },
  ],
};

const WINDOW_IDS = CONTRACT_SCENE.windows.map((window) => window.id);

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function build(setup: SceneTargetContractSetup): Promise<void> {
  applyScene(setup.target, CONTRACT_SCENE);
  await setup.settle?.(WINDOW_IDS);
}

const CASES: readonly SceneTargetContractCase[] = [
  {
    name: 'applyScene opens every descriptor window on the manager',
    async run(setup) {
      await build(setup);
      for (const id of WINDOW_IDS) {
        assert(setup.manager.has(id), `applyScene must open window "${id}" on the host's manager`);
      }
    },
  },
  {
    name: 'each window keeps its descriptor title',
    async run(setup) {
      await build(setup);
      for (const window of CONTRACT_SCENE.windows) {
        const title = setup.manager.get(window.id)?.title;
        assert(title === window.title, `window "${window.id}" must be titled "${window.title}", got ${JSON.stringify(title)}`);
      }
    },
  },
  {
    name: 'a window named into a region is in that region',
    async run(setup) {
      await build(setup);
      const region = setup.manager.get('contract-stats')?.region;
      assert(region === 'contract-shelf', `window "contract-stats" must be in region "contract-shelf", got ${JSON.stringify(region)}`);
    },
  },
  {
    name: 'a window keeps its descriptor dock mode and chrome',
    async run(setup) {
      await build(setup);
      const record = setup.manager.get('contract-log');
      assert(
        record?.dockMode === DockMode.HeadLocked,
        `window "contract-log" must be ${DockMode.HeadLocked}, got ${JSON.stringify(record?.dockMode)}`,
      );
      assert(
        record.chrome.close && record.chrome.minimize,
        `window "contract-log" must show the close and minimize chrome it asked for, got ${JSON.stringify(record.chrome)}`,
      );
    },
  },
  {
    name: 'a window given a region and a dock mode is world-locked in that region',
    async run(setup) {
      await build(setup);
      const record = setup.manager.get('contract-docked');
      assert(
        record?.region === 'contract-rail',
        `window "contract-docked" must be in region "contract-rail", got ${JSON.stringify(record?.region)}`,
      );
      assert(
        record.dockMode === DockMode.WorldLocked,
        `window "contract-docked" is in a region, so it must be ${DockMode.WorldLocked}, got ${JSON.stringify(record.dockMode)}`,
      );
    },
  },
];

/** The shared `SceneTarget` conformance suite. */
export function sceneTargetContractCases(): readonly SceneTargetContractCase[] {
  return CASES;
}
