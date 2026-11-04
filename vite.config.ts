import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config.ts";

export default defineConfig({
  plugins: [crx({ manifest })],
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  build: { target: "es2022", sourcemap: false },
});
