# Glosse

A Chrome extension for German learners. It shows a **literal, word-order-preserving English gloss** under German YouTube subtitles, and explains any word or phrase you click with a grammar breakdown, meaning in context, and examples, powered by the Claude API with your own key.

| Layer   | Text |
| ------- | ---- |
| German  | Ich habe gestern das Buch, das du mir empfohlen hast, gelesen. |
| Literal | I have yesterday the book, that you to-me recommended have, read. |
| Fluent  | Yesterday I read the book you recommended to me. |

## Why

YouTube's built-in translation turns a German line into fluent English, so verb-final clauses, separable prefixes and case endings vanish. A literal gloss keeps the German structure visible.

## Features (planned)

- Three-line subtitle panel: German, aligned literal gloss, fluent English
- Click a word or select a span for an AI deep dive: form, grammar, why it sits where it sits, meaning here, examples
- Separable-verb brackets and part-of-speech colouring
- Vocabulary deck with Anki export
- All calls go from the extension's service worker straight to the Claude API with the user's own key

## Design

See [docs/DESIGN.md](docs/DESIGN.md).

## Planned stack

TypeScript, Vite + CRXJS (Manifest V3), Anthropic TypeScript SDK with Zod schemas, Preact in a Shadow DOM overlay.

## Status

Design stage. No code yet.
