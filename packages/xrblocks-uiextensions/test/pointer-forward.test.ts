import { describe, expect, it, vi } from 'vitest';
import { forwardClick, pickInteractive } from '../src/pointer-forward.js';

function uikitNode(overrides: Record<string, unknown> = {}) {
  return {
    dispatchEvent: vi.fn(),
    userData: { dataUid: 'uid-1' },
    parent: undefined as unknown,
    ...overrides,
  };
}

describe('pickInteractive', () => {
  it('returns the hit object itself when it is a uikit element', () => {
    const node = uikitNode();
    expect(pickInteractive(node)).toBe(node);
  });

  it('walks up to the nearest uikit ancestor', () => {
    const ancestor = uikitNode();
    const child = { parent: ancestor, userData: {} };
    expect(pickInteractive(child)).toBe(ancestor);
  });

  it('ignores plain three.js objects with no uikit ancestry', () => {
    const plain = { parent: { parent: undefined, userData: {} }, userData: {} };
    expect(pickInteractive(plain)).toBeUndefined();
  });
});

describe('forwardClick', () => {
  it('dispatches a click to the element under the first hit', () => {
    const node = uikitNode();
    const received = forwardClick([{ object: node as never }]);
    expect(received).toBe(node);
    expect(node.dispatchEvent).toHaveBeenCalledWith({ type: 'click' });
  });

  it('does nothing for an empty intersection list', () => {
    expect(forwardClick([])).toBeUndefined();
  });
});
