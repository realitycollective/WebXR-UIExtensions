/**
 * Compatibility gate: the native adapter must keep re-exporting the FULL
 * engine-free core, so an app that depends only on
 * `@realitycollective/native-uiextensions` never breaks when logic moves
 * into `@realitycollective/webxr-uiextensions`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

describe('native adapter re-export surface', () => {
  it("re-exports the core package wholesale from the adapter's index", () => {
    const index = read('../src/index.ts');
    expect(index).toContain("export * from '@realitycollective/webxr-uiextensions';");
  });

  it('exports what every platform adapter exports, and keeps its internals private', () => {
    const index = read('../src/index.ts');
    expect(index).toContain("export { NativeWindowHost } from './host.js';");
    expect(index).toContain("export type { CreateWindowOptions, NativeWindowHostOptions } from './host.js';");
    expect(index).toContain("export type { NativeElementNode, NativeUiHost } from './native-types.js';");
    // Implementation helpers are not platform API: no other adapter has them.
    for (const internal of ['NativeUixElement', 'flattenByHandle', 'readNativeUiHost', './element.js']) {
      expect(index, `index.ts must not export ${internal}`).not.toContain(internal);
    }
  });

  it('declares the core package as a real dependency', () => {
    const pkg = JSON.parse(read('../package.json')) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies).toHaveProperty('@realitycollective/webxr-uiextensions');
  });

  it('declares no engine dependency', () => {
    const pkg = JSON.parse(read('../package.json')) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const names = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ];
    for (const engine of ['three', '@iwsdk/core', '@pmndrs/uikit', '@pmndrs/uikitml']) {
      expect(names, `must not depend on ${engine}`).not.toContain(engine);
    }
  });
});
