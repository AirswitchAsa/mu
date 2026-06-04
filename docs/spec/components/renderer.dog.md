# Component: Renderer

## Description

A renderer turns a *validated `&Window`'s `spec`* plus its *bound data* into UI
(product.md §6). It registers with a `&RendererManifest` declaring the window
type it serves, the spec schema it accepts, and the `#Shape` it requires. It
**never reasons and never touches a provider** — it binds to a *shape*, resolves
the window's `&Handle`(s) from the `#DataBroker` server-side (`!resolve`, full
data), and draws. The v0 set (registered as core in `@mu/server`): **`price_chart`**
(OHLCV candlesticks plus a catalog of spec-selected technical indicators — see below),
**`compare`** (index-normalized multi-instrument lines), **`memo`** (safe
markdown, no data binding), **`news`** (a scrolling wire feed), and **`releases`**
(a point-in-time release calendar — a vintage timeline). More shapes/renderers
(table) are later work.

### Indicator catalog — a curated vocabulary, not freeform compute

`price_chart` takes `spec.indicators: [{ name, params? }]`. The set of valid
`name`s + their params lives in **one shared catalog** (`@mu/protocol`
`INDICATORS`): the single source of truth the runtime validates agent specs
against (`!validate_spec` → `validateIndicators`) and the agent discovers via
`!renderer_list` (it rides on the manifest's `specSchema.indicatorCatalog`). The
`#WebClient` pairs each `name` with a pure compute fn (`lib/indicator-compute.ts`)
and a **generic renderer** that draws by the catalog's `placement`: `"price"`
indicators overlay the candle axis; `"pane"` indicators each get their **own
sub-pane with its own y-axis** (so volume/RSI/MACD/… are properly scaled — not
squeezed onto the price axis). An indicator may emit several outputs (Bollinger =
3 lines; MACD = 2 lines + a histogram). Each active indicator gets a legend entry
(swatch · label · last value) drawn by the renderer.

v0 catalog (21): price overlays `sma ema wma vwap bollinger donchian keltner psar
ichimoku supertrend`; own-pane `volume rsi macd stochastic atr obv cci adx
williamsr mfi roc`. **Adding one = a catalog entry + a compute fn** — the spec
shape, the validator, and the renderer are untouched. This is deliberately a
**closed, curated vocabulary**: the agent picks a name from the catalog, it never
authors a formula. Agent-authored/sandboxed compute remains deferred; the catalog
is the seam it would slot behind. (v0 simplifications: Ichimoku displacement is
clipped to the loaded range with no forward projection past the last bar and no
cloud fill; channel/band indicators draw as boundary lines, no shaded fill.)

### News + point-in-time — data plane deferred

`news` and `releases` ship as **presentational renderers only**: their manifests
are registered (so the agent can `!apply_canvas_op create` them and specs validate
— `news` spec `{ query?, limit? }`, `releases` spec `{ scope? }`, both
`requiresShape: []`), and the `#WebClient` draws them faithfully. But there is **no
live data plane behind them yet** — they render from baked sample data in the
client (`packages/web/src/ui/cards/sampleData.ts`), not from a broker `!resolve`.

Next round, to make them real (so they obey the same data-path discipline as the
charts):
- **Shapes.** Add a `news` shape (fields: `source`, `published_at`, `tickers[]`,
  `headline`, `summary?`, `image_url?`, `sentiment?`) and a point-in-time
  `releases` shape (fields: `series`, `as_of`, `reference_period`, `status`
  ∈ released|revised|scheduled, `actual?`, `forecast?`, `importance`). The
  releases shape is **bitemporal** — keyed by (event, vintage `as_of`) so a
  revision is a new row, never an overwrite (that is the whole point of "point in
  time": you can ask what was known *as of* a date).
- **Resources.** Add resource(s) producing those shapes (a wire/news API; an
  econ-calendar / earnings source). Same `#Resource` contract as `yfinance`.
- **Binding.** `news`/`releases` windows then carry `&Handle`s and the renderers
  read resolved rows instead of the baked sample — at which point
  `requiresShape` tightens to `["news"]` / `["releases"]` and `sampleData.ts`
  is deleted.

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
