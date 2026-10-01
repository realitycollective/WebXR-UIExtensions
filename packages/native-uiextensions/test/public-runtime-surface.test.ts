/**
 * The runtime counterpart of the re-export check: beyond the core, the
 * adapter adds only its window host, and the host conformance kit a native
 * app runs on its device (the one export a web adapter has no need for).
 */
import { describe, expect, it } from 'vitest';
import * as core from '@realitycollective/webxr-uiextensions';
import * as adapter from '../src/index.js';

describe('native-uiextensions public surface', () => {
  it('adds only the window host every adapter has, and the host conformance kit', () => {
    const added = Object.keys(adapter).filter((name) => !(name in core)).sort();
    expect(added).toEqual(['NativeWindowHost', 'nativeUiHostConformanceCases']);
  });
});
