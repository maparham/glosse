/** Small, fast, deterministic string hash (FNV-1a, 32-bit) for cache keys. */
export function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function glossKey(text: string, model: string, level: string, style: string): string {
  return `g1:${model}:${level}:${style}:${hash(text.trim().toLowerCase())}`;
}
