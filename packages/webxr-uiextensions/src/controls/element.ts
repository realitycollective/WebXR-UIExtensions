/**
 * Structural view of a uikit element as the controls layer needs it.
 *
 * UIKitML preserves `data-*` attributes into `element.userData` (camelCased,
 * `data-` stripped): `data-uix="stepper"` → `userData.uix`. Controls are
 * discovered by traversing a panel's object tree for those markers - no
 * custom uikit component classes, so any markup (or kit) works.
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

/** All descendants (including self) with `data-uix-role="<role>"`. */
export function findRoles(root: UixElement, role: string): UixElement[] {
  const found: UixElement[] = [];
  walk(root, (element) => {
    if (element.userData?.['uixRole'] === role) {
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
