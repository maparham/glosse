import type { Cue } from "../shared/types";

export interface TrackInfo {
  lang: string | null;
  /** Set when YouTube is auto-translating the track. */
  tlang: string | null;
  /** "asr" for auto-generated captions. */
  kind: string | null;
}

export function trackInfo(url: string): TrackInfo {
  const u = new URL(url, location.origin);
  return {
    lang: u.searchParams.get("lang"),
    tlang: u.searchParams.get("tlang"),
    kind: u.searchParams.get("kind"),
  };
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

type Json3Event = { tStartMs: number; dDurationMs?: number; segs?: { utf8: string; tOffsetMs?: number }[]; aAppend?: number };

/** Break an auto-generated cue at a pause this long (ms) between words. */
const ASR_PAUSE_MS = 1200;
/** Past this many words, break at the next comma; at the hard cap, break anyway. */
const ASR_SOFT_WORDS = 12;
const ASR_MAX_WORDS = 20;
/** How long the last word of a cue stays up when nothing follows soon. */
const ASR_TAIL_MS = 1500;

/**
 * Auto-generated tracks come as rolling display lines that cut sentences in half,
 * but every word carries its own time. Regroup the words into sentence-sized cues.
 */
function regroupAsr(events: Json3Event[]): Cue[] {
  const words: { t: number; w: string }[] = [];
  for (const ev of events) {
    if (!ev.segs || ev.aAppend) continue;
    for (const s of ev.segs) {
      const w = s.utf8.trim();
      if (w) words.push({ t: ev.tStartMs + (s.tOffsetMs ?? 0), w });
    }
  }
  words.sort((a, b) => a.t - b.t);

  const groups: { t: number; w: string }[][] = [];
  let cur: { t: number; w: string }[] = [];
  words.forEach((word, i) => {
    cur.push(word);
    const next = words[i + 1];
    const n = cur.length;
    if (
      !next
      || /[.!?…]["»“”']?$/.test(word.w)
      || next.t - word.t > ASR_PAUSE_MS
      || (n >= ASR_SOFT_WORDS && /[,;:]$/.test(word.w))
      || n >= ASR_MAX_WORDS
    ) {
      groups.push(cur);
      cur = [];
    }
  });

  return groups.map((g, i) => {
    const start = g[0].t;
    const tail = g[g.length - 1].t + ASR_TAIL_MS;
    const nextStart = groups[i + 1]?.[0].t ?? Infinity;
    return { index: i, start: start / 1000, end: Math.min(tail, nextStart) / 1000, text: g.map((x) => x.w).join(" ") };
  });
}

/** Parse YouTube's json3 caption format into cues. */
export function parseJson3(body: string, asr = false): Cue[] {
  const data = JSON.parse(body) as { events?: Json3Event[] };
  if (asr) return regroupAsr(data.events ?? []);
  const cues: Cue[] = [];
  for (const ev of data.events ?? []) {
    if (!ev.segs || ev.aAppend) continue;
    const text = clean(ev.segs.map((s) => s.utf8).join(""));
    if (!text) continue;
    const start = ev.tStartMs / 1000;
    const end = start + (ev.dDurationMs ?? 3000) / 1000;
    cues.push({ index: cues.length, start, end, text });
  }
  return cues;
}

/** Parse the srv3/XML caption format (fallback when the player asks for XML). */
export function parseXml(body: string): Cue[] {
  const doc = new DOMParser().parseFromString(body, "text/xml");
  const cues: Cue[] = [];
  doc.querySelectorAll("p, text").forEach((p) => {
    const t = Number(p.getAttribute("t") ?? p.getAttribute("start") ?? "0");
    const d = Number(p.getAttribute("d") ?? p.getAttribute("dur") ?? "3000");
    const text = clean(p.textContent ?? "");
    if (!text) return;
    const isMs = p.hasAttribute("t");
    const start = isMs ? t / 1000 : t;
    const end = start + (isMs ? d / 1000 : d);
    cues.push({ index: cues.length, start, end, text });
  });
  return cues;
}

export function parseTimedText(body: string, asr = false): Cue[] {
  const trimmed = body.trimStart();
  if (trimmed.startsWith("{")) return parseJson3(body, asr);
  if (trimmed.startsWith("<")) return parseXml(body);
  return [];
}

/**
 * Fallback: read whatever caption text YouTube is rendering right now, one visual line per entry.
 * Only sees the current cue, so there is no lookahead in this mode.
 */
export function observeRenderedCaptions(onChange: (lines: string[]) => void): () => void {
  let last = "";
  const read = () => {
    const container = document.querySelector(".ytp-caption-window-container");
    const nodes = container?.querySelectorAll(".caption-visual-line");
    const lines = (nodes?.length ? Array.from(nodes) : Array.from(document.querySelectorAll(".ytp-caption-segment")))
      .map((n) => clean(n.textContent ?? ""))
      .filter(Boolean);
    const key = lines.join("\n");
    if (key !== last) {
      last = key;
      onChange(lines);
    }
  };
  const obs = new MutationObserver(read);
  const target = document.querySelector(".ytp-caption-window-container") ?? document.body;
  obs.observe(target, { childList: true, subtree: true, characterData: true });
  read();
  return () => obs.disconnect();
}

/** A rolling line counts as finished once it has not changed for this long. */
const ROLLING_STABLE_MS = 1500;

/**
 * Auto-generated captions roll in word by word, so the rendered text changes several times a second.
 * Turn snapshots of the visual lines into finished lines: a line is done once a newer line appears
 * below it, or once it has sat unchanged for a moment.
 */
export function rollingLines(onLine: (text: string) => void): { push: (lines: string[]) => void; stop: () => void } {
  const recent: string[] = [];
  let timer: number | undefined;
  let tail = "";
  const emit = (text: string) => {
    if (!text || recent.includes(text)) return;
    recent.push(text);
    if (recent.length > 4) recent.shift();
    onLine(text);
  };
  return {
    push(lines) {
      clearTimeout(timer);
      // The previous bottom line vanished without growing into a current one: it is done.
      if (tail && !lines.some((l) => l.startsWith(tail))) emit(tail);
      lines.slice(0, -1).forEach(emit);
      tail = lines[lines.length - 1] ?? "";
      const pending = tail;
      if (pending) timer = window.setTimeout(() => emit(pending), ROLLING_STABLE_MS);
    },
    stop: () => clearTimeout(timer),
  };
}
