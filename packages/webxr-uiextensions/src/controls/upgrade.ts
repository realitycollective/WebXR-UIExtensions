/**
 * Panel upgrade - scans a loaded panel for `<uix-*>` control elements and
 * wires the matching behaviour. App code retrieves the resulting handles via
 * `panelControlsFor(document)` and the control's `data-uix-id`.
 */
import { UixElement, attrString, tagOf, walk } from './element.js';
import { StepperHandle, upgradeStepper } from './stepper.js';
import { ToggleHandle, upgradeToggle } from './toggle.js';
import { ExpandableLabelHandle, upgradeExpandableLabel } from './expandable-label.js';
import { LogViewHandle, upgradeLogView } from './log-view.js';

export type ControlHandle =
  | StepperHandle
  | ToggleHandle
  | ExpandableLabelHandle
  | LogViewHandle;

export class PanelControls {
  private handles = new Map<string, ControlHandle>();
  private anonymous = 0;

  add(id: string | undefined, handle: ControlHandle): void {
    const key = id ?? `uix-control-${this.anonymous++}`;
    if (this.handles.has(key)) {
      throw new Error(`[uix] duplicate control id "${key}" in panel`);
    }
    this.handles.set(key, handle);
  }

  /** Typed accessors - throw on wrong id so mistakes surface immediately. */
  stepper(id: string): StepperHandle {
    return this.expect(id, StepperHandle);
  }

  toggle(id: string): ToggleHandle {
    return this.expect(id, ToggleHandle);
  }

  expandableLabel(id: string): ExpandableLabelHandle {
    return this.expect(id, ExpandableLabelHandle);
  }

  logView(id: string): LogViewHandle {
    return this.expect(id, LogViewHandle);
  }

  get(id: string): ControlHandle | undefined {
    return this.handles.get(id);
  }

  ids(): string[] {
    return [...this.handles.keys()];
  }

  private expect<T extends ControlHandle>(
    id: string,
    kind: abstract new (...args: never[]) => T,
  ): T {
    const handle = this.handles.get(id);
    if (!handle) {
      throw new Error(`[uix] no control "${id}" in panel (have: ${this.ids().join(', ') || 'none'})`);
    }
    if (!(handle instanceof kind)) {
      throw new Error(`[uix] control "${id}" is not a ${kind.name}`);
    }
    return handle;
  }
}

/**
 * Control tags. These are the custom elements an author writes; every part
 * inside them (`<uix-value>`, `<uix-line>`, …) is a role, resolved by the
 * individual upgraders through `findRole`.
 */
const UPGRADERS: Record<string, (root: UixElement) => ControlHandle> = {
  'uix-stepper': upgradeStepper,
  'uix-toggle': upgradeToggle,
  'uix-expandable-label': upgradeExpandableLabel,
  'uix-log-view': upgradeLogView,
};

/**
 * Parts claimed by the control that owns them, resolved through `findRole`.
 * Listed here only so a genuine typo in a control tag still gets a warning
 * instead of being silently mistaken for a role.
 */
const ROLE_TAGS = new Set([
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
]);

const registry = new WeakMap<object, PanelControls>();

/**
 * Upgrade every `data-uix` control under `root` and remember the result
 * against `documentKey` (the panel's `UIKitDocument`). Idempotent per key.
 */
export function upgradePanel(documentKey: object, root: UixElement): PanelControls {
  const existing = registry.get(documentKey);
  if (existing) {
    return existing;
  }
  const controls = new PanelControls();
  walk(root, (element) => {
    const tag = tagOf(element);
    if (tag === undefined || !tag.startsWith('uix-')) {
      return;
    }
    const upgrader = UPGRADERS[tag];
    if (!upgrader) {
      if (!ROLE_TAGS.has(tag)) {
        console.warn(`[uix] unknown control element <${tag}> - skipped`);
      }
      return;
    }
    controls.add(attrString(element, 'uixId'), upgrader(element));
  });
  registry.set(documentKey, controls);
  return controls;
}

/** Controls of an upgraded panel; undefined before `UIControlsSystem` ran. */
export function panelControlsFor(documentKey: object): PanelControls | undefined {
  return registry.get(documentKey);
}
