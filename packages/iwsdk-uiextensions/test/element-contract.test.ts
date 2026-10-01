/**
 * IWSDK builds panels with `@drawcall/uikitml` and the `uix-*` component set
 * an app registers on the world, so the contract panel is built the same way
 * here: real uikit elements, headless. Rendering needs a GPU; the element
 * tree, properties and events do not.
 */
import { instantiate, parse } from '@drawcall/uikitml';
import { describe, expect, it } from 'vitest';
import { CONTRACT_PANEL_MARKUP, UIX_ELEMENT_TAGS, type UixElement } from '@realitycollective/webxr-uiextensions';
import { uixElementContract } from '../../webxr-uiextensions/test/helpers/uix-element-contract.js';
import { uixComponentSet } from '../src/component-set.js';

interface UikitElement {
  properties: { peek(): Record<string, unknown> };
  dispatchEvent(event: { type: string }): void;
}

uixElementContract('IWSDK', () => {
  const parsed = parse(CONTRACT_PANEL_MARKUP, { componentSets: [uixComponentSet] });
  if (!parsed.success) throw new Error(`contract panel failed to parse: ${JSON.stringify(parsed.errors)}`);
  return {
    root: instantiate(parsed.ast, { componentSets: [uixComponentSet] }) as unknown as UixElement,
    drive: {
      rendered: (element, property) => (element as unknown as UikitElement).properties.peek()[property],
      fire: (element, type) => (element as unknown as UikitElement).dispatchEvent({ type }),
    },
  };
});

describe('uixComponentSet', () => {
  it('declares exactly the element vocabulary the core publishes', () => {
    expect(Object.keys(uixComponentSet)).toEqual([...UIX_ELEMENT_TAGS]);
  });
});
