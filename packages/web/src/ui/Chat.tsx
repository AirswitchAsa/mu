import { useEffect, useRef, useState } from "react";
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
        {msg.text && <Markdown text={msg.text} />}
        {msg.error && <div className="mu-error">{msg.error}</div>}
        <OpsTrace ops={msg.ops} />
      </div>
    </div>
  );
}

function Thinking({ ops }: { ops?: TraceLine[] }): JSX.Element {
  return (
    <div className="mu-turn mu-turn--agent">
      <div className="mu-turn__role">µ</div>
      <div className="mu-turn__col">
        <span className="ds-loading">
          <span className="ds-loading__dot"></span>
          composing
        </span>
        <OpsTrace ops={ops} />
      </div>
    </div>
  );
}

export function Chat(props: {
  name: string;
  status: string;
  chat: ChatTurn[];
  thinking: boolean;
  pendingOps?: TraceLine[];
  width: number;
  disabled?: boolean;
  inputRef?: React.RefObject<HTMLTextAreaElement>;
  onSend: (text: string) => void;
}): JSX.Element {
  const { name, status, chat, thinking, pendingOps, width, disabled, inputRef, onSend } = props;
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
    if (taRef.current) taRef.current.style.height = "";
    onSend(text);
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const autoGrow = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setDraft(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`;
  };

  return (
    <aside className="mu-chat" style={{ width }}>
      <header className="mu-chat__head">
        <span className="mu-chat__name">{name}</span>
        <span className="mu-chat__status ds-spec" data-status={status}>
          <span className="ds-dot"></span>
          {status}
        </span>
      </header>

      <div className="mu-chat__stream" ref={scrollRef}>
        {chat.map((m, i) => (
          <Turn key={i} msg={m} />
        ))}
        {thinking && <Thinking ops={pendingOps} />}
      </div>

      <div className="mu-composer">
        <div className="mu-composer__field">
          <textarea
            ref={taRef}
            className="mu-composer__input"
            rows={1}
            placeholder={disabled ? "agent not configured (set MU_MODEL)" : "ask µ"}
            value={draft}
            onChange={autoGrow}
            onKeyDown={onKey}
            disabled={disabled}
          />
          <button className="mu-composer__send" onClick={submit} disabled={thinking || disabled} aria-label="send">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}
