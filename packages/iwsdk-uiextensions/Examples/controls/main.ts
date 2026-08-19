/**
 * Controls — data-uix markup upgrades on any IWSDK panel.
 *
 * The controls work in plain panels too (no window required): the
 * UIControlsSystem upgrades every loaded PanelDocument.
 */
import { PanelDocument, PanelUI, UIKitDocument, World, createSystem, eq } from '@iwsdk/core';
import {
  registerUIExtensions,
  upgradePanel,
  type UixElement,
} from '@realitycollective/iwsdk-uiextensions';

export async function start(container: HTMLDivElement) {
  const world = await World.create(container, {
    features: { spatialUI: true },
  });
  registerUIExtensions(world);

  const panel = world
    .createTransformEntity()
    .addComponent(PanelUI, { config: './ui/controls.json', maxWidth: 0.8, maxHeight: 1 });
  panel.object3D!.position.set(0, 1.5, -1.2);

  // Wire the handles once the panel loads.
  class WireSystem extends createSystem({
    panel: {
      required: [PanelUI, PanelDocument],
      where: [eq(PanelUI, 'config', './ui/controls.json')],
    },
  }) {
    override init(): void {
      this.queries.panel.subscribe('qualify', (entity) => {
        const document = PanelDocument.data.document[entity.index] as UIKitDocument;
        // upgradePanel is idempotent — safe regardless of system order.
        const controls = upgradePanel(document, document.rootElement as unknown as UixElement);
        const log = controls.logView('log');
        controls.stepper('volume').events.on('change', (v) => log.push(`volume ${v}`));
        controls.toggle('music').events.on('change', (on) => log.push(`music ${on ? 'on' : 'off'}`));
      });
    }
  }
  world.registerSystem(WireSystem);
}
