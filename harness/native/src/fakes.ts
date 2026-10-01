/**
 * The reference fakes as a test host, for a harness run with no native host
 * (Node in CI, or a shell that installs no test host). The same fake `ui`
 * slice this package's own suites prove the kit against, wrapped the way a
 * device behaves: `createWindow` is fire-and-forget and the panel is reported
 * ready on the next `pump()`, as the host's frame loop would. Every subject is
 * a fresh fake, so no case sees another's windows.
 */
import { WINDOW_CHROME_IDS, type NativeUiHost } from "@realitycollective/native-uiextensions";
import { createFakeNativeUiHost, type FakeElementSpec } from "../../../packages/native-uiextensions/test/helpers/fake-native-ui-host.js";
import { elementSubjectOver, type UiSubject, type UiTestSlices } from "./kits.js";

/** The tree a host must build for the kit's chrome panel: the contractual window chrome ids. */
const CHROME: FakeElementSpec = {
  id: WINDOW_CHROME_IDS.window,
  children: [
    {
      id: WINDOW_CHROME_IDS.titlebar,
      children: [{ id: WINDOW_CHROME_IDS.title }, { id: WINDOW_CHROME_IDS.pin }, { id: WINDOW_CHROME_IDS.dock }, { id: WINDOW_CHROME_IDS.minimize }, { id: WINDOW_CHROME_IDS.close }],
    },
    { id: WINDOW_CHROME_IDS.content },
  ],
};

/** The tree a native parser sends for `CONTRACT_PANEL_MARKUP`: `uix-*` tags, and every `data-*` attribute as written. */
const CONTRACT_PANEL_TREE: FakeElementSpec = {
  children: [
    {
      componentName: "uix-stepper",
      attributes: {
        "data-uix-id": "contract-count",
        "data-uix-min": "0",
        "data-uix-max": "3",
        "data-uix-step": "1",
        "data-uix-value": "2",
        "data-uix-chars-per-line": "4",
      },
      children: [{ componentName: "uix-decrement" }, { componentName: "uix-value" }, { componentName: "uix-increment" }],
    },
    {},
  ],
};

function freshSubject(): UiSubject {
  const fake = createFakeNativeUiHost();
  const pending = new Map<string, FakeElementSpec>();
  const ui: NativeUiHost = {
    ...fake,
    createWindow(windowId, config, options) {
      fake.createWindow(windowId, config, options);
      pending.set(windowId, config as FakeElementSpec);
    },
  };
  return {
    ui,
    readbacks: fake,
    kitConfig: CHROME,
    pump() {
      for (const [windowId, config] of [...pending]) {
        pending.delete(windowId);
        fake.readyWindow(windowId, `panel-${windowId}`, config);
      }
    },
    elementSubject() {
      const elements = createFakeNativeUiHost();
      return elementSubjectOver(elements, CONTRACT_PANEL_TREE, {
        rendered(_panelId, elementHandle, property) {
          const writes = elements.propertyWrites.filter((write) => write.elementHandle === elementHandle && property in write.props);
          return writes.at(-1)?.props[property];
        },
        fire: (panelId, elementHandle, type) => elements.fireElementEvent(panelId, elementHandle, type),
      });
    },
  };
}

export function referenceTestSlices(): UiTestSlices {
  return { source: "reference fakes", fresh: freshSubject };
}
