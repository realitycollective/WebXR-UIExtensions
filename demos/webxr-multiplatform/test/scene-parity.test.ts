/**
 * Scene parity.
 *
 * All three pipelines in this demo - IWSDK, XR Blocks and plain three.js -
 * feed the SAME showcase descriptor to their adapter's `SceneTarget`. The
 * descriptor is therefore the contract between them, and this checks it holds:
 * it validates, and applying it produces exactly the regions and windows it
 * declares, regions first so a window that spawns docked finds its region.
 */
import {
  applyScene,
  validateScene,
  type SceneTarget,
} from '@realitycollective/webxr-uiextensions';
import { describe, expect, it } from 'vitest';
import { PLAYGROUND } from '@showcase/playground-scene.js';

function record(): { target: SceneTarget; spawned: string[] } {
  const spawned: string[] = [];
  return {
    spawned,
    target: {
      spawnRegion: (region) => void spawned.push(`region:${region.id}`),
      spawnWindow: (window) => void spawned.push(`window:${window.id}`),
    },
  };
}

describe('showcase playground descriptor', () => {
  it('is valid - unique ids, every docked window has its region', () => {
    expect(validateScene(PLAYGROUND)).toEqual([]);
  });

  it('declares regions and windows for the pipelines to build', () => {
    expect(PLAYGROUND.regions?.length ?? 0).toBeGreaterThan(0);
    expect(PLAYGROUND.windows.length).toBeGreaterThan(0);
  });

  it('spawns every declared region and window, regions first', () => {
    const { target, spawned } = record();
    applyScene(target, PLAYGROUND);

    const regions = (PLAYGROUND.regions ?? []).map((region) => `region:${region.id}`);
    const windows = PLAYGROUND.windows.map((window) => `window:${window.id}`);
    expect(spawned).toEqual([...regions, ...windows]);
  });

  it('gives every window a config path an adapter can resolve', () => {
    for (const window of PLAYGROUND.windows) {
      expect(window.config).toMatch(/\.uikitml$/);
    }
  });
});
