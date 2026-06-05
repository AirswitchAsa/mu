import { traceFromOp, type CanvasOp } from "./canvas-op.js";
import type { TurnItem } from "./session.js";

// =============================================================================
// µ — the ONE turn-timeline fold (interleaved prose ↔ tool calls). It runs in two
// places that MUST agree: the server folds the live event stream and persists the
// result on `ChatMessage.items`; the web client folds the same SSE events to render
// the in-flight turn. Sharing this single function is what guarantees live≡reload —
// a restored turn is byte-for-byte the live one. (Previously duplicated server-side
// and web-side, with only the web copy tested; that drift seam is now closed.)
//
// Rules (locked):
//   - text/reasoning items are upserted by `partId`; first-seen fixes the slot,
//     later deltas REPLACE the text (the wire is cumulative per part).
//   - a `tool` item is appended for each `tool` event AND each `canvas` op (mapped
//     via `traceFromOp`), in receipt order — prose before a tool call stays before it.
//   - `chat`/`done`/`error` carry no timeline content and are ignored.
// =============================================================================

/** Mutable accumulator: fold events one at a time (live) or all at once (reduce).
 *  `index` maps `partId` → its position in `items`. */
export interface TimelineState {
  items: TurnItem[];
  index: Map<string, number>;
}

export function emptyTimeline(): TimelineState {
  return { items: [], index: new Map() };
}

/**
 * The minimal structural shape this fold reads off a turn event. Both the server's
 * `MuEvent` and the web's `MuStreamEvent` unions are assignable to it (their relevant
 * variants carry exactly these fields; everything else is ignored), so ONE fold
 * serves both without coupling the two event unions.
 */
export interface TimelineEventInput {
  readonly type: string;
  readonly verb?: string;
  readonly arg?: string;
  readonly ret?: string;
  readonly op?: CanvasOp;
  readonly partId?: string;
  readonly kind?: "text" | "reasoning";
  readonly text?: string;
}

/** Fold one turn event into the timeline, mutating + returning `state`. */
export function applyTimelineEvent(state: TimelineState, e: TimelineEventInput): TimelineState {
  if (e.type === "tool") {
    state.items.push({ kind: "tool", verb: e.verb ?? "", arg: e.arg ?? "", ret: e.ret ?? "" });
  } else if (e.type === "canvas" && e.op) {
    state.items.push({ kind: "tool", ...traceFromOp(e.op) });
  } else if (e.type === "chat_delta" && e.partId && e.kind) {
    const item: TurnItem = { kind: e.kind, id: e.partId, text: e.text ?? "" };
    const at = state.index.get(e.partId);
    if (at === undefined) {
      state.index.set(e.partId, state.items.length);
      state.items.push(item);
    } else {
      state.items[at] = item;
    }
  }
  return state;
}

/** Build the full ordered timeline from a sequence of turn events (pure). */
export function buildTimeline(events: readonly TimelineEventInput[]): TurnItem[] {
  const state = emptyTimeline();
  for (const e of events) applyTimelineEvent(state, e);
  return state.items;
}
