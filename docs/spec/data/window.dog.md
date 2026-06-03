# Data: Window

## Description

A typed view on the `#Canvas` — the unit the `@Agent` creates and fills. The
agent does not draw; it requests a window *of a known type* (a type some
`#Renderer` serves) and supplies a validated spec plus the `&Handle`(s) it binds
to. The runtime validates the spec against the renderer's `&RendererManifest`
before the window enters `&SessionState`.

## Fields

- **id** — stable window id (referenced by `&CanvasOp`s and the
  `&CanvasSummary`).
- **type** — the window/renderer type (`price_chart`, `indicator_chart`,
  `table`, `memo`, `news_timeline`, …); must match a registered `#Renderer`.
- **title** — human-readable label shown in the chat-side summary.
- **spec** — the renderer-specific, validated configuration (the
  `&RendererManifest`'s spec schema): axes, overlays, columns, etc. Authored by
  the `@Agent`; **never** includes layout.
- **bindings** — the `&Handle`(s) this window resolves (`!resolve`) for its
  data; a chart may bind several (price + overlay metric).
- **provenanceRefs** — links into the `provenanceLog` of `&SessionState` for
  each binding, so the window can answer "where did this come from?".

## Notes

- **No layout fields here** — grid placement lives in the `layout` of
  `&SessionState`, owned by the `@User`. A window's *content* (spec + bindings) is the agent's;
  its *position* is not.
- The first window set is intentionally small (product.md §4); new types arrive
  by `!register_renderer`, and the `@Agent` may use one the moment it appears in
  the manifest.
