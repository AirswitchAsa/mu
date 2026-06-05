import type { TraceLine } from "./canvas-op.js";
import type { Handle } from "./handle.js";
import type { Provenance } from "./provenance.js";
import type { Placement, Window } from "./window.js";

/**
 * One item in an assistant turn's interleaved timeline — prose, reasoning, and tool
 * calls in the order they happened. Built client-side from the stream (`chat_delta`
 * text/reasoning parts keyed by `id`, interleaved with `tool`/`canvas` events in
 * receipt order) and persisted on {@link ChatMessage.items} so a *restored* turn
 * renders identically to the live one (same live≡reload discipline as `ops`). A
 * `tool` item mirrors a {@link TraceLine}.
 */
export type TurnItem =
  | { readonly kind: "text"; readonly id: string; readonly text: string }
  | { readonly kind: "reasoning"; readonly id: string; readonly text: string }
  | { readonly kind: "tool"; readonly verb: string; readonly arg: string; readonly ret: string };

export interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly at: number;
  /** The ops-trace for an assistant turn (canvas + data verbs), so it survives a
   *  reload. Absent on user messages and on turns that ran no tools. */
  readonly ops?: readonly TraceLine[];
  /** The full interleaved turn timeline (prose ↔ tool calls in order). Present on
   *  streamed/restored assistant turns; `text`+`ops` remain the flat fallback for
   *  legacy messages and any client that doesn't render the timeline. */
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
  /** The opencode session this µ session currently drives. Decoupled from `id` so
   *  µ keeps a stable identity (and its persisted canvas/transcript) even when the
   *  opencode session is gone after a restart and has to be re-minted (WS3). When
   *  absent, the legacy 1:1 mapping (`opencodeSessionId === id`) is assumed. */
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
