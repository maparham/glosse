/** Cache key for a cue's gloss. The normalised text is the key, so distinct lines never collide. */
export function glossKey(text: string, model: string, level: string, style: string): string {
  return `g1:${model}:${level}:${style}:${text.replace(/\s+/g, " ").trim().toLowerCase()}`;
}
