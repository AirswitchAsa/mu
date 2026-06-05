import { useEffect, useRef, useState } from "react";
import type { TurnItem } from "@mu/protocol";
import { Markdown } from "./Markdown";

// =============================================================================
// µ — chat plane (right). User bubbles, agent prose, and the ops-trace that
// reveals the µ texture (validated ops + handles, never bulk). Drives onSend.
// =============================================================================

export interface TraceLine {
  verb: string;
  arg: string;
  ret: string;
}
export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  ops?: TraceLine[];
  /** The interleaved timeline (prose/reasoning/tool in order). When present it is
   *  the authoritative render; `text`/`ops` are the fallback for legacy turns. */
  items?: TurnItem[];
  error?: string;
}

function OpsTrace({ ops }: { ops?: TraceLine[] }): JSX.Element | null {
  if (!ops || !ops.length) return null;
  return (
    <div className="mu-ops">
      {ops.map((op, i) => (
        <div className="mu-ops__row" key={i}>
          <span className="mu-ops__verb">{op.verb}</span>
          <span className="mu-ops__arg">{op.arg}</span>
          <span className="mu-ops__ret">{op.ret ? `→ ${op.ret}` : ""}</span>
        </div>
      ))}
    </div>
  );
}

/** One tool row, reusing the ops-trace styling (a single `.mu-ops` block). */
function ToolRow({ verb, arg, ret }: { verb: string; arg: string; ret: string }): JSX.Element {
  return (
    <div className="mu-ops">
      <div className="mu-ops__row">
        <span className="mu-ops__verb">{verb}</span>
        <span className="mu-ops__arg">{arg}</span>
        <span className="mu-ops__ret">{ret ? `→ ${ret}` : ""}</span>
      </div>
    </div>
  );
}

/** Agent reasoning — shown but COLLAPSED by default (a locked decision); the user
 *  can expand it. Uses native <details> so it needs no extra state plumbing. */
function Reasoning({ text }: { text: string }): JSX.Element {
  return (
    <details className="mu-reasoning">
      <summary className="mu-reasoning__summary">reasoning</summary>
      <div className="mu-reasoning__body">
        <Markdown text={text} />
      </div>
    </details>
  );
}

/** Render an interleaved timeline (live or restored) in array order. Adjacent
 *  text parts each get their own Markdown block — opencode splits prose across
 *  steps, and the parts are already cumulative per id. */
function Timeline({ items }: { items: TurnItem[] }): JSX.Element {
  return (
    <>
      {items.map((it, i) =>
        it.kind === "tool" ? (
          <ToolRow key={i} verb={it.verb} arg={it.arg} ret={it.ret} />
        ) : it.kind === "reasoning" ? (
          <Reasoning key={i} text={it.text} />
        ) : (
          <Markdown key={i} text={it.text} />
        ),
      )}
    </>
  );
}

function Turn({ msg }: { msg: ChatTurn }): JSX.Element {
  if (msg.role === "user") {
    return (
      <div className="mu-turn mu-turn--user">
        <div className="mu-bubble">{msg.text}</div>
      </div>
    );
  }
  return (
    <div className="mu-turn mu-turn--agent">
      <div className="mu-turn__role">µ</div>
      <div className="mu-turn__col">
        {/* Prefer the interleaved timeline; fall back to text+ops for legacy/restored
            -pre-streaming turns (which carry no `items`). */}
        {msg.items && msg.items.length ? (
          <Timeline items={msg.items} />
        ) : (
          <>
            {msg.text && <Markdown text={msg.text} />}
            <OpsTrace ops={msg.ops} />
          </>
        )}
        {msg.error && <div className="mu-error">{msg.error}</div>}
      </div>
    </div>
  );
}

/** The in-flight turn: the SAME partial timeline as a committed turn, plus a
 *  "composing" pip. Falls back to the bare pip when nothing has streamed yet. */
function Thinking({ items }: { items?: TurnItem[] }): JSX.Element {
  return (
    <div className="mu-turn mu-turn--agent">
      <div className="mu-turn__role">µ</div>
      <div className="mu-turn__col">
        {items && items.length ? <Timeline items={items} /> : null}
        <span className="ds-loading">
          <span className="ds-loading__dot"></span>
          composing
        </span>
      </div>
    </div>
  );
}

export function Chat(props: {
  name: string;
  chat: ChatTurn[];
  thinking: boolean;
  /** the in-flight turn's partial interleaved timeline (prose/reasoning/tool). */
  pendingItems?: TurnItem[];
  width: number;
  disabled?: boolean;
  inputRef?: React.RefObject<HTMLTextAreaElement>;
  onSend: (text: string) => void;
  /** Cancel the in-flight turn (keeps the partial reply, labeled "stopped"). */
  onStop?: () => void;
}): JSX.Element {
  const { name, chat, thinking, pendingItems, width, disabled, inputRef, onSend, onStop } = props;
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const localRef = useRef<HTMLTextAreaElement>(null);
  const taRef = inputRef ?? localRef; // App can focus the composer (e.g. on session pick)

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length, thinking]);

  const submit = (): void => {
    const text = draft.trim();
    if (!text || thinking || disabled) return;
    setDraft("");
    onSend(text);
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter") {
      // single-line composer — Enter always sends, never inserts a newline
      e.preventDefault();
      submit();
    }
  };

  return (
    <aside className="mu-chat" style={{ width }}>
      <header className="mu-chat__head">
        <span className="mu-chat__name">{name}</span>
      </header>

      <div className="mu-chat__stream" ref={scrollRef}>
        {chat.map((m, i) => (
          <Turn key={i} msg={m} />
        ))}
        {thinking && <Thinking items={pendingItems} />}
      </div>

      <div className="mu-composer">
        <div className="mu-composer__field">
          <textarea
            ref={taRef}
            className="mu-composer__input"
            rows={1}
            wrap="off"
            placeholder={disabled ? "agent not configured (set MU_MODEL)" : "ask µ"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            disabled={disabled}
          />
          {/* While a turn streams, the send button becomes a STOP button: it aborts
              the turn (the partial reply is kept, labeled "stopped"). */}
          {thinking ? (
            <button className="mu-composer__send mu-composer__stop" onClick={() => onStop?.()} disabled={!onStop} aria-label="stop">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="1.5" />
              </svg>
            </button>
          ) : (
            <button className="mu-composer__send" onClick={submit} disabled={disabled} aria-label="send">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
