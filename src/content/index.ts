import { observeRenderedCaptions, parseTimedText, rollingLines, trackInfo } from "./capture";
import { mountBelowPanel, mountOverlay, unmountBelowPanel, type OverlayActions, type OverlayState } from "./overlay";
import type { PopoverState } from "./popover";
import { mountTranscript, unmountTranscript, type TranscriptProps } from "./transcript";
import { glossKey } from "../shared/hash";
import { loadPanelPos, loadSettings, onSettingsChange, savePanelPos, saveSettings } from "../shared/settings";
import type { BackgroundResponse, Cue, ExplainPortRequest, ExplainPortResponse, Gloss, GlossRequestItem, Settings, TimedTextMessage } from "../shared/types";

const BATCH = 5;
const MAX_IN_FLIGHT = 2;
/** Give up on a cue after this many failed or skipped attempts. */
const MAX_ATTEMPTS = 3;
const BACKOFF_MIN_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;

let settings: Settings;
let cues: Cue[] = [];
let videoId: string | null = null;
let domFallbackMode = false;
const glosses = new Map<string, Gloss>();
const pending = new Set<string>();
const attempts = new Map<string, number>();
/** text -> cache key, cleared when model, level or style change. */
const keyCache = new Map<string, string>();
let inFlight = 0;
let version = 0;
let renderPanel: ((s: OverlayState) => void) | null = null;
let renderTranscript: ((p: TranscriptProps) => void) | null = null;
let stopDomFallback: (() => void) | null = null;
let hideNativeStyle: HTMLStyleElement | null = null;
let boundVideo: HTMLVideoElement | null = null;
let currentIndex = -1;
/** Set when the background reports a missing key; cleared when settings change. */
let apiBlocked = false;
/** Exponential backoff after an API error, so a 429 or outage is not hammered. */
let backoffMs = BACKOFF_MIN_MS;
let backoffUntil = 0;
let backoffTimer: number | undefined;
/** Transcript render memo. */
let drawnIndex = -2;
let drawnVersion = -1;
let glossedCount = 0;

const emptyPopover = (): PopoverState => ({
  open: false, selection: "", cue: "", explanation: null, error: null,
  startedAt: 0, history: [], streaming: null, saved: false,
});

const state: OverlayState = {
  cue: null, gloss: null, status: null, error: null, hint: null, hintFading: false, panelPos: null, panelBelow: false,
  settings: undefined as unknown as Settings,
  popover: emptyPopover(),
};

// ---- Explanations (phase 2) -------------------------------------------------

let explainPort: chrome.runtime.Port | null = null;
let explainSeq = 0;
let activeExplainId = "";
let hoveredWord: string | null = null;
/** True when we paused the video for the popover, so we resume on close. */
let pausedByUs = false;
let explainCtx: { selection: string; cue: string; prev: string; next: string } | null = null;

function port(): chrome.runtime.Port {
  if (explainPort) return explainPort;
  explainPort = chrome.runtime.connect({ name: "explain" });
  explainPort.onDisconnect.addListener(() => { explainPort = null; });
  explainPort.onMessage.addListener((m: ExplainPortResponse) => {
    const pop = state.popover;
    if (m.type === "saved") { pop.saved = m.ok; draw(); return; }
    if (m.id !== activeExplainId) return;
    switch (m.type) {
      case "explain-result": pop.explanation = m.explanation; pop.error = null; break;
      case "explain-error":
        if (pop.streaming !== null) { pop.streaming = null; }
        pop.error = m.error; break;
      case "followup-delta": pop.streaming = (pop.streaming ?? "") + m.text; break;
      case "followup-done":
        if (pop.streaming !== null) pop.history = [...pop.history, { q: pendingQuestion, a: pop.streaming }];
        pop.streaming = null; break;
    }
    draw();
  });
  return explainPort;
}
let pendingQuestion = "";

function send(m: ExplainPortRequest) {
  try { port().postMessage(m); }
  catch (e) { state.popover.error = e instanceof Error ? e.message : String(e); draw(); }
}

function openExplain(selection: string) {
  const cue = state.cue;
  if (!cue || !selection) return;
  const v = video();
  if (settings.pauseOnExplain && v && !v.paused) { v.pause(); pausedByUs = true; }
  explainCtx = { selection, cue: cue.text, prev: cues[cue.index - 1]?.text ?? "", next: cues[cue.index + 1]?.text ?? "" };
  activeExplainId = `x${++explainSeq}`;
  state.popover = { ...emptyPopover(), open: true, selection, cue: cue.text, startedAt: Date.now() };
  draw();
  send({ type: "explain", id: activeExplainId, ctx: explainCtx });
}

