/**
 * The UI host conformance kit: host cases (the third kind in the Masters'
 * "Validation" section), shipped as data so a native app runs them against
 * its REAL `ui` slice on the device, for example under `debug.rc.suites=1`.
 *
 * Binding cases prove what this package hands the host. These prove what the
 * host does with it: that it draws a window at the pose it was handed, hides
 * what it was told to hide, shows the properties it was given, and measures
 * a fingertip's signed distance with the right sign. That was the layer the
 * September 2026 native drift lived in, and the layer no Node test can see.
 *
 * Each case builds its own `NativeWindowHost` over the real host, with a
 * scripted head and hands so the expected result is exact, and reads the
 * outcome back through the host's test readbacks (`NativeUiTestHost`). The
 * suite is runner-free, like the core contract suites: a case resolves on
 * success and rejects with a plain `Error` naming the master row otherwise.
 *
 * ```ts
 * for (const hostCase of nativeUiHostConformanceCases()) {
 *   await hostCase.run({ ui: __rcHost.ui, testHost: __rcShell.testHost, config, waitForPanel });
 * }
 * ```
 */
import {
  DEFAULT_WINDOW_FOLLOW,
  DockMode,
  enterFollow,
  stepFollow,
  yawQuaternion,
  type FollowState,
  type HeadPose,
  type PoseTuple,
  type Vec3Tuple,
  WINDOW_CHROME_IDS,
} from '@realitycollective/webxr-uiextensions';
import { NativeWindowHost } from './host.js';
import type { NativeUiHost, NativeUiInputHost, NativeUiInputSource, NativeUiTestHost } from './native-types.js';

/** Everything a host case needs. Build a fresh one per case if the host keeps state between windows. */
export interface NativeUiHostConformanceSetup {
  /** The host under test: the real `ui` slice. */
  ui: NativeUiHost;
  /** Its test readbacks. */
  testHost: NativeUiTestHost;
  /**
   * A panel config the host can build that carries the standard window
   * chrome ids (`WINDOW_CHROME_IDS`: `uix-window`, `uix-titlebar`,
   * `uix-title`, `uix-pin`, `uix-dock`, `uix-minimize`, `uix-close`,
   * `uix-content`), such as the core's `WINDOW_CHROME_MARKUP` compiled.
   */
  config: unknown;
  /** Resolve once the host has reported the window's panel ready (let frames run until then). */
  waitForPanel(windowId: string): Promise<void>;
}

/** One check a native `ui` host must pass. `name` is `ui/<master row>`. */
export interface NativeUiHostConformanceCase {
  name: string;
  run(setup: NativeUiHostConformanceSetup): Promise<void>;
}

/** Positions within 1 mm, orientations within about 0.1 degree. */
const POSITION_TOLERANCE = 1e-3;
const ROTATION_TOLERANCE = 1e-6;

function fail(name: string, message: string): never {
  throw new Error(`[${name}] ${message}`);
}

function samePose(a: PoseTuple | undefined, b: PoseTuple): boolean {
  if (!a) return false;
  const close = a.position.every((value, i) => Math.abs(value - b.position[i]!) <= POSITION_TOLERANCE);
  const dot = Math.abs(a.quaternion.reduce((sum, value, i) => sum + value * b.quaternion[i]!, 0));
  return close && 1 - dot <= ROTATION_TOLERANCE;
}

function show(pose: PoseTuple | undefined): string {
  return pose ? JSON.stringify(pose) : 'nothing';
}

function scripted(head: HeadPose, sources: NativeUiInputSource[] = []): NativeUiInputHost & { head: HeadPose } {
  const input = {
    head,
    getHeadPose: () => input.head,
    sample: () => sources,
  };
  return input;
}

const HEAD: HeadPose = { position: [0, 1.6, 0], quaternion: [0, 0, 0, 1] };
const FRAME = 1 / 72;

async function openWindow(
  setup: NativeUiHostConformanceSetup,
  input: NativeUiInputHost,
  id: string,
  options: Record<string, unknown> = {},
): Promise<NativeWindowHost> {
  const binding = new NativeWindowHost({ host: setup.ui, input });
  binding.createWindow({ id, config: setup.config, ...options });
  await setup.waitForPanel(id);
  if (!binding.manager.has(id)) {
    binding.dispose();
    fail('ui/panel ready', `the host never reported the panel of "${id}" ready`);
  }
  return binding;
}

