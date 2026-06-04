# µ — Data Shapes (v0 reference)

> The concrete canonical shapes. **v0 / provisional:** this is the minimal set the *first*
> windows need, and it will be refined when the renderers are actually built (the "harvest the
> shapes" build step). It is not a comprehensive library — new shapes are minted on demand. The
> structural model, identity rules, and storage live in
> [data-architecture.md](./data-architecture.md); this is the field-level catalogue.

## Conventions

- **Time** is **epoch milliseconds, UTC**, everywhere. The *time-key column* is named per shape
  (`t` for series, `published_at` for news, `release_time` for releases, `as_of` for key_stats).
  Trading-calendar and timezone concerns live in the renderer, not in stored data.
- **Provider** is part of every handle; `fetch` defaults it. Handles use `:` delimiters and map
  to on-disk paths (see [data-architecture §3](./data-architecture.md)).
- Each entry below gives: **kind · record schema · identity · query params · merge key · storage**.

---

## `ohlcv` — price/volume bars

- **window:** price chart
- **kind:** `series`
- **record:** `{ t, open, high, low, close, adjClose, volume, factor? }`
  - `close` is raw; `adjClose` is split/dividend-adjusted; `factor` is the cumulative
    adjustment. Storing all three avoids the silent corruption of one ambiguous "close."
- **identity:** `provider : ohlcv : entity : resolution` — e.g. `tiingo:ohlcv:AMZN:1d`
- **query params:** `start` / `end` / `range` (drive the pull; not part of identity)
- **merge key:** `t`
- **storage:** volume-partitioned parquet, sorted by `t`

---

## `metric` — single-value numeric series

The generic indicator series. **One shape** covers IV rank, realized vol, skew, factor scores,
macro levels, and simple single-number fundamentals — they differ by *identity*, not by shape.

- **window:** indicator chart
- **kind:** `series`
- **record:** `{ t, value }`  (`label` and `unit` are dataset metadata in the descriptor, not
  per-row)
- **identity:** `provider : metric : entity : metricId [ : resolution ]` — e.g.
  `tiingo:metric:AMZN:realized_vol_20d:1d`, `fred:metric:CPIAUCSL:level:1mo`
  - **Slotting rule (resolved):** `entity` is *the subject the number is about*, `metricId`
    is *which quantity*. Equity-linked → entity is the ticker, metricId the indicator
    (`AMZN` / `realized_vol_20d`). Macro → entity is the upstream series code, metricId the
    observation/transform (`CPIAUCSL` / `level`, or `CPIAUCSL` / `yoy`). One rule, no macro
    special-case. (See the `Shape` spec in [spec/](./spec/components/shape.dog.md).)
- **query params:** `start` / `end` / `range`
- **merge key:** `t`
- **storage:** parquet (volume-partitioned for high-freq; a single small file for low-freq like
  quarterly/monthly), sorted by `t`

---

## `options_chain` — options snapshot

- **window:** options table / vol surface
- **kind:** `cross-section`
- **record (one row):**
  `{ expiry, strike, right /* call|put */, bid, ask, last, iv, delta, gamma, theta, vega, openInterest, volume }`
- **identity:** `provider : options_chain : entity : asOf` — e.g.
  `orats:options_chain:AMZN:2026-06-03`
- **query params:** optional expiry/strike filters (the snapshot is stored whole regardless)
- **merge:** keyed by **as-of** — re-fetching an as-of overwrites that snapshot; new as-ofs are
  added. No within-snapshot merge.
- **storage:** one parquet per as-of snapshot (the directory of snapshots *is* the surface
  history)

---

## `news` — news / catalysts *(built)*

- **window:** `news` wire
- **kind:** `event-list`
- **record (one item):**
  `{ id, published_at, source, headline, summary?, url?, tickers?, image_url?, sentiment? }`
  - `published_at` is epoch-ms UTC; `tickers` is a comma-joined symbol list (`"AMZN,MSFT"`) stored
    as one column and split by the client.
- **identity:** `provider : news : entity` — e.g. `finnhub:news:AMZN`, `yahoo:news:AMZN`,
  `cnbc:news:markets` (for general feeds `entity` is a feed slug, e.g. `markets`/`top`)
- **query params:** `start` / `end` / `range`
- **merge key:** `id` (a re-fetch of the same article is a no-op; a correction overwrites);
  `published_at` orders the feed
- **storage:** year-partitioned parquet, sorted by `published_at`

---

## `releases` — release calendar (point-in-time) *(built)*

- **window:** `releases` calendar
- **kind:** `point-in-time` (bitemporal)
- **record (one vintage):**
  `{ event, name, reference_period, as_of, release_time, status, forecast?, actual?, previous?, unit?, importance? }`
  - the logical row is `(event, reference_period)` — e.g. `AMZN-EPS` × `2026 Q1`; `as_of` is when
    this vintage became known. `forecast`/`actual` are real numbers (the expected-vs-actual pair);
    `status ∈ scheduled|released|revised`; `release_time` orders the calendar.
- **identity:** `provider : releases : entity` — e.g. `finnhub:releases:AMZN` (earnings),
  `fred:releases:GDP` (macro). `as_of` is a **column, not** in the handle.
- **query params:** `entity` (`asOf` cutoff on the read side)
- **merge key:** `(event, reference_period, as_of)` — a revision is a *new vintage*, never an
  overwrite; the as-of read returns the latest vintage ≤ a cutoff
- **storage:** year-partitioned parquet (by `release_time`), every vintage kept
- **what belongs here:** anything with a **release date + an expected/actual** — EPS, revenue,
  dividends, guidance, macro prints. *Not* continuously-moving or static facts (those are
  `key_stats`).

---

## `key_stats` — company key statistics (cross-section) *(built)*

- **window:** `key_stats` panel
- **kind:** `cross-section` (accumulating snapshot)
- **record (one stat):** `{ field, label, value, as_of, group? }`
  - `field` is the machine id (e.g. `peTTM`) — the within-snapshot row identity; `label` is the
    reader-friendly name (`"P/E (TTM)"`); `value` is a **display-ready string** (so a `42.3`, a
    `"$2.10T"`, and a `"Technology"` coexist in one column); `group` buckets the panel
    (`valuation`/`trading`/`profile`); `as_of` is the vintage.
- **identity:** `provider : key_stats : entity` — e.g. `finnhub:key_stats:AMZN`. `as_of` is a
  **column, not** in the handle (vintages accumulate under one handle).
- **query params:** `entity` (`asOf` cutoff on the read side)
- **merge key:** `(as_of, field)` — re-snapshotting overwrites a field within its vintage; a new
  `as_of` adds a vintage; the card shows the newest `as_of`
- **storage:** year-partitioned parquet (by `as_of`), every vintage kept
- **what belongs here:** **continuously-moving or static descriptive facts** — market cap, P/E,
  forward P/E, beta, 52-week range, dividend yield, sector, shares outstanding. *Not* dated
  expected/actual events (those are `releases`).

---

## Card ↔ shape map (the binding contract)

A renderer binds to a **shape, never a provider**. The agent picks the card by the *question*,
then fetches a matching shape and binds. This table is the source of truth (mirrored in each
renderer's `description` for `renderer_list`):

| card (`window.type`) | requires shape | answers | sources (examples) |
|---|---|---|---|
| `price_chart` | `ohlcv` | "how has price moved?" + indicators | yahoo |
| `compare` | `ohlcv` (≥2) | "how do these move relative to each other?" | yahoo |
| `news` | `news` | "what's being said / catalysts?" | yahoo, cnbc, finnhub |
| `releases` | `releases` | "what's expected vs what printed, by date?" | finnhub (earnings), fred (macro) |
| `key_stats` | `key_stats` | "what *is* this company right now?" | finnhub |
| `memo` | — | agent-authored prose, no data | — |

**Routing rule:** a fact with a *release date and an expected/actual* → `releases`; a
*continuously-moving or static descriptive* fact → `key_stats`; a *time path you want to chart* →
`series` (ohlcv today). This is what keeps P/E out of the calendar and EPS out of the stats panel.

## Deferred (not v0)

- **`metric`** (single-value numeric `series` — IV rank, realized vol, macro levels charted over
  time) — minted when an indicator chart needs it; until then macro actuals ride on `releases`.
- **`options_chain`** (the whole-table-per-`as_of` `cross-section` variant) — strikes × expiries ×
  greeks, fetched and written whole; needs ORATS.
- **Panel** (`cross-section` over time as one addressable object, e.g. the term structure) — for
  now history is assembled by globbing vintages.
