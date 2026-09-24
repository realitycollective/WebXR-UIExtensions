/**
 * The runtime counterpart of the re-export check: beyond the core, the
 * adapter adds only its window host.
 */
import { describe, expect, it } from 'vitest';
import * as core from '@realitycollective/webxr-uiextensions';
import * as adapter from '../src/index.js';

describe('native-uiextensions public surface', () => {
  it('adds only the window host every adapter has', () => {
    const added = Object.keys(adapter).filter((name) => !(name in core)).sort();
    expect(added).toEqual(['NativeWindowHost']);
  });
});
