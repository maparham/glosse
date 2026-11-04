# Glosse: German literal-subtitle Chrome extension

*Design, 2026-11-04*

## Goal

Show a word-by-word English gloss under German YouTube subtitles so the German structure stays visible, and explain any selected word or phrase on demand with grammar, contextual meaning and examples.

**Problem.** YouTube's translation renders a German line as fluent English. Verb-final clauses, separable prefixes, case endings and word order disappear, so a learner cannot map English back onto the German.

**Core idea.** Two AI calls, both through the user's own Claude API key:

1. **Literal gloss (automatic).** For each subtitle cue, Claude returns an aligned gloss: German tokens, a literal English rendering that keeps German word order, and a fluent English line. Shown stacked under the video.
2. **Deep dive (on demand).** The user clicks a word or selects a span. Claude returns a grammatical breakdown, the meaning in this exact context, related forms, and example sentences.

| Layer   | Text |
| ------- | ---- |
| German  | Ich habe gestern das Buch, das du mir empfohlen hast, gelesen. |
| Literal | I have yesterday the book, that you to-me recommended have, read. |
| Fluent  | Yesterday I read the book you recommended to me. |

## User experience

**Subtitle panel (always on while a German track is active)**

- Line 1: original German, each token a clickable chip.
- Line 2: literal gloss, tokens aligned under their German source. Hovering a chip highlights its counterpart.
- Line 3: fluent English, dimmed, toggleable.
- Optional colour coding: verbs, separable prefixes, case-marked articles.
- Separable verbs drawn with a thin bracket joining prefix and stem (`rufe ... an`).

**Deep-dive popover (click or selection)**

- Single click explains a word; drag-select explains a span (for example a whole subordinate clause).
- Sections: lemma and form, grammar breakdown, meaning here, why this position, examples, Save.
- Video pauses while open, resumes on close (configurable).
- Follow-up box for one more question about the same selection ("why dative here?").

**Controls and settings**

- Player toolbar toggle: off, gloss only, gloss plus fluent.
- Keys: `G` panel, `E` explain word under cursor, `S` save, `Left`/`Right` replay previous/next cue.
- Options page: API key, model choice, learner level (A1 to C1), gloss style (strict vs lightly smoothed), cache size, lookahead count.
- Nothing leaves the browser except subtitle text sent to the Claude API.

## Architecture

Manifest V3 extension with three parts.

```
YouTube tab (content script)            Service worker (background)
  Cue capture  ─── cues, selections ──▶   API key, prompt building
  Overlay (Shadow DOM) ◀── gloss ────     Gloss queue: 5 cues/batch, 2 in flight
  Playback sync                           Explain calls, streamed
                                          IndexedDB cache (video + cue hash)
                                          Vocabulary store
                                                  │ HTTPS, user's own key
                                                  ▼
                                          Claude API (api.anthropic.com)
Options page: key, model, level, style
```

The content script never sees the API key. It exchanges cues, selections, gloss and explanation objects with the service worker over the runtime messaging port.

**Subtitle capture, in order of preference**

1. Intercept the `timedtext` request for the chosen caption track: every cue with timings up front, so glossing runs ahead of playback.
2. Fallback: MutationObserver on the caption container. Works for auto captions but sees only the current cue.
3. Last resort: paste a transcript or upload an SRT.

**Alignment model.** Claude returns token pairs so lines 1 and 2 draw in lockstep. A German token maps to zero, one or several gloss words; a separable verb maps two tokens to one entry with a shared `group` id, used for the bracket and hover highlight.

**Persistence**

- `chrome.storage.local`: settings, learner level, API key (read only by the service worker).
- IndexedDB: gloss cache keyed by video id plus cue hash; saved vocabulary deck.

**Permissions:** `storage`, `activeTab`, `scripting`, host permissions for youtube.com and api.anthropic.com.

## AI calls

| Call | Default model | Why |
| --- | --- | --- |
| Literal gloss | `claude-haiku-5-5` | Runs on every cue; cheap and good at token-level glossing. |
| Deep dive | `claude-opus-5-5` | Grammar reasoning and example quality matter; effort `medium`. |
| Follow-up | same as deep dive | Continues the same conversation. |

**Call 1: literal gloss (5 cues per request)**

System prompt, cached with `cache_control`:

```text
You gloss German subtitles for an English-speaking learner at level {level}.
For each cue return three things.
1. tokens: the German words in order. Keep punctuation attached.
2. gloss: for each token, a literal English rendering that preserves German
   word order and grammar. Use hyphens to join multi-word renderings
   ("to-me", "have-read"). Mark separable verb parts with the same group id.
   Render case and gender visibly when it helps: "the(acc)", "the(dat)".
   Keep particles like "doch", "mal", "ja" as themselves with a short tag:
   "doch(emphasis)".
3. fluent: a natural English sentence.
Use the previous cues only for context; gloss each cue independently.
```

