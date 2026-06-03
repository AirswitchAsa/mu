# Component: SessionStore

## Description

The server-side holder of every live session's `&SessionState` inside the
`#MuServer`. It is the single source of truth both the `@User` (via the
`#WebClient`) and the `@Agent` reconcile against, and the only thing
`!apply_canvas_op` mutates. It owns *session* lifecycle (windows, layout,
messages) — but **not** data: datasets live in the one shared `#DataBroker`
store and outlive any session.

## State

- **sessions** — µ session id → `&SessionState`. A session holds `&Window`
  *bindings* (handles), never dataset contents — the data is in the shared
  `#DataBroker`.

## Events

- **create(muSessionId)** — allocate fresh `&SessionState`; paired with the
  `#OpencodeDriver` creating an opencode session (`!bind_sessions`).
- **apply(muSessionId, ops)** — `!apply_canvas_op`: validate + mutate windows /
  layout / provenance.
- **summary(muSessionId)** — produce the `&CanvasSummary` for
  `!inject_canvas_state`.
- **get(muSessionId)** — full state for `!get_canvas_state`.
- **end(muSessionId)** — on opencode `session.deleted`, drop the
  `&SessionState` and the session mapping (`!bind_sessions`). **No data is
  touched** — broker datasets are shared and persist independently of any
  session.

## Notes

- Layout authority is enforced here: `apply` accepts layout ops only from the
  `@User`, content ops from either party (`&CanvasOp`).
- Persistence of `&SessionState` itself is tied to the future save/share
  feature; v0 may keep it in-memory. Either way it is cheap, because it holds
  only window/layout/message state plus handle bindings — never data.
