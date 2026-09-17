import { describe, expect, it, vi } from 'vitest';
import { DockMode } from '../src/core/dock-state.js';
import {
  applyScene,
  sceneConfigPaths,
  validateScene,
  type SceneDescriptor,
  type SceneTarget,
} from '../src/scene.js';

const SCENE: SceneDescriptor = {
  name: 'test',
  regions: [{ id: 'wall', flow: 'column' }],
  windows: [
    { id: 'a', title: 'A', config: './ui/a.json', position: [0, 1, -1] },
    { id: 'b', title: 'B', config: './ui/b.json', region: 'wall' },
    { id: 'c', title: 'C', config: './ui/a.json', dockMode: DockMode.BodyFollow },
  ],
};

function recordingTarget() {
  const calls: string[] = [];
  const target: SceneTarget = {
    spawnRegion: (region) => void calls.push(`region:${region.id}`),
    spawnWindow: (window) => void calls.push(`window:${window.id}`),
  };
  return { target, calls };
}

describe('applyScene', () => {
  it('spawns every region and window', () => {
    const { target, calls } = recordingTarget();
    applyScene(target, SCENE);
    expect(calls).toEqual(['region:wall', 'window:a', 'window:b', 'window:c']);
  });

  it('creates regions before windows so docked spawns resolve', () => {
    const { target, calls } = recordingTarget();
    applyScene(target, SCENE);
    expect(calls.indexOf('region:wall')).toBeLessThan(calls.indexOf('window:b'));
  });

  it('tolerates a scene with no regions', () => {
    const spawnWindow = vi.fn();
    applyScene({ spawnRegion: vi.fn(), spawnWindow }, { windows: SCENE.windows });
    expect(spawnWindow).toHaveBeenCalledTimes(3);
  });

  it('passes the window descriptor through unchanged', () => {
    const spawnWindow = vi.fn();
    applyScene({ spawnRegion: vi.fn(), spawnWindow }, SCENE);
    expect(spawnWindow).toHaveBeenNthCalledWith(3, {
      id: 'c',
      title: 'C',
      config: './ui/a.json',
      dockMode: DockMode.BodyFollow,
    });
  });
});

describe('sceneConfigPaths', () => {
  it('lists each distinct config once', () => {
    expect(sceneConfigPaths(SCENE)).toEqual(['./ui/a.json', './ui/b.json']);
  });
});

describe('validateScene', () => {
  it('accepts a well-formed scene', () => {
    expect(validateScene(SCENE)).toEqual([]);
  });

  it('reports duplicate window ids', () => {
    const problems = validateScene({
      windows: [
        { id: 'dup', title: 'x', config: './a.json' },
        { id: 'dup', title: 'y', config: './b.json' },
      ],
    });
    expect(problems).toEqual(['duplicate window id "dup"']);
  });

  it('reports duplicate region ids', () => {
    const problems = validateScene({
      regions: [{ id: 'r' }, { id: 'r' }],
      windows: [],
    });
    expect(problems).toEqual(['duplicate region id "r"']);
  });

  it('reports windows docking into unknown regions', () => {
    const problems = validateScene({
      regions: [{ id: 'wall' }],
      windows: [{ id: 'w', title: 'x', config: './a.json', region: 'nope' }],
    });
    expect(problems).toEqual(['window "w" docks into unknown region "nope"']);
  });

  it('collects every problem rather than failing fast', () => {
    expect(
      validateScene({
        regions: [{ id: 'r' }, { id: 'r' }],
        windows: [
          { id: 'w', title: 'x', config: './a.json', region: 'ghost' },
          { id: 'w', title: 'y', config: './b.json' },
        ],
      }),
    ).toHaveLength(3);
  });
});
