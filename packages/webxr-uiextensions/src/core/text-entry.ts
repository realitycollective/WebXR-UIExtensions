/**
 * Text entry - when a text field takes focus, what the platform's keyboard
 * is asked for, and how typed text comes back. Pure logic, no engine.
 *
 * The template is uikit's `Input` (`@pmndrs/uikit` `components/input.js`
 * over `text/input/hidden-input.js`): a click on the field focuses a hidden
 * HTML input, which is what makes the browser (and, on a headset, the
 * system) show its keyboard; every `input` event on it replaces the field's
 * value and raises `onValueChange`; blurring it ends entry. The keyboard
 * itself is a platform facility (`TextInputFacility`): the browser's on the
 * web, the system keyboard on a native host, each the platform's default.
 *
 * `TextEntry` is the state one field's binding keeps: which field has focus,
 * its value, and what to ask the facility for.
 */

/** What a field asks the keyboard for. */
export interface TextEntryRequest {
  /** The field's value when it took focus. */
  value: string;
  /** A multi-line field wants a return key that inserts a line break. uikit `multiline`. */
  multiline: boolean;
  /** The HTML input type the field declared: `"text"`, `"password"`, `"email"`, `"number"` and so on. Default `"text"`. */
  type: string;
}

/**
 * The platform's keyboard, behind one contract. `show` asks it to appear for
 * a field with the request's value; the platform then reports every change
 * through `onInput` (the whole value each time, as uikit's hidden input
 * does) and `onClose` when the user dismissed it or focus moved. `hide`
 * dismisses it from the app's side. Every platform names a default: the
 * browser's keyboard through a hidden HTML input on the web, the system
 * keyboard on a native host.
 */
export interface TextInputFacility {
  show(request: TextEntryRequest): void;
  hide(): void;
  onInput(listener: (value: string) => void): () => void;
  onClose(listener: () => void): () => void;
}

export interface TextEntryOptions {
  multiline?: boolean;
  type?: string;
}

export class TextEntry<T> {
  private focused: T | undefined;
  private current = "";

  /** The field that has focus, if any. */
  get field(): T | undefined {
    return this.focused;
  }

  /** The focused field's value as typed so far. */
  get value(): string {
    return this.current;
  }

  /** A field was clicked: it takes focus, and the keyboard is asked for. Returns the request to hand the facility. */
  focus(field: T, value: string, options: TextEntryOptions = {}): TextEntryRequest {
    this.focused = field;
    this.current = value;
    return { value, multiline: options.multiline ?? false, type: options.type ?? "text" };
  }

  /** The keyboard reported the whole value. Returns the field it belongs to, or undefined when nothing has focus. */
  input(value: string): T | undefined {
    if (this.focused === undefined) return undefined;
    this.current = value;
    return this.focused;
  }

  /** The keyboard closed or focus moved: entry ends. Returns the field that lost focus. */
  blur(): T | undefined {
    const field = this.focused;
    this.focused = undefined;
    return field;
  }
}
