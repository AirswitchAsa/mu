# Behavior: get_canvas_state

## Condition

The `@Agent` needs specifics about the current canvas beyond the cheap
`&CanvasSummary` that rides along each turn — e.g. to read a window's full spec
before updating it.

## Description

A `#ToolSurface` verb that returns the **full** detail of the session's
`&SessionState` canvas: each `&Window`'s type, title, spec, bindings, and
provenance refs, plus layout and focus. Routed to the correct session by
`sessionID` (routing via `!bind_sessions`) and served from the `#SessionStore`.
It returns
*canvas* state, not bulk dataset payloads — window data is still read via
`!data_view` or drawn via `!resolve`.

## Outcome

The agent gets an accurate, complete picture of the canvas on demand, without
that detail bloating every turn — the "fetch the detail" half of append-summary/
fetch-detail (agent-integration.md §6).

## Notes

- Pairs with `!inject_canvas_state`: the summary is always present and cheap;
  the full state is pull-on-demand. Together they keep the context lean while
  preventing the agent from acting on a stale model.
- It does **not** return data payloads — only the canvas/spec/binding structure.