function closeExplain() {
  if (!state.popover.open) return;
  state.popover = emptyPopover();
  activeExplainId = "";
  const v = video();
  if (pausedByUs && v) v.play();
  pausedByUs = false;
  draw();
}

const overlayActions: OverlayActions = {
  explain: openExplain,
  hover: (w) => { hoveredWord = w; },
  movePanel: (pos) => {
    state.panelPos = pos;
    draw();
    void savePanelPos(pos);
  },
  close: closeExplain,
  ask: (question) => {
    const pop = state.popover;
    if (!pop.explanation || !explainCtx || pop.streaming !== null) return;
    pendingQuestion = question;
    pop.streaming = "";
    pop.error = null;
    draw();
    send({ type: "followup", id: activeExplainId, ctx: explainCtx, explanation: pop.explanation, history: pop.history, question });
  },
  save: () => {
    const pop = state.popover;
    if (!pop.explanation) return;
    const v = video();
    send({ type: "save", entry: {
      id: `${videoId ?? "x"}:${Math.round((v?.currentTime ?? 0) * 10)}:${pop.selection}`,
      selection: pop.selection, lemma: pop.explanation.lemma, meaning: pop.explanation.meaning_here,
      cue: pop.cue, videoId, time: v?.currentTime ?? 0, savedAt: Date.now(),
    } });
  },
};

const settingsLoaded = loadSettings().then((s) => (settings = s));
void settingsLoaded.then(loadPanelPos).then((pos) => { state.panelPos = pos; draw(); });

function keyFor(text: string): string {
  let k = keyCache.get(text);
  if (!k) {
    k = glossKey(text, settings.glossModel, settings.level, settings.glossStyle);
    keyCache.set(text, k);
  }
  return k;
}

function glossFor(cue: Cue): Gloss | null {
  return glosses.get(keyFor(cue.text)) ?? null;
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

/** Jump to a cue, then keep playing or hold paused on it. */
function seekTo(cue: Cue, pause = false) {
  const v = video();
  if (!v) return;
  v.currentTime = cue.start + 0.01;
  if (pause) v.pause(); else v.play();
}

function draw() {
  state.settings = settings;
  const renderBelow = settings.panelPlacement === "below" && !document.fullscreenElement ? mountBelowPanel(overlayActions) : null;
  if (!renderBelow && state.panelBelow) unmountBelowPanel();
  state.panelBelow = renderBelow !== null;
  renderPanel?.(state);
  renderBelow?.(state);
  const wantTranscript = settings.showTranscript && !domFallbackMode && cues.length > 0;
  if (!wantTranscript) {
    if (renderTranscript) { unmountTranscript(); renderTranscript = null; }
    return;
  }
  if (drawnIndex === currentIndex && drawnVersion === version && renderTranscript) return;
  renderTranscript ??= mountTranscript();
  if (!renderTranscript) return;
  if (drawnVersion !== version) {
    glossedCount = cues.reduce((n, c) => n + (glosses.has(keyFor(c.text)) ? 1 : 0), 0);
  }
  drawnIndex = currentIndex;
  drawnVersion = version;
  renderTranscript({ cues, glossFor, currentIndex, glossedCount, settings, onSeek: (c) => seekTo(c, true), version });
}

function noteFailure(keys: string[]) {
  for (const k of keys) attempts.set(k, (attempts.get(k) ?? 0) + 1);
}

/**
 * Pick what to gloss next: the lookahead window around the playhead first,
 * then, if enabled, the rest of the video from the playhead onward and
 * finally the part before it. Up to two batches of five are in flight.
 */
function fillQueue() {
  if (apiBlocked || Date.now() < backoffUntil) return;
  const from = Math.max(0, currentIndex);
  const order: Cue[] = cues.slice(from, from + 1 + settings.lookahead);
  if (settings.glossWholeVideo && !domFallbackMode) {
    order.push(...cues.slice(from + 1 + settings.lookahead), ...cues.slice(0, from));
  }
  const todo: GlossRequestItem[] = [];
  for (const c of order) {
    const key = keyFor(c.text);
    if (glosses.has(key) || pending.has(key) || (attempts.get(key) ?? 0) >= MAX_ATTEMPTS) continue;
    if (todo.some((t) => t.key === key)) continue;
    todo.push({ key, text: c.text, prev: cues[c.index - 1]?.text ?? "", next: cues[c.index + 1]?.text ?? "" });
    if (todo.length >= BATCH * (MAX_IN_FLIGHT - inFlight)) break;
  }
  while (todo.length && inFlight < MAX_IN_FLIGHT) {
    const batch = todo.splice(0, BATCH);
    const keys = batch.map((b) => b.key);
    keys.forEach((k) => pending.add(k));
    inFlight++;
    chrome.runtime
      .sendMessage({ type: "gloss", items: batch })
      .then((res: BackgroundResponse) => {
        if (res.type !== "gloss") return;
        for (const [k, g] of Object.entries(res.results)) glosses.set(k, g);
        state.error = res.error ?? null;
        if (res.error) {
          apiBlocked = res.error.startsWith("No API key");
          onApiError(keys);
        } else {
          backoffMs = BACKOFF_MIN_MS;
          // Cues the model skipped count as an attempt; after MAX_ATTEMPTS they are left unglossed.
          noteFailure(keys.filter((k) => !glosses.has(k)));
        }
      })
      .catch((e: unknown) => {
        state.error = e instanceof Error ? e.message : String(e);
        onApiError(keys);
      })
      .finally(() => {
        keys.forEach((k) => pending.delete(k));
        inFlight--;
        version++;
        sync();
      });
  }
}

function onApiError(keys: string[]) {
  noteFailure(keys);
  backoffUntil = Date.now() + backoffMs;
  clearTimeout(backoffTimer);
  backoffTimer = window.setTimeout(sync, backoffMs + 50);
  backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
}

function findCue(t: number): Cue | null {
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
    currentIndex = cue.index;
    const key = keyFor(cue.text);
    state.gloss = glosses.get(key) ?? null;
    state.status = state.gloss
      ? null
      : pending.has(key) ? "glossing…"
      : (attempts.get(key) ?? 0) >= MAX_ATTEMPTS ? "no gloss for this line"
      : Date.now() < backoffUntil ? "retrying soon…"
      : "waiting…";
  } else {
    state.gloss = null;
    const next = cues.find((c) => c.start > v.currentTime);
    if (next) currentIndex = next.index;
  }
  fillQueue();
  draw();
}

