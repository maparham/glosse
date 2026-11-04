import { render } from "preact";
import { useRef, useState } from "preact/hooks";
import type { Cue, Gloss, PanelPos, Settings } from "../shared/types";
import { Popover, type PopoverActions, type PopoverState } from "./popover";
import css from "./overlay.css?inline";
import popCss from "./popover.css?inline";

export interface OverlayState {
  cue: Cue | null;
  gloss: Gloss | null;
  status: string | null;
  error: string | null;
  hint: string | null;
  /** True while a transient hint fades out. */
  hintFading: boolean;
  settings: Settings;
  /** Null keeps the default spot near the bottom of the video. */
  panelPos: PanelPos | null;
  /** The panel is drawn below the video instead of over it. */
  panelBelow: boolean;
  popover: PopoverState;
}

export interface OverlayActions extends PopoverActions {
  /** Explain a word or span from the current cue. */
  explain: (selection: string) => void;
  /** Remember the token under the cursor for the E key. */
  hover: (word: string | null) => void;
  /** Remember where the panel was dragged; null resets it. */
  movePanel: (pos: PanelPos | null) => void;
}

const stripPunct = (s: string) => s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

function Panel({ state, actions, inline = false }: { state: OverlayState; actions: OverlayActions; inline?: boolean }) {
  const [hl, setHl] = useState<string | null>(null);
  const tokensRef = useRef<HTMLDivElement>(null);
  /** Set by a drag-select so the click that follows the mouseup does not also fire. */
  const justSelected = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  /** The live position while a drag is in progress. */
  const [dragPos, setDragPos] = useState<PanelPos | null>(null);
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

  /** Drag by the grip or any part of the panel outside the word chips, keeping it inside the player. */
  const onDragStart = (e: PointerEvent) => {
    const panel = panelRef.current;
    const host = (panel?.getRootNode() as ShadowRoot | undefined)?.host;
    // Chips keep their click and drag-select behaviour.
    if (inline || !panel || !host || e.button !== 0 || (e.target as Element).closest(".tok")) return;
    e.preventDefault();
    e.stopPropagation();
    const box = host.getBoundingClientRect();
    const r = panel.getBoundingClientRect();
    const offX = e.clientX - (r.left + r.width / 2);
    const offY = e.clientY - r.bottom;
    let last: PanelPos | null = null;
    const move = (ev: PointerEvent) => {
      const cx = Math.min(Math.max(ev.clientX - offX, box.left + r.width / 2), box.right - r.width / 2);
      const by = Math.min(Math.max(ev.clientY - offY, box.top + r.height), box.bottom);
      last = { x: (cx - box.left) / box.width, y: (by - box.top) / box.height };
      setDragPos(last);
    };
    // On window, not the grip: the panel can unmount mid-drag when the line ends.
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDragPos(null);
      if (last) actions.movePanel(last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const pos = dragPos ?? state.panelPos;
  const style = pos && !inline ? { left: `${pos.x * 100}%`, top: `${pos.y * 100}%`, bottom: "auto", transform: "translate(-50%, -100%)" } : undefined;

  return (
    <div ref={panelRef} style={style} class={`panel ${inline ? "inline" : ""} ${settings.colourPos ? "colour" : ""}`} onPointerDown={onDragStart} onClick={(e) => e.stopPropagation()} onDblClick={(e) => e.stopPropagation()}>
      {!inline && <div
        class="grip"
        title="Drag to move · double-click to reset"
        onDblClick={(e) => { e.stopPropagation(); actions.movePanel(null); }}
      />}
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
      {state.hint && <div class={`hint ${state.hintFading ? "fade" : ""}`}>{state.hint}</div>}
    </div>
  );
}

function Root({ state, actions }: { state: OverlayState; actions: OverlayActions }) {
  return (
    <>
      {!state.panelBelow && <Panel state={state} actions={actions} />}
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

const BELOW_ID = "glosse-below";

/** Mount the panel in the page just under the player, above the title. Null if that spot is not there. */
export function mountBelowPanel(actions: OverlayActions): ((state: OverlayState) => void) | null {
  const below = document.querySelector<HTMLElement>("ytd-watch-flexy #below");
  if (!below) return null;
  let host = document.getElementById(BELOW_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = BELOW_ID;
    host.style.cssText = "display:block;margin-top:12px";
  }
  if (below.firstElementChild !== host) below.prepend(host);
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
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
  const h = host;
  return (state) => {
    // Hold the space while there is no line, so the page below does not jump.
    h.style.minHeight = state.settings.enabled ? "76px" : "";
    render(<Panel state={state} actions={actions} inline />, mount!);
  };
}

export function unmountBelowPanel() {
  const host = document.getElementById(BELOW_ID);
  const mount = host?.shadowRoot?.querySelector<HTMLElement>("#mount");
  if (mount) render(null, mount);
  host?.remove();
}
