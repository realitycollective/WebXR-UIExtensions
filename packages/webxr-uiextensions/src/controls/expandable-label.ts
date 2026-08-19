/**
 * Expandable label - `data-uix="expandable-label"`.
 *
 * A multi-line label that collapses to a character budget with an ellipsis
 * and an inline more/less affordance.
 *
 * ```html
 * <div data-uix="expandable-label" data-uix-id="lore"
 *      data-uix-lines="2" data-uix-chars-per-line="40"
 *      data-uix-text="Long text..." class="my-label">
 *   <span data-uix-role="text">.</span>
 *   <button data-uix-role="toggle">more</button>
 * </div>
 * ```
 */
import { Emitter } from '../core/events.js';
import { ExpandableModel } from '../core/expandable-model.js';
import { UixElement, attrNumber, attrString, findRole } from './element.js';

export class ExpandableLabelHandle {
  readonly events = new Emitter<{ change: boolean }>();

  constructor(
    readonly model: ExpandableModel,
    private textElement: UixElement | undefined,
    private toggleElement: UixElement | undefined,
  ) {
    this.render();
  }

  get expanded(): boolean {
    return this.model.expanded;
  }

  setText(text: string): void {
    this.model.setText(text);
    this.render();
  }

  toggle(): void {
    this.events.emit('change', this.model.toggle());
    this.render();
  }

  private render(): void {
    this.textElement?.setProperties({ text: this.model.displayText });
    // Hide the affordance entirely when the text fits the collapsed budget.
    this.toggleElement?.setProperties({
      text: this.model.toggleLabel,
      display: this.model.overflows ? 'flex' : 'none',
    });
  }
}

export function upgradeExpandableLabel(root: UixElement): ExpandableLabelHandle {
  const lines = attrNumber(root, 'uixLines');
  const charsPerLine = attrNumber(root, 'uixCharsPerLine');
  const model = new ExpandableModel({
    text: attrString(root, 'uixText') ?? '',
    ...(lines !== undefined && { collapsedLines: lines }),
    ...(charsPerLine !== undefined && { charsPerLine }),
  });
  const toggle = findRole(root, 'toggle');
  const handle = new ExpandableLabelHandle(model, findRole(root, 'text'), toggle);
  toggle?.addEventListener('click', () => handle.toggle());
  return handle;
}
