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

### News + point-in-time — live on the data plane

`news` and `releases` are **real, bound renderers** — they obey the same data-path
discipline as the charts: a window carries `&Handle`(s), the `#WebClient` resolves
each handle server-side (`!resolve`), and the card draws the rows. The manifests
`requiresShape: ["news"]` / `["releases"]`; the old baked `sampleData.ts` is gone.

- **Shapes** (in `@mu/broker`):
  - `news` — an **event-list** (`merge.idKey = id`, ordered by `published_at`):
    `id`, `published_at`, `source`, `headline`, `summary?`, `url?`, `tickers?`
    (comma-joined), `image_url?`, `sentiment?`. A re-fetch upserts by `id`.
  - `releases` — **point-in-time / bitemporal** (`merge` keyed by
    `(event, reference_period, as_of)`, ordered by `release_time`): `event`,
    `name`, `reference_period`, `as_of` (vintage), `release_time`, `status`
    ∈ scheduled|released|revised, `forecast?`, `actual?` (real numbers), `previous?`,
    `unit?`, `importance?`. A revision is a **new vintage row**, never an
    overwrite — so the store answers "what was known *as of* date D" (the broker's
    as-of read; the client mirrors it by keeping the latest-known vintage per
    release). This is what makes "point in time" point-in-time: no lookahead.
- **Resources.** One shape, many resources (the modularity seam). Shipped:
  **no-key** `yahoo` (per-ticker RSS) + `cnbc` (general/section RSS) → `news`;
  **keyed** `finnhub` → `news` (company-news) + `releases` (earnings, estimate vs
  actual) and `fred`/ALFRED → `releases` (econ vintages). Keyed resources declare a
  `configSchema` and stay dormant until `isConfigured()` (key in `.env`) — so the
  app works no-key out of the box and richer sources are an additive opt-in.
- **Binding & aggregation.** A card binds **1..N** handles; the agent aggregates
  (`cnbc:news:MARKETS` + `yahoo:news:AMZN` on one wire) or splits. The wire
  interleaves by time and **labels every source** (no cross-source dedup).
- **Freshness.** The merger owns fetch+merge; the v0 trigger is a **manual global
  refresh** (`POST /api/sessions/:id/refresh` → re-acquire each bound handle from
  its stored descriptor → re-resolve). For `releases` this is where a now-available
  actual lands as a new vintage. A background **cadence scheduler** (auto-snapshot
  forecasts before a release, push a "handle changed" nudge over the existing SSE —
  *not* websockets) is the deferred next step; true moving-tick real-time is out of
  scope (this app's grain is minutes, not seconds).

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