function hostCase(
  name: string,
  run: (setup: NativeUiHostConformanceSetup, name: string) => Promise<void>,
): NativeUiHostConformanceCase {
  return { name, run: (setup) => run(setup, name) };
}

/** The UI host conformance cases. See the file comment. */
export function nativeUiHostConformanceCases(): NativeUiHostConformanceCase[] {
  return [
    hostCase('ui/title defaults to the window id and is written to uix-title', async (setup, name) => {
        const binding = await openWindow(setup, scripted(HEAD), 'rc-kit-title');
        try {
          const text = setup.testHost.elementProperties('rc-kit-title', 'uix-title')?.['text'];
          if (text !== 'rc-kit-title') {
            fail(name, `uix-title shows ${JSON.stringify(text)}, expected "rc-kit-title"`);
          }
        } finally {
          binding.dispose();
        }
    }),
    hostCase('ui/every chrome button is off unless asked', async (setup, name) => {
        const binding = await openWindow(setup, scripted(HEAD), 'rc-kit-chrome', { closable: true });
        try {
          const display = (id: string) => setup.testHost.elementProperties('rc-kit-chrome', id)?.['display'];
          if (display('uix-close') !== 'flex') fail(name, 'the enabled close button is not shown');
          for (const id of ['uix-pin', 'uix-dock', 'uix-minimize']) {
            if (display(id) !== 'none') fail(name, `${id} is shown although it was not asked for`);
          }
        } finally {
          binding.dispose();
        }
    }),
    hostCase('ui/pin label names the next action', async (setup, name) => {
        const binding = await openWindow(setup, scripted(HEAD), 'rc-kit-pin', { pinnable: true });
        try {
          const label = () => setup.testHost.elementProperties('rc-kit-pin', 'uix-pin')?.['text'];
          if (label() !== 'UNPIN') fail(name, `a placed window reads ${JSON.stringify(label())}, expected "UNPIN"`);
          binding.manager.togglePin('rc-kit-pin');
          if (label() !== 'PIN') fail(name, `a following window reads ${JSON.stringify(label())}, expected "PIN"`);
        } finally {
          binding.dispose();
        }
    }),
    hostCase('ui/minimize label and minimized content', async (setup, name) => {
        const binding = await openWindow(setup, scripted(HEAD), 'rc-kit-min', { minimizable: true });
        try {
          binding.manager.minimize('rc-kit-min');
          const props = (id: string) => setup.testHost.elementProperties('rc-kit-min', id);
          if (props('uix-minimize')?.['text'] !== 'MAX') fail(name, 'a minimized window does not read "MAX"');
          if (props('uix-content')?.['display'] !== 'none') fail(name, 'the content is still shown while minimized');
        } finally {
          binding.dispose();
        }
    }),
    hostCase('ui/the host draws a window at the pose it is handed (world-locked)', async (setup, name) => {
        const binding = await openWindow(setup, scripted(HEAD), 'rc-kit-world', { position: [0.2, 1.4, -1.5] });
        try {
          binding.update(FRAME);
          const expected: PoseTuple = { position: [0.2, 1.4, -1.5], quaternion: [0, 0, 0, 1] };
          const drawn = setup.testHost.windowPose('rc-kit-world');
          if (!samePose(drawn, expected)) fail(name, `drawn at ${show(drawn)}, handed ${show(expected)}`);
        } finally {
          binding.dispose();
        }
    }),
    hostCase('ui/body-follow and head-locked follow the core rule (speed 3, dead zone 0.35 m, 30 degrees, PivotY)', async (setup, name) => {
        for (const mode of [DockMode.BodyFollow, DockMode.HeadLocked]) {
          const input = scripted(HEAD);
          const id = `rc-kit-${mode}`;
          const binding = await openWindow(setup, input, id, { dockMode: mode });
          try {
            let reference: FollowState = enterFollow();
            for (let i = 0; i < 60; i += 1) {
              input.head = {
                position: [0.3 * Math.sin(i / 15), 1.6, -0.02 * i],
                quaternion: yawQuaternion(Math.min(0.9, i * 0.02)),
              };
              binding.update(FRAME);
              const step = stepFollow(reference, input.head, DEFAULT_WINDOW_FOLLOW, FRAME);
              reference = step.state;
              const drawn = setup.testHost.windowPose(id);
              if (!samePose(drawn, step.pose)) {
                fail(name, `${mode} frame ${i}: drawn at ${show(drawn)}, the rule gives ${show(step.pose)}`);
              }
            }
          } finally {
            binding.dispose();
          }
        }
    }),
    hostCase('ui/a hand menu is hidden while its hand is untracked', async (setup, name) => {
        const binding = await openWindow(setup, scripted(HEAD, []), 'rc-kit-menu', { dockMode: DockMode.HandLocked });
        try {
          binding.update(FRAME);
          if (setup.testHost.windowHidden('rc-kit-menu') !== true) {
            fail(name, 'the host shows a hand menu with no tracked hand');
          }
        } finally {
          binding.dispose();
        }
    }),
    hostCase('ui/hidden versus closed: a hidden window is not drawn and comes back unchanged', async (setup, name) => {
        const binding = await openWindow(setup, scripted(HEAD), 'rc-kit-hide', { position: [0, 1.5, -1] });
        try {
          binding.update(FRAME);
          binding.manager.hide('rc-kit-hide');
          binding.update(FRAME);
          if (setup.testHost.windowHidden('rc-kit-hide') !== true) fail(name, 'a hidden window is still drawn');
          binding.manager.show('rc-kit-hide');
          binding.update(FRAME);
          if (setup.testHost.windowHidden('rc-kit-hide') !== false) fail(name, 'a shown window is still hidden');
          const drawn = setup.testHost.windowPose('rc-kit-hide');
          if (!samePose(drawn, { position: [0, 1.5, -1], quaternion: [0, 0, 0, 1] })) {
            fail(name, `a shown window came back at ${show(drawn)}`);
          }
        } finally {
          binding.dispose();
        }
    }),
    hostCase('ui/focus bias: the focused window is drawn 0.02 m nearer per window behind it', async (setup, name) => {
        const input = scripted(HEAD);
        const binding = new NativeWindowHost({ host: setup.ui, input });
        try {
          binding.createWindow({ id: 'rc-kit-back', config: setup.config, position: [0, 1.6, -1] });
          await setup.waitForPanel('rc-kit-back');
          binding.createWindow({ id: 'rc-kit-front', config: setup.config, position: [0, 1.6, -1.2] });
          await setup.waitForPanel('rc-kit-front');
          binding.update(FRAME);
          const front = setup.testHost.windowPose('rc-kit-front');
          const back = setup.testHost.windowPose('rc-kit-back');
          if (!samePose(back, { position: [0, 1.6, -1], quaternion: [0, 0, 0, 1] })) {
            fail(name, `the window behind is drawn at ${show(back)}`);
          }
          if (!samePose(front, { position: [0, 1.6, -1.18], quaternion: [0, 0, 0, 1] })) {
            fail(name, `the focused window is drawn at ${show(front)}, expected 0.02 m nearer`);
          }
        } finally {
          binding.dispose();
        }
    }),
    hostCase('ui/hover is decided by the binding; the host styles an element exactly as told', async (setup, name) => {
        if (typeof setup.ui.setHover !== 'function') fail(name, 'the host has no setHover, so no element can show a hover style');
        if (typeof setup.testHost.elementHovered !== 'function' || typeof setup.testHost.elementHandle !== 'function') {
          fail(name, 'the test host has no elementHovered or elementHandle readback');
        }
        const binding = await openWindow(setup, scripted(HEAD), 'rc-kit-hover', { position: [0, 1.6, -1] });
        try {
          binding.update(FRAME);
          const ids = setup.testHost.elementHandle('rc-kit-hover', WINDOW_CHROME_IDS.title);
          if (!ids) fail(name, 'the window has no title element to hover');
          const { panelId, elementHandle: title } = ids;
          setup.ui.setHover(panelId, title, true);
          if (setup.testHost.elementHovered('rc-kit-hover', WINDOW_CHROME_IDS.title) !== true) {
            fail(name, 'told to style the title as hovered, the host does not');
          }
          setup.ui.setHover(panelId, title, false);
          if (setup.testHost.elementHovered('rc-kit-hover', WINDOW_CHROME_IDS.title) !== false) {
            fail(name, 'told to remove the hover style, the host keeps it');
          }
        } finally {
          binding.dispose();
        }
    }),
    hostCase("ui/the host scrolls an element's content exactly as told", async (setup, name) => {
        if (typeof setup.ui.setScroll !== 'function') fail(name, 'the host has no setScroll, so nothing can scroll');
        if (typeof setup.testHost.scrollPosition !== 'function' || typeof setup.testHost.elementHandle !== 'function') {
          fail(name, 'the test host has no scrollPosition or elementHandle readback');
        }
        const binding = await openWindow(setup, scripted(HEAD), 'rc-kit-scroll', { position: [0, 1.6, -1] });
        try {
          binding.update(FRAME);
          const ids = setup.testHost.elementHandle('rc-kit-scroll', WINDOW_CHROME_IDS.content);
          if (!ids) fail(name, 'the window has no content element to scroll');
          setup.ui.setScroll(ids.panelId, ids.elementHandle, 0, 40);
          const at = setup.testHost.scrollPosition('rc-kit-scroll', WINDOW_CHROME_IDS.content);
          if (!at || Math.abs(at[0]) > POSITION_TOLERANCE || Math.abs(at[1] - 40) > POSITION_TOLERANCE) {
            fail(name, `told to scroll the content to (0, 40), the host draws it at ${JSON.stringify(at)}`);
          }
        } finally {
          binding.dispose();
        }
    }),
    hostCase('ui/the host shows its keyboard for a text field when told, and hides it when told', async (setup, name) => {
        if (typeof setup.ui.showKeyboard !== 'function' || typeof setup.ui.hideKeyboard !== 'function') {
          fail(name, 'the host has no showKeyboard or hideKeyboard, so no text can be entered');
        }
        if (typeof setup.testHost.keyboardShown !== 'function' || typeof setup.testHost.elementHandle !== 'function') {
          fail(name, 'the test host has no keyboardShown or elementHandle readback');
        }
        const binding = await openWindow(setup, scripted(HEAD), 'rc-kit-keys', { position: [0, 1.6, -1] });
        try {
          binding.update(FRAME);
          const ids = setup.testHost.elementHandle('rc-kit-keys', WINDOW_CHROME_IDS.title);
          if (!ids) fail(name, 'the window has no title element to type into');
          setup.ui.showKeyboard(ids.panelId, ids.elementHandle, { value: 'rc', multiline: false, type: 'text' });
          const shown = setup.testHost.keyboardShown();
          if (!shown || shown.elementHandle !== ids.elementHandle || shown.value !== 'rc') {
            fail(name, `told to show the keyboard for the title with "rc", the host shows ${JSON.stringify(shown)}`);
          }
          setup.ui.hideKeyboard();
          if (setup.testHost.keyboardShown() !== null) fail(name, 'told to hide the keyboard, the host keeps it up');
        } finally {
          binding.dispose();
        }
    }),
    hostCase('ui/touch signed distance is measured along the panel normal, positive in front', async (setup, name) => {
        const binding = await openWindow(setup, scripted(HEAD), 'rc-kit-touch', { position: [0, 1.6, -1] });
        try {
          binding.update(FRAME);
          const front = setup.testHost.measureTouch('rc-kit-touch', [0, 1.6, -0.99] as Vec3Tuple);
          const behind = setup.testHost.measureTouch('rc-kit-touch', [0, 1.6, -1.01] as Vec3Tuple);
          if (!front || Math.abs(front.signedDistance - 0.01) > POSITION_TOLERANCE) {
            fail(name, `1 cm in front measures ${front?.signedDistance}, expected +0.01`);
          }
          if (!behind || Math.abs(behind.signedDistance + 0.01) > POSITION_TOLERANCE) {
            fail(name, `1 cm behind measures ${behind?.signedDistance}, expected -0.01`);
          }
        } finally {
          binding.dispose();
        }
    }),
  ];
}
