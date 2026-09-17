/**
 * Stepper control - `<uix-stepper>`.
 *
 * Markup contract (parts are `<uix-*>` elements; params are `data-uix-*`):
 * ```html
 * <uix-stepper data-uix-id="count" data-uix-min="0" data-uix-max="10"
 *              data-uix-step="1" data-uix-value="5" class="my-stepper">
 *   <uix-decrement>-</uix-decrement>
 *   <uix-value>.</uix-value>
 *   <uix-increment>+</uix-increment>
 * </uix-stepper>
 * ```
 */
import { Emitter } from '../core/events.js';
import { StepperModel, type StepperOptions } from '../core/stepper-model.js';
import { UixElement, attrNumber, findRole } from './element.js';

const DISABLED_OPACITY = 0.35;

export class StepperHandle {
  readonly events = new Emitter<{ change: number }>();

  constructor(
    readonly model: StepperModel,
    private valueElement: UixElement | undefined,
    private decrementElement: UixElement | undefined,
    private incrementElement: UixElement | undefined,
  ) {
    this.render();
  }

  get value(): number {
    return this.model.value;
  }

  set(value: number): void {
    if (this.model.set(value)) {
      this.render();
      this.events.emit('change', this.model.value);
    }
  }

  increment(): void {
    this.set(this.model.value + this.model.step);
  }

  decrement(): void {
    this.set(this.model.value - this.model.step);
  }

  private render(): void {
    this.valueElement?.setProperties({ text: String(this.model.value) });
    this.decrementElement?.setProperties({
      opacity: this.model.canDecrement ? 1 : DISABLED_OPACITY,
    });
    this.incrementElement?.setProperties({
      opacity: this.model.canIncrement ? 1 : DISABLED_OPACITY,
    });
  }
}

export function upgradeStepper(root: UixElement): StepperHandle {
  const options: StepperOptions = {};
  const min = attrNumber(root, 'uixMin');
  const max = attrNumber(root, 'uixMax');
  const step = attrNumber(root, 'uixStep');
  const value = attrNumber(root, 'uixValue');
  if (min !== undefined) options.min = min;
  if (max !== undefined) options.max = max;
  if (step !== undefined) options.step = step;
  if (value !== undefined) options.value = value;
  const model = new StepperModel(options);
  const decrement = findRole(root, 'decrement');
  const increment = findRole(root, 'increment');
  const handle = new StepperHandle(model, findRole(root, 'value'), decrement, increment);
  decrement?.addEventListener('click', () => handle.decrement());
  increment?.addEventListener('click', () => handle.increment());
  return handle;
}
