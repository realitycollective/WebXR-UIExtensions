import { describe, expect, it } from 'vitest';
import { compilePanelSource } from '../src/runtime-compile.js';

// `<span>` rather than `<text>`: IWSDK 0.5's parser has no `<text>` component.
const PANEL = `
<style>
  .box { display: flex; flex-direction: column; padding: 8; }
</style>
<div class="box" id="uix-window">
  <span id="uix-title">Hello</span>
</div>
`;

describe('compilePanelSource', () => {
  it('validates clean markup without diagnostics', () => {
    const compiled = compilePanelSource(PANEL);
    expect(compiled.errors).toEqual([]);
    expect(compiled.source).toBe(PANEL);
  });

  it('serves the SOURCE through a fetchable blob URL', async () => {
    // 0.5 fetches PanelUI.config as text and parses it, so the blob must carry
    // the markup itself - not the compiled JSON 0.4.x expected.
    const compiled = compilePanelSource(PANEL);
    expect(compiled.configUrl).toMatch(/^blob:/);
    const fetched = await fetch(compiled.configUrl).then((r) => r.text());
    expect(fetched).toBe(PANEL);
    compiled.revoke();
  });

  it('collects diagnostics instead of throwing on empty source', () => {
    const compiled = compilePanelSource('');
    expect(compiled.errors.length).toBeGreaterThan(0);
  });

  it('reports unknown components as diagnostics', () => {
    const compiled = compilePanelSource('<div><text>x</text></div>');
    expect(compiled.errors.some((e) => e.includes('text'))).toBe(true);
  });

  it('reports unknown properties as diagnostics', () => {
    // data-* attributes are rejected by the 0.5 parser; catching that here is
    // the whole point of validating before the panel is spawned.
    const compiled = compilePanelSource('<div data-uix="log-view"><span>x</span></div>');
    expect(compiled.errors.length).toBeGreaterThan(0);
  });

  it('still produces a config URL when the source has diagnostics', () => {
    // The editor shows errors and lets the author keep going; a broken panel is
    // still spawnable so the failure is visible in-world rather than silent.
    const compiled = compilePanelSource('<div><text>x</text></div>');
    expect(compiled.errors.length).toBeGreaterThan(0);
    expect(compiled.configUrl).toMatch(/^blob:/);
    compiled.revoke();
  });

  it('revoke is callable more than once without error', () => {
    const compiled = compilePanelSource(PANEL);
    compiled.revoke();
    expect(() => compiled.revoke()).not.toThrow();
  });
});
