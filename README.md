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

Phases 1 (gloss overlay, transcript panel) and 2 (deep-dive explanations) are implemented and untested against live YouTube. See [docs/DESIGN.md](docs/DESIGN.md) for the full design and build plan.

## Install (developer mode)

On macOS, one script builds everything and opens Chrome at the right page:

```bash
curl -fsSL https://raw.githubusercontent.com/maparham/glosse/main/scripts/install-macos.sh | bash
```

To bake in an API key and a custom base URL so the build works without visiting the options page, pass them as environment variables. They are written to a gitignored `.env.local` and never committed:

```bash
GLOSSE_API_KEY=sk-... GLOSSE_API_BASE_URL=https://your-proxy.example bash -c "$(curl -fsSL https://raw.githubusercontent.com/maparham/glosse/main/scripts/install-macos.sh)"
```

Rerun the same script after each update, then click the reload icon on the extension's card. Chrome has no supported way for a script to load an unpacked extension by itself, so the "Load unpacked" click on first install stays manual.

Manually, on any platform:

```bash
npm install
npm run build
```

1. Open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, pick the `dist` folder.
2. The options page opens. Paste your Claude API key (console.anthropic.com), pick your level, save.
   The API base URL can be changed there too, for a proxy or gateway; Chrome asks once to allow the new host.
3. Open a YouTube video that has a **German subtitle track** and turn it on (Settings → Subtitles → Deutsch, not auto-translate). Auto-generated German captions work too: their rolling lines are regrouped into sentences using the per-word timings.
4. The native captions are replaced by the three-line panel: German, literal gloss, fluent English.
5. A transcript panel appears above the recommendations column with every line and its gloss. Click a line to jump there. The whole video is glossed in the background, nearest lines first.
6. Click any German word in the panel, or drag across several, for a deep dive on Opus: the exact form, grammar points, why it sits where it does, meaning in this line, a common confusion, examples, and a word-by-word breakdown for spans. Ask follow-up questions in the box at the bottom. The video pauses while it is open and resumes on close.

Keys on a video: **G** toggles the overlay, **E** explains the word under the cursor, **Esc** closes the explanation, **[** and **]** replay the previous or next line.

## How it works

- `src/content/main-world.iife.ts` runs in the page and watches the player's own caption requests, so every cue with timing is known up front.
- `src/content/index.ts` keeps the panel in sync with the playhead and asks for glosses a few lines ahead, five cues per request, two requests in flight.
- `src/background/index.ts` holds the API key, checks the IndexedDB cache, and calls Claude (`claude-haiku-5-5` by default) with a structured-output schema. Explanations and follow-ups go over a long-lived port so answers can stream, using `src/background/explain.ts` on `claude-opus-5-5`.
- If no caption data arrives, the content script falls back to reading the rendered caption text.

The API key lives in `chrome.storage.local` and is only read by the background worker. Only subtitle text is sent to `api.anthropic.com`.

## Development

```bash
npm run dev
```

Vite with CRXJS rebuilds on change; reload the extension in `chrome://extensions` after manifest changes.

## Roadmap

1. **Gloss overlay** and transcript panel (done, needs field testing)
2. **Deep dive** on `claude-opus-5-5` with follow-up questions and Save (done, needs field testing)
3. **Robustness**: alignment validation, worker suspend recovery, SRT upload
4. **Learning tools**: vocabulary deck with Anki export, known-word fading, chunk mode
