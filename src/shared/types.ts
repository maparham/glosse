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
  showFluent: boolean;
  colourPos: boolean;
  /** Strict word order, or lightly smoothed English. */
  glossStyle: "strict" | "smoothed";
  enabled: boolean;
}

export const DEFAULT_API_BASE_URL = "https://api.anthropic.com";

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  apiBaseUrl: DEFAULT_API_BASE_URL,
  level: "B1",
  glossModel: "claude-haiku-5-5",
  explainModel: "claude-opus-5-5",
  lookahead: 5,
  glossWholeVideo: true,
  showTranscript: true,
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
