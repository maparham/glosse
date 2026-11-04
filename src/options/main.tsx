import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { loadSettings, saveSettings } from "../shared/settings";
import { DEFAULT_API_BASE_URL, DEFAULT_SETTINGS, type Level, type Settings } from "../shared/types";

const LEVELS: Level[] = ["A1", "A2", "B1", "B2", "C1"];

function App() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [permError, setPermError] = useState<string | null>(null);

  useEffect(() => {
    loadSettings().then(setS);
  }, []);

  const update = (patch: Partial<Settings>) => setS({ ...s, ...patch });

  const save = async (e: Event) => {
    e.preventDefault();
    setPermError(null);
    const base = (s.apiBaseUrl || DEFAULT_API_BASE_URL).trim();
    let origin: string;
    try {
      origin = new URL(base).origin + "/*";
    } catch {
      setPermError("The API URL is not a valid URL.");
      return;
    }
    const granted = await chrome.permissions.contains({ origins: [origin] })
      || await chrome.permissions.request({ origins: [origin] });
    if (!granted) {
      setPermError(`Chrome needs permission to reach ${origin} for the extension to call this API.`);
      return;
    }
    await saveSettings({ ...s, apiBaseUrl: base });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <form onSubmit={save}>
      <h1>Glosse settings</h1>
      <p class="note">
        Subtitle text is sent to the Claude API using your own key. Nothing else leaves the browser.
      </p>

      <label>Claude API key</label>
      <input type="password" value={s.apiKey} onInput={(e) => update({ apiKey: e.currentTarget.value.trim() })} placeholder="sk-ant-…" />
      <p class="note">Create one at console.anthropic.com. Consider setting a spend limit there.</p>

      <label>API base URL</label>
      <input type="text" value={s.apiBaseUrl} onInput={(e) => update({ apiBaseUrl: e.currentTarget.value })} placeholder={DEFAULT_API_BASE_URL} />
      <p class="note">
        Default is {DEFAULT_API_BASE_URL}. Set this to a proxy or gateway that speaks the Claude Messages API.
        Enter the base only; the extension appends /v1/messages. Chrome will ask once to allow the new host.
      </p>
      {permError && <p class="note" style="color:#b00">{permError}</p>}

      <label>Your German level</label>
      <select value={s.level} onChange={(e) => update({ level: e.currentTarget.value as Level })}>
        {LEVELS.map((l) => <option value={l}>{l}</option>)}
      </select>

      <label>Gloss style</label>
      <select value={s.glossStyle} onChange={(e) => update({ glossStyle: e.currentTarget.value as Settings["glossStyle"] })}>
        <option value="strict">Strict: keep German word order exactly</option>
        <option value="smoothed">Smoothed: keep the structure, smooth small details</option>
      </select>

      <label>Gloss model (runs on every subtitle line)</label>
      <input type="text" value={s.glossModel} onInput={(e) => update({ glossModel: e.currentTarget.value.trim() })} />

      <label>Explanation model (used from phase 2)</label>
      <input type="text" value={s.explainModel} onInput={(e) => update({ explainModel: e.currentTarget.value.trim() })} />

      <label>Lines to gloss ahead of the playhead</label>
      <input type="number" min={1} max={20} value={s.lookahead} onInput={(e) => update({ lookahead: Number(e.currentTarget.value) || 5 })} />

      <div class="row" style="margin-top:14px">
        <input id="whole" type="checkbox" checked={s.glossWholeVideo} onChange={(e) => update({ glossWholeVideo: e.currentTarget.checked })} />
        <label for="whole">Gloss the whole video in the background (about 1 cent per 10 minutes on Haiku)</label>
      </div>
      <div class="row">
        <input id="transcript" type="checkbox" checked={s.showTranscript} onChange={(e) => update({ showTranscript: e.currentTarget.checked })} />
        <label for="transcript">Show the transcript panel beside the video (click a line to jump there)</label>
      </div>
      <div class="row">
        <input id="fluent" type="checkbox" checked={s.showFluent} onChange={(e) => update({ showFluent: e.currentTarget.checked })} />
        <label for="fluent">Show the fluent English line</label>
      </div>
      <div class="row">
        <input id="colour" type="checkbox" checked={s.colourPos} onChange={(e) => update({ colourPos: e.currentTarget.checked })} />
        <label for="colour">Colour verbs, articles and particles</label>
      </div>
      <div class="row">
        <input id="enabled" type="checkbox" checked={s.enabled} onChange={(e) => update({ enabled: e.currentTarget.checked })} />
        <label for="enabled">Overlay on (press G on a video to toggle)</label>
      </div>

      <button type="submit">Save</button> {saved && <span class="ok">Saved</span>}

      <p class="note" style="margin-top:24px">
        Keys on a video: <b>G</b> toggle overlay, <b>[</b> and <b>]</b> replay previous or next line.
      </p>
    </form>
  );
}

render(<App />, document.getElementById("app")!);
