/**
 * Log view - `data-uix="log-view"`.
 *
 * A console-style scrolling list rendered into a fixed pool of row elements
 * (UIKitML's text rule: each row needs a literal placeholder child). Rows
 * are the descendants with role `line`, in document order; their count is
 * the viewport height.
 *
 * ```html
 * <div data-uix="log-view" data-uix-id="combat" data-uix-capacity="200">
 *   <div class="rows">
 *     <span data-uix-role="line">.</span>
 *     <span data-uix-role="line">.</span>
 *     <span data-uix-role="line">.</span>
 *   </div>
 *   <div class="log-buttons">
 *     <button data-uix-role="up">▲</button>
 *     <button data-uix-role="down">▼</button>
 *     <button data-uix-role="clear">clear</button>
 *   </div>
 *   <span data-uix-role="status">.</span>
 * </div>
 * ```
 */
import { LogModel } from '../core/log-model.js';
import { UixElement, attrNumber, findRole, findRoles } from './element.js';

export class LogViewHandle {
  constructor(
    readonly model: LogModel,
    private rows: UixElement[],
    private statusElement: UixElement | undefined,
  ) {
    this.render();
  }

  push(message: string, level = 'info'): void {
    this.model.push(message, level);
    this.render();
  }

  clear(): void {
    this.model.clear();
    this.render();
  }

  scrollUp(rows = 1): void {
    this.model.scrollUp(rows);
    this.render();
  }

  scrollDown(rows = 1): void {
    this.model.scrollDown(rows);
    this.render();
  }

  private render(): void {
    const visible = this.model.visible();
    this.rows.forEach((row, index) => {
      const entry = visible[index];
      row.setProperties({
        // UIKitML renders "" as empty text - exactly what vacant rows need.
        text: entry ? entry.message : '',
      });
    });
    if (this.statusElement) {
      const suffix = this.model.isFollowing ? '' : ' (scrolled)';
      this.statusElement.setProperties({
        text: `${this.model.count} entries${suffix}`,
      });
    }
  }
}

export function upgradeLogView(root: UixElement): LogViewHandle {
  const rows = findRoles(root, 'line');
  const capacity = attrNumber(root, 'uixCapacity');
  const model = new LogModel({
    visibleRows: Math.max(1, rows.length),
    ...(capacity !== undefined && { capacity }),
  });
  const handle = new LogViewHandle(model, rows, findRole(root, 'status'));
  findRole(root, 'up')?.addEventListener('click', () => handle.scrollUp());
  findRole(root, 'down')?.addEventListener('click', () => handle.scrollDown());
  findRole(root, 'clear')?.addEventListener('click', () => handle.clear());
  return handle;
}
