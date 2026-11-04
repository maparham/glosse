import { BAKED_SIGNATURE, DEFAULT_SETTINGS, type PanelPos, type Settings } from "./types";

const KEY = "settings";
const BAKED_KEY = "bakedSignature";
/** Kept apart from settings so the options page, which saves settings whole, cannot overwrite it. */
const PANEL_POS_KEY = "panelPos";

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get([KEY, BAKED_KEY]);
  const merged = { ...DEFAULT_SETTINGS, ...(stored[KEY] as Partial<Settings> | undefined) };
  // A build with baked-in key or URL overrides what was saved, once per distinct build.
  if (BAKED_SIGNATURE && stored[BAKED_KEY] !== BAKED_SIGNATURE) {
    merged.apiKey = DEFAULT_SETTINGS.apiKey;
    merged.apiBaseUrl = DEFAULT_SETTINGS.apiBaseUrl;
    await chrome.storage.local.set({ [KEY]: merged, [BAKED_KEY]: BAKED_SIGNATURE });
  }
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

export async function loadPanelPos(): Promise<PanelPos | null> {
  const stored = await chrome.storage.local.get(PANEL_POS_KEY);
  return (stored[PANEL_POS_KEY] as PanelPos | undefined) ?? null;
}

export async function savePanelPos(pos: PanelPos | null): Promise<void> {
  if (pos) await chrome.storage.local.set({ [PANEL_POS_KEY]: pos });
  else await chrome.storage.local.remove(PANEL_POS_KEY);
}
