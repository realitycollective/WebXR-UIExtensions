/**
 * The plain three.js host runs the core's rules, as IWSDK, XR Blocks and
 * native do: the follow rule (`stepFollow`, proved equal to IWSDK's
 * FollowSystem), IWSDK's region follow defaults, the title default, and
 * automatic control upgrades. Mirrors
 * `xrblocks-uiextensions/test/core-rules.test.ts` - this package's
 * `UixWindowHost` is the same class that test drives, through
 * `@realitycollective/xrblocks-uiextensions`'s thin subclass.
 */
import { parse } from '@pmndrs/uikitml';
import { Group } from 'three';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REGION_FOLLOW,
  DEFAULT_WINDOW_FOLLOW,
  DockMode,
  enterFollow,
  resolveFollow,
  stepFollow,
  upgradePanel,
  yawQuaternion,
  type FollowState,
  type HeadPose,
} from '@realitycollective/webxr-uiextensions';
import { UixWindowHost } from '../src/host.js';

const PANEL = `
<div id="uix-window">
  <div id="uix-titlebar"><text id="uix-title">t</text></div>
  <div id="uix-content">
    <uix-stepper data-uix-id="count" data-uix-value="1"><uix-value>1</uix-value></uix-stepper>
  </div>
</div>
`;

function config() {
  return parse(PANEL);
}

function moving() {
  const head = { pose: { position: [0, 1.6, 0], quaternion: [0, 0, 0, 1] } as HeadPose };
  const scene = new Group();
  const host = new UixWindowHost({ scene, headPose: { getHeadPose: () => head.pose } });
  const walk = (i: number) => {
    head.pose = { position: [0.3 * Math.sin(i / 20), 1.6, -0.02 * i], quaternion: yawQuaternion(Math.min(1, i * 0.02)) };
  };
  return { head, host, walk };
}

describe('three.js follows by the core rule', () => {
  for (const mode of [DockMode.BodyFollow, DockMode.HeadLocked]) {
    it(`a ${mode} window's pose every frame is stepFollow's`, () => {
      const { head, host, walk } = moving();
      const handle = host.createWindow({ id: 'w', config: config(), dockMode: mode, position: [3, 0, 3] });
      let reference: FollowState = enterFollow();
      for (let i = 0; i < 90; i += 1) {
        walk(i);
        host.update(1 / 72);
        const step = stepFollow(reference, head.pose, DEFAULT_WINDOW_FOLLOW, 1 / 72);
        reference = step.state;
        handle.group.position.toArray().forEach((value, axis) => {
          expect(value).toBeCloseTo(step.pose.position[axis]!, 9);
        });
      }
    });
  }

  it('a following region follows with IWSDK Follower defaults', () => {
    const { head, host, walk } = moving();
    const region = host.createRegion({ id: 'rail', follow: true });
    let reference: FollowState = enterFollow();
    const options = resolveFollow({}, DEFAULT_REGION_FOLLOW);
    for (let i = 0; i < 60; i += 1) {
      walk(i);
      host.update(1 / 72);
      const step = stepFollow(reference, head.pose, options, 1 / 72);
      reference = step.state;
      region.group.position.toArray().forEach((value, axis) => {
        expect(value).toBeCloseTo(step.pose.position[axis]!, 9);
      });
    }
  });

  it('unpinning follows from where the window was left', () => {
    const { host } = moving();
    const handle = host.createWindow({ id: 'w', config: config(), position: [0.5, 1.6, -1] });
    host.update(1 / 72);
    host.manager.togglePin('w');
    host.update(1 / 72);
    handle.group.position.toArray().forEach((value, axis) => expect(value).toBeCloseTo([0.5, 1.6, -1][axis]!, 9));
  });
});

describe('three.js applies the shared defaults', () => {
  it('a window with no title is titled with its id', () => {
    const { host } = moving();
    host.createWindow({ id: 'untitled', config: config() });
    expect(host.manager.get('untitled')?.title).toBe('untitled');
  });

  it("upgrades every panel's controls, as IWSDK's UIControlsSystem does", () => {
    const { host } = moving();
    const handle = host.createWindow({ id: 'w', config: config() });
    expect(upgradePanel(handle.panel.root, handle.panel.root).ids()).toEqual(['count']);
    const bare = host.createPanel(config());
    expect(upgradePanel(bare.root, bare.root).ids()).toEqual(['count']);
  });
});
