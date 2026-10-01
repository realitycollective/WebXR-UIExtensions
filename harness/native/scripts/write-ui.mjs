// Fill harness/native/ui/ with the panels the native host cooks: the showcase's own panels
// (demos/showcase/public/ui/*.uikitml, copied unchanged) and rc-kit-chrome.uikitml, the window the
// host conformance kit opens, built from the core's WINDOW_CHROME_SNIPPET so it carries the
// contractual chrome ids (WINDOW_CHROME_IDS). Nothing is added to the showcase's folder.
// Run after changing either source: node harness/native/scripts/write-ui.mjs
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const target = resolve(here, "../ui");
const work = resolve(here, "../build/ui");
mkdirSync(work, { recursive: true });

const bundle = resolve(work, "chrome.cjs");
await build({
  stdin: { contents: 'export { WINDOW_CHROME_SNIPPET, WINDOW_CHROME_IDS } from "@realitycollective/webxr-uiextensions";', resolveDir: root, loader: "ts" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2022",
  outfile: bundle,
  alias: { "@realitycollective/webxr-uiextensions": resolve(root, "packages/webxr-uiextensions/src/index.ts") },
  logLevel: "warning",
});
const core = createRequire(import.meta.url)(bundle);

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
const source = resolve(root, "demos/showcase/public/ui");
const panels = readdirSync(source).filter((name) => name.endsWith(".uikitml"));
for (const name of panels) copyFileSync(resolve(source, name), resolve(target, name));

const chrome = `<style>
  .uix-window { display: flex; flex-direction: column; width: 100%; background-color: #101c2b; border-radius: 12; }
  .uix-titlebar { display: flex; flex-direction: row; justify-content: space-between; align-items: center; padding: 8; background-color: #1a2f47; }
  .uix-title { font-size: 12; font-weight: bold; color: #dce9f7; }
  .uix-titlebar-buttons { display: flex; flex-direction: row; }
  .uix-titlebar-button { padding: 4; margin-left: 4; font-size: 10; color: #dce9f7; background-color: #24405e; }
  .uix-content { display: flex; flex-direction: column; width: 100%; padding: 10; }
</style>
${core.WINDOW_CHROME_SNIPPET.trim().replace("<!-- window body goes here -->", '<span id="kit-body">kit</span>')}
`;
writeFileSync(resolve(target, "rc-kit-chrome.uikitml"), chrome);
console.log(JSON.stringify({ step: "ui", folder: target, showcasePanels: panels, kit: "rc-kit-chrome.uikitml", chromeIds: Object.values(core.WINDOW_CHROME_IDS) }));
