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

/** Parse YouTube's json3 caption format into cues. */
export function parseJson3(body: string): Cue[] {
  const data = JSON.parse(body) as {
    events?: { tStartMs: number; dDurationMs?: number; segs?: { utf8: string }[]; aAppend?: number }[];
  };
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

export function parseTimedText(body: string): Cue[] {
  const trimmed = body.trimStart();
  if (trimmed.startsWith("{")) return parseJson3(body);
  if (trimmed.startsWith("<")) return parseXml(body);
  return [];
}

/**
 * Fallback: read whatever caption text YouTube is rendering right now.
 * Only sees the current cue, so there is no lookahead in this mode.
 */
export function observeRenderedCaptions(onCue: (text: string) => void): () => void {
  let last = "";
  const read = () => {
    const segs = document.querySelectorAll(".ytp-caption-segment");
    const text = clean(Array.from(segs).map((s) => s.textContent ?? "").join(" "));
    if (text && text !== last) {
      last = text;
      onCue(text);
    }
  };
  const obs = new MutationObserver(read);
  const target = document.querySelector(".ytp-caption-window-container") ?? document.body;
  obs.observe(target, { childList: true, subtree: true, characterData: true });
  read();
  return () => obs.disconnect();
}
