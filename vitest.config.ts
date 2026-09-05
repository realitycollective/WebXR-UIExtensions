import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@realitycollective/webxr-uiextensions": pkg(
        "./packages/webxr-uiextensions/src/index.ts",
      ),
      "@realitycollective/iwsdk-uiextensions": pkg(
        "./packages/iwsdk-uiextensions/src/index.ts",
      ),
      "@realitycollective/xrblocks-uiextensions": pkg(
        "./packages/xrblocks-uiextensions/src/index.ts",
      ),
      // The multiplatform demo reads the showcase's scene descriptor under
      // this alias, matching its own vite and tsconfig paths.
      "@showcase": pkg("./demos/showcase/src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["packages/*/test/**/*.test.ts", "demos/*/test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      all: true,
      // Coverage is gated on the modules that can be driven headlessly:
      //  - the library's core/, plus the shipped WindowHost conformance
      //    cases, which are ordinary engine-free logic and public API
      //  - the IWSDK adapter's factories and scene host. `new World()` from
      //    @iwsdk/core constructs with no renderer and no WebGL, so their
      //    entities, components and ECS query all run for real in node. The
      //    per-frame ECS SYSTEMS still need a live world and stay out.
      //  - the devtools' gate, runtime compiler and CLI logic (process
      //    orchestration in cli/main.ts is intentionally thin and excluded).
      include: [
        "packages/webxr-uiextensions/src/core/**/*.ts",
        "packages/webxr-uiextensions/src/contract-cases.ts",
        "packages/iwsdk-uiextensions/src/factory.ts",
        "packages/iwsdk-uiextensions/src/scene-host.ts",
        "packages/uix-devtools/src/gate.ts",
        "packages/uix-devtools/src/runtime-compile.ts",
        "packages/uix-devtools/src/cli/lib.ts",
      ],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
