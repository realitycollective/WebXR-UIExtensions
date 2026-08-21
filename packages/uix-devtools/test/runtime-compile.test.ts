import { describe, expect, it } from 'vitest';
import { compilePanelSource } from '../src/runtime-compile.js';

const PANEL = `
<style>
  .box { display: flex; flex-direction: column; padding: 8; }
</style>
<div class="box" id="uix-window">
  <text id="uix-title">Hello</text>
</div>
`;

describe('compilePanelSource', () => {
  it('compiles markup to the same JSON shape the vite plugin emits', () => {
    const compiled = compilePanelSource(PANEL);
    expect(compiled.errors).toEqual([]);
    const parsed = JSON.parse(compiled.json) as {
      element?: { type?: string };
      classes?: Record<string, unknown>;
    };
    // Shape parity with public/ui/*.json: top-level element + classes.
    expect(parsed.element?.type).toBe('container');
    expect(parsed.classes).toHaveProperty('box');
  });

  it('serves the JSON through a fetchable blob URL', async () => {
    const compiled = compilePanelSource(PANEL);
    expect(compiled.configUrl).toMatch(/^blob:/);
    const fetched = await fetch(compiled.configUrl).then((r) => r.json());
    expect(fetched).toEqual(JSON.parse(compiled.json));
    compiled.revoke();
  });

  it('collects diagnostics instead of throwing on empty source', () => {
    const compiled = compilePanelSource('');
    expect(compiled.errors.length).toBeGreaterThan(0);
  });

  it('resolves linked stylesheets through resolveFile', () => {
    const compiled = compilePanelSource(
      '<link ref="panel.css" /><div class="box"><text>x</text></div>',
      { resolveFile: () => '.box { padding: 8; }' },
    );
    expect(compiled.errors).toEqual([]);
    expect(JSON.parse(compiled.json).classes).toHaveProperty('box');
  });

  it('reports a failing resolveFile as a diagnostic, not a throw', () => {
    const compiled = compilePanelSource(
      '<link ref="missing.css" /><div><text>x</text></div>',
      {
        resolveFile: () => {
          throw new Error('no such file');
        },
      },
    );
    expect(compiled.errors.some((e) => e.includes('missing.css'))).toBe(true);
  });

  it('revoke is callable more than once without error', () => {
    const compiled = compilePanelSource(PANEL);
    compiled.revoke();
    expect(() => compiled.revoke()).not.toThrow();
  });
});
