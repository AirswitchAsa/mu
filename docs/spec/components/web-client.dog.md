# Component: WebClient

## Description

The playground frontend (system-design.md §2): a responsive **grid canvas** plus
a **chat panel**. It is the `@User`'s window into a session — it renders the
`#Canvas`'s windows through the `#RendererRegistry`, shows the conversation
streamed from the `#OpencodeDriver`, and is where the `@User` exercises layout
authority. It owns *layout*; it does not own *state* (that is the `#SessionStore`
server-side). This is the least-designed area (system-design.md §5).

## State

- **grid** — window placements from the `layout` of `&SessionState`; the `@User`
  rearranges/resizes (sticky manual placement), and `!auto_layout` fills gaps
  for new content.
- **renderers** — the `#RendererRegistry` instances that draw each `&Window`.
- **chat** — the message transcript, with optional inline tool traces.

## Events

- **userMessage(text)** — send to the `#MuServer` → `#OpencodeDriver`.
- **layoutEdit(windowId, placement)** — emit a `move`/`resize` `&CanvasOp` (only
  the `@User` may); applied by `!apply_canvas_op`.
- **renderWindow(window)** — resolve the window's `&Handle`s server-side
  (`!resolve`) and draw via the matching `#Renderer`.
- **provenanceQuery(windowId)** — surface "where did this come from?" from the
  `provenanceRefs` of the `&Window`.

## Notes

- Renderers resolve handles **server-side** and receive full data; the client
  never pulls bulk data through the agent path.
- **Live updates deferred:** v0 is resolve-on-render only; window auto-refresh
  waits on the DataBroker's later internal pub/sub (see `#DataBroker`), at which
  point the client gains a push channel. Not in v0.
- Layout is the `@User`'s exclusive authority; the `@Agent` authors content via
  `&Window`, never placement.
