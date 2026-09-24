/**
 * The XR Blocks and three.js hosts build panels through `UixPanelDocument`
 * over `@pmndrs/uikitml`, so the contract panel is built the same way here:
 * real uikit elements, headless.
 */
import { parse } from '@pmndrs/uikitml';
import { CONTRACT_PANEL_MARKUP } from '@realitycollective/webxr-uiextensions';
import { uixElementContract } from '../../webxr-uiextensions/test/helpers/uix-element-contract.js';
import { UixPanelDocument } from '../src/panel-document.js';

interface UikitElement {
  properties: { peek(): Record<string, unknown> };
  dispatchEvent(event: { type: string }): void;
}

uixElementContract('XR Blocks and three.js', () => ({
  root: new UixPanelDocument(parse(CONTRACT_PANEL_MARKUP)).root,
  drive: {
    rendered: (element, property) => (element as unknown as UikitElement).properties.peek()[property],
    fire: (element, type) => (element as unknown as UikitElement).dispatchEvent({ type }),
  },
}));
