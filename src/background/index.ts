import { glossBatch } from "./claude";
import { getExplanation, getGlosses, putExplanation, putGlosses, saveVocab } from "./cache";
import { explain, followUp } from "./explain";
import { loadSettings } from "../shared/settings";
import type { BackgroundRequest, BackgroundResponse, ExplainPortRequest, ExplainPortResponse, Gloss } from "../shared/types";

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

/** Explanations and follow-ups run over a port so answers can stream back. */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "explain") return;
  const send = (m: ExplainPortResponse) => {
    try { port.postMessage(m); } catch { /* popover closed */ }
  };
  port.onMessage.addListener(async (msg: ExplainPortRequest) => {
    const settings = await loadSettings();
    if (msg.type === "save") {
      try { await saveVocab(msg.entry); send({ type: "saved", ok: true }); }
      catch { send({ type: "saved", ok: false }); }
      return;
    }
    if (!settings.apiKey) {
      send({ type: "explain-error", id: msg.id, error: "No API key. Open the extension options and add your Claude API key." });
      return;
    }
    if (msg.type === "explain") {
      const key = `e3:${settings.explainModel}:${settings.level}:${msg.ctx.selection}\u0000${msg.ctx.cue}`;
      try {
        const cached = await getExplanation(key);
        if (cached) { send({ type: "explain-result", id: msg.id, explanation: cached, cached: true }); return; }
        const explanation = await explain(msg.ctx, settings);
        await putExplanation(key, explanation);
        send({ type: "explain-result", id: msg.id, explanation, cached: false });
      } catch (e) {
        send({ type: "explain-error", id: msg.id, error: e instanceof Error ? e.message : String(e) });
      }
    } else if (msg.type === "followup") {
      try {
        await followUp(msg.ctx, msg.explanation, msg.history, msg.question, settings, (text) =>
          send({ type: "followup-delta", id: msg.id, text }));
        send({ type: "followup-done", id: msg.id });
      } catch (e) {
        send({ type: "explain-error", id: msg.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
  });
});

chrome.runtime.onInstalled.addListener(async () => {
  const s = await loadSettings();
  if (!s.apiKey) chrome.runtime.openOptionsPage();
});
