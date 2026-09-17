/**
 * Architectural gate: this ENTIRE package must stay engine-free.
 *
 * @realitycollective/webxr-uiextensions is the portable heart of the UI
 * Extensions - pure logic and interfaces, so the same UX drives any three.js
 * WebXR runtime through an adapter package (IWSDK today, XR Blocks
 * experimentally, others later). This test fails the moment an engine import
 * lands anywhere in src/, or a runtime dependency outside the allow-list
 * below lands in package.json.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

/**
 * The only runtime dependency this package may carry.
 *
 * `@realitycollective/webxr-input` is the shared contracts package: plain
 * tuples and records, no engine imports and no dependencies of its own. The
 * adapter contract takes its geometry vocabulary from there rather than
 * redeclaring it, so a pose or a ray means the same thing to the Interactions
 * family and to this one. Anything else fails this test.
 */
const ALLOWED_DEPENDENCIES = ['@realitycollective/webxr-input'];
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

  it('package.json declares only the shared contracts dependency', () => {
    const pkg = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../package.json', import.meta.url)),
        'utf8',
      ),
    ) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const dependencies = pkg.dependencies ?? {};
    expect(Object.keys(dependencies).sort()).toEqual(ALLOWED_DEPENDENCIES);
    for (const [name, range] of Object.entries(dependencies)) {
      // A bare '*' resolves only inside the workspace, so it would publish
      // an uninstallable package. verify:pack checks this too.
      expect(range, `${name} needs a publishable range`).not.toBe('*');
    }
    expect(pkg.peerDependencies ?? {}).toEqual({});
  });
});
