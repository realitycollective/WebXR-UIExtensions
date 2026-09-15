/**
 * Basic window - a managed window plus a hand menu that drives it.
 *
 * The window spawns with NO title-bar buttons (that is the default). Its
 * manipulation lives on a hand menu instead: a `hand-locked` window that
 * rides the left hand above the fingertips and shows while that palm faces
 * you. Every menu button is one `WindowManager` call on the window, and the
 * labels read back from the record so they always name the next action.
 *
 * Put window.uikitml and hand-menu.uikitml in your app's public/ui/ folder -
 * IWSDK 0.5 fetches and parses the source at runtime, so there is no
 * compile step.
 */
import { World } from '@iwsdk/core';
import {
  DockMode,
  createSceneHost,
  minimizeLabelFor,
  pinLabelFor,
  registerUIExtensions,
} from '@realitycollective/iwsdk-uiextensions';

const TARGET = 'hello';

type Uikit = {
  addEventListener(type: string, listener: () => void): void;
  setProperties(props: Record<string, unknown>): void;
};

export async function start(container: HTMLDivElement) {
  const world = await World.create(container, {
    features: { spatialUI: true },
  });

  const windows = registerUIExtensions(world);
  const host = createSceneHost(world);

  host.createWindow({
    id: TARGET,
    title: 'Hello Window',
    config: './ui/window.uikitml',
    dockMode: DockMode.BodyFollow, // follows until pinned or dragged
    followOffset: [0, -0.15, -1.2],
    // Title-bar buttons are off unless asked for; the hand menu can switch
    // them on with `setChrome` (BUTTONS ON below).
  });

  // The hand menu. `hand`, `anchor` and the palm gate are the developer's
  // choice; these are the defaults written out. Try `anchor: 'inside'` or
  // `hand: 'either'`.
  const menu = host.createWindow({
    id: 'hand-menu',
    config: './ui/hand-menu.uikitml',
    dockMode: DockMode.HandLocked,
    handMenu: { hand: 'left', anchor: 'above', palmGate: true },
  });

  menu.onReady((panel) => {
    const element = (id: string) => panel.getElementById(id) as Uikit | undefined;

    const refresh = (): void => {
      const record = windows.get(TARGET);
      if (!record) {
        return; // closed: the buttons stay, and do nothing
      }
      element('menu-hide')?.setProperties({ text: record.hidden ? 'SHOW' : 'HIDE' });
      element('menu-pin')?.setProperties({ text: pinLabelFor(record) });
      element('menu-minimize')?.setProperties({ text: minimizeLabelFor(record) });
      element('menu-chrome')?.setProperties({
        text: record.chrome.pin ? 'BUTTONS OFF' : 'BUTTONS ON',
      });
    };

    const on = (id: string, action: () => void): void => {
      element(id)?.addEventListener('click', () => {
        if (windows.has(TARGET)) {
          action();
        }
        refresh();
      });
    };
    on('menu-hide', () => windows.toggleHidden(TARGET));
    on('menu-pin', () => windows.togglePin(TARGET));
    on('menu-home', () => windows.returnHome(TARGET));
    on('menu-minimize', () => windows.toggleMinimized(TARGET));
    on('menu-chrome', () => {
      const enable = !(windows.get(TARGET)?.chrome.pin ?? false);
      windows.setChrome(TARGET, { pin: enable, dock: enable, minimize: enable, close: enable });
    });
    on('menu-close', () => windows.close(TARGET));

    // The window can change under the menu (its own title bar once enabled,
    // a drag), so re-read on every manager event.
    for (const event of [
      'hidden',
      'shown',
      'dockChanged',
      'minimized',
      'restored',
      'chromeChanged',
      'dragEnded',
      'closed',
    ] as const) {
      windows.events.on(event, refresh);
    }
    refresh();
  });

  windows.events.on('dockChanged', ({ window, previous }) => {
    console.log(`[uix] ${window.title}: ${previous} → ${window.dockMode}`);
  });
  windows.events.on('closed', (w) => console.log(`[uix] ${w.title} closed`));
}
