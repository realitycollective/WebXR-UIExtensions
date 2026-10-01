// Compile the native harness the way the conversion pipeline does, and stop there: bundle entry.ts
// with esbuild (IIFE, ES2020, no browser, no engine), gate the bundle (no three.js, @iwsdk or @pmndrs code,
// no browser global outside the host profile), and compile it to Hermes bytecode with the flags the
// pipeline uses, so a bundle the device's engine would refuse fails here. It never runs the bundle:
// a native build runs only on a developer's machine or a headset, never in CI.
// usage: node harness/native/compile.mjs [--require-hermes] [--no-hermes]
import { build, transform } from "esbuild";
import ts from "typescript";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const args = process.argv.slice(2);
const out = resolve(here, "build/node");
mkdirSync(out, { recursive: true });

// 1. Bundle. Every Reality Collective package resolves to THIS repository's source, so the harness
// proves the working tree, not a published preview.
const pkg = (name) => resolve(root, "packages", name, "src/index.ts");
const outfile = resolve(out, "harness.js");
const result = await build({
  entryPoints: [resolve(here, "entry.ts")],
  bundle: true,
  platform: "neutral",
  format: "iife",
  target: "es2020",
  outfile,
  mainFields: ["module", "main"],
  conditions: ["import", "default"],
  alias: {
    "@realitycollective/webxr-uiextensions": pkg("webxr-uiextensions"),
    "@realitycollective/native-uiextensions": pkg("native-uiextensions"),
  },
  metafile: true,
  logLevel: "warning",
  define: { "process.env.NODE_ENV": '"production"' },
});
const inputs = Object.keys(result.metafile.inputs).map((p) => p.replace(/\\/g, "/"));
const forbidden = inputs.filter((p) => /node_modules\/(three|super-three|@iwsdk|@pmndrs)\//.test(p) || /\/three\/build\//.test(p));
if (forbidden.length) {
  console.error(`harness: the bundle contains engine code: ${forbidden.join(", ")}`);
  process.exit(1);
}

// 2. The host-profile gate: no browser global named as a free identifier. The prelude reaches the
// shell's objects as properties of globalThis, so `__rcHost` and `__rcShell` never appear bare.
const source = readFileSync(outfile, "utf8");
// Parse the bundle and look at identifiers, not text: every local binding is renamed first (for this
// check only), so the core's own `window` record variables cannot be mistaken for the browser's, and
// strings and comments are never read. A property name (`x.window`, `{ window: 1 }`, `({ window: w }) => w`) is not a global.
const checked = (await transform(source, { minifyIdentifiers: true, target: "es2020", legalComments: "none" })).code;
const browserGlobals = new Set(["window", "document", "navigator", "fetch", "XMLHttpRequest", "requestAnimationFrame", "localStorage", "Intl"]);
const found = new Set();
const tree = ts.createSourceFile("harness.js", checked, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS);
(function visit(node) {
  if (ts.isIdentifier(node) && browserGlobals.has(node.text)) {
    const p = node.parent;
    const isName = (ts.isPropertyAccessExpression(p) && p.name === node) || ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p)) && p.name === node) || (ts.isBindingElement(p) && p.propertyName === node);
    if (!isName) found.add(node.text);
  }
  ts.forEachChild(node, visit);
})(tree);
const bare = [...found];
if (bare.length) {
  console.error(`harness: the bundle names browser globals outside the host profile: ${bare.join(", ")}`);
  process.exit(1);
}
console.log(JSON.stringify({ step: "bundle", bytes: source.length, inputFiles: inputs.length, packages: [...new Set(inputs.map((p) => (p.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/) ?? [])[1]).filter(Boolean))].sort() }));

// 3. Hermes bytecode, when the compiler is installed (npm i -D hermes-compiler): the same flags the
// pipeline uses; a bundle hermesc refuses would refuse on the device.
if (!args.includes("--no-hermes")) {
  const hermesc = findHermesc();
  if (hermesc) {
    const hbc = resolve(out, "harness.hbc");
    execFileSync(hermesc, ["-O", "-Xes6-block-scoping", "-emit-binary", "-out", hbc, outfile], { stdio: ["ignore", "inherit", "pipe"] });
    console.log(JSON.stringify({ step: "hermes", hbc, bytes: readFileSync(hbc).length }));
  } else if (args.includes("--require-hermes")) {
    console.error("harness: hermes-compiler is not installed (npm ci installs it as a devDependency)");
    process.exit(1);
  } else {
    console.log(JSON.stringify({ step: "hermes", skipped: "hermes-compiler is not installed" }));
  }
}

console.log(JSON.stringify({ step: "compiled", bundle: outfile }));

// hermes-compiler ships every platform's binary, so take this machine's, never the first that exists:
// on a Linux runner the Windows .exe exists too, and the shell refuses it.
function findHermesc() {
  const sub = process.platform === "win32" ? "win64-bin/hermesc.exe" : process.platform === "darwin" ? "osx-bin/hermesc" : "linux64-bin/hermesc";
  const hermesc = resolve(root, "node_modules/hermes-compiler/hermesc", sub);
  return existsSync(hermesc) ? hermesc : null;
}
