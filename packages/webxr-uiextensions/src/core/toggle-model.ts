/**
 * Toggle model — pure boolean state for the `data-uix="toggle"` control.
 */
export class ToggleModel {
  private state: boolean;

  constructor(initial = false) {
    this.state = initial;
  }

  get value(): boolean {
    return this.state;
  }

  /** Set the state; returns true when it actually changed. */
  set(value: boolean): boolean {
    if (value === this.state) {
      return false;
    }
    this.state = value;
    return true;
  }

  toggle(): boolean {
    this.state = !this.state;
    return this.state;
  }
}
