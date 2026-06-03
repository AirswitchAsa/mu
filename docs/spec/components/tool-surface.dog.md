# Component: ToolSurface

## Description

The **µ-native verb interface** — Level 1 of the two-level tool abstraction and
the *real* agent boundary, runtime-agnostic (agent-integration.md §2). The
registered verbs (as built):

- **data** — `!data_list`, `!data_fetch`, `!data_view`.
- **canvas** — the granular ops `canvas_create`, `canvas_update`, `canvas_bind`,
  `canvas_delete`, `canvas_focus` (each a `&CanvasOp` applied through
  `!apply_canvas_op`), plus the read `!get_canvas_state`.
- **capability** — `renderer_list`, returning the registered
  `&RendererManifest`s (types + spec schemas + `requiresShape`) so the agent can
  discover window types before composing.

Everything µ exposes to *any* `@Agent` is defined here; the `#OpencodePlugin` is
Level 2, a thin binding that surfaces these verbs as opencode tools. The same
Level-1 surface could later be wrapped in an MCP facade — a bolt-on, not the
foundation.

## State

- **verbs** — the registered verb set with descriptions/examples good enough
  that the generic verbs are unambiguous to a model (the naming maps onto
  opencode's `<file>_<export>` convention: a `data` module exporting
  `list`/`fetch`/`view`; a `canvas` family).
- **binding-agnostic** — the surface holds *no* session state; state lives in
  the `#SessionStore`. A verb call carries the session id, routed by
  `!bind_sessions`.

## Events

- **invoke(sessionId, verb, args)** — validate args, dispatch to the broker or
  `#Canvas`, return a handle/summary/result. Never returns bulk payloads.

## Notes

- The boundary is defined by *documenting this surface* — that is how the
  BYO-agent promise is honored without depending on opencode (agent-integration
  §2). opencode is simply its first binding.
- **Open — verb descriptions:** the exact tool descriptions/examples that make
  the generic verbs unambiguous to the model are still to be written and tuned
  (agent-integration.md §7).
