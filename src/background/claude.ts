import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { DEFAULT_API_BASE_URL, type Gloss, type GlossRequestItem, type Settings } from "../shared/types";

const PosSchema = z.enum([
  "noun", "verb", "sep-prefix", "article", "pronoun", "adjective",
  "adverb", "preposition", "conjunction", "particle", "punct", "other",
]);

export const GlossBatchSchema = z.object({
  cues: z.array(
    z.object({
      id: z.string(),
      tokens: z.array(
        z.object({
          de: z.string(),
          en: z.string(),
          pos: PosSchema,
          group: z.string().nullable(),
        }),
      ),
      fluent: z.string(),
    }),
  ),
});

function systemPrompt(level: string, style: "strict" | "smoothed"): string {
  const order =
    style === "strict"
      ? "Preserve German word order exactly, even where the English reads oddly."
      : "Keep German word order where it teaches something (verb position, separable prefixes, clause structure) but smooth small details so the line stays readable.";
  return `You gloss German subtitles for an English-speaking learner at level ${level}.
For each cue return three things.
1. tokens: the German words of the cue in order, one entry per word, punctuation attached to its word. Do not drop, merge or reorder words.
2. For each token, "en": a literal English rendering. ${order}
   Join multi-word renderings with hyphens ("to-me", "have-read").
   Mark both parts of a separable verb with the same group id (e.g. "sv1"); use null otherwise.
   Show case or gender where it helps: "the(acc)", "the(dat)".
   Keep modal particles as themselves with a short tag: "doch(emphasis)", "mal(softener)".
   Give each token a part of speech from the allowed list.
3. fluent: a natural English sentence.
Use the previous and next cues only as context. Gloss each cue independently and return one entry per cue id, in the same order.`;
}

function userPrompt(items: GlossRequestItem[]): string {
  return items
    .map(
      (it) =>
        `<cue id="${it.key}">\n<previous>${it.prev}</previous>\n<current>${it.text}</current>\n<next>${it.next}</next>\n</cue>`,
    )
    .join("\n\n");
}

/** Trim whitespace and a trailing slash or /v1, which the SDK adds itself. */
export function normalizeBaseUrl(url: string): string {
  const trimmed = (url || "").trim().replace(/\/+$/, "").replace(/\/v1$/, "");
  return trimmed || DEFAULT_API_BASE_URL;
}

export async function glossBatch(
  items: GlossRequestItem[],
  settings: Settings,
): Promise<Record<string, Gloss>> {
  const client = new Anthropic({
    apiKey: settings.apiKey,
    baseURL: normalizeBaseUrl(settings.apiBaseUrl),
    dangerouslyAllowBrowser: true,
    defaultHeaders: { "anthropic-dangerous-direct-browser-access": "true" },
  });

  const res = await client.messages.parse({
    model: settings.glossModel,
    max_tokens: 4000,
    output_config: { effort: "low", format: zodOutputFormat(GlossBatchSchema) },
    system: [
      {
        type: "text",
        text: systemPrompt(settings.level, settings.glossStyle),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userPrompt(items) }],
  });

  if (res.stop_reason === "refusal") throw new Error("The model declined this request.");
  if (res.stop_reason === "max_tokens") throw new Error("Gloss output was cut off; try fewer cues.");
  const parsed = res.parsed_output;
  if (!parsed) throw new Error("Could not parse the gloss response.");

  const out: Record<string, Gloss> = {};
  for (const cue of parsed.cues) {
    out[cue.id] = { tokens: cue.tokens, fluent: cue.fluent };
  }
  // Cues the model skipped are simply absent; the content script retries them a few times.
  return out;
}
