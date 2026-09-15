/**
 * Window control - drive a window from code, the way a hand menu would.
 *
 * `registerUIExtensions` hands back the `WindowManager`. Every window state
 * change is a call on it: hide/show, pin/unpin, dock into a region, return
 * home, minimize, enable or disable the title-bar buttons, close. The
 * systems apply each call to the entity, and the same calls work on the XR
 * Blocks adapter, so a menu written against the manager is engine-free.
 *
 * Here a second panel stands in for the hand menu: its buttons target the
 * "status" window by id. Put both .uikitml files in your app's public/ui/.
 */
import { World } from '@iwsdk/core';
import {
  DockMode,
  createDockRegion,
  createSceneHost,
  minimizeLabelFor,
  pinLabelFor,
  registerUIExtensions,
} from '@realitycollective/iwsdk-uiextensions';

const TARGET = 'status';

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

  createDockRegion(world, {
    id: 'belt',
    flow: 'row',
    follow: true,
    followOffset: [0, -0.7, -1.1],
  });

  // The window being controlled. Its own buttons start OFF; the menu can
  // switch them on with `setChrome`.
  host.createWindow({
    id: TARGET,
    title: 'Status',
    config: './ui/window.uikitml',
    dockMode: DockMode.BodyFollow,
    followOffset: [0.45, -0.2, -1.1],
  });

  // The "hand menu". A real one would be a panel parented to the wrist or a
  // controller; the calls are the same.
  const menu = host.createWindow({
    id: 'menu',
    title: 'Window Control',
    config: './ui/menu.uikitml',
    position: [-0.5, 1.3, -1.0],
    pinnable: true,
  });

  menu.onReady((panel) => {
    const element = (id: string) => panel.getElementById(id) as Uikit | undefined;

    // Labels always name the NEXT action, read straight off the record.
    const refresh = (): void => {
      const record = windows.get(TARGET);
      if (!record) {
        element('menu-status')?.setProperties({ text: 'closed' });
        return;
      }
      element('menu-hide')?.setProperties({ text: record.hidden ? 'SHOW' : 'HIDE' });
      element('menu-pin')?.setProperties({ text: pinLabelFor(record) });
      element('menu-minimize')?.setProperties({ text: minimizeLabelFor(record) });
      element('menu-dock')?.setProperties({ text: record.region ? 'UNDOCK' : 'TO BELT' });
      element('menu-chrome')?.setProperties({
        text: record.chrome.pin ? 'BUTTONS OFF' : 'BUTTONS ON',
      });
      element('menu-status')?.setProperties({
        text: `${record.hidden ? 'hidden' : 'shown'}, ${record.dockMode}, region ${record.region ?? 'none'}`,
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
    on('menu-dock', () => {
      if (windows.get(TARGET)?.region) {
        windows.undock(TARGET);
      } else {
        windows.dockTo(TARGET, 'belt');
      }
    });
    on('menu-home', () => windows.returnHome(TARGET));
    on('menu-minimize', () => windows.toggleMinimized(TARGET));
    on('menu-chrome', () => {
      const enable = !(windows.get(TARGET)?.chrome.pin ?? false);
      windows.setChrome(TARGET, { pin: enable, dock: enable, minimize: enable, close: enable });
    });
    on('menu-close', () => windows.close(TARGET));

    // The target can change under the menu (its own title bar, a drag into
    // the belt), so re-read on every manager event.
    for (const event of [
      'hidden',
      'shown',
      'dockChanged',
      'regionChanged',
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
}
