/**
 * Structural view of a uikit element as the controls layer needs it.
 *
 * Controls and their parts are declared as CUSTOM ELEMENTS - `<uix-stepper>`,
 * `<uix-value>` - rather than as attributes on a `<div>`. That is what makes
 * one markup file portable across every adapter: the IWSDK 0.5 parser rejects
 * unknown attributes on built-in tags, but accepts a custom tag declared in a
 * component set, and the three.js / XR Blocks parser accepts custom tags with
 * no registration at all.
 *
 * Both paths expose the declared tag the same way, on
 * `userData.customElement.componentName`. Parameters stay `data-uix-*`
 * attributes, which land in `userData` camelCased with `data-` stripped:
 * `data-uix-min="0"` → `userData.uixMin`.
 */
export interface UixElement {
  userData: Record<string, unknown>;
  children: UixElement[];
  addEventListener(type: string, listener: (event?: unknown) => void): void;
  setProperties(props: Record<string, unknown>): void;
}

/** Depth-first traversal over uikit element children. */
export function walk(element: UixElement, visit: (element: UixElement) => void): void {
  visit(element);
  for (const child of element.children ?? []) {
    walk(child, visit);
  }
}

/**
 * The custom-element tag this element was declared with, lowercased, or
 * undefined for a plain built-in element.
 */
export function tagOf(element: UixElement): string | undefined {
  const custom = element.userData?.['customElement'] as
    | { componentName?: unknown }
    | undefined;
  const name = custom?.componentName;
  return typeof name === 'string' && name.length > 0 ? name.toLowerCase() : undefined;
}

/** All descendants (including self) declared as `<uix-{role}>`. */
export function findRoles(root: UixElement, role: string): UixElement[] {
  const tag = `uix-${role}`;
  const found: UixElement[] = [];
  walk(root, (element) => {
    if (tagOf(element) === tag) {
      found.push(element);
    }
  });
  return found;
}

export function findRole(root: UixElement, role: string): UixElement | undefined {
  return findRoles(root, role)[0];
}

export function attrString(element: UixElement, key: string): string | undefined {
  const value = element.userData?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function attrNumber(element: UixElement, key: string): number | undefined {
  const raw = attrString(element, key);
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function attrBoolean(element: UixElement, key: string): boolean | undefined {
  const raw = attrString(element, key);
  if (raw === undefined) {
    return undefined;
  }
  return raw === 'true' || raw === '1' || raw === 'on';
}
