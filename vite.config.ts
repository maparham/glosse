import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config.ts";

export default defineConfig({
  // Bundle the content script into one file. The default loader pulls it in with a
  // dynamic import(), which Chrome reports as an "Unsafe attempt to load URL" error.
  plugins: [crx({ manifest, contentScripts: { standaloneFiles: ["src/content/index.ts"] } })],
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  build: { target: "es2022", sourcemap: false },
});
