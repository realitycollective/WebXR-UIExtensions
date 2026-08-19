import { fileURLToPath } from "node:url";
import { compileUIKit } from "@iwsdk/vite-plugin-uikitml";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [compileUIKit({ sourceDir: "ui", outputDir: "public/ui", verbose: true })],
  resolve: {
    alias: {
      // Consume the library from source so dev/build never need a prebuilt dist.
      "@realitycollective/webxr-uiextensions": fileURLToPath(
        new URL("../../packages/webxr-uiextensions/src/index.ts", import.meta.url),
      ),
      "@realitycollective/iwsdk-uiextensions": fileURLToPath(
        new URL("../../packages/iwsdk-uiextensions/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 8081,
    // Allow Cloudflare quick tunnels to front the dev server; when
    // `uix-dev tunnel` drives (UIX_DEV_TUNNEL=1) HMR flows over wss:443.
    allowedHosts: [".trycloudflare.com"],
    ...(process.env.UIX_DEV_TUNNEL
      ? { hmr: { protocol: "wss", clientPort: 443 } }
      : {}),
  },
  build: {
    outDir: "dist",
    target: "esnext",
    sourcemap: true,
  },
  esbuild: { target: "esnext" },
  publicDir: "public",
  base: "./",
});
