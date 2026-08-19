/**
 * Consumer-path verification: prove the PUBLISHED artifact works.
 *
 * Everything else in this repo resolves `@realitycollective/...` to
 * `packages/<name>/src` - the demos through Vite aliases, the tests and the
 * typecheck through tsconfig/vitest paths. That is fast and correct for
 * contributors, but it means nothing here ever exercises what a consumer
 * actually installs: the built `dist`, the `exports` map, the `files`
 * allow-list, the `bin` entries and the dependency ranges.
 *
 * This script closes that gap. It packs every package exactly as the publish
 * workflow does, installs the tarballs into a throwaway project outside the
 * repo, and asserts the result is usable. It is the only check that would
 * catch a package which builds green but ships broken.
 *
 * Usage:  npm run verify:pack [-- --skip-build]
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = [
  'webxr-uiextensions',
  'iwsdk-uiextensions',
  'xrblocks-uiextensions',
  'uix-devtools',
];

const skipBuild = process.argv.includes('--skip-build');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const failures = [];

function run(cmd, args, cwd, label) {
  try {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
    const tail = out ? out.split(/\r?\n/).slice(-12).join('\n') : err.message;
    throw new Error(`${label} failed:\n${tail}`);
  }
}

/**
 * Node >= 20 refuses to spawn `npm.cmd` through execFile (the .cmd hardening),
 * so prefer npm's own JS entry point, which npm exports while running a script.
 */
function npmRun(args, cwd, label) {
  const cli = process.env.npm_execpath;
  if (cli && cli.endsWith('.js')) return run(process.execPath, [cli, ...args], cwd, label);
  return run(npm, args, cwd, label);
}

function check(ok, message) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${message}`);
  if (!ok) failures.push(message);
}

function manifestOf(dir) {
  return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
}

const workdir = mkdtempSync(path.join(tmpdir(), 'uix-verify-'));
const tarballDir = path.join(workdir, 'tarballs');
const consumer = path.join(workdir, 'consumer');

try {
  await mkdir(tarballDir, { recursive: true });
  await mkdir(consumer, { recursive: true });

  if (!skipBuild) {
    console.log('building packages...');
    npmRun(['run', 'build'], ROOT, 'npm run build');
  }

  // The publish workflow copies the shared CHANGELOG in before packing.
  console.log('packing (as the publish workflow does)...');
  const copies = PACKAGES.map((name) => path.join(ROOT, 'packages', name, 'CHANGELOG.md'));
  for (const dest of copies) cpSync(path.join(ROOT, 'CHANGELOG.md'), dest);
  try {
    for (const name of PACKAGES) {
      npmRun(
        ['pack', '--workspace', `@realitycollective/${name}`, '--pack-destination', tarballDir],
        ROOT,
        `npm pack ${name}`,
      );
    }
  } finally {
    for (const dest of copies) rmSync(dest, { force: true });
  }

  const tarballs = PACKAGES.map((name) => {
    const { version } = manifestOf(path.join(ROOT, 'packages', name));
    return path.join(tarballDir, `realitycollective-${name}-${version}.tgz`);
  });

  console.log('installing the tarballs into a clean project...');
  writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify({ name: 'uix-consumer-check', private: true, type: 'module' }, null, 2),
  );
  // legacy-peer-deps mirrors the repo .npmrc (xrblocks vs super-three peer clash).
  npmRun(['install', ...tarballs, '--legacy-peer-deps'], consumer, 'npm install (tarballs)');

  console.log('');
  console.log('verifying the installed packages:');
  for (const name of PACKAGES) {
    const dir = path.join(consumer, 'node_modules', '@realitycollective', name);
    const manifest = manifestOf(dir);

    // every entry point named by main/types/exports must physically exist
    const entries = new Set();
    if (manifest.main) entries.add(manifest.main);
    if (manifest.types) entries.add(manifest.types);
    for (const target of Object.values(manifest.exports ?? {})) {
      if (typeof target === 'string') entries.add(target);
      else for (const value of Object.values(target)) {
        if (typeof value === 'string') entries.add(value);
      }
    }
    for (const rel of entries) {
      check(existsSync(path.join(dir, rel)), `${name}: ${rel} present`);
    }

    // a declared binary with no file behind it installs as a dangling shim
    for (const [bin, rel] of Object.entries(manifest.bin ?? {})) {
      check(existsSync(path.join(dir, rel)), `${name}: bin "${bin}" -> ${rel} present`);
    }

    // a bare "*" range on a sibling only ever resolves inside the workspace
    for (const type of ['dependencies', 'peerDependencies']) {
      for (const [dep, range] of Object.entries(manifest[type] ?? {})) {
        if (dep.startsWith('@realitycollective/')) {
          check(range !== '*', `${name}: ${dep} range "${range}" is publishable (not "*")`);
        }
      }
    }

    check(existsSync(path.join(dir, 'LICENSE')), `${name}: LICENSE shipped`);
    check(existsSync(path.join(dir, 'CHANGELOG.md')), `${name}: CHANGELOG shipped`);
  }

  // the engine-free core must import and expose its surface in plain node
  const coreEntry = path.join(
    consumer, 'node_modules', '@realitycollective', 'webxr-uiextensions', 'dist', 'index.js',
  );
  const core = await import(pathToFileURL(coreEntry).href);
  check(Object.keys(core).length > 0, `core imports in plain node (${Object.keys(core).length} exports)`);

  // the devtools CLI must launch through its published bin
  const cliBin = path.join(
    consumer, 'node_modules', '@realitycollective', 'uix-devtools', 'bin', 'uix-dev.mjs',
  );
  const cliOut = run(process.execPath, [cliBin, 'help'], consumer, 'uix-dev help');
  check(/uix-dev/.test(cliOut), 'uix-dev CLI runs from the installed package');
} catch (err) {
  console.log('');
  console.log(`  FAIL  ${err.message}`);
  failures.push(err.message);
} finally {
  rmSync(workdir, { recursive: true, force: true });
}

console.log('');
if (failures.length > 0) {
  console.error(`verify:pack FAILED - ${failures.length} problem(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('verify:pack passed - the published artifact is consumable.');
