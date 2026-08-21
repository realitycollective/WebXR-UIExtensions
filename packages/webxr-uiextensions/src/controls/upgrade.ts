/**
 * Panel upgrade - scans a loaded panel for `data-uix` markers and wires the
 * matching control behaviour. App code retrieves the resulting handles via
 * `panelControlsFor(document)` and the control's `data-uix-id`.
 */
import { UixElement, attrString, walk } from './element.js';
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

const UPGRADERS: Record<string, (root: UixElement) => ControlHandle> = {
  stepper: upgradeStepper,
  toggle: upgradeToggle,
  'expandable-label': upgradeExpandableLabel,
  'log-view': upgradeLogView,
};

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
    const marker = attrString(element, 'uix');
    if (marker === undefined) {
      return;
    }
    const upgrader = UPGRADERS[marker];
    if (!upgrader) {
      console.warn(`[uix] unknown control type data-uix="${marker}" - skipped`);
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
