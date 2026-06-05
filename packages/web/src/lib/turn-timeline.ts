import { traceFromOp, type TurnItem } from "@mu/protocol";
import type { MuStreamEvent } from "./types";

// =============================================================================
// µ — turn timeline merge. Pure, keyless-testable folder over the SSE events of
// one assistant turn → an ordered `TurnItem[]` (the interleaved timeline). The
// SAME logic runs live (App.tsx, event-by-event) and is what the server persists,
// so a restored turn renders identically to the live stream (live≡reload).
//
// Rules (locked by the workstream):
//   - text/reasoning items are upserted by `partId`; first-seen fixes the slot,
//     later deltas REPLACE the text (the wire is cumulative per part).
//   - a `tool` item is appended for each `tool` event AND each `canvas` op (mapped
//     via the shared `traceFromOp`), in the order received — so prose written
//     before a tool call stays before that tool's row.
//   - `chat`/`done`/`error` carry no timeline content and are ignored here.
// =============================================================================

/** A minimal mutable accumulator so callers can fold events one at a time (live)
 *  or all at once (tests / reduce). `index` maps partId → position in `items`. */
export interface TimelineState {
  items: TurnItem[];
  index: Map<string, number>;
}

export function emptyTimeline(): TimelineState {
  return { items: [], index: new Map() };
}

/** Fold one SSE event into the timeline, mutating `state` and returning it. Only
 *  `tool`/`canvas`/`chat_delta` contribute; everything else is a no-op. */
export function applyTimelineEvent(state: TimelineState, e: MuStreamEvent): TimelineState {
  if (e.type === "tool") {
    state.items.push({ kind: "tool", verb: e.verb, arg: e.arg, ret: e.ret });
  } else if (e.type === "canvas") {
    state.items.push({ kind: "tool", ...traceFromOp(e.op) });
  } else if (e.type === "chat_delta") {
    const at = state.index.get(e.partId);
    if (at === undefined) {
      state.index.set(e.partId, state.items.length);
      state.items.push({ kind: e.kind, id: e.partId, text: e.text });
    } else {
      state.items[at] = { kind: e.kind, id: e.partId, text: e.text };
    }
  }
  return state;
}

/** Build the full ordered timeline from a sequence of turn events (pure). */
export function buildTimeline(events: readonly MuStreamEvent[]): TurnItem[] {
  const state = emptyTimeline();
  for (const e of events) applyTimelineEvent(state, e);
  return state.items;
}
