import { describe, expect, it } from 'vitest';
import { StepperModel } from '../src/core/stepper-model.js';
import { ToggleModel } from '../src/core/toggle-model.js';
import { ELLIPSIS, ExpandableModel } from '../src/core/expandable-model.js';
import { LogModel } from '../src/core/log-model.js';

describe('StepperModel', () => {
  it('starts at min by default and clamps initial values', () => {
    expect(new StepperModel().value).toBe(0);
    expect(new StepperModel({ min: 2, max: 5, value: 99 }).value).toBe(5);
    expect(new StepperModel({ min: 2, max: 5, value: -1 }).value).toBe(2);
  });

  it('validates configuration', () => {
    expect(() => new StepperModel({ min: 5, max: 1 })).toThrow(/max/);
    expect(() => new StepperModel({ step: 0 })).toThrow(/step/);
  });

  it('increments and decrements by step within bounds', () => {
    const model = new StepperModel({ min: 0, max: 1, step: 0.5 });
    expect(model.increment()).toBe(true);
    expect(model.value).toBe(0.5);
    expect(model.increment()).toBe(true);
    expect(model.increment()).toBe(false); // clamped at max
    expect(model.value).toBe(1);
    expect(model.canIncrement).toBe(false);
    expect(model.canDecrement).toBe(true);
    model.decrement();
    model.decrement();
    expect(model.decrement()).toBe(false);
    expect(model.canDecrement).toBe(false);
  });

  it('set reports change only when the clamped value differs', () => {
    const model = new StepperModel({ min: 0, max: 10, value: 5 });
    expect(model.set(5)).toBe(false);
    expect(model.set(50)).toBe(true);
    expect(model.value).toBe(10);
    expect(model.set(11)).toBe(false); // clamps to the same 10
  });
});

describe('ToggleModel', () => {
  it('defaults off, toggles and de-duplicates sets', () => {
    const model = new ToggleModel();
    expect(model.value).toBe(false);
    expect(model.toggle()).toBe(true);
    expect(model.set(true)).toBe(false);
    expect(model.set(false)).toBe(true);
    expect(new ToggleModel(true).value).toBe(true);
  });
});

describe('ExpandableModel', () => {
  const LONG =
    'The quick brown fox jumps over the lazy dog while the log window scrolls quietly in the corner of the play space.';

  it('validates configuration', () => {
    expect(() => new ExpandableModel({ collapsedLines: 0 })).toThrow(/collapsedLines/);
    expect(() => new ExpandableModel({ charsPerLine: 2 })).toThrow(/charsPerLine/);
  });

  it('defaults to empty text', () => {
    const model = new ExpandableModel();
    expect(model.text).toBe('');
    expect(model.overflows).toBe(false);
    expect(model.displayText).toBe('');
  });

  it('short text never truncates and hides the affordance need', () => {
    const model = new ExpandableModel({ text: 'short', collapsedLines: 1, charsPerLine: 10 });
    expect(model.overflows).toBe(false);
    expect(model.displayText).toBe('short');
  });

  it('collapses long text on a word boundary with an ellipsis', () => {
    const model = new ExpandableModel({ text: LONG, collapsedLines: 2, charsPerLine: 20 });
    expect(model.overflows).toBe(true);
    expect(model.displayText.endsWith(ELLIPSIS)).toBe(true);
    expect(model.displayText.length).toBeLessThanOrEqual(40);
    // Word boundary: no trailing partial word before the ellipsis.
    expect(model.displayText).not.toMatch(/\s…$/);
  });

  it('hard-cuts a single unbroken token', () => {
    const model = new ExpandableModel({
      text: 'x'.repeat(100),
      collapsedLines: 1,
      charsPerLine: 20,
    });
    expect(model.displayText).toBe(`${'x'.repeat(20 - ELLIPSIS.length)}${ELLIPSIS}`);
  });

  it('toggle expands to the full text and back', () => {
    const model = new ExpandableModel({ text: LONG, collapsedLines: 1, charsPerLine: 10 });
    expect(model.toggleLabel).toBe('more');
    expect(model.toggle()).toBe(true);
    expect(model.expanded).toBe(true);
    expect(model.displayText).toBe(LONG);
    expect(model.toggleLabel).toBe('less');
    expect(model.toggle()).toBe(false);
    expect(model.displayText).not.toBe(LONG);
  });

  it('setText replaces the content', () => {
    const model = new ExpandableModel({ text: 'a' });
    model.setText('b');
    expect(model.text).toBe('b');
    expect(model.displayText).toBe('b');
  });
});

describe('LogModel', () => {
  it('validates configuration', () => {
    expect(() => new LogModel({ capacity: 0 })).toThrow(/capacity/);
    expect(() => new LogModel({ visibleRows: 0 })).toThrow(/visibleRows/);
  });

  it('follows the tail by default', () => {
    const model = new LogModel({ visibleRows: 2 });
    model.push('one');
    model.push('two');
    model.push('three');
    expect(model.isFollowing).toBe(true);
    expect(model.visible().map((entry) => entry.message)).toEqual(['two', 'three']);
    expect(model.count).toBe(3);
  });

  it('drops the oldest entries beyond capacity', () => {
    const model = new LogModel({ capacity: 2, visibleRows: 2 });
    model.push('one');
    model.push('two');
    model.push('three');
    expect(model.count).toBe(2);
    expect(model.visible().map((entry) => entry.message)).toEqual(['two', 'three']);
  });

  it('scrolling up disengages follow; scrolling to the tail re-engages it', () => {
    const model = new LogModel({ visibleRows: 1 });
    ['a', 'b', 'c'].forEach((message) => model.push(message));
    model.scrollUp();
    expect(model.isFollowing).toBe(false);
    expect(model.visible()[0]?.message).toBe('b');
    model.scrollUp(99);
    expect(model.visible()[0]?.message).toBe('a');
    model.scrollDown();
    expect(model.visible()[0]?.message).toBe('b');
    expect(model.isFollowing).toBe(false);
    model.scrollDown();
    expect(model.isFollowing).toBe(true);
    expect(model.visible()[0]?.message).toBe('c');
  });

  it('scrolled viewport keeps its place while new entries arrive, and follow() jumps back', () => {
    const model = new LogModel({ visibleRows: 1 });
    ['a', 'b', 'c'].forEach((message) => model.push(message));
    model.scrollUp(2);
    model.push('d');
    expect(model.visible()[0]?.message).toBe('a');
    model.follow();
    expect(model.visible()[0]?.message).toBe('d');
  });

  it('capacity overflow adjusts a scrolled viewport so it never underflows', () => {
    const model = new LogModel({ capacity: 3, visibleRows: 1 });
    ['a', 'b', 'c'].forEach((message) => model.push(message));
    model.scrollUp(99); // top = 0 ('a')
    model.push('d'); // 'a' dropped
    expect(model.visible()[0]?.message).toBe('b');
  });

  it('records levels and clear resets everything', () => {
    const model = new LogModel({ visibleRows: 2 });
    model.push('warned', 'warn');
    expect(model.visible()[0]).toEqual({ message: 'warned', level: 'warn' });
    model.scrollUp();
    model.clear();
    expect(model.count).toBe(0);
    expect(model.isFollowing).toBe(true);
    expect(model.visible()).toEqual([]);
  });
});
