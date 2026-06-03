# Behavior: inject_canvas_state

## Condition

A `@User` message is about to be relayed to the `@Agent` (the `#OpencodeDriver`
is composing a `session.prompt`).

## Description

Build the session's `&CanvasSummary` (window ids, types, titles, and bound
`&Handle`s — plus focus and count) from the `#SessionStore` and **append it to
the prompt** as an additional text part, so the agent always opens a turn aware
of the current canvas. It is deliberately cheap: ids/types/titles/handles only,
never specs or payloads. When the agent needs more, it calls `!get_canvas_state`.

## Outcome

The agent never duplicates a window the `@User` made or references one they
closed, yet the per-turn context cost stays flat regardless of canvas size
(agent-integration.md §6).

## Notes

- "Append the summary; fetch the detail" — this behavior is the always-on half,
  `!get_canvas_state` the on-demand half.
- Carrying the summary as a prompt part (the `#OpencodeDriver`'s
  `session.prompt` `body.parts`) means it rides the normal message path; no
  special opencode channel is needed.
- Because user layout edits land in the same `&SessionState`, the next injected
  summary reflects them — closing the loop between the two actors
  (system-design.md §3).
