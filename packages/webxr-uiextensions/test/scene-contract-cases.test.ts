/**
 * The shipped `SceneTarget` suite: a conforming host passes it, and every case
 * fails for a host built to break the promise it checks.
 */
import { describe, expect, it } from 'vitest';
import {
  CONTRACT_SCENE,
  DockMode,
  WindowManager,
  sceneTargetContractCases,
  type SceneTargetContractSetup,
  type SceneWindow,
} from '../src/index.js';

type Defect = 'drops-window' | 'renames' | 'no-region' | 'no-dock' | 'no-chrome' | 'dock-over-region';

function makeSetup(defect?: Defect, deferred = false): SceneTargetContractSetup {
  const manager = new WindowManager();
  const pending: SceneWindow[] = [];
  const open = (window: SceneWindow): void => {
    if (defect === 'drops-window' && window.id === 'contract-log') return;
    manager.open(window.id, {
      title: defect === 'renames' ? 'untitled' : window.title,
      ...(window.region !== undefined && defect !== 'no-region' ? { region: window.region } : {}),
      ...(window.dockMode !== undefined && defect !== 'no-dock' ? { dockMode: window.dockMode } : {}),
      chrome: {
        close: defect === 'no-chrome' ? false : (window.closable ?? false),
        minimize: window.minimizable ?? false,
      },
    });
    // Re-applies the descriptor's dock mode after opening, which takes a
    // docked window back out of its region.
    if (defect === 'dock-over-region' && window.region !== undefined && window.dockMode !== undefined) {
      manager.setDockMode(window.id, window.dockMode);
    }
  };
  const setup: SceneTargetContractSetup = {
    manager,
    target: {
      spawnRegion: () => {},
      spawnWindow: (window) => (deferred ? pending.push(window) : open(window)),
    },
  };
  if (deferred) {
    setup.settle = async () => {
      await Promise.resolve();
      for (const window of pending.splice(0)) open(window);
    };
  }
  return setup;
}

async function runCase(name: string, setup: SceneTargetContractSetup): Promise<void> {
  const contractCase = sceneTargetContractCases().find((entry) => entry.name === name);
  if (!contractCase) throw new Error(`no contract case named "${name}"`);
  await contractCase.run(setup);
}

describe('sceneTargetContractCases', () => {
  it('applies a descriptor with two regions and three windows', () => {
    expect(CONTRACT_SCENE.regions).toHaveLength(2);
    expect(CONTRACT_SCENE.windows.map((window) => window.id)).toEqual([
      'contract-stats',
      'contract-log',
      'contract-docked',
    ]);
    expect(CONTRACT_SCENE.windows[1]?.dockMode).toBe(DockMode.HeadLocked);
    expect(CONTRACT_SCENE.windows[2]).toMatchObject({ region: 'contract-rail', dockMode: DockMode.HeadLocked });
  });

  it('passes a host that builds windows at once, and one that settles later', async () => {
    for (const contractCase of sceneTargetContractCases()) {
      await expect(contractCase.run(makeSetup())).resolves.toBeUndefined();
      await expect(contractCase.run(makeSetup(undefined, true))).resolves.toBeUndefined();
    }
  });
});

describe('sceneTargetContractCases catches a broken host', () => {
  it('rejects a host that drops a window', async () => {
    await expect(runCase('applyScene opens every descriptor window on the manager', makeSetup('drops-window'))).rejects.toThrow(
      /must open window "contract-log"/,
    );
  });

  it('rejects a host that changes a title', async () => {
    await expect(runCase('each window keeps its descriptor title', makeSetup('renames'))).rejects.toThrow(
      /must be titled "Stats", got "untitled"/,
    );
  });

  it('rejects a host that ignores the region', async () => {
    await expect(runCase('a window named into a region is in that region', makeSetup('no-region'))).rejects.toThrow(
      /must be in region "contract-shelf"/,
    );
  });

  it('rejects a host that ignores the dock mode or the chrome', async () => {
    await expect(runCase('a window keeps its descriptor dock mode and chrome', makeSetup('no-dock'))).rejects.toThrow(
      /"contract-log" must be head-locked/,
    );
    await expect(runCase('a window keeps its descriptor dock mode and chrome', makeSetup('no-chrome'))).rejects.toThrow(
      /close and minimize chrome/,
    );
  });

  it('rejects a host whose docked window follows its dock mode out of the region', async () => {
    await expect(
      runCase('a window given a region and a dock mode is world-locked in that region', makeSetup('dock-over-region')),
    ).rejects.toThrow(/must be in region "contract-rail", got undefined/);
  });

  it('fails loudly when asked for a case that does not exist', async () => {
    await expect(runCase('no such case', makeSetup())).rejects.toThrow(/no contract case named/);
  });
});
