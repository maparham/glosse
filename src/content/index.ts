import { observeRenderedCaptions, parseTimedText, trackInfo } from "./capture";
import { mountOverlay, type OverlayState } from "./overlay";
import { glossKey } from "../shared/hash";
import { loadSettings, onSettingsChange, saveSettings } from "../shared/settings";
import type { BackgroundResponse, Cue, Gloss, GlossRequestItem, Settings, TimedTextMessage } from "../shared/types";

const BATCH = 5;
const MAX_IN_FLIGHT = 2;

let settings: Settings;
let cues: Cue[] = [];
let videoId: string | null = null;
const glosses = new Map<string, Gloss>();
const pending = new Set<string>();
let inFlight = 0;
let renderPanel: ((s: OverlayState) => void) | null = null;
let stopDomFallback: (() => void) | null = null;
let hideNativeStyle: HTMLStyleElement | null = null;

const state: OverlayState = {
  cue: null, gloss: null, status: null, error: null, hint: null,
  settings: undefined as unknown as Settings,
};

function draw() {
  state.settings = settings;
  renderPanel?.(state);
}

function keyFor(text: string) {
  return glossKey(text, settings.glossModel, settings.level, settings.glossStyle);
}

function currentVideoId(): string | null {
  return new URLSearchParams(location.search).get("v");
}

function player(): HTMLElement | null {
  return document.querySelector<HTMLElement>("#movie_player");
}

function video(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>("video.html5-main-video");
}

function hideNativeCaptions(hide: boolean) {
  if (hide && !hideNativeStyle) {
    hideNativeStyle = document.createElement("style");
    hideNativeStyle.textContent = ".ytp-caption-window-container{display:none!important}";
    document.head.appendChild(hideNativeStyle);
  } else if (!hide && hideNativeStyle) {
    hideNativeStyle.remove();
    hideNativeStyle = null;
  }
}

/** Ask the background for glosses of the given cues, batched, at most two batches out. */
async function requestGloss(targets: Cue[]) {
  const items: GlossRequestItem[] = [];
  for (const c of targets) {
    const key = keyFor(c.text);
    if (glosses.has(key) || pending.has(key)) continue;
    items.push({
      key,
      text: c.text,
      prev: cues[c.index - 1]?.text ?? "",
      next: cues[c.index + 1]?.text ?? "",
    });
  }
  while (items.length && inFlight < MAX_IN_FLIGHT) {
    const batch = items.splice(0, BATCH);
    batch.forEach((b) => pending.add(b.key));
    inFlight++;
    chrome.runtime
      .sendMessage({ type: "gloss", items: batch })
      .then((res: BackgroundResponse) => {
        if (res.type !== "gloss") return;
        for (const [k, g] of Object.entries(res.results)) glosses.set(k, g);
        state.error = res.error ?? null;
      })
      .catch((e: unknown) => {
        state.error = e instanceof Error ? e.message : String(e);
      })
      .finally(() => {
        batch.forEach((b) => pending.delete(b.key));
        inFlight--;
        sync();
      });
  }
}

function findCue(t: number): Cue | null {
  // Cues are sorted by start; a short linear scan from the end is fine at subtitle sizes.
  for (let i = cues.length - 1; i >= 0; i--) {
    if (cues[i].start <= t) return t < cues[i].end + 0.25 ? cues[i] : null;
  }
  return null;
}

function sync() {
  if (!settings.enabled) { state.cue = null; draw(); return; }
  const v = video();
  if (!v || cues.length === 0) { draw(); return; }
  const cue = findCue(v.currentTime);
  state.cue = cue;
  if (cue) {
    const key = keyFor(cue.text);
    state.gloss = glosses.get(key) ?? null;
    state.status = state.gloss ? null : pending.has(key) ? "glossing…" : "waiting…";
    requestGloss(cues.slice(cue.index, cue.index + 1 + settings.lookahead));
  } else {
    state.gloss = null;
    // Keep the pipeline warm for the next cue.
    const next = cues.find((c) => c.start > v.currentTime);
    if (next) requestGloss(cues.slice(next.index, next.index + 1 + settings.lookahead));
  }
  draw();
}

function setCues(next: Cue[], hint: string | null) {
  cues = next;
  state.hint = hint;
  state.error = null;
  stopDomFallback?.();
  stopDomFallback = null;
  hideNativeCaptions(cues.length > 0);
  sync();
}

/** The MAIN-world script hands us the player's own caption fetches. */
window.addEventListener("message", (ev: MessageEvent<TimedTextMessage>) => {
  const m = ev.data;
  if (ev.source !== window || !m || m.source !== "glosse" || m.type !== "timedtext") return;
  const info = trackInfo(m.url);
  if (info.tlang) {
    setCues([], "Auto-translate is on. Pick the German subtitle track itself (Settings → Subtitles → Deutsch).");
    return;
  }
  if (info.lang && !info.lang.toLowerCase().startsWith("de")) {
    setCues([], `Subtitle track is "${info.lang}". Switch to the German track.`);
    return;
  }
  const parsed = parseTimedText(m.body);
  if (parsed.length === 0) {
    startDomFallback();
    return;
  }
  setCues(parsed, info.kind === "asr" ? "Auto-generated captions: punctuation may be missing." : null);
});

/** No usable track data: read the rendered caption text instead, one cue at a time. */
function startDomFallback() {
  if (stopDomFallback) return;
  state.hint = "Reading captions from the player. Turn on German subtitles for the best results.";
  let idx = 0;
  stopDomFallback = observeRenderedCaptions((text) => {
    const v = video();
    const t = v?.currentTime ?? 0;
    const cue: Cue = { index: idx++, start: t, end: t + 6, text };
    cues = [...cues.slice(-20), cue];
    sync();
  });
}

function onNavigate() {
  const id = currentVideoId();
  if (id === videoId) return;
  videoId = id;
  cues = [];
  state.cue = null; state.gloss = null; state.hint = null; state.error = null;
  hideNativeCaptions(false);
  stopDomFallback?.(); stopDomFallback = null;
  if (!id) { draw(); return; }
  attach();
}

let attached = false;
function attach() {
  const p = player();
  const v = video();
  if (!p || !v) { setTimeout(attach, 500); return; }
  renderPanel = mountOverlay(p);
  if (!attached) {
    attached = true;
    v.addEventListener("timeupdate", sync);
    v.addEventListener("seeking", sync);
  }
  // If the player already has captions on and we missed the fetch, fall back after a moment.
  setTimeout(() => { if (cues.length === 0 && videoId) startDomFallback(); }, 4000);
  draw();
}

function onKey(ev: KeyboardEvent) {
  const t = ev.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  if (ev.key === "g" || ev.key === "G") {
    saveSettings({ enabled: !settings.enabled });
  } else if (ev.key === "[" || ev.key === "]") {
    const v = video();
    if (!v || !cues.length) return;
    const cur = findCue(v.currentTime);
    const i = cur ? cur.index + (ev.key === "]" ? 1 : -1) : 0;
    const target = cues[Math.max(0, Math.min(cues.length - 1, i))];
    v.currentTime = target.start + 0.01;
    v.play();
  }
}

(async () => {
  settings = await loadSettings();
  onSettingsChange((s) => {
    const modelChanged = s.glossModel !== settings.glossModel || s.level !== settings.level || s.glossStyle !== settings.glossStyle;
    settings = s;
    if (modelChanged) glosses.clear();
    hideNativeCaptions(s.enabled && cues.length > 0);
    sync();
  });
  document.addEventListener("yt-navigate-finish", onNavigate);
  document.addEventListener("keydown", onKey);
  onNavigate();
})();
