/**
 * UIControlsSystem - upgrades `data-uix` controls in every loaded panel.
 *
 * Runs against ALL `PanelDocument` panels, not just windows: any IWSDK panel
 * gains steppers, toggles, expandable labels and log views by markup alone.
 */
import { PanelDocument, UIKitDocument, createSystem, type Entity } from '@iwsdk/core';
import type { UixElement } from '@realitycollective/webxr-uiextensions';
import { upgradePanel } from '@realitycollective/webxr-uiextensions';

export class UIControlsSystem extends createSystem({
  panels: { required: [PanelDocument] },
}) {
  override init(): void {
    this.cleanupFuncs.push(
      this.queries.panels.subscribe('qualify', (entity) => this.upgrade(entity)),
    );
    this.queries.panels.entities.forEach((entity) => this.upgrade(entity));
  }

  private upgrade(entity: Entity): void {
    const document = PanelDocument.data.document[entity.index] as
      | UIKitDocument
      | undefined;
    if (!document?.rootElement) {
      return;
    }
    upgradePanel(document, document.rootElement as unknown as UixElement);
  }
}
