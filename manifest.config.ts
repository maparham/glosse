import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Glosse: literal German subtitles",
  version: "0.1.0",
  description:
    "Literal, word-order-preserving English gloss under German YouTube subtitles, powered by the Claude API with your own key.",
  permissions: ["storage"],
  host_permissions: ["https://www.youtube.com/*", "https://api.anthropic.com/*"],
  background: { service_worker: "src/background/index.ts", type: "module" },
  options_page: "src/options/index.html",
  content_scripts: [
    {
      matches: ["https://www.youtube.com/*"],
      js: ["src/content/main-world.iife.ts"],
      run_at: "document_start",
      world: "MAIN",
    },
    {
      matches: ["https://www.youtube.com/*"],
      js: ["src/content/index.ts"],
      run_at: "document_idle",
    },
  ],
});
