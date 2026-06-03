# Component: MuServer

## Description

The single µ process (system-design.md §1) — the runtime that ties the planes
together. It holds `&SessionState` (via the `#SessionStore`), validates and
applies canvas operations (`!apply_canvas_op`), records provenance, hosts the
`#ToolSurface` / `#DataBroker` / `#ResourceRegistry` / `#CadenceScheduler`, and
**drives a headless opencode** through the `#OpencodeDriver`. Everything but the
`#WebClient` runs inside it; it is packaged as one Docker image.

## State

- **sessions** — the `#SessionStore`: all live sessions' `&SessionState`.
- **broker** — the `#DataBroker` and its `#Catalog` / `#Storage`.
- **registries** — the `#ResourceRegistry` and (frontend-facing)
  `#RendererRegistry` manifests it advertises to the `@Agent`.
- **toolSurface** — the `#ToolSurface`: the µ-native verbs, the real agent
  boundary.
- **driver** — the `#OpencodeDriver` running one opencode session per µ session.

## Events

- **handleUserMessage(sessionId, text)** — relay to the `@Agent` via the
  `#OpencodeDriver`, with `!inject_canvas_state` riding along.
- **applyOps(sessionId, ops)** — validate + apply `&CanvasOp`s to
  `&SessionState` (`!apply_canvas_op`), recording provenance.
- **toolCall(sessionId, verb, args)** — dispatch a `#ToolSurface` verb to the
  right session and broker (session routing is part of `!bind_sessions`).

## Notes

- **In-process plugin host:** `#Resource` and `#Renderer` plugins load into this
  process; MCP is *not* load-bearing (agent-integration.md §2). The agent
  interface is µ's own tool surface; opencode is one binding.
- Single process is what makes broker locking simple (`!atomic_write`) and the
  data path short (tool calls go straight into µ, not over MCP).
