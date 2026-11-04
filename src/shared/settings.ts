import { DEFAULT_SETTINGS, type Settings } from "./types";

const KEY = "settings";

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(KEY);
  const merged = { ...DEFAULT_SETTINGS, ...(stored[KEY] as Partial<Settings> | undefined) };
  // An empty saved key or URL means "unset": fall back to the build's defaults.
  if (!merged.apiKey) merged.apiKey = DEFAULT_SETTINGS.apiKey;
  if (!merged.apiBaseUrl) merged.apiBaseUrl = DEFAULT_SETTINGS.apiBaseUrl;
  return merged;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export function onSettingsChange(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && changes[KEY]) {
      cb({ ...DEFAULT_SETTINGS, ...(changes[KEY].newValue as Partial<Settings>) });
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
