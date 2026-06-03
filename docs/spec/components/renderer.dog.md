# Component: Renderer

## Description

A renderer turns a *validated `&Window`'s `spec`* plus its *bound data* into UI
(product.md §6). It registers with a `&RendererManifest` declaring the window
type it serves, the spec schema it accepts, and the `#Shape` it requires. It
**never reasons and never touches a provider** — it binds to a *shape*, resolves
the window's `&Handle`(s) from the `#DataBroker` server-side (`!resolve`, full
data), and draws. The v0 set (registered as core in `@mu/server`): **`price_chart`**
(OHLCV candlesticks with baked, spec-toggled SMA/EMA/volume overlays),
**`compare`** (index-normalized multi-instrument lines), and **`memo`** (safe
markdown, no data binding). More shapes/renderers (indicator chart, table, news
timeline) are later work.

## State

- **manifest** — the `&RendererManifest` (`type`, `specSchema`, `requiresShape`,
  `trust`).
- **render inputs** — the validated `&Window`'s `spec` + the resolved full dataset
  for each binding.

## Events

- **render(spec, data)** — produce the UI for the window (client-side, in the
  `#WebClient`).
- **(trusted core renderers)** draw on **Lightweight Charts** (Apache-2.0) for
  charting.

## Notes

- The shape indirection is the modularity seam: a new `#Resource` (source) of an
  existing shape lights up every renderer that requires that shape, with zero
  renderer changes.
- **Trust (v0):** renderers are trusted, in-core code built on **Lightweight
  Charts**. There is no third-party renderer surface in v0, so no sandbox is
  designed yet — that boundary is later work (`!register_renderer`).
- A renderer's data path is **separate from the agent's**: full data via
  `!resolve`, never via `!data_view`. Renderers are the only consumers of full
  series.
