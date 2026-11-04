import { render } from "preact";
import { useRef, useState } from "preact/hooks";
import type { Cue, Gloss, Settings } from "../shared/types";
import { Popover, type PopoverActions, type PopoverState } from "./popover";
import css from "./overlay.css?inline";
import popCss from "./popover.css?inline";

export interface OverlayState {
  cue: Cue | null;
  gloss: Gloss | null;
  status: string | null;
  error: string | null;
  hint: string | null;
  settings: Settings;
  popover: PopoverState;
}

export interface OverlayActions extends PopoverActions {
  /** Explain a word or span from the current cue. */
  explain: (selection: string) => void;
  /** Remember the token under the cursor for the E key. */
  hover: (word: string | null) => void;
}

const stripPunct = (s: string) => s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

function Panel({ state, actions }: { state: OverlayState; actions: OverlayActions }) {
  const [hl, setHl] = useState<string | null>(null);
  const tokensRef = useRef<HTMLDivElement>(null);
  /** Set by a drag-select so the click that follows the mouseup does not also fire. */
  const justSelected = useRef(false);
  const { cue, gloss, settings } = state;
  if (!settings.enabled) return null;
  if (!cue && !state.hint && !state.error) return null;

  /** Drag-select across chips: collect the German tokens the selection touches. */
  const onMouseUp = () => {
    const root = tokensRef.current?.getRootNode() as (ShadowRoot & { getSelection?: () => Selection | null }) | undefined;
    const sel = root?.getSelection?.() ?? document.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !tokensRef.current) return;
    const range = sel.getRangeAt(0);
    const words: string[] = [];
    tokensRef.current.querySelectorAll<HTMLElement>(".de").forEach((el) => {
      if (range.intersectsNode(el)) words.push(el.textContent ?? "");
    });
    sel.removeAllRanges();
    const text = stripPunct(words.join(" "));
    if (words.length > 1 && text) {
      justSelected.current = true;
      actions.explain(text);
    }
  };

  return (
    <div class={`panel ${settings.colourPos ? "colour" : ""}`} onClick={(e) => e.stopPropagation()} onDblClick={(e) => e.stopPropagation()}>
      {gloss && cue ? (
        <>
          <div class="tokens" ref={tokensRef} onMouseUp={onMouseUp}>
            {gloss.tokens.map((t, i) => {
              const grouped = t.group && hl === t.group;
              const word = stripPunct(t.de);
              return (
                <span
                  key={i}
                  class={`tok ${grouped ? "hl" : ""}`}
                  title="Click to explain"
                  onMouseEnter={() => { setHl(t.group); actions.hover(word || null); }}
                  onMouseLeave={() => { setHl(null); actions.hover(null); }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (justSelected.current) { justSelected.current = false; return; }
                    if (word) actions.explain(word);
                  }}
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

function Root({ state, actions }: { state: OverlayState; actions: OverlayActions }) {
  return (
    <>
      <Panel state={state} actions={actions} />
      {state.settings.enabled && <Popover state={state.popover} actions={actions} />}
    </>
  );
}

export function mountOverlay(host: HTMLElement, actions: OverlayActions): (state: OverlayState) => void {
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
    style.textContent = css + "\n" + popCss;
    shadow.appendChild(style);
  }
  let mount = shadow.querySelector<HTMLElement>("#mount");
  if (!mount) {
    mount = document.createElement("div");
    mount.id = "mount";
    shadow.appendChild(mount);
  }
  return (state) => render(<Root state={state} actions={actions} />, mount!);
}
