/**
 * NativeUixElement - a proxy `UixElement` over one node of a `NativeElementNode`
 * tree (see `controls/element.ts` in `@realitycollective/webxr-uiextensions`
 * for the interface itself and how `tagOf`/`attrString`/`findRole` read it).
 *
 * The native app renders the real element; this object only forwards calls to
 * it and replays events the host reports. `userData` carries `id` (the markup
 * id), `customElement.componentName` (the declared `uix-*` tag) and every
 * `data-*` attribute under the core's `dataAttributeKey` rule, the shape the
 * web parsers give, so `<uix-stepper>`, `<uix-toggle>` and the rest work
 * unchanged on a native host.
 */
import { dataAttributeKey, type UixElement } from '@realitycollective/webxr-uiextensions';
import type { NativeElementNode } from './native-types.js';

/** What a `NativeUixElement` needs from its host, to forward a property write. */
export interface NativeElementContext {
  setProperties(elementHandle: string, props: Record<string, unknown>): void;
}

export class NativeUixElement implements UixElement {
  /** The host's own handle for this element - stable for its lifetime. */
  readonly handle: string;
  readonly userData: Record<string, unknown>;
  readonly children: NativeUixElement[];
  private readonly context: NativeElementContext;
  private readonly listeners = new Map<string, Set<(event?: unknown) => void>>();

  constructor(node: NativeElementNode, context: NativeElementContext) {
    this.handle = node.handle;
    this.context = context;
    this.userData = {};
    if (node.id !== undefined) {
      this.userData['id'] = node.id;
    }
    if (node.componentName !== undefined) {
      this.userData['customElement'] = { componentName: node.componentName };
    }
    for (const [attribute, value] of Object.entries(node.attributes ?? {})) {
      if (attribute.startsWith('data-')) {
        this.userData[dataAttributeKey(attribute)] = value;
      }
    }
    this.children = node.children.map((child) => new NativeUixElement(child, context));
  }

  addEventListener(type: string, listener: (event?: unknown) => void): void {
    let forType = this.listeners.get(type);
    if (!forType) {
      forType = new Set();
      this.listeners.set(type, forType);
    }
    forType.add(listener);
  }

  setProperties(props: Record<string, unknown>): void {
    this.context.setProperties(this.handle, props);
  }

  /**
   * Runs every listener registered for `type`. Called by the host binding
   * when the native side reports a matching `onElementEvent`; not part of
   * the `UixElement` contract, so app code never calls it directly.
   */
  dispatch(type: string, payload: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(payload);
    }
  }
}

/**
 * Every element in `root`'s subtree, keyed by host handle - one flat lookup
 * built once per panel, used to route `onElementEvent` and `getElementById`.
 */
export function flattenByHandle(root: NativeUixElement): Map<string, NativeUixElement> {
  const found = new Map<string, NativeUixElement>();
  const visit = (element: NativeUixElement): void => {
    found.set(element.handle, element);
    for (const child of element.children) {
      visit(child);
    }
  };
  visit(root);
  return found;
}
