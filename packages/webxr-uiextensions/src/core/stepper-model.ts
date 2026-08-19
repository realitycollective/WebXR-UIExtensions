/**
 * Stepper model — pure numeric state for the `data-uix="stepper"` control.
 */
export interface StepperOptions {
  min?: number;
  max?: number;
  step?: number;
  value?: number;
}

export class StepperModel {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  private current: number;

  constructor(options: StepperOptions = {}) {
    this.min = options.min ?? 0;
    this.max = options.max ?? 10;
    this.step = options.step ?? 1;
    if (this.max < this.min) {
      throw new Error(`[uix] stepper max (${this.max}) < min (${this.min})`);
    }
    if (!(this.step > 0)) {
      throw new Error(`[uix] stepper step must be > 0 (got ${this.step})`);
    }
    this.current = this.clamp(options.value ?? this.min);
  }

  get value(): number {
    return this.current;
  }

  /** Set (clamped); returns true when the value actually changed. */
  set(value: number): boolean {
    const next = this.clamp(value);
    if (next === this.current) {
      return false;
    }
    this.current = next;
    return true;
  }

  increment(): boolean {
    return this.set(this.current + this.step);
  }

  decrement(): boolean {
    return this.set(this.current - this.step);
  }

  get canIncrement(): boolean {
    return this.current < this.max;
  }

  get canDecrement(): boolean {
    return this.current > this.min;
  }

  private clamp(value: number): number {
    return Math.min(this.max, Math.max(this.min, value));
  }
}
