import type { TraceLine } from "./canvas-op.js";
import type { Handle } from "./handle.js";
import type { Provenance } from "./provenance.js";
import type { Placement, Window } from "./window.js";

export interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly at: number;
  /** The ops-trace for an assistant turn (canvas + data verbs), so it survives a
   *  reload. Absent on user messages and on turns that ran no tools. */
  readonly ops?: readonly TraceLine[];
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
