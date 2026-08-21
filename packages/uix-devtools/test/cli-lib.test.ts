import { describe, expect, it } from 'vitest';
import {
  buildEditUrl,
  checkBinary,
  checkNodeVersion,
  extractTunnelUrl,
  formatDoctorReport,
  mintToken,
  planTunnel,
} from '../src/cli/lib.js';

describe('extractTunnelUrl', () => {
  it('finds the assigned URL in cloudflared banner output', () => {
    const banner = [
      '2026-08-05T10:00:00Z INF +--------------------------------------------+',
      '2026-08-05T10:00:00Z INF |  Your quick Tunnel has been created! Visit:  |',
      '2026-08-05T10:00:00Z INF |  https://lamp-shore-nested-brief.trycloudflare.com  |',
      '2026-08-05T10:00:00Z INF +--------------------------------------------+',
    ].join('\n');
    expect(extractTunnelUrl(banner)).toBe(
      'https://lamp-shore-nested-brief.trycloudflare.com',
    );
  });

  it('returns undefined when no URL is present yet', () => {
    expect(extractTunnelUrl('INF Starting tunnel')).toBeUndefined();
  });
});

describe('mintToken', () => {
  it('mints URL-safe, distinct tokens', () => {
    const a = mintToken();
    const b = mintToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('buildEditUrl', () => {
  it('appends the token under the default param', () => {
    expect(buildEditUrl('https://x.trycloudflare.com', 'tok')).toBe(
      'https://x.trycloudflare.com/?uix-edit=tok',
    );
  });

  it('supports custom params and preserves existing query', () => {
    expect(buildEditUrl('https://x.test/?a=1', 'tok', 'edit')).toBe(
      'https://x.test/?a=1&edit=tok',
    );
  });
});

describe('planTunnel', () => {
  it('defaults to port 8081 and mints a token', () => {
    const plan = planTunnel();
    expect(plan.port).toBe(8081);
    expect(plan.cloudflaredArgs).toEqual([
      'tunnel',
      '--url',
      'http://localhost:8081',
    ]);
    expect(plan.devServerEnv['VITE_UIX_EDIT']).toBe('1');
    expect(plan.devServerEnv['VITE_UIX_EDIT_TOKEN']).toBe(plan.token);
    expect(plan.devServerEnv['UIX_DEV_TUNNEL']).toBe('1');
  });

  it('accepts an explicit port and token', () => {
    const plan = planTunnel({ port: 5173, token: 'fixed' });
    expect(plan.cloudflaredArgs[2]).toBe('http://localhost:5173');
    expect(plan.token).toBe('fixed');
  });

  it('rejects nonsense ports', () => {
    expect(() => planTunnel({ port: 0 })).toThrow(/Invalid port/);
    expect(() => planTunnel({ port: 1.5 })).toThrow(/Invalid port/);
    expect(() => planTunnel({ port: 70000 })).toThrow(/Invalid port/);
  });
});

describe('doctor checks', () => {
  it('accepts supported node versions', () => {
    expect(checkNodeVersion('v22.12.0').ok).toBe(true);
    expect(checkNodeVersion('v20.19.4').ok).toBe(true);
    expect(checkNodeVersion('v24.0.0').ok).toBe(true);
  });

  it('rejects unsupported or unparseable versions', () => {
    expect(checkNodeVersion('v18.20.0').ok).toBe(false);
    expect(checkNodeVersion('v20.18.9').ok).toBe(false);
    expect(checkNodeVersion('v22.11.0').ok).toBe(false);
    expect(checkNodeVersion('wat').ok).toBe(false);
  });

  it('reports missing binaries with the install hint', () => {
    const check = checkBinary('cloudflared', false, undefined, 'install it');
    expect(check.ok).toBe(false);
    expect(check.hint).toBe('install it');
  });

  it('reports found binaries with their first version line', () => {
    const check = checkBinary('adb', true, 'adb version 36.0.0\nrest', 'x');
    expect(check).toEqual({ name: 'adb', ok: true, detail: 'adb version 36.0.0' });
  });

  it('reports found binaries without a version string', () => {
    expect(checkBinary('adb', true, undefined, 'x').detail).toBe('found');
  });

  it('formats a readable report', () => {
    const report = formatDoctorReport([
      { name: 'node', ok: true, detail: 'v22' },
      { name: 'cloudflared', ok: false, detail: 'not found on PATH', hint: 'install' },
    ]);
    expect(report).toContain('[ ok ] node: v22');
    expect(report).toContain('[FAIL] cloudflared: not found on PATH');
    expect(report).toContain('↳ install');
  });
});
