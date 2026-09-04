/**
 * Compatibility gate: the IWSDK adapter must keep re-exporting the FULL
 * engine-free core, so existing apps that depend only on
 * `@realitycollective/iwsdk-uiextensions` never break when logic moves into
 * `@realitycollective/webxr-uiextensions`.
 *
 * Checked statically (the adapter's engine modules import `@iwsdk/core`,
 * which a headless node test must not execute).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

describe('adapter re-export surface', () => {
  it("re-exports the core package wholesale from the adapter's index", () => {
    const index = read('../src/index.ts');
    expect(index).toContain(
      "export * from '@realitycollective/webxr-uiextensions';",
    );
  });

  it('keeps the engine binding modules exported', () => {
    const index = read('../src/index.ts');
    for (const module of [
      './components.js',
      './manager-registry.js',
      './region-registry-store.js',
      './factory.js',
      './scene-host.js',
      './register.js',
      './systems/window-system.js',
      './systems/dock-system.js',
      './systems/drag-system.js',
      './systems/dock-region-system.js',
      './systems/controls-system.js',
    ]) {
      expect(index, `index.ts must export ${module}`).toContain(
        `export * from '${module}';`,
      );
    }
  });

  it('declares the core package as a real dependency', () => {
    const pkg = JSON.parse(read('../package.json')) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies).toHaveProperty(
      '@realitycollective/webxr-uiextensions',
    );
  });
});
