/**
 * Architectural gate: this ENTIRE package must stay engine-free.
 *
 * @realitycollective/webxr-uiextensions is the portable heart of the UI
 * Extensions — pure logic and interfaces with no runtime dependencies, so
 * the same UX drives any three.js WebXR runtime through an adapter package
 * (IWSDK today, XR Blocks experimentally, others later). This test fails
 * the moment an engine import lands anywhere in src/.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const FORBIDDEN = [
  "'@iwsdk/",
  "'three'",
  '"three"',
  "'@pmndrs/",
  "'super-three",
  "'xrblocks",
];

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return tsFiles(path);
    }
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('engine-free package', () => {
  it('src/ imports no engine packages anywhere', () => {
    const files = tsFiles(SRC);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const marker of FORBIDDEN) {
        expect(
          source.includes(`from ${marker}`) || source.includes(`import ${marker}`),
          `${file} must not import ${marker}`,
        ).toBe(false);
      }
    }
  });

  it('package.json declares no runtime dependencies', () => {
    const pkg = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../package.json', import.meta.url)),
        'utf8',
      ),
    ) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.peerDependencies ?? {}).toEqual({});
  });
});
