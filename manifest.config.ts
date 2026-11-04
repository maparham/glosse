import { defineManifest } from "@crxjs/vite-plugin";
import { loadEnv } from "vite";

// Build-time defaults from .env.local (gitignored). A custom API host baked in
// this way also needs a host permission, so it is added to the manifest here.
const env = loadEnv(process.env.NODE_ENV ?? "production", process.cwd(), "VITE_");
const bakedHost = (() => {
  try {
    return env.VITE_GLOSSE_API_BASE_URL ? new URL(env.VITE_GLOSSE_API_BASE_URL).origin + "/*" : null;
  } catch {
    return null;
  }
})();
const hosts = ["https://www.youtube.com/*", "https://api.anthropic.com/*"];
if (bakedHost && !hosts.includes(bakedHost)) hosts.push(bakedHost);

export default defineManifest({
  manifest_version: 3,
  name: "Glosse: literal German subtitles",
  version: "0.2.0",
  description:
    "Literal, word-order-preserving English gloss under German YouTube subtitles, powered by the Claude API with your own key.",
  permissions: ["storage"],
  host_permissions: hosts,
  // A custom API base URL entered later is granted on demand from the options page.
  optional_host_permissions: ["https://*/*", "http://*/*"],
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
