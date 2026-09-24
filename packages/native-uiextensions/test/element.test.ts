/**
 * NativeUixElement in isolation: userData shape, event dispatch and property
 * forwarding, independent of any host or WindowHost wiring.
 */
import { describe, expect, it, vi } from 'vitest';
import { NativeUixElement, flattenByHandle } from '../src/element.js';
import type { NativeElementNode } from '../src/native-types.js';

const TREE: NativeElementNode = {
  handle: 'h-root',
  id: 'root',
  children: [
    { handle: 'h-title', id: 'title', children: [] },
    {
      handle: 'h-toggle',
      id: 'toggle',
      componentName: 'uix-toggle',
      children: [{ handle: 'h-value', children: [] }],
    },
  ],
};

describe('NativeUixElement', () => {
  it('carries id and customElement.componentName in userData, omitting either when the node has none', () => {
    const setProperties = vi.fn();
    const root = new NativeUixElement(TREE, { setProperties });

    expect(root.userData).toEqual({ id: 'root' });
    expect(root.children).toHaveLength(2);

    const [title, toggle] = root.children;
    expect(title?.userData).toEqual({ id: 'title' });
    expect(toggle?.userData).toEqual({
      id: 'toggle',
      customElement: { componentName: 'uix-toggle' },
    });

    const value = toggle?.children[0];
    expect(value?.userData).toEqual({});
  });

  it('lifts data-* attributes into userData under the core rule and ignores the rest', () => {
    const element = new NativeUixElement(
      {
        handle: 'h-stepper',
        componentName: 'uix-stepper',
        attributes: { 'data-uix-id': 'count', 'data-uix-chars-per-line': '4', 'aria-label': 'Count' },
        children: [],
      },
      { setProperties: vi.fn() },
    );
    expect(element.userData).toEqual({
      customElement: { componentName: 'uix-stepper' },
      uixId: 'count',
      uixCharsPerLine: '4',
    });
  });

  it('setProperties forwards to the context with this element handle', () => {
    const setProperties = vi.fn();
    const root = new NativeUixElement(TREE, { setProperties });
    root.setProperties({ text: 'hi' });
    expect(setProperties).toHaveBeenCalledWith('h-root', { text: 'hi' });
  });

  it('addEventListener registers locally; dispatch runs every listener for that type only', () => {
    const root = new NativeUixElement(TREE, { setProperties: vi.fn() });
    const clicks: unknown[] = [];
    const others: unknown[] = [];
    root.addEventListener('click', (payload) => clicks.push(payload));
    root.addEventListener('click', (payload) => clicks.push(payload));
    root.addEventListener('change', (payload) => others.push(payload));

    root.dispatch('click', { x: 1 });
    expect(clicks).toEqual([{ x: 1 }, { x: 1 }]);
    expect(others).toEqual([]);

    // No listener registered for this type: dispatch is a no-op, not an error.
    expect(() => root.dispatch('unregistered', undefined)).not.toThrow();
  });

  it('flattenByHandle indexes every element in the subtree, including the root', () => {
    const root = new NativeUixElement(TREE, { setProperties: vi.fn() });
    const byHandle = flattenByHandle(root);
    expect([...byHandle.keys()].sort()).toEqual(
      ['h-root', 'h-title', 'h-toggle', 'h-value'].sort(),
    );
    expect(byHandle.get('h-toggle')).toBe(root.children[1]);
  });
});
