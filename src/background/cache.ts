import { createStore, get, set, getMany, setMany } from "idb-keyval";
import type { Explanation, Gloss, VocabEntry } from "../shared/types";

const store = createStore("glosse", "gloss");
const explainStore = createStore("glosse-explain", "explain");
const vocabStore = createStore("glosse-vocab", "vocab");

export async function getGlosses(keys: string[]): Promise<Map<string, Gloss>> {
  const values = await getMany<Gloss | undefined>(keys, store);
  const out = new Map<string, Gloss>();
  keys.forEach((k, i) => {
    const v = values[i];
    if (v) out.set(k, v);
  });
  return out;
}

export async function putGlosses(entries: [string, Gloss][]): Promise<void> {
  if (entries.length) await setMany(entries, store);
}

export async function getExplanation(key: string): Promise<Explanation | undefined> {
  return get<Explanation>(key, explainStore);
}

export async function putExplanation(key: string, value: Explanation): Promise<void> {
  await set(key, value, explainStore);
}

export async function saveVocab(entry: VocabEntry): Promise<void> {
  await set(entry.id, entry, vocabStore);
}
