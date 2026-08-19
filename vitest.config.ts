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
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["packages/*/test/**/*.test.ts", "demos/*/test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      all: true,
      // Coverage is gated on the pure, headless-testable modules:
      //  - the library's core/ (ECS systems + widget upgraders are exercised
      //    through the same core but need a live IWSDK world, which CI lacks)
      //  - the devtools' gate, runtime compiler and CLI logic (process
      //    orchestration in cli/main.ts is intentionally thin and excluded).
      include: [
        "packages/webxr-uiextensions/src/core/**/*.ts",
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
