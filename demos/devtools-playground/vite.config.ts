import { fileURLToPath } from "node:url";
import { compileUIKit } from "@iwsdk/vite-plugin-uikitml";
import { defineConfig } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The playground IS the showcase scene — same UIKitML, same public assets —
// plus the uix-devtools edit gate. It deliberately has no panels of its own:
// the editor window is compiled AT RUNTIME by @realitycollective/uix-devtools.
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
      // Consume the libraries from source so dev/build never need a dist.
      "@realitycollective/webxr-uiextensions": here(
        "../../packages/webxr-uiextensions/src/index.ts",
      ),
      "@realitycollective/iwsdk-uiextensions": here(
        "../../packages/iwsdk-uiextensions/src/index.ts",
      ),
      "@realitycollective/uix-devtools": here(
        "../../packages/uix-devtools/src/index.ts",
      ),
      "@showcase": here("../showcase/src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 8081,
    // Cloudflare quick tunnels front the dev server with a random
    // *.trycloudflare.com hostname — allow it, and when `uix-dev tunnel`
    // is driving (UIX_DEV_TUNNEL=1) point the HMR client at wss:443 so hot
    // reload flows through the tunnel instead of the local port.
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
  publicDir: "../showcase/public",
  base: "./",
});
