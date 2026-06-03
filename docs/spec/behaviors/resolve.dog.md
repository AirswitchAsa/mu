# Behavior: resolve

## Condition

A `#Renderer` (via the `#WebClient`, server-side) needs the **full** data for a
`&Window`'s bound `&Handle` in order to draw.

## Description

`resolve(handle, slice?)` looks up the dataset in the `#DataBroker`'s one shared
store, reads its leaves from the hot cache or `#Storage`
(range-scanning parquet/json by sort order + row-group stats), and returns the
**full series / cross-section / event list** for rendering. Unlike `!data_view`,
there is **no bulk guard** — the renderer is entitled to all the data, because
this path never enters the `@Agent`'s context.

## Outcome

The renderer receives complete, canonical data for the handle and draws the
window faithfully. The agent was never in this path.

## Notes

- This is the deliberate asymmetry of the data plane: the `@Agent` reads bounded
  `!data_view`s; `#Renderer`s read full `resolve`s — both server-side, but only
  the renderer gets bulk.
- An optional `slice` lets a renderer ask for only the visible range (e.g. a
  zoomed chart) as an efficiency measure, not a guard.
- **Live updates are deferred:** v0 is resolve-on-render — a renderer
  `resolve`s each time it draws. Incremental notification waits on the
  DataBroker's later internal pub/sub (see `#DataBroker`).
