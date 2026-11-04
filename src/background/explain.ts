import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { normalizeBaseUrl } from "./claude";
import type { ExplainContext, Explanation, Settings } from "../shared/types";

export const ExplanationSchema = z.object({
  lemma: z.string(),
  form_here: z.string(),
  grammar: z.array(z.object({ label: z.string(), note: z.string() })),
  meaning_here: z.string(),
  examples: z.array(z.object({ de: z.string(), literal: z.string(), fluent: z.string() })).max(1),
});

function client(settings: Settings) {
  return new Anthropic({
    apiKey: settings.apiKey,
    baseURL: normalizeBaseUrl(settings.apiBaseUrl),
    dangerouslyAllowBrowser: true,
    defaultHeaders: { "anthropic-dangerous-direct-browser-access": "true" },
  });
}

function systemPrompt(level: string): string {
  return `You are a German tutor for an English-speaking learner at level ${level}, explaining a word or phrase from a video subtitle.
Be brief: the learner can ask follow-up questions for more. Plain language, no markdown.
- lemma: the dictionary form (with article and plural for nouns, infinitive for verbs).
- form_here: the form used here in a few words (e.g. "dative plural", "past participle, prefix split off").
- grammar: one to three short labelled points about the grammar at work (e.g. "Dative after 'mit'", "Verb-final in subordinate clause"), each note one short sentence.
- meaning_here: what it means in this line, in one short sentence.
- examples: one short sentence at the learner's level using the selection, with a literal (word-order-preserving) and a fluent English line.`;
}

function userPrompt(ctx: ExplainContext): string {
  return `The learner selected "${ctx.selection}" in this German subtitle.
<previous>${ctx.prev}</previous>
<current>${ctx.cue}</current>
<next>${ctx.next}</next>
Explain "${ctx.selection}" as it is used in the current line.`;
}

export async function explain(ctx: ExplainContext, settings: Settings): Promise<Explanation> {
  const stream = client(settings).messages.stream({
    model: settings.explainModel,
    max_tokens: 8000,
    output_config: { effort: "medium", format: zodOutputFormat(ExplanationSchema) },
    system: [{ type: "text", text: systemPrompt(settings.level), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userPrompt(ctx) }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("The model declined this request.");
  if (msg.stop_reason === "max_tokens") throw new Error("The explanation was cut off.");
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const parsed = ExplanationSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error("Could not parse the explanation.");
  return parsed.data;
}

/** A free-form follow-up question about the same selection, streamed as plain text. */
export async function followUp(
  ctx: ExplainContext,
  explanation: Explanation,
  history: { q: string; a: string }[],
  question: string,
  settings: Settings,
  onDelta: (text: string) => void,
): Promise<void> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userPrompt(ctx) },
    { role: "assistant", content: JSON.stringify(explanation) },
  ];
  for (const h of history) {
    messages.push({ role: "user", content: h.q }, { role: "assistant", content: h.a });
  }
  messages.push({ role: "user", content: question });

  const stream = client(settings).messages.stream({
    model: settings.explainModel,
    max_tokens: 4000,
    output_config: { effort: "medium" },
    system: [
      { type: "text", text: systemPrompt(settings.level), cache_control: { type: "ephemeral" } },
      { type: "text", text: "The learner now asks a follow-up question. Answer in plain prose, at most a short paragraph, no markdown, with one German example if it helps." },
    ],
    messages,
  });
  for await (const ev of stream) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") onDelta(ev.delta.text);
  }
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("The model declined this request.");
}
