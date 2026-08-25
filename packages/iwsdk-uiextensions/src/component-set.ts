/**
 * The UIKitML component set for `<uix-*>` control elements.
 *
 * IWSDK 0.5 parses panels with `@drawcall/uikitml`, which validates every tag
 * against a component schema and rejects anything it does not know - including
 * every `data-*` attribute on a built-in tag. Declaring the control elements
 * here is the supported way to extend that vocabulary.
 *
 * The three.js and XR Blocks adapters need no equivalent: their parser accepts
 * custom tags unregistered, exposing the tag on
 * `userData.customElement.componentName`. This set reproduces that convention
 * on the IWSDK side - the constructor below stamps the same key and lifts
 * `data-uix-*` attributes into `userData` - so ONE markup file drives every
 * adapter and the engine-free upgraders read it identically everywhere.
 *
 * Register it when creating the world:
 * ```ts
 * const world = await World.create(container, {
 *   features: { spatialUI: { kit: 'horizon', componentSets: [uixComponentSet] } },
 * });
 * ```
 */
import { htmlComponentSet, type ComponentSet, type ComponentDefinition } from '@drawcall/uikitml';
import { z } from 'zod';

/**
 * Base container, taken from the parser's own `<div>` definition rather than
 * imported from `@pmndrs/uikit` directly - that keeps a single copy of uikit
 * in the tree, whichever version `@iwsdk/core` resolves.
 */
const BaseContainer = htmlComponentSet['div']
  ?.component as unknown as new (properties?: Record<string, unknown>) => {
  userData: Record<string, unknown>;
};

/** Control elements an author writes, and the parts that live inside them. */
const CONTROL_TAGS = [
  'uix-stepper',
  'uix-toggle',
  'uix-expandable-label',
  'uix-log-view',
] as const;

const ROLE_TAGS = [
  'uix-decrement',
  'uix-value',
  'uix-increment',
  'uix-label',
  'uix-line',
  'uix-up',
  'uix-down',
  'uix-clear',
  'uix-status',
  'uix-text',
  'uix-more',
] as const;

/**
 * `data-uix-min` → `uixMin`, matching how the other parser fills userData.
 *
 * The parser hands properties over already camelCased, so `data-uix-min`
 * arrives as `dataUixMin`; both spellings are normalised here.
 */
function toUserDataKey(attribute: string): string {
  if (/^data[A-Z]/.test(attribute)) {
    const rest = attribute.slice(4);
    return rest.charAt(0).toLowerCase() + rest.slice(1);
  }
  return attribute
    .replace(/^data-/, '')
    .replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * A plain uikit Container that records what it was declared as.
 *
 * Anything the schema let through that is not a uikit property - the
 * `data-uix-*` parameters - is moved into `userData` rather than handed to
 * uikit, which would warn about properties it does not recognise.
 */
function controlComponent(tag: string): typeof BaseContainer {
  return class UixControlContainer extends BaseContainer {
    constructor(properties: Record<string, unknown> = {}) {
      const uikitProps: Record<string, unknown> = {};
      const userData: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(properties)) {
        if (key.startsWith('data-') || /^data[A-Z]/.test(key)) {
          userData[toUserDataKey(key)] = value;
        } else {
          uikitProps[key] = value;
        }
      }
      super(uikitProps);
      Object.assign(this.userData, userData, {
        customElement: { componentName: tag, sourceTag: tag },
      });
    }
  };
}

/** Permissive: the parameters are ours, and the upgraders validate them. */
const schema = z.object({}).passthrough();

function define(tag: string): ComponentDefinition {
  return {
    component: controlComponent(tag) as unknown as ComponentDefinition['component'],
    schema,
    canHaveChildren: true,
  };
}

/**
 * Pass to `spatialUI.componentSets` so `<uix-*>` elements parse on IWSDK 0.5.
 * Without it, a panel using any control fails to parse and never attaches.
 */
export const uixComponentSet: ComponentSet = Object.fromEntries(
  [...CONTROL_TAGS, ...ROLE_TAGS].map((tag) => [tag, define(tag)]),
);
