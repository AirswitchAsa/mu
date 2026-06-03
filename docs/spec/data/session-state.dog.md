# Data: SessionState

## Description

The complete, authoritative state of one µ session — the "playground per
conversation" (product.md §4). Held server-side by the `#SessionStore`, mutated
**only** through `!apply_canvas_op`, and the single source of truth both the
`@User` (via the `#WebClient`) and the `@Agent` reconcile against. It is the
unit that a future save/share feature would serialize.

## Fields

- **id** — the µ session id; maps 1:1 to an opencode session id (see
  `!bind_sessions`).
- **windows** — the ordered set of `&Window`s currently on the `#Canvas`.
- **layout** — per-window grid placement (column/row/span), owned by the
  `@User` and `!auto_layout`; the `@Agent` never writes this.
- **messages** — the chat history of the conversation (mirrors the opencode
  session's transcript).
- **provenanceLog** — the trail tying each `&Window` and memo claim back to a
  `&Handle` and its `&Provenance`.
- **createdAt / updatedAt** — epoch-ms UTC lifecycle stamps.

## Notes

- **Content vs. layout split is structural:** `windows` (content) is
  agent-writable; `layout` is `@User`-only. The same `&CanvasOp` vocabulary
  carries both, but the runtime authorizes layout ops only from the `@User`
  (see `!apply_canvas_op`).
- A compact projection of this state (`&CanvasSummary`) rides along with every
  agent turn via `!inject_canvas_state`; the full state is fetched on demand by
  `!get_canvas_state`.
- Datasets are *referenced by* `&Handle` from `windows`, never embedded — the
  one shared `#DataBroker` holds the data (visible to every session), the session
  holds only the bindings. A session owns no private data and outlives nothing in
  the store.
