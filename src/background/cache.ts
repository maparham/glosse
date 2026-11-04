import { createStore, get, set, getMany, setMany } from "idb-keyval";
import type { Gloss } from "../shared/types";

const store = createStore("glosse", "gloss");

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

export const cacheGet = get;
export const cacheSet = set;
