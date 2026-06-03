# Component: OpencodePlugin

## Description

**@mu/opencode-plugin** — Level 2 of the two-level tool abstraction: the thin
adapter that surfaces µ's `#ToolSurface` verbs as opencode tools and binds
opencode sessions to µ sessions (agent-integration.md §5). It is the *only* code
that knows opencode exists; if opencode were swapped, this is the package that
changes. No MCP is involved — each tool's `execute` calls straight into the
`#MuServer` (in-process / localhost), which *is* the data-path discipline.

## State

- **tools** — one opencode `tool({ description, args, execute })` per
  `#ToolSurface` verb (`data_list`, `data_fetch`, `data_view`,
  `canvas_*`/`apply_canvas_op`, `get_canvas_state`). Definitions are
  **stateless**; session state lives in µ.
- **sessionMap** — the µ ↔ opencode session mapping maintained by
  `!bind_sessions` (a session-keyed Map, the documented opencode pattern).

## Events

- **plugin init** — the plugin function `async ({ project, client, $,
  directory, worktree }) => ({ … })` returns its hooks + tools.
- **event hook** — handles `event.type === "session.created"` /
  `"session.deleted"` to bind/unbind sessions (`!bind_sessions`).
- **tool.execute.before / after** — optionally stream tool traces into the
  `#WebClient` chat panel.
- **tool execute(args, context)** — forwards to the `#MuServer`, using
  `context.sessionID` to route to the correct µ session and its broker (the
  routing maintained by `!bind_sessions`); returns handles + summaries, never
  payloads.

## Notes

- **Verified surface (June 2026):** plugins are `async (ctx) => hooks` from
  **@opencode-ai/plugin**; the `tool` helper defines custom tools; the `event`
  hook receives session lifecycle events (`session.created`, `session.deleted`,
  `session.idle`, …); `execute`'s context carries `sessionID`. Source:
  <https://opencode.ai/docs/plugins/>, <https://opencode.ai/docs/custom-tools/>.
- Tool *definitions* being stateless is what lets one plugin serve every session
  — routing is purely by `sessionID`, the state is all in the `#SessionStore`.
