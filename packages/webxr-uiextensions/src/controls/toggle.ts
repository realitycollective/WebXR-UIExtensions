/**
 * Toggle control - `<uix-toggle>`.
 *
 * The whole control is the click target. Optional attributes:
 * `data-uix-on` (initial state), `data-uix-on-text` / `data-uix-off-text`
 * (label written into the `label` role), `data-uix-on-color` /
 * `data-uix-off-color` (background color applied to the control root).
 *
 * ```html
 * <uix-toggle data-uix-id="shield" data-uix-on="true"
 *             data-uix-on-text="SHIELD ON" data-uix-off-text="SHIELD OFF"
 *             data-uix-on-color="#2e7d32" data-uix-off-color="#5d4037" class="my-toggle">
 *   <uix-label>.</uix-label>
 * </uix-toggle>
 * ```
 */
import { Emitter } from '../core/events.js';
import { ToggleModel } from '../core/toggle-model.js';
import { UixElement, attrBoolean, attrString, findRole } from './element.js';

export class ToggleHandle {
  readonly events = new Emitter<{ change: boolean }>();

  constructor(
    readonly model: ToggleModel,
    private root: UixElement,
    private labelElement: UixElement | undefined,
  ) {
    this.render();
  }

  get value(): boolean {
    return this.model.value;
  }

  set(value: boolean): void {
    if (this.model.set(value)) {
      this.render();
      this.events.emit('change', this.model.value);
    }
  }

  toggle(): void {
    this.set(!this.model.value);
  }

  private render(): void {
    const on = this.model.value;
    const text = on
      ? (attrString(this.root, 'uixOnText') ?? 'ON')
      : (attrString(this.root, 'uixOffText') ?? 'OFF');
    this.labelElement?.setProperties({ text });
    const color = on
      ? attrString(this.root, 'uixOnColor')
      : attrString(this.root, 'uixOffColor');
    if (color) {
      this.root.setProperties({ backgroundColor: color });
    }
  }
}

export function upgradeToggle(root: UixElement): ToggleHandle {
  const model = new ToggleModel(attrBoolean(root, 'uixOn') ?? false);
  const handle = new ToggleHandle(model, root, findRole(root, 'label'));
  root.addEventListener('click', () => handle.toggle());
  return handle;
}
