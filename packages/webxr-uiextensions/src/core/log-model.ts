/**
 * Log model - pure ring buffer + viewport for the `data-uix="log-view"`
 * control (scrollable log/list windows).
 *
 * UIKitML text nodes are a fixed pool (see "the text rule": dynamic text
 * needs a placeholder child), so the view renders into a fixed number of
 * visible rows and the model computes which slice of the buffer those rows
 * show. `follow` mode pins the viewport to the newest entry, like a console.
 */
export interface LogEntry {
  message: string;
  /** Optional severity/category tag; the view can color rows by it. */
  level: string;
}

export interface LogModelOptions {
  /** Maximum retained entries; older entries are dropped. */
  capacity?: number;
  /** Number of visible rows in the view. */
  visibleRows?: number;
}

export class LogModel {
  readonly capacity: number;
  readonly visibleRows: number;
  private entries: LogEntry[] = [];
  /** Index of the first visible entry when not following. */
  private scrollTop = 0;
  private following = true;

  constructor(options: LogModelOptions = {}) {
    this.capacity = options.capacity ?? 200;
    this.visibleRows = options.visibleRows ?? 8;
    if (this.capacity < 1) {
      throw new Error(`[uix] log capacity must be >= 1 (got ${this.capacity})`);
    }
    if (this.visibleRows < 1) {
      throw new Error(`[uix] log visibleRows must be >= 1 (got ${this.visibleRows})`);
    }
  }

  get count(): number {
    return this.entries.length;
  }

  get isFollowing(): boolean {
    return this.following;
  }

  push(message: string, level = 'info'): void {
    this.entries.push({ message, level });
    const overflow = this.entries.length - this.capacity;
    if (overflow > 0) {
      this.entries.splice(0, overflow);
      this.scrollTop = Math.max(0, this.scrollTop - overflow);
    }
  }

  clear(): void {
    this.entries = [];
    this.scrollTop = 0;
    this.following = true;
  }

  /** Scroll up (towards older entries) by `rows`; disengages follow mode. */
  scrollUp(rows = 1): void {
    // Seed from the viewport the user is looking at NOW (which, while
    // following, is the tail) before switching to manual scrolling.
    const top = this.effectiveTop();
    this.following = false;
    this.scrollTop = Math.max(0, top - rows);
  }

  /** Scroll down; re-engages follow mode when the newest entry comes into view. */
  scrollDown(rows = 1): void {
    const max = this.maxTop();
    const next = Math.min(max, this.effectiveTop() + rows);
    this.scrollTop = next;
    if (next >= max) {
      this.following = true;
    }
  }

  follow(): void {
    this.following = true;
  }

  /** The entries currently in the viewport, oldest first. */
  visible(): LogEntry[] {
    const top = this.effectiveTop();
    return this.entries.slice(top, top + this.visibleRows);
  }

  private maxTop(): number {
    return Math.max(0, this.entries.length - this.visibleRows);
  }

  private effectiveTop(): number {
    return this.following ? this.maxTop() : Math.min(this.scrollTop, this.maxTop());
  }
}