let hintTimers: number[] = [];

/** Show a hint; a transient one fades out after a few seconds. */
function setHint(hint: string | null, transient = false) {
  hintTimers.forEach(clearTimeout);
  hintTimers = [];
  state.hint = hint;
  state.hintFading = false;
  if (!hint || !transient) return;
  hintTimers.push(
    window.setTimeout(() => { state.hintFading = true; draw(); }, 5000),
    window.setTimeout(() => { state.hint = null; state.hintFading = false; draw(); }, 5600),
  );
}

function setCues(next: Cue[], hint: string | null, transientHint = false) {
  cues = next;
  domFallbackMode = false;
  setHint(hint, transientHint);
  state.error = null;
  stopDomFallback?.();
  stopDomFallback = null;
  hideNativeCaptions(settings.enabled && cues.length > 0);
  version++;
  sync();
}

/** The MAIN-world script hands us the player's own caption fetches. */
window.addEventListener("message", async (ev: MessageEvent<TimedTextMessage>) => {
  const m = ev.data;
  if (ev.source !== window || !m || m.source !== "glosse" || m.type !== "timedtext") return;
  await settingsLoaded;
  const info = trackInfo(m.url);
  // Not a German track (or an auto-translation into German): stay dormant.
  if (info.tlang || (info.lang && !info.lang.toLowerCase().startsWith("de"))) {
    setCues([], null);
    return;
  }
  const parsed = parseTimedText(m.body, info.kind === "asr");
  if (parsed.length === 0) {
    startDomFallback();
    return;
  }
  setCues(parsed, info.kind === "asr" ? "Auto-generated captions: punctuation may be missing." : null, true);
});

let trackQuerySeq = 0;

type PlayerTrack = { lang: string | null; tlang: string | null; kind: string | null };

/** Ask the MAIN-world script which caption track the player shows. Null if it does not answer. */
function queryTrack(): Promise<PlayerTrack | null> {
  const id = ++trackQuerySeq;
  return new Promise((resolve) => {
    const done = (r: PlayerTrack | null) => {
      window.removeEventListener("message", onReply);
      clearTimeout(timer);
      resolve(r);
    };
    const onReply = (ev: MessageEvent) => {
      const m = ev.data;
      if (ev.source === window && m?.source === "glosse" && m.type === "track" && m.id === id) done(m);
    };
    const timer = window.setTimeout(() => done(null), 500);
    window.addEventListener("message", onReply);
    window.postMessage({ source: "glosse", type: "track-query", id }, "*");
  });
}

