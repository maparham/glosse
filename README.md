# Glosse

A Chrome extension for German learners. It shows a **literal, word-order-preserving English gloss** under German YouTube subtitles, and (from phase 2) explains any word or phrase you click with a grammar breakdown, meaning in context, and examples. Powered by the Claude API with your own key.

| Layer   | Text |
| ------- | ---- |
| German  | Ich habe gestern das Buch, das du mir empfohlen hast, gelesen. |
| Literal | I have yesterday the book, that you to-me recommended have, read. |
| Fluent  | Yesterday I read the book you recommended to me. |

## Why

YouTube's built-in translation turns a German line into fluent English, so verb-final clauses, separable prefixes and case endings vanish. A literal gloss keeps the German structure visible.

## Status

Phase 1 (gloss overlay) is implemented and untested against live YouTube. See [docs/DESIGN.md](docs/DESIGN.md) for the full design and build plan.

## Install (developer mode)

```bash
npm install
npm run build
```

1. Open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, pick the `dist` folder.
2. The options page opens. Paste your Claude API key (console.anthropic.com), pick your level, save.
3. Open a YouTube video that has a **German subtitle track** and turn it on (Settings → Subtitles → Deutsch, not auto-translate).
4. The native captions are replaced by the three-line panel: German, literal gloss, fluent English.

Keys on a video: **G** toggles the overlay, **[** and **]** replay the previous or next line.

## How it works

- `src/content/main-world.iife.ts` runs in the page and watches the player's own caption requests, so every cue with timing is known up front.
- `src/content/index.ts` keeps the panel in sync with the playhead and asks for glosses a few lines ahead, five cues per request, two requests in flight.
- `src/background/index.ts` holds the API key, checks the IndexedDB cache, and calls Claude (`claude-haiku-5-5` by default) with a structured-output schema.
- If no caption data arrives, the content script falls back to reading the rendered caption text.

The API key lives in `chrome.storage.local` and is only read by the background worker. Only subtitle text is sent to `api.anthropic.com`.

## Development

```bash
npm run dev
```

Vite with CRXJS rebuilds on change; reload the extension in `chrome://extensions` after manifest changes.

## Roadmap

1. **Gloss overlay** (done, needs field testing)
2. **Deep dive**: click a word or select a span for a grammar and meaning breakdown on `claude-opus-5-5`
3. **Robustness**: alignment validation, worker suspend recovery, SRT upload
4. **Learning tools**: vocabulary deck with Anki export, known-word fading, chunk mode
