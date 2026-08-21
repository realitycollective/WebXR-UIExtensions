/**
 * The DOM-facing half of DesktopControls is thin glue, but the one decision
 * it makes - "is this keystroke mine, or is someone typing?" - is pure, so it
 * is tested here without a DOM.
 */
import { describe, expect, it } from 'vitest';
import { isTextEntryTarget } from '../src/desktop-controls.js';

describe('isTextEntryTarget', () => {
  it('claims nothing when there is no target', () => {
    expect(isTextEntryTarget(null)).toBe(false);
    expect(isTextEntryTarget(undefined)).toBe(false);
  });

  it('yields to text fields', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(isTextEntryTarget({ tagName })).toBe(true);
    }
  });

  it('matches tag names case-insensitively', () => {
    expect(isTextEntryTarget({ tagName: 'textarea' })).toBe(true);
  });

  it('yields to contenteditable elements whatever their tag', () => {
    expect(isTextEntryTarget({ tagName: 'DIV', isContentEditable: true })).toBe(
      true,
    );
  });

  it('keeps the keystroke for the scene everywhere else', () => {
    expect(isTextEntryTarget({ tagName: 'CANVAS' })).toBe(false);
    expect(isTextEntryTarget({ tagName: 'BODY' })).toBe(false);
    expect(
      isTextEntryTarget({ tagName: 'DIV', isContentEditable: false }),
    ).toBe(false);
  });

  it('survives a target that is not an element at all', () => {
    expect(isTextEntryTarget('window')).toBe(false);
    expect(isTextEntryTarget({ tagName: 42 })).toBe(false);
  });
});
