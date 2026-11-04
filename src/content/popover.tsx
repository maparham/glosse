import { useEffect, useRef, useState } from "preact/hooks";
import type { Explanation } from "../shared/types";

export interface PopoverState {
  open: boolean;
  selection: string;
  cue: string;
  explanation: Explanation | null;
  error: string | null;
  /** Milliseconds since the request went out, for the waiting message. */
  startedAt: number;
  history: { q: string; a: string }[];
  /** The answer currently streaming in, or null. */
  streaming: string | null;
  saved: boolean;
}

export interface PopoverActions {
  close: () => void;
  ask: (question: string) => void;
  save: () => void;
}

function Waiting({ since }: { since: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  const s = Math.floor((Date.now() - since) / 1000);
  return <div class="wait">Thinking about it{s > 2 ? ` (${s}s)` : ""}…</div>;
}

export function Popover({ state, actions }: { state: PopoverState; actions: PopoverActions }) {
  const [q, setQ] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const ex = state.explanation;

  useEffect(() => {
    if (state.streaming !== null) bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [state.streaming]);

  if (!state.open) return null;

  const submit = (e: Event) => {
    e.preventDefault();
    const question = q.trim();
    if (!question || state.streaming !== null) return;
    setQ("");
    actions.ask(question);
  };

  return (
    <div class="pop" onClick={(e) => e.stopPropagation()} onDblClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key !== "Escape") e.stopPropagation(); }} onKeyUp={(e) => e.stopPropagation()} onKeyPress={(e) => e.stopPropagation()}>
      <div class="pop-head">
        <span class="pop-sel">{state.selection}</span>
        {ex && <span class="pop-lemma">{ex.lemma}</span>}
        <button class="pop-close" title="Close (Esc)" onClick={actions.close}>×</button>
      </div>
      <div class="pop-body" ref={bodyRef}>
        {state.error && <div class="err">{state.error}</div>}
        {!ex && !state.error && <Waiting since={state.startedAt} />}
        {ex && (
          <>
            <div class="sec"><h4>Form here</h4><p>{ex.form_here}</p></div>
            {ex.grammar.length > 0 && (
              <div class="sec"><h4>Grammar</h4>
                <div class="g">{ex.grammar.map((g) => <><b>{g.label}</b><span>{g.note}</span></>)}</div>
              </div>
            )}
            <div class="sec"><h4>Why here</h4><p>{ex.position}</p></div>
            <div class="sec"><h4>Meaning in this line</h4><p>{ex.meaning_here}</p></div>
            {ex.other_meanings.length > 0 && (
              <div class="sec"><h4>Other meanings</h4><p>{ex.other_meanings.join(" · ")}</p></div>
            )}
            {ex.confusion && <div class="sec"><h4>Watch out</h4><p>{ex.confusion}</p></div>}
            {ex.breakdown.length > 0 && (
              <div class="sec"><h4>Word by word</h4>
                <div class="g">{ex.breakdown.map((b) => <><b>{b.word}</b><span>{b.note}</span></>)}</div>
              </div>
            )}
            {ex.examples.length > 0 && (
              <div class="sec"><h4>Examples</h4>
                {ex.examples.map((e) => (
                  <div class="ex"><div class="de">{e.de}</div><div class="lit">{e.literal}</div><div class="fl">{e.fluent}</div></div>
                ))}
              </div>
            )}
            {state.history.map((h) => (
              <div class="qa"><div class="q">{h.q}</div><div class="a">{h.a}</div></div>
            ))}
            {state.streaming !== null && <div class="qa"><div class="a">{state.streaming || "…"}</div></div>}
          </>
        )}
      </div>
      {ex && (
        <div class="pop-foot">
          <form class="ask" onSubmit={submit}>
            <input value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Ask a follow-up, e.g. why dative here?" />
            <button type="submit" disabled={state.streaming !== null}>Ask</button>
          </form>
          <div class="pop-actions">
            <button type="button" class={`save ${state.saved ? "done" : ""}`} onClick={actions.save} disabled={state.saved}>
              {state.saved ? "Saved to deck" : "Save word"}
            </button>
            <span>Esc closes · click another word to switch</span>
          </div>
        </div>
      )}
    </div>
  );
}