function leaveDomFallback() {
  domFallbackMode = false;
  cues = [];
  currentIndex = -1;
  state.cue = null; state.gloss = null; setHint(null);
  hideNativeCaptions(false);
  version++;
  sync();
}

/**
 * No usable track data: read the rendered caption text instead, one cue at a time.
 * Silent until the player actually renders a caption, so videos without subtitles show nothing,
 * and silent unless the player confirms a German track, so other captions are left alone.
 * Auto-generated captions roll in word by word, so on those only finished lines become cues.
 */
function startDomFallback() {
  if (stopDomFallback) return;
  const addCue = (text: string) => {
    const t = video()?.currentTime ?? 0;
    if (!domFallbackMode) {
      domFallbackMode = true;
      cues = [];
      hideNativeCaptions(settings.enabled);
    }
    // index always equals the array position, which fillQueue relies on.
    cues = [...cues, { index: cues.length, start: t, end: t + 6, text }];
    sync();
  };
  const rolling = rollingLines(addCue);
  let hinted = false;
  const stopObserving = observeRenderedCaptions(async (lines) => {
    const track = await queryTrack();
    if (!stopDomFallback) return;
    if (!track || track.tlang || !track.lang?.toLowerCase().startsWith("de")) {
      if (domFallbackMode) leaveDomFallback();
      return;
    }
    if (track.kind === "asr") {
      rolling.push(lines);
      if (!hinted) { hinted = true; setHint("Auto-generated captions: each line appears once it is finished.", true); }
    } else if (lines.length) {
      addCue(lines.join(" "));
    }
  });
  stopDomFallback = () => { stopObserving(); rolling.stop(); };
}

function onNavigate() {
  const id = currentVideoId();
  if (id === videoId) return;
  videoId = id;
  cues = [];
  currentIndex = -1;
  domFallbackMode = false;
  state.cue = null; state.gloss = null; setHint(null); state.error = null;
  state.popover = emptyPopover(); activeExplainId = ""; pausedByUs = false;
  hideNativeCaptions(false);
  stopDomFallback?.(); stopDomFallback = null;
  version++;
  if (!id) { draw(); return; }
  attach();
}

function attach() {
  const p = player();
  const v = video();
  if (!p || !v) { setTimeout(attach, 500); return; }
  renderPanel = mountOverlay(p, overlayActions);
  // YouTube can replace the <video> element; always follow the current one.
  if (boundVideo !== v) {
    boundVideo?.removeEventListener("timeupdate", sync);
    boundVideo?.removeEventListener("seeking", sync);
    v.addEventListener("timeupdate", sync);
    v.addEventListener("seeking", sync);
    boundVideo = v;
  }
  setTimeout(() => { if (cues.length === 0 && videoId) startDomFallback(); }, 4000);
  draw();
}

function onKey(ev: KeyboardEvent) {
  const t = (ev.composedPath()[0] ?? ev.target) as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  if (ev.key === "Escape" && state.popover.open) {
    ev.stopPropagation();
    closeExplain();
  } else if ((ev.key === "e" || ev.key === "E") && hoveredWord) {
    openExplain(hoveredWord);
  } else if (ev.key === "g" || ev.key === "G") {
    saveSettings({ enabled: !settings.enabled });
  } else if (ev.key === "[" || ev.key === "]") {
    const v = video();
    if (!v || !cues.length) return;
    const cur = findCue(v.currentTime);
    const i = cur ? cur.index + (ev.key === "]" ? 1 : -1) : 0;
    seekTo(cues[Math.max(0, Math.min(cues.length - 1, i))]);
  }
}

(async () => {
  await settingsLoaded;
  onSettingsChange((s) => {
    const modelChanged = s.glossModel !== settings.glossModel || s.level !== settings.level || s.glossStyle !== settings.glossStyle;
    settings = s;
    if (modelChanged) { glosses.clear(); keyCache.clear(); attempts.clear(); }
    apiBlocked = false;
    backoffUntil = 0;
    backoffMs = BACKOFF_MIN_MS;
    hideNativeCaptions(s.enabled && cues.length > 0);
    version++;
    sync();
  });
  document.addEventListener("yt-navigate-finish", onNavigate);
  document.addEventListener("fullscreenchange", draw);
  document.addEventListener("keydown", onKey);
  onNavigate();
})();
