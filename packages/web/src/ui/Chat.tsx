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

/** The µ agent chip, repeated before each prose run. */
function Avatar(): JSX.Element {
  return <div className="mu-turn__role">µ</div>;
}

/** Render an interleaved timeline (live or restored) in array order as a stack of
 *  lines. The µ avatar leads the FIRST line of the turn (whatever its kind — a tool
 *  call or reasoning still gets it) and the start of every later prose RUN (text that
 *  follows a non-text item); tool rows, reasoning, and prose that continues the same
 *  run indent to align under it, no repeated avatar. Adjacent text parts each keep
 *  their own Markdown block — opencode splits prose across steps, cumulative per id. */
function Timeline({ items }: { items: TurnItem[] }): JSX.Element {
  return (
    <>
      {items.map((it, i) => {
        const withAvatar = i === 0 || (it.kind === "text" && items[i - 1]!.kind !== "text");
        const body =
          it.kind === "tool" ? (
            <ToolRow verb={it.verb} arg={it.arg} ret={it.ret} />
          ) : it.kind === "reasoning" ? (
            <Reasoning text={it.text} />
          ) : (
            <Markdown text={it.text} />
          );
        return (
          <div className={`mu-line${withAvatar ? "" : " mu-line--sub"}`} key={i}>
            {withAvatar && <Avatar />}
            <div className="mu-line__body">{body}</div>
          </div>
        );
      })}
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
      {/* Prefer the interleaved timeline; fall back to text+ops for legacy/restored
          -pre-streaming turns (which carry no `items`). */}
      {msg.items && msg.items.length ? (
        <Timeline items={msg.items} />
      ) : (
        <>
          {msg.text && (
            <div className="mu-line">
              <Avatar />
              <div className="mu-line__body">
                <Markdown text={msg.text} />
              </div>
            </div>
          )}
          {msg.ops && msg.ops.length > 0 && (
            // No prose? the ops line leads the turn, so it takes the avatar.
            <div className={`mu-line${msg.text ? " mu-line--sub" : ""}`}>
              {!msg.text && <Avatar />}
              <div className="mu-line__body">
                <OpsTrace ops={msg.ops} />
              </div>
            </div>
          )}
        </>
      )}
      {msg.error && (
        <div className="mu-line mu-line--sub">
          <div className="mu-error">{msg.error}</div>
        </div>
      )}
    </div>
  );
}

/** The in-flight turn: the SAME partial timeline as a committed turn, plus a
 *  "composing" pip. Falls back to the bare pip when nothing has streamed yet. */
function Thinking({ items }: { items?: TurnItem[] }): JSX.Element {
  const hasItems = Boolean(items && items.length);
  return (
    <div className="mu-turn mu-turn--agent">
      {hasItems && <Timeline items={items!} />}
      {/* The composing pip carries the avatar when nothing has streamed yet (so an
          in-flight turn still shows µ); once prose is streaming it sits indented
          under it, since the last prose run already owns the avatar. */}
      <div className={`mu-line${hasItems ? " mu-line--sub" : ""}`}>
        {!hasItems && <Avatar />}
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
  const stick = useRef(true); // follow the stream — released when the user scrolls up to read
  const localRef = useRef<HTMLTextAreaElement>(null);
  const taRef = inputRef ?? localRef; // App can focus the composer (e.g. on session pick)

  // Re-arm sticking whenever the user is near the bottom; release it when they scroll
  // up. Without this, auto-scroll would yank them back down while they read history.
  const onScroll = (): void => {
    const el = scrollRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // The scroll handler alone can lose a race against fast streaming: a token re-render
  // pins to the bottom in the same frame the user scrolls up, before the scroll event
  // lands. Catch the upward intent synchronously on wheel/touch so scroll-up ALWAYS
  // wins while the agent is typing — standard chatbot behavior. (onScroll re-arms once
  // they return to the bottom.)
  const release = (): void => {
    stick.current = false;
  };
  const onWheel = (e: React.WheelEvent): void => {
    if (e.deltaY < 0) release();
  };

  // Total characters streamed in the in-flight turn — moves on every token, so the
  // effect below re-runs and the view tracks the growing reply. (The bug: it keyed
  // only on chat.length/thinking, neither of which changes mid-stream.)
  const streamLen = pendingItems?.reduce((n, it) => (it.kind === "tool" ? n : n + it.text.length), 0) ?? 0;

  useEffect(() => {
    if (!stick.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length, thinking, pendingItems?.length, streamLen]);

  // Switching sessions re-arms sticking, so a freshly opened session always shows its
  // latest turn even if the user had scrolled up in the one they left.
  useEffect(() => {
    stick.current = true;
  }, [name]);

  const submit = (): void => {
    const text = draft.trim();
    if (!text || thinking || disabled) return;
    setDraft("");
    stick.current = true; // the user just sent — snap back to the bottom
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

      <div className="mu-chat__stream" ref={scrollRef} onScroll={onScroll} onWheel={onWheel} onTouchMove={release}>
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
