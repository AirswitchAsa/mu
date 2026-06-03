# Component: Canvas

## Description

The logical canvas plane: the set of `&Window`s in a session and the operations
that change them. It is the server-side authority (its state is the
`&SessionState` in the `#SessionStore`); the `#WebClient` is its view. The
`@Agent` and `@User` both act on it through one `&CanvasOp` vocabulary, applied
by `!apply_canvas_op`, with the standing asymmetry: **the agent authors content,
the user owns layout.**

## State

- **windows** — the live `&Window`s (content: type, spec, bindings) — the
  agent-writable surface.
- **layout** — grid placement per window — the `@User`-and-`!auto_layout`
  surface; never written by the `@Agent`.
- **focus** — the focused window id.
- **provenanceLog** — every binding's link back to a `&Handle` + `&Provenance`,
  so any on-screen number is traceable (product.md §6).

## Events

- **create / update / delete / focus / bind** — the agent-or-user content verbs,
  all via `!apply_canvas_op`.
- **move / resize** — `@User`-only layout verbs.
- **resolveForRender(windowId)** — the `#Renderer` resolves the window's
  `&Handle`s through `!resolve`, server-side, getting full data (never through
  `!data_view` or the agent).

## Notes

- The content/layout split is the whole canvas-plane design: one vocabulary, two
  authorities, reconciled by the runtime as the single applier — so a user's
  manual rearrange and an agent's new window never fight.
- Provenance tracking is mandatory: a `bind` op records into `provenanceLog`, and
  the `#WebClient` can always surface "where did this come from?".
