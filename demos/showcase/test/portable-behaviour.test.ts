/**
 * Architectural gate for the playground behaviour.
 *
 * `playground-behaviour.ts` is the demo's proof that app logic can be written
 * once and run on every adapter: it talks only to `WindowHost`, the control
 * models and the `WindowManager`. The moment an engine import lands in it the
 * claim stops being true, and the IWSDK, XR Blocks and desktop pipelines stop
 * sharing one behaviour file. This test fails on that import.
 *
 * Same check the core package runs over its own `src/`, applied to the one
 * demo file that makes the same promise.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const FORBIDDEN = ["'@iwsdk/", "'three'", '"three"', "'xrblocks", "'@pmndrs/"];

const SOURCE = readFileSync(
  fileURLToPath(new URL('../src/playground-behaviour.ts', import.meta.url)),
  'utf8',
);

describe('portable playground behaviour', () => {
  it('imports no engine package', () => {
    expect(SOURCE.length).toBeGreaterThan(0);
    for (const marker of FORBIDDEN) {
      expect(
        SOURCE.includes(`from ${marker}`) || SOURCE.includes(`import ${marker}`),
        `playground-behaviour.ts must not import ${marker}`,
      ).toBe(false);
    }
  });

  it('takes its host and manager from the engine-free core', () => {
    expect(SOURCE).toContain("from '@realitycollective/webxr-uiextensions'");
  });
});
