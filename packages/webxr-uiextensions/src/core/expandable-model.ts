/**
 * Expandable label model - pure truncation/expansion state for the
 * `data-uix="expandable-label"` control (a multi-line label that collapses to
 * a preview with an ellipsis and a "more/less" affordance).
 *
 * Truncation is character-budget based (lines × charsPerLine) rather than
 * pixel based: uikit lays text out with MSDF glyphs at panel resolution, so
 * an exact pixel measure would need the live renderer. A stable budget keeps
 * the control deterministic and testable; authors tune `charsPerLine` to
 * their font size.
 */
export interface ExpandableOptions {
  text?: string;
  collapsedLines?: number;
  charsPerLine?: number;
}

// Three ASCII dots, not U+2026: MSDF font atlases routinely lack the
// ellipsis glyph and render a tofu box instead.
export const ELLIPSIS = '...';

export class ExpandableModel {
  readonly collapsedLines: number;
  readonly charsPerLine: number;
  private fullText: string;
  private isExpanded = false;

  constructor(options: ExpandableOptions = {}) {
    this.collapsedLines = options.collapsedLines ?? 2;
    this.charsPerLine = options.charsPerLine ?? 42;
    if (this.collapsedLines < 1) {
      throw new Error(`[uix] collapsedLines must be >= 1 (got ${this.collapsedLines})`);
    }
    if (this.charsPerLine < 4) {
      throw new Error(`[uix] charsPerLine must be >= 4 (got ${this.charsPerLine})`);
    }
    this.fullText = options.text ?? '';
  }

  get text(): string {
    return this.fullText;
  }

  setText(text: string): void {
    this.fullText = text;
  }

  get expanded(): boolean {
    return this.isExpanded;
  }

  toggle(): boolean {
    this.isExpanded = !this.isExpanded;
    return this.isExpanded;
  }

  /** True when the text overflows the collapsed budget (i.e. a toggle is useful). */
  get overflows(): boolean {
    return this.fullText.length > this.budget;
  }

  /** The string the label should currently display. */
  get displayText(): string {
    if (this.isExpanded || !this.overflows) {
      return this.fullText;
    }
    // Cut on the last word boundary inside the budget so the preview never
    // ends mid-word; fall back to a hard cut for a single unbroken token.
    const slice = this.fullText.slice(0, this.budget - ELLIPSIS.length);
    const lastSpace = slice.lastIndexOf(' ');
    const cut = lastSpace > this.budget * 0.5 ? slice.slice(0, lastSpace) : slice;
    return `${cut.trimEnd()}${ELLIPSIS}`;
  }

  /** Label for the expand/collapse affordance. */
  get toggleLabel(): string {
    return this.isExpanded ? 'less' : 'more';
  }

  private get budget(): number {
    return this.collapsedLines * this.charsPerLine;
  }
}