```typescript
const GlossSchema = z.object({
  cues: z.array(z.object({
    id: z.string(),
    tokens: z.array(z.object({
      de: z.string(),
      en: z.string(),
      pos: z.enum(["noun","verb","sep-prefix","article","pronoun",
                   "adjective","adverb","preposition","conjunction",
                   "particle","punct","other"]),
      group: z.string().nullable(),
    })),
    fluent: z.string(),
  })),
});
```

**Call 2: deep dive (one selection, streamed)**

```text
The learner selected "{selection}" in this German subtitle:
  previous: {prev}
  current:  {cue}
  next:     {next}
Explain it for a level-{level} learner. Cover: the dictionary form and
the exact form used here (case, gender, number, tense, mood, person);
why it takes this position in the sentence; what it means in this
context versus its general meanings; one common confusion; and three
short example sentences at the learner's level, each with a literal
and a fluent English line. If the selection is a multi-word span,
treat it as a unit and also break it down word by word.
```

```typescript
const ExplainSchema = z.object({
  lemma: z.string(),
  form_here: z.string(),
  grammar: z.array(z.object({ label: z.string(), note: z.string() })),
  position: z.string(),
  meaning_here: z.string(),
  other_meanings: z.array(z.string()),
  confusion: z.string(),
  examples: z.array(z.object({ de: z.string(), literal: z.string(), fluent: z.string() })).max(3),
  breakdown: z.array(z.object({ word: z.string(), note: z.string() })),
});
```

**Request shape (service worker)**

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

const res = await client.messages.parse({
  model: "claude-opus-5-5",
  max_tokens: 4000,
  output_config: { effort: "medium", format: zodOutputFormat(ExplainSchema) },
  system: [{ type: "text", text: EXPLAIN_SYSTEM, cache_control: { type: "ephemeral" } }],
  messages: [{ role: "user", content: explainPrompt(selection, cues, level) }],
});
if (res.stop_reason === "refusal" || !res.parsed_output) { /* show fallback */ }
```

Notes: the service worker is an extension origin, so the SDK's browser flag is required. Check `stop_reason` before reading content. Leave `thinking` unset; effort is the only lever on Opus 5.5.

## Cost, latency and caching

| Item | Estimate | Basis |
| --- | --- | --- |
| Gloss, 10-minute video | $0.01 | ~150 cues, ~12k output tokens on Haiku, cached system prompt |
| Deep dive, one selection | $0.03 | ~1k in, ~1k out on Opus 5.5, plus thinking |
| Gloss latency per batch | 1 to 2 s | Haiku, short output |
| Deep dive first text | under 1 s | streamed |

- Gloss 5 cues ahead of the playhead, 2 batches in flight; with the full track known, gloss the whole video in the background.
- Cache every gloss and deep dive in IndexedDB; re-watching costs nothing.
- `cache_control` on the system prompt.
- On seek, drop queued batches now behind the playhead.

## Embellishments

- **Vocabulary deck** with Anki CSV export and a simple spaced-repetition review.
- **Sentence rewind** and 0.75x slow replay.
- **Chunk mode**: clause brackets so verb-final structure is visible.
- **Known-word fading** from the deck.
- **Difficulty read-out** per video (A2, B1, B2).
- **Grammar themes** panel aggregating tags seen today.
- **Comprehension check** questions in German.
- **Other languages** by swapping the prompt pack.

## Risks

| Risk | Mitigation |
| --- | --- |
| YouTube changes timedtext endpoint or caption DOM | Three capture paths; SRT upload always works |
| Auto captions lack punctuation | Send 3 cues per unit, let Claude segment, flag in UI |
| Token alignment drift | Schema forces one entry per token; validate count, retry once |
| API key in the extension | Local storage only, never in the content script; spend cap in Console |
| Service worker suspended after 30 s idle | Queue state in storage, resume on wake |
| Web Store review | Clear privacy text |

**Open questions**

- Strict word-order gloss or lightly smoothed? Proposed: strict, with a setting.
- Auto-pause on popover? Proposed: yes.
- Firefox? Defer.

## Build plan

1. **Gloss overlay** (about 1 week): timedtext capture, Haiku gloss call, three-line panel, options page. Gate: daily use.
2. **Deep dive** (about 1 week): click and span selection, streamed Opus call, popover with follow-up, pause/resume. Gate: explanations beat a dictionary.
3. **Robustness** (about 1 week): IndexedDB caches, DOM fallback, SRT upload, alignment validation, worker suspend recovery. Gate: survives a YouTube update.
4. **Learning tools** (ongoing): vocabulary deck, known-word fading, chunk mode, grammar tags, Web Store listing.

Stack: TypeScript, Vite + CRXJS, Anthropic TypeScript SDK with Zod, Preact in a Shadow DOM.
