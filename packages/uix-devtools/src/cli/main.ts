/**
 * `uix-dev` - get an IWSDK UI Extensions client onto a headset in one command.
 *
 * Commands:
 *   uix-dev tunnel [--port N] [--cwd DIR] [--no-dev-server]
 *       Mint an edit-session token, start the Vite dev server (npm run dev)
 *       with the token exported, open a Cloudflare quick tunnel to it and
 *       print both the plain and the edit-mode URL as text + QR codes.
 *   uix-dev doctor
 *       Check node / cloudflared / adb availability with install hints.
 *   uix-dev qr <url>
 *       Print a QR code for any URL (e.g. a staging deploy).
 *
 * Orchestration only - all decision logic lives in lib.ts where it is unit
 * tested.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import process from 'node:process';
import qrcode from 'qrcode-terminal';
import {
  buildEditUrl,
  checkBinary,
  checkNodeVersion,
  extractTunnelUrl,
  formatDoctorReport,
  planTunnel,
} from './lib.js';

function printQr(url: string): Promise<void> {
  return new Promise((resolve) => {
    qrcode.generate(url, { small: true }, (code: string) => {
      console.log(code);
      resolve();
    });
  });
}

function probeBinary(command: string, args: string[]): string | undefined {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    return undefined;
  }
  return (result.stdout || result.stderr || '').trim() || 'found';
}

async function runDoctor(): Promise<number> {
  const checks = [
    checkNodeVersion(process.version),
    checkBinary(
      'cloudflared',
      probeBinary('cloudflared', ['--version']) !== undefined,
      probeBinary('cloudflared', ['--version']),
      'Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ (brew install cloudflared / winget install Cloudflare.cloudflared)',
    ),
    checkBinary(
      'adb',
      probeBinary('adb', ['--version']) !== undefined,
      probeBinary('adb', ['--version']),
      'Optional (USB loop): install Android platform-tools for `adb reverse`.',
    ),
  ];
  console.log(formatDoctorReport(checks));
  return checks.every((check) => check.ok || check.name === 'adb') ? 0 : 1;
}

interface TunnelFlags {
  port: number;
  cwd: string;
  devServer: boolean;
}

function parseTunnelFlags(argv: string[]): TunnelFlags {
  const flags: TunnelFlags = { port: 8081, cwd: process.cwd(), devServer: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port') {
      flags.port = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--cwd') {
      flags.cwd = argv[i + 1] ?? flags.cwd;
      i += 1;
    } else if (arg === '--no-dev-server') {
      flags.devServer = false;
    }
  }
  return flags;
}

async function runTunnel(argv: string[]): Promise<number> {
  const flags = parseTunnelFlags(argv);
  const plan = planTunnel({ port: flags.port });
  const children: ChildProcess[] = [];

  const shutdown = () => {
    for (const child of children) {
      child.kill('SIGTERM');
    }
  };
  process.on('SIGINT', () => {
    shutdown();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    shutdown();
    process.exit(0);
  });

  if (flags.devServer) {
    console.log(`[uix-dev] starting dev server (npm run dev) in ${flags.cwd} ...`);
    const dev = spawn('npm', ['run', 'dev'], {
      cwd: flags.cwd,
      env: { ...process.env, ...plan.devServerEnv },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    children.push(dev);
    dev.on('exit', (code) => {
      console.error(`[uix-dev] dev server exited (${String(code)}); stopping tunnel.`);
      shutdown();
      process.exit(code ?? 1);
    });
  } else {
    console.log(
      `[uix-dev] --no-dev-server: expecting a server on port ${String(plan.port)}. ` +
        `Export VITE_UIX_EDIT_TOKEN=${plan.token} yourself for the gate to match.`,
    );
  }

  console.log('[uix-dev] opening Cloudflare quick tunnel (no account needed) ...');
  const tunnel = spawn('cloudflared', plan.cloudflaredArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(tunnel);

  let announced = false;
  const onChunk = async (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    process.stderr.write(text);
    if (announced) {
      return;
    }
    const url = extractTunnelUrl(text);
    if (!url) {
      return;
    }
    announced = true;
    const editUrl = buildEditUrl(url, plan.token);
    console.log('\n──────────────────────────────────────────────────────');
    console.log('  Quick tunnel is up. HTTPS + WSS, HMR flows through.');
    console.log(`\n  Runtime  : ${url}`);
    await printQr(url);
    console.log(`\n  EDIT MODE: ${editUrl}`);
    await printQr(editUrl);
    console.log('  Scan the second code on the headset to open an edit session.');
    console.log('  URL and token are minted per run - Ctrl+C invalidates both.');
    console.log('──────────────────────────────────────────────────────\n');
  };
  tunnel.stderr?.on('data', onChunk);
  tunnel.stdout?.on('data', onChunk);
  tunnel.on('error', () => {
    console.error(
      '[uix-dev] could not start cloudflared - is it installed? Run `uix-dev doctor`.',
    );
    shutdown();
    process.exit(1);
  });
  tunnel.on('exit', (code) => {
    console.error(`[uix-dev] tunnel exited (${String(code)}).`);
    shutdown();
    process.exit(code ?? 1);
  });

  return new Promise<number>(() => {
    // Runs until Ctrl+C or a child exits - handlers above end the process.
  });
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'tunnel':
      return runTunnel(rest);
    case 'doctor':
      return runDoctor();
    case 'qr': {
      const url = rest[0];
      if (!url) {
        console.error('Usage: uix-dev qr <url>');
        return 1;
      }
      await printQr(url);
      return 0;
    }
    default:
      console.log(
        [
          'uix-dev - IWSDK UI Extensions dev tooling',
          '',
          'Usage:',
          '  uix-dev tunnel [--port N] [--cwd DIR] [--no-dev-server]',
          '  uix-dev doctor',
          '  uix-dev qr <url>',
        ].join('\n'),
      );
      return command === undefined || command === 'help' ? 0 : 1;
  }
}
