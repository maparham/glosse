/** A subtitle cue as captured from YouTube. */
export interface Cue {
  /** Stable id within the video: the cue's index in the track. */
  index: number;
  /** Start and end in seconds. */
  start: number;
  end: number;
  text: string;
}

export type Pos =
  | "noun" | "verb" | "sep-prefix" | "article" | "pronoun" | "adjective"
  | "adverb" | "preposition" | "conjunction" | "particle" | "punct" | "other";

export interface GlossToken {
  /** The German token, punctuation attached. */
  de: string;
  /** Literal English rendering preserving German order. */
  en: string;
  pos: Pos;
  /** Shared id for tokens that belong together, e.g. a separable verb. */
  group: string | null;
}

export interface Gloss {
  tokens: GlossToken[];
  fluent: string;
}

export type Level = "A1" | "A2" | "B1" | "B2" | "C1";

export interface Settings {
  apiKey: string;
  /** Base URL of the Claude-compatible API, without a trailing /v1. */
  apiBaseUrl: string;
  level: Level;
  glossModel: string;
  explainModel: string;
  /** How many cues ahead of the playhead to gloss first. */
  lookahead: number;
  /** After the lookahead window, keep glossing the rest of the video in the background. */
  glossWholeVideo: boolean;
  /** Show the transcript panel beside the video. */
  showTranscript: boolean;
  /** Pause the video while an explanation is open. */
  pauseOnExplain: boolean;
  showFluent: boolean;
  colourPos: boolean;
  /** Strict word order, or lightly smoothed English. */
  glossStyle: "strict" | "smoothed";
  enabled: boolean;
}

export const DEFAULT_API_BASE_URL = "https://api.anthropic.com";

/** Build-time defaults from .env.local, if the build had them. */
const BAKED_KEY: string = (import.meta.env.VITE_GLOSSE_API_KEY as string | undefined) ?? "";
const BAKED_BASE_URL: string = (import.meta.env.VITE_GLOSSE_API_BASE_URL as string | undefined) || DEFAULT_API_BASE_URL;
/** Identifies this build's baked key and URL, so a rebuild with new values is applied once over saved settings. */
export const BAKED_SIGNATURE = BAKED_KEY || BAKED_BASE_URL !== DEFAULT_API_BASE_URL ? `${BAKED_KEY}|${BAKED_BASE_URL}` : "";

export const DEFAULT_SETTINGS: Settings = {
  apiKey: BAKED_KEY,
  apiBaseUrl: BAKED_BASE_URL,
  level: "B1",
  glossModel: "claude-haiku-5-5",
  explainModel: "claude-opus-5-5",
  lookahead: 5,
  glossWholeVideo: true,
  showTranscript: true,
  pauseOnExplain: true,
  showFluent: true,
  colourPos: true,
  glossStyle: "strict",
  enabled: true,
};

/** One cue sent for glossing, with neighbours for context only. */
export interface GlossRequestItem {
  /** Cache key, derived from text, model, level and style. */
  key: string;
  text: string;
  prev: string;
  next: string;
}

export type BackgroundRequest =
  | { type: "gloss"; items: GlossRequestItem[] }
  | { type: "getSettings" };

export type BackgroundResponse =
  | { type: "gloss"; results: Record<string, Gloss>; error?: string }
  | { type: "settings"; settings: Settings };

/** Message posted from the MAIN-world script to the content script. */
export interface TimedTextMessage {
  source: "glosse";
  type: "timedtext";
  url: string;
  body: string;
}

/** Phase 2: the deep-dive explanation of a selected word or span. */
export interface Explanation {
  lemma: string;
  /** The exact form used here, e.g. "3rd person singular present, prefix moved to clause end". */
  form_here: string;
  grammar: { label: string; note: string }[];
  meaning_here: string;
  examples: { de: string; literal: string; fluent: string }[];
}

export interface ExplainContext {
  selection: string;
  cue: string;
  prev: string;
  next: string;
}

/** Messages over the long-lived port used for explanations. */
export type ExplainPortRequest =
  | { type: "explain"; id: string; ctx: ExplainContext }
  | { type: "followup"; id: string; ctx: ExplainContext; explanation: Explanation; history: { q: string; a: string }[]; question: string }
  | { type: "save"; entry: VocabEntry };

export type ExplainPortResponse =
  | { type: "explain-result"; id: string; explanation: Explanation; cached: boolean }
  | { type: "explain-error"; id: string; error: string }
  | { type: "followup-delta"; id: string; text: string }
  | { type: "followup-done"; id: string }
  | { type: "saved"; ok: boolean };

export interface VocabEntry {
  id: string;
  selection: string;
  lemma: string;
  meaning: string;
  cue: string;
  videoId: string | null;
  time: number;
  savedAt: number;
}
