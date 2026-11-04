import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Cue, Gloss, Settings } from "../shared/types";
import css from "./transcript.css?inline";

export interface TranscriptProps {
  cues: Cue[];
  glossFor: (cue: Cue) => Gloss | null;
  currentIndex: number;
  glossedCount: number;
  settings: Settings;
  onSeek: (cue: Cue) => void;
  /** Bumped on every change so the memo-free list re-renders. */
  version: number;
}

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

function Transcript(p: TranscriptProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [showFluent, setShowFluent] = useState(p.settings.showFluent);
  const listRef = useRef<HTMLDivElement>(null);
  const userScrolledAt = useRef(0);

  // Follow the playhead unless the user scrolled the list in the last few seconds.
  useEffect(() => {
    if (collapsed || p.currentIndex < 0) return;
    if (Date.now() - userScrolledAt.current < 4000) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${p.currentIndex}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [p.currentIndex, collapsed]);

  const dark = document.documentElement.hasAttribute("dark");

  return (
    <div class={`wrap ${dark ? "dark" : ""}`}>
      <div class="head">
        <span>Transcript</span>
        <button class={showFluent ? "on" : ""} onClick={() => setShowFluent(!showFluent)} title="Show fluent English">EN</button>
        <button onClick={() => setCollapsed(!collapsed)}>{collapsed ? "Show" : "Hide"}</button>
        <span class="count">{p.glossedCount}/{p.cues.length} glossed</span>
      </div>
      <div
        class={`list ${collapsed ? "collapsed" : ""}`}
        ref={listRef}
        onWheel={() => (userScrolledAt.current = Date.now())}
        onTouchMove={() => (userScrolledAt.current = Date.now())}
      >
        {p.cues.map((c) => {
          const g = p.glossFor(c);
          return (
            <div key={c.index} data-i={c.index} class={`row ${c.index === p.currentIndex ? "cur" : ""}`} onClick={() => p.onSeek(c)}>
              <span class="time">{fmt(c.start)}</span>
              <div>
                <div class="de">
                  {g
                    ? g.tokens.map((t, i) => (
                        <span key={i} class="tok" title={t.en}>{t.de}{i < g.tokens.length - 1 ? " " : ""}</span>
                      ))
                    : c.text}
                </div>
                {g ? (
                  <>
                    <div class="en">{g.tokens.map((t) => t.en).join(" ")}</div>
                    {showFluent && g.fluent && <div class="fl">{g.fluent}</div>}
                  </>
                ) : (
                  <div class="pending">…</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Mount the transcript above YouTube's recommendations column. Idempotent. */
export function mountTranscript(): ((p: TranscriptProps) => void) | null {
  const column = document.querySelector<HTMLElement>("#secondary-inner") ?? document.querySelector<HTMLElement>("#secondary");
  if (!column) return null;
  let host = document.querySelector<HTMLElement>("#glosse-transcript");
  if (!host) {
    host = document.createElement("div");
    host.id = "glosse-transcript";
    column.prepend(host);
  } else if (host.parentElement !== column) {
    column.prepend(host);
  }
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
  return (p) => render(<Transcript {...p} />, mount!);
}

export function unmountTranscript() {
  const host = document.querySelector<HTMLElement>("#glosse-transcript");
  const mount = host?.shadowRoot?.querySelector<HTMLElement>("#mount");
  if (mount) render(null, mount);
}
