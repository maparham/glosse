import { render } from "preact";
import { useState } from "preact/hooks";
import type { Cue, Gloss, Settings } from "../shared/types";
import css from "./overlay.css?inline";

export interface OverlayState {
  cue: Cue | null;
  gloss: Gloss | null;
  /** "loading" while the gloss call is out, otherwise a message or null. */
  status: string | null;
  error: string | null;
  hint: string | null;
  settings: Settings;
}

function Panel({ state }: { state: OverlayState }) {
  const [hl, setHl] = useState<string | null>(null);
  const { cue, gloss, settings } = state;
  if (!settings.enabled) return null;
  if (!cue && !state.hint && !state.error) return null;

  return (
    <div class={`panel ${settings.colourPos ? "colour" : ""}`}>
      {gloss && cue ? (
        <>
          <div class="tokens">
            {gloss.tokens.map((t, i) => {
              const grouped = t.group && hl === t.group;
              return (
                <span
                  key={i}
                  class={`tok ${grouped ? "hl" : ""}`}
                  onMouseEnter={() => setHl(t.group)}
                  onMouseLeave={() => setHl(null)}
                >
                  <span class={`de ${t.pos} ${t.group ? "group-bracket" : ""}`}>{t.de}</span>
                  <span class="en">{t.en}</span>
                </span>
              );
            })}
          </div>
          {settings.showFluent && gloss.fluent && <div class="fluent">{gloss.fluent}</div>}
        </>
      ) : cue ? (
        <>
          <div class="plain">{cue.text}</div>
          <div class="status">{state.status ?? "…"}</div>
        </>
      ) : null}
      {state.error && <div class="status error">{state.error}</div>}
      {state.hint && <div class="hint">{state.hint}</div>}
    </div>
  );
}

export function mountOverlay(host: HTMLElement): (state: OverlayState) => void {
  let root = host.querySelector<HTMLElement>("#glosse-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "glosse-root";
    root.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:60";
    host.appendChild(root);
  }
  const shadow = root.shadowRoot ?? root.attachShadow({ mode: "open" });
  if (!shadow.querySelector("style")) {
    const style = document.createElement("style");
    style.textContent = css;
    shadow.appendChild(style);
  }
  let mount = shadow.querySelector<HTMLElement>("#mount");
  if (!mount) {
    mount = document.createElement("div");
    mount.id = "mount";
    shadow.appendChild(mount);
  }
  return (state) => render(<Panel state={state} />, mount!);
}
