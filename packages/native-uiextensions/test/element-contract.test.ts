/**
 * On native the app parses the markup and renders the elements; the package
 * builds proxy `UixElement`s over the tree it reports. The fake stands in for
 * the native app, so the tree below is what a native parser must send for
 * `CONTRACT_PANEL_MARKUP`: the `uix-*` tags, and every `data-*` attribute as
 * written. The panel goes through the real `NativeWindowHost.createPanel`.
 */
import type { UixElement } from '@realitycollective/webxr-uiextensions';
import { uixElementContract } from '../../webxr-uiextensions/test/helpers/uix-element-contract.js';
import { NativeWindowHost } from '../src/index.js';
import type { NativeUixElement } from '../src/element.js';
import { createFakeNativeUiHost, type FakeElementSpec } from './helpers/fake-native-ui-host.js';

const CONTRACT_PANEL_TREE: FakeElementSpec = {
  children: [
    {
      componentName: 'uix-stepper',
      attributes: {
        'data-uix-id': 'contract-count',
        'data-uix-min': '0',
        'data-uix-max': '3',
        'data-uix-step': '1',
        'data-uix-value': '2',
        'data-uix-chars-per-line': '4',
      },
      children: [{ componentName: 'uix-decrement' }, { componentName: 'uix-value' }, { componentName: 'uix-increment' }],
    },
    {},
  ],
};

uixElementContract('native', () => {
  const fake = createFakeNativeUiHost();
  let panelId = '';
  const createPanel = fake.createPanel.bind(fake);
  fake.createPanel = (id, config) => {
    panelId = id;
    return createPanel(id, config);
  };
  const host = new NativeWindowHost({ host: fake });
  const handleOf = (element: UixElement): string => (element as NativeUixElement).handle;
  return {
    root: host.createPanel(CONTRACT_PANEL_TREE).root,
    drive: {
      rendered(element, property) {
        const writes = fake.propertyWrites.filter(
          (write) => write.elementHandle === handleOf(element) && property in write.props,
        );
        return writes.at(-1)?.props[property];
      },
      fire: (element, type) => fake.fireElementEvent(panelId, handleOf(element), type),
    },
  };
});
