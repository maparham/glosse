import { glossBatch } from "./claude";
import { getGlosses, putGlosses } from "./cache";
import { loadSettings } from "../shared/settings";
import type { BackgroundRequest, BackgroundResponse, Gloss } from "../shared/types";

/** Requests already on their way to the API, so a seek does not duplicate work. */
const inFlight = new Map<string, Promise<Record<string, Gloss>>>();

async function handleGloss(items: BackgroundRequest & { type: "gloss" }): Promise<BackgroundResponse> {
  const settings = await loadSettings();
  if (!settings.apiKey) {
    return { type: "gloss", results: {}, error: "No API key. Open the extension options and add your Claude API key." };
  }

  const keys = items.items.map((i) => i.key);
  const cached = await getGlosses(keys);
  const results: Record<string, Gloss> = {};
  cached.forEach((v, k) => (results[k] = v));

  const missing = items.items.filter((i) => !cached.has(i.key));
  if (missing.length === 0) return { type: "gloss", results };

  const batchKey = missing.map((m) => m.key).join("|");
  let promise = inFlight.get(batchKey);
  if (!promise) {
    promise = glossBatch(missing, settings).finally(() => inFlight.delete(batchKey));
    inFlight.set(batchKey, promise);
  }

  try {
    const fresh = await promise;
    await putGlosses(Object.entries(fresh));
    Object.assign(results, fresh);
    return { type: "gloss", results };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { type: "gloss", results, error: message };
  }
}

chrome.runtime.onMessage.addListener((msg: BackgroundRequest, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "gloss":
        sendResponse(await handleGloss(msg));
        break;
      case "getSettings":
        sendResponse({ type: "settings", settings: await loadSettings() } satisfies BackgroundResponse);
        break;
    }
  })();
  return true; // keep the channel open for the async response
});

chrome.runtime.onInstalled.addListener(async () => {
  const s = await loadSettings();
  if (!s.apiKey) chrome.runtime.openOptionsPage();
});
