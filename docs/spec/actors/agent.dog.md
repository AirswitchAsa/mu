# Actor: Agent

## Description

The reasoning party behind a thin boundary. In the default binding the Agent is
a **headless opencode session** driven by the `#OpencodeDriver`, but µ depends
on no particular implementation — the Agent is *anything that speaks µ's
`#ToolSurface`*. One µ session maps to exactly one opencode session.

The Agent's authority is broad but bounded. It may call any verb on the
`#ToolSurface` — the data verbs (`!data_list`, `!data_fetch`, `!data_view`) and
the canvas verbs (`!apply_canvas_op`, `!get_canvas_state`) — and through them
build any view the runtime knows how to render. It may **not** touch
credentials, the DOM, layout, or bulk data: it moves `&Handle`s, never payloads
(the load-bearing constraint of agent-integration.md §1).

## Notes

- **Untrusted by construction.** Every operation the Agent emits is validated by
  the `#MuServer` against the contract before it touches `&SessionState`. An
  invalid or unknown op is rejected, not applied.
- The Agent reasons over data only through bounded `!data_view` reads and the
  small summaries `!data_fetch` returns — never the full payload.
- The Agent is provider-agnostic in practice: `!data_fetch` defaults the
  provider and returns the concrete provider-qualified `&Handle`.
