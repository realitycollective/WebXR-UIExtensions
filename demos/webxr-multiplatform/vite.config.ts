import { fileURLToPath } from "node:url";
import { compileUIKit } from "@iwsdk/vite-plugin-uikitml";
import { defineConfig } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The multiplatform demo reuses the showcase's UIKitML + assets so all three
// demo clients exercise the same panels; both engine pipelines are code-split
// and only the detected one is loaded at runtime.
export default defineConfig({
  plugins: [
    compileUIKit({
      sourceDir: "../showcase/ui",
      outputDir: "../showcase/public/ui",
      verbose: true,
    }),
  ],
  resolve: {
    alias: {
      "@realitycollective/webxr-uiextensions": here(
        "../../packages/webxr-uiextensions/src/index.ts",
      ),
      "@realitycollective/iwsdk-uiextensions": here(
        "../../packages/iwsdk-uiextensions/src/index.ts",
      ),
      "@realitycollective/xrblocks-uiextensions": here(
        "../../packages/xrblocks-uiextensions/src/index.ts",
      ),
      "@realitycollective/uix-devtools": here(
        "../../packages/uix-devtools/src/index.ts",
      ),
      "@showcase": here("../showcase/src"),
      "@playground": here("../devtools-playground/src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 8081,
    allowedHosts: [".trycloudflare.com"],
    ...(process.env.UIX_DEV_TUNNEL
      ? { hmr: { protocol: "wss", clientPort: 443 } }
      : {}),
  },
  // xrblocks lazily imports optional integrations that this demo never uses
  // (see build.rollupOptions.external below). Excluding it from dependency
  // pre-bundling keeps those imports unevaluated instead of failing esbuild
  // at dev-server start.
  optimizeDeps: {
    exclude: ["xrblocks"],
  },
  build: {
    outDir: "dist",
    target: "esnext",
    sourcemap: true,
    rollupOptions: {
      // xrblocks lazily imports optional integrations (AI, MediaPipe,
      // gaussian splats, text rendering, physics helpers). This demo uses
      // none of those features, so the modules stay unresolved - xrblocks
      // only touches them behind the corresponding feature options.
      // (three-pathfinding ships as a real dependency of xrblocks and DOES
      // resolve; it is deliberately not externalized.)
      external: [
        "@google/genai",
        "openai",
        "@mediapipe/tasks-audio",
        "@mediapipe/tasks-vision",
        "@sparkjsdev/spark",
        "three-mesh-bvh",
        "troika-three-text",
      ],
    },
  },
  esbuild: { target: "esnext" },
  publicDir: "../showcase/public",
  base: "./",
});
