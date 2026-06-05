import type { TraceLine } from "./canvas-op.js";
import type { Handle } from "./handle.js";
import type { Provenance } from "./provenance.js";
import type { Placement, Window } from "./window.js";

/**
 * One entry in an assistant turn's INTERLEAVED timeline (conversation-experience).
 * Prose, reasoning, and tool activity are recorded in receipt order so a restored
 * turn renders identically to the live stream (live≡reload): text the agent wrote
 * before a tool call stays *before* that tool's row, not lumped at the end.
 * `text`/`reasoning` items are keyed by `id` (the opencode part id) and upserted —
 * their `text` is the cumulative content of that part. A `tool` item is one
 * ops-trace line (a canvas op or a data verb), appended where it occurred.
 */
export type TurnItem =
  | { readonly kind: "text" | "reasoning"; readonly id: string; readonly text: string }
  | { readonly kind: "tool"; readonly verb: string; readonly arg: string; readonly ret: string };

export interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly at: number;
  /** The ops-trace for an assistant turn (canvas + data verbs), so it survives a
   *  reload. Absent on user messages and on turns that ran no tools. */
  readonly ops?: readonly TraceLine[];
  /** The interleaved timeline (prose/reasoning/tool in order) for an assistant
   *  turn. Present on turns recorded since token-streaming landed; absent on
   *  legacy/restored-pre-this-change messages, which fall back to `text`+`ops`. */
  readonly items?: readonly TurnItem[];
}

/** One entry in the provenance trail: a window's binding back to a handle + stamp. */
export interface ProvenanceEntry {
  readonly id: string;
  readonly windowId: string;
  readonly handle: Handle;
  readonly provenance: Provenance | null;
  readonly at: number;
}

/**
 * SessionState — the authoritative state of one µ session (session-state.dog.md).
 * Mutated only through apply_canvas_op. `windows` (content) is agent-writable;
 * `layout` (placement) is user-only. Datasets are referenced by handle, never
 * embedded — the session owns bindings, not data.
 */
export interface SessionState {
  readonly id: string;
  /**
   * The opencode session this µ session is currently bound to (its disposable
   * executor). Decoupled from `id`: µ owns its identity; opencode is re-mintable.
   * When ABSENT, assume the legacy 1:1 model where `opencodeSessionId === id`
   * (rehydrated pre-decouple sidecars, or API-only sessions that never had a
   * driver). Reconcile-on-miss rewrites this field when a fresh opencode session
   * is minted for an existing µ session.
   */
  opencodeSessionId?: string;
  windows: Window[];
  /** windowId → placement; owned by user + auto_layout. */
  layout: Record<string, Placement>;
  focusedWindowId?: string;
  messages: ChatMessage[];
  provenanceLog: ProvenanceEntry[];
  readonly createdAt: number;
  updatedAt: number;
}

/** The full canvas detail returned by get_canvas_state (no dataset payloads). */
export interface CanvasState {
  readonly id: string;
  readonly windows: readonly Window[];
  readonly layout: Readonly<Record<string, Placement>>;
  readonly focusedWindowId?: string;
}
