/**
 * Playground behaviour — the demo logic behind each window, wired through
 * the engine-free `WindowHost.onPanelReady` contract.
 *
 * No IWSDK, no XR Blocks, no three.js: every handler here talks to the core
 * control models (`upgradePanel`, stepper/toggle/log-view handles) and the
 * shared `WindowManager`, so the SAME behaviour runs on every adapter.
 * Panels are matched by their window id from the scene descriptor.
 */
import {
  upgradePanel,
  type LogViewHandle,
  type PanelHandle,
  type UixElement,
  type WindowHost,
  type WindowManager,
} from '@realitycollective/webxr-uiextensions';

type Uikit = {
  addEventListener: (type: string, listener: (event?: unknown) => void) => void;
  setProperties: (props: Record<string, unknown>) => void;
};

export interface PlaygroundBehaviour {
  dispose(): void;
}

/**
 * Wire the playground's demo behaviour onto a host.
 *
 * Safe to call before or after windows spawn — `onPanelReady` replays
 * already-live panels.
 */
export function installPlaygroundBehaviour(
  host: WindowHost,
  manager: WindowManager,
): PlaygroundBehaviour {
  const bootTime = performance.now();
  const pending: string[] = [];
  let eventLog: LogViewHandle | undefined;
  let clicks = 0;
  const form = { name: '', email: '', notes: '', speed: 50 };

  const log = (message: string): void => {
    const stamp = ((performance.now() - bootTime) / 1000).toFixed(1);
    const line = `[${stamp}s] ${message}`;
    if (eventLog) {
      eventLog.push(line);
    } else {
      pending.push(line);
    }
  };

  // Dogfood the window manager: every lifecycle event lands in the log
  // window, including events fired before the log panel finishes loading.
  manager.events.on('opened', (w) => log(`opened "${w.title}"`));
  manager.events.on('closed', (w) => log(`closed "${w.title}"`));
  manager.events.on('focused', (w) => log(`focused "${w.title}"`));
  manager.events.on('minimized', (w) => log(`minimized "${w.title}"`));
  manager.events.on('restored', (w) => log(`restored "${w.title}"`));
  manager.events.on('dockChanged', ({ window, previous }) =>
    log(`"${window.title}" ${previous} → ${window.dockMode}`),
  );

  const wire = (id: string, panel: PanelHandle): void => {
    const controls = upgradePanel(panel.root, panel.root as UixElement);
    const element = (elementId: string) =>
      panel.getElementById(elementId) as unknown as Uikit | undefined;

    switch (id) {
      case 'player-status': {
        controls
          .stepper('health')
          .events.on('change', (value) => log(`health set to ${value}`));
        controls
          .toggle('shield')
          .events.on('change', (on) => log(`shield ${on ? 'raised' : 'dropped'}`));
        controls
          .expandableLabel('bio')
          .events.on('change', (expanded) =>
            log(`bio ${expanded ? 'expanded' : 'collapsed'}`),
          );
        break;
      }

      case 'registration': {
        const bind = (elementId: string, key: 'name' | 'email' | 'notes') => {
          element(elementId)?.setProperties({
            onValueChange: (value: string) => {
              form[key] = value;
            },
          });
        };
        bind('reg-name', 'name');
        bind('reg-email', 'email');
        bind('reg-notes', 'notes');
        element('reg-speed')?.setProperties({
          onValueChange: (value: number) => {
            form.speed = value;
          },
        });

        const result = element('reg-result');
        element('reg-submit')?.addEventListener('click', () => {
          if (!form.name.trim()) {
            result?.setProperties({
              text: 'Enter a call sign first.',
              color: '#ff9d7a',
            });
            return;
          }
          result?.setProperties({
            text: `Welcome, ${form.name.trim()}!`,
            color: '#7ddba3',
          });
          log(`${form.name.trim()} registered (speed ${form.speed})`);
        });
        break;
      }

      case 'event-log': {
        eventLog = controls.logView('events');
        for (const line of pending.splice(0)) {
          eventLog.push(line);
        }
        break;
      }

      case 'clicker': {
        const clickList = controls.logView('clicks');
        element('click-me')?.addEventListener('click', () => {
          clicks += 1;
          const stamp = ((performance.now() - bootTime) / 1000).toFixed(1);
          clickList.push(`clicked #${clicks} at ${stamp}s`);
          log(`click machine fired (#${clicks})`);
        });
        break;
      }

      default:
        break; // gallery and any future panels need no wiring
    }
  };

  const unsubscribe = host.onPanelReady(({ id, panel }) => {
    try {
      wire(id, panel);
    } catch (error) {
      console.error(`[playground] failed to wire "${id}":`, error);
    }
  });

  return { dispose: unsubscribe };
}
