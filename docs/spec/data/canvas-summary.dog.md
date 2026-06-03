# Data: CanvasSummary

## Description

The cheap, always-present projection of `&SessionState` that rides along with
every user message into the `@Agent`'s context (`!inject_canvas_state`). It
gives the agent enough awareness not to duplicate a window the `@User` made or
reference one they closed, **without** bloating every turn with full state. The
full detail is fetched on demand by `!get_canvas_state`.

## Fields

- **windows** — one compact line per `&Window`: `{ id, type, title, handles }`
  (the bound `&Handle`s, not their data).
- **focusedWindowId?** — which window currently has focus.
- **windowCount** — total, so the agent knows if anything was truncated.

## Notes

- Deliberately *just* ids, types, titles, and handles — never specs, never
  payloads. This keeps the per-turn cost flat regardless of canvas size.
- Append-the-summary / fetch-the-detail is the explicit pattern of
  agent-integration.md §6; `!get_canvas_state` returns the full `&SessionState`
  view when the agent needs specifics.
