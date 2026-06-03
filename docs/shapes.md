# µ — Data Shapes (v0 reference)

> The concrete canonical shapes. **v0 / provisional:** this is the minimal set the *first*
> windows need, and it will be refined when the renderers are actually built (the "harvest the
> shapes" build step). It is not a comprehensive library — new shapes are minted on demand. The
> structural model, identity rules, and storage live in
> [data-architecture.md](./data-architecture.md); this is the field-level catalogue.

## Conventions

- **Time** is **epoch milliseconds, UTC**, everywhere (`t`). Trading-calendar and timezone
  concerns live in the renderer, not in stored data.
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

## `news` — news / catalysts

- **window:** news timeline
- **kind:** `event-list`
- **record (one item):** `{ id, t, headline, url?, source?, sentiment?, symbols? }`
- **identity:** `provider : news : entity` — e.g. `tiingo:news:AMZN`
- **query params:** `start` / `end` / `range`
- **merge key:** `id` (event id — two distinct items at the same `t` are both kept)
- **storage:** json (or json-lines) of items, sorted by `t`

---

## Deferred (not v0)

- **Point-in-time fundamentals** — a `series` variant carrying both `period` (fiscal) and
  `report_date` (when the value became known), so backtests/factor work avoid lookahead. Minted
  when a no-lookahead window needs it; until then, simple fundamentals ride on `metric`.
- **Panel** (`cross-section` over time, e.g. the term structure as a single addressable object) —
  for now, assembled by globbing `cross-section` snapshots.
