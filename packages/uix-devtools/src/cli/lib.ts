/**
 * Pure logic behind the `uix-dev` CLI - everything here is unit-testable in
 * node with no processes spawned. The orchestration (spawning vite and
 * cloudflared, wiring stdio) lives in `main.ts` and stays intentionally thin.
 */
import { randomBytes } from 'node:crypto';

/** Matches the URL cloudflared assigns to a quick tunnel. */
const TUNNEL_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

/**
 * Extract the assigned quick-tunnel URL from a chunk of cloudflared output.
 * cloudflared prints it (to stderr) inside a box banner once the tunnel is up.
 */
export function extractTunnelUrl(outputChunk: string): string | undefined {
  const match = TUNNEL_URL_PATTERN.exec(outputChunk);
  return match ? match[0] : undefined;
}

/** Mint a URL-safe random session token. */
export function mintToken(bytes = 16): string {
  return randomBytes(bytes).toString('base64url');
}

/** Append the edit-session token to a base URL. */
export function buildEditUrl(
  baseUrl: string,
  token: string,
  param = 'uix-edit',
): string {
  const url = new URL(baseUrl);
  url.searchParams.set(param, token);
  return url.toString();
}

export interface TunnelPlan {
  /** Local dev-server port the tunnel forwards to. */
  port: number;
  /** Per-run edit-session token, exported as VITE_UIX_EDIT_TOKEN. */
  token: string;
  /** argv for the cloudflared process. */
  cloudflaredArgs: string[];
  /** Environment additions for the dev-server process. */
  devServerEnv: Record<string, string>;
}

/** Compute everything a `uix-dev tunnel` run needs up front. */
export function planTunnel(options: { port?: number; token?: string } = {}): TunnelPlan {
  const port = options.port ?? 8081;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${String(options.port)}`);
  }
  const token = options.token ?? mintToken();
  return {
    port,
    token,
    cloudflaredArgs: ['tunnel', '--url', `http://localhost:${port}`],
    devServerEnv: {
      // Compile the edit gate in and pin the accepted token to this run.
      VITE_UIX_EDIT: '1',
      VITE_UIX_EDIT_TOKEN: token,
      // Tells vite configs to emit HMR client settings that work through an
      // HTTPS tunnel (wss on port 443) instead of the local port.
      UIX_DEV_TUNNEL: '1',
    },
  };
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  hint?: string;
}

/** Interpret a `node --version` string against the workspace requirement. */
export function checkNodeVersion(versionString: string): DoctorCheck {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(versionString.trim());
  if (!match) {
    return {
      name: 'node',
      ok: false,
      detail: `Unrecognised version "${versionString.trim()}"`,
      hint: 'Install Node 20.19+, 22.12+ or 24+.',
    };
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const ok =
    (major === 20 && minor >= 19) ||
    (major === 22 && minor >= 12) ||
    major >= 24;
  return {
    name: 'node',
    ok,
    detail: `Node ${match[0].replace(/^v?/, 'v')}`,
    ...(ok ? {} : { hint: 'This workspace needs Node 20.19+, 22.12+ or 24+.' }),
  };
}

/** Build the doctor result for an external binary probe. */
export function checkBinary(
  name: string,
  found: boolean,
  version: string | undefined,
  installHint: string,
): DoctorCheck {
  if (!found) {
    return { name, ok: false, detail: 'not found on PATH', hint: installHint };
  }
  return { name, ok: true, detail: version?.trim().split('\n')[0] ?? 'found' };
}

/** Render doctor checks as terminal lines. */
export function formatDoctorReport(checks: readonly DoctorCheck[]): string {
  return checks
    .map((check) => {
      const status = check.ok ? ' ok ' : 'FAIL';
      const hint = check.hint ? `\n       ↳ ${check.hint}` : '';
      return `[${status}] ${check.name}: ${check.detail}${hint}`;
    })
    .join('\n');
}
