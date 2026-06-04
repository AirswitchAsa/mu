# µ — Data Architecture (the data plane)

> How data is shaped, identified, fetched, stored, and served. The agent's *access* to all of
> this — the verbs as tools, the data-path discipline — lives in
> [agent-integration.md](./agent-integration.md). The concrete v0 shapes are catalogued in
> [shapes.md](./shapes.md). Settled unless marked **Open**.

---

## 1. Principles

- **Everything in the broker is canonical.** Data is normalized into a small set of shapes at
  fetch time; everything downstream (storage, `view`, merge, rendering) is then generic.
- **The agent moves names, not data.** Datasets are addressed by deterministic **handles**;
  bulk data never travels through the agent (see [agent-integration §1](./agent-integration.md)).
- **Resources are thin; shapes are smart.** A resource only *fetches and normalizes*;
  validation, `view`, and merge belong to the *shape*.
- **The broker validates at ingest** — trust-but-verify. A source that emits off-spec data is
  rejected, not rendered.

---

## 2. The data contract

A canonical dataset is described in three layers:

1. **Structural kind** — *how data sits in time*. There are four:
   - **`series`** — records over a time axis, connected/interpolated when drawn (OHLCV, IV,
     realized vol, macro, fundamentals). Stored **sparse**: a row per actual observation, never
     a gap-filled grid. Low-frequency data (quarterly EPS, monthly CPI) is just a `series` with
     few rows — not a separate kind. A "current value" is the *last point* of a series, a
     `view`/render choice, not a kind. (This is why there is no `scalar` kind.)
   - **`event-list`** — discrete, irregular, timestamped items (news, catalysts, filings).
     Rendered as markers, *not* interpolated; many items may share a timestamp. Upserted by a
     stable **event id** (a correction overwrites; two items at the same minute both kept).
   - **`point-in-time`** — *bitemporal* facts whose value is **revised over time**: a logical
     row `(event, reference_period)` (e.g. `AMZN-EPS` × `2026 Q1`) carries an **expected and an
     actual**, and each **vintage** `as_of` is a NEW row, never an overwrite — so you can ask
     "what was knowable *as of* date D". Earnings and macro releases. The two numbers beside a
     dated, named event are exactly why this is its own kind, distinct from a plain `event-list`.
   - **`cross-section`** — a **snapshot of fields for one entity**, accumulating vintages: a tall
     key-value table (`field → value`) stamped with an `as_of`, re-snapshotted on refresh
     (company key-stats: P/E, market cap, sector, beta). The newest `as_of` is "now"; older
     vintages are kept, so a stat's history is recoverable. *(A whole-table-per-`as_of` variant —
     an options chain, strikes × expiries × greeks fetched and written whole — is **deferred**
     until `options_chain` is built; it will reuse this kind's `as_of` axis or split out then.)*
2. **Record schema** — what one element holds (see [shapes.md](./shapes.md) for the concrete
   records).
3. **Descriptor** — a dataset's identity + context: shape + identity components + query params +
   provenance + freshness.

The **shape id is the lingua franca**: resources declare the shape they *produce*, renderers
declare the shape they *require*, and the broker validates at ingest that a payload matches —
that validation *is* the "data fits the chart" guarantee. The contract is versioned, and (per
dashboard-first) we define the *framework* now and mint concrete shapes as renderers demand them.

### Shapes own behavior

A shape carries the generic operations that must be identical across every source of that shape:
**validation** (ingest gate), **`view` / summary** (bounded read + default summary), and
**merge**. Because tiingo-OHLCV and yfinance-OHLCV must `view` and merge identically, this logic
lives on the shape, never in a resource. **Merge is per kind:**

| kind | merge semantics |
|---|---|
| `series` | union rows by **time key**, dedupe/overwrite (incoming wins) |
| `event-list` | **upsert by event id** (a correction overwrites; two items at the same minute both kept); the **time key** orders the feed |
| `point-in-time` | **append by (event, reference_period, as_of)** — a revision is a *new vintage row*, never an overwrite; the **time key** (release time) orders the calendar; the *as-of read* returns, per logical row, the latest vintage ≤ a cutoff ("what was knowable as of D") |
| `cross-section` | **upsert by (as_of, field)** — re-snapshotting overwrites a field inside its vintage; a new `as_of` adds a vintage; the *as-of read* returns, per field, the latest vintage ≤ a cutoff |

All four run through **one generalized SQL merge** in storage (union incoming + existing → `row_number()` dedupe over the kind's keys, incoming wins → year-partitioned parquet). The kinds differ only in *which keys* they dedupe on and whether they expose an as-of read — there is no per-kind storage code path.

---

## 3. Identity & handles

### A handle is the dataset's *identity*, not the query window

`fetch`'s time range is a **query parameter** that decides which records to pull and merge — it
is **not** part of the handle. If range were in the handle, `1Y` and `6M` would fragment into
two datasets that merge can never unify. So the dataset *accumulates* under a stable handle, and
`view(handle, slice)` reads whatever window you want out of it.

### Provider is part of identity

Different providers are genuinely different data (adjusted vs. raw closes, split handling,
timestamp conventions). Provider-in-identity prevents unsafe cross-provider merges *by
construction* and bakes provenance into the name. The canonical shape gives a uniform *format*
(so renderers are source-agnostic) — it is **not** a license to merge across sources. The agent
stays provider-agnostic in practice: `fetch` **defaults** the provider (µ resolves the request to
the configured/preferred source and returns the concrete, provider-qualified handle).

### Identity composition (per kind)

```
series         provider : shape : entity : <resolution / metric>    tiingo:ohlcv:AMZN:1d
event-list     provider : shape : entity                            finnhub:news:AMZN
point-in-time  provider : shape : entity                            finnhub:releases:AMZN
cross-section  provider : shape : entity                            finnhub:key_stats:AMZN
```

For **`point-in-time`** and **`cross-section`** the vintage **`as_of` is a column, not part of the
handle** — the dataset *accumulates* vintages under one stable handle (the same reasoning that
keeps the query range out of the handle). *(The deferred whole-table `options_chain` variant would
instead put `as_of` in the handle — one immutable dataset per snapshot, e.g.
`orats:options_chain:AMZN:2026-06-03` — which is why cross-section's identity is listed without
an as-of here.)*

Exact components per shape are in [shapes.md](./shapes.md).

### Canonical encoding

- **Delimiter `:`** (chosen over `.` so tickers like `BRK.B` need no special-casing — the dot is
  literal).
- **Fixed component order** per kind (above); the **`entity`** component is upper-cased.
- Any component character in the reserved set (`:`, `/`, whitespace) is **percent-encoded**;
  everything else (`.`, `-`, …) is literal. This keeps the encoding reproducible: the same
  identity always serializes to the same string.
- **Handle ↔ path:** replace `:` with `/` — the handle *is* the on-disk directory path
  (`tiingo:ohlcv:BRK.B:1d` ↔ `tiingo/ohlcv/BRK.B/1d/`).

---

## 4. The resource contract

A **resource** is a data source, and it is deliberately thin. It owns exactly two things:

1. **A descriptor it declares** — id, the params it accepts, the shape(s) it produces, and
   whether it is currently **configured / available**. (The runtime's `data_list` aggregates
   descriptors; a resource does *not* implement `list`.)
2. **`fetch`** — source-specific acquisition that returns:

   ```
   fetch(...) → {
     descriptor: { shape, identity, ...queryParams },  // identity → handle
     payload:    <canonical payload for that shape>,
     provenance: { source, fetchedAt, ... },
   }
   ```

   The broker derives the handle from `descriptor.identity`, validates `payload` against the
   shape, merges into any existing dataset under that handle, and stamps provenance.

That is the entire resource SDK surface: *declare yourself, and know how to fetch + normalize.*

- **In-process and trusted.** Resources are plugins loaded into the µ server; they run with the
  server's privileges and may hold credentials — acceptable for a self-hosted, self-installed
  tool. Worker/sandbox isolation is a later option.
- **Escape hatch.** A resource may proxy an external MCP server or shell out to a CLI when a
  source needs isolation or a non-TS runtime. Not the default path, but it keeps any source
  reachable.
- **Credentials stay server-side.** Keys live in the resource's configuration; they never reach
  the agent or the browser.

### Two extension surfaces, different weights

- **Add a resource** — a new *source* of *existing* shapes. Thin: descriptor + `fetch`.
  (yfinance, tiingo, orats.)
- **Add a shape** — a new *data type*. Heavier: it brings its own validation, `view`, and merge,
  and usually a renderer that consumes it. A data-contract extension, not a resource.

### Starter resources

- **yfinance** — the zero-config on-ramp (no key). It's a Python lib; in TS this is
  `yahoo-finance2`, or a resource shells out to Python. Feeds the price chart.
- **tiingo / orats** — configurable (API key + params). `data_list` reports them available only
  once configured (an orats with no key is *listed-but-unavailable*). **orats proves the thesis**
  — the IV / skew / options-chain windows that earn a practitioner's trust need real options/vol
  data, so it should work early, not last.

---

## 5. The verbs

The agent's data interface is three universal verbs, namespaced **`data_*`** (which maps exactly
onto opencode's `<file>_<export>` tool naming — one `data` module exporting `list`/`fetch`/`view`;
the canvas family is `canvas_*`). Their packaging as tools is in
[agent-integration §2–3](./agent-integration.md).

- **`data_list`** → a dense, **manual-like overview** of the data surface: installed *sources*
  (params, shapes, availability) **and** materialized *datasets* (metadata only — handle, shape,
  freshness, size, optional one-line headline), tagged by kind. This is capability negotiation
  *and* "what do you already have?". Kept **bounded by filter** — it surveys the one shared
  store and never enumerates every handle. Never returns bulk data.
- **`data_fetch(source, params)`** → **idempotent** download-and-merge into the broker; returns a
  **handle + small summary**, never the payload. Re-fetching the same identity is a cheap
  merge/no-op, so dedup is automatic.
- **`data_view(handle, slice?)`** → a **bounded** read of a materialized dataset, for the agent to
  reason over. No slice → a default summary. A guard degrades an over-broad slice to a summary
  rather than dumping bulk into the agent's context.

**The renderer data path is separate.** Renderers resolve a handle directly from the broker,
server-side, and receive the *full* series. That path never goes through `data_view` or the agent.

---

## 6. Storage

**Folders + parquet/json**, no database. A **dataset is a directory**, and its layout maps onto
the verbs: a `meta.json` sidecar feeds `data_list` (survey) without cracking open the data, and
the data leaves feed `data_view` / `resolve`.

```
<root>/tiingo/ohlcv/AMZN/1d/
    meta.json        descriptor · provenance · freshness · rowcount   → data_list
    2024.parquet     time-partitioned bars (sparse, sorted by time)   → data_view / resolve
    2025.parquet
<root>/finnhub/news/AMZN/
    meta.json
    2026.parquet     event-list items, year-partitioned, sorted by published_at
<root>/finnhub/releases/AMZN/
    meta.json
    2026.parquet     point-in-time vintages (every as_of kept), sorted by release_time
<root>/finnhub/key_stats/AMZN/
    meta.json
    2026.parquet     cross-section vintages (every as_of kept); newest as_of = current snapshot
```

Per kind (**all four share the one year-partitioned parquet merge path**; they differ only in dedupe keys):

| kind | storage unit |
|---|---|
| `series` | sparse rows in a **year-partitioned** parquet (a merge rewrites only the affected year; low-freq → a single small file), **sorted by time** (row-group min/max stats give efficient range scans — the "sparse index") |
| `event-list` | rows in a year-partitioned parquet (by `published_at`), upserted by **id** |
| `point-in-time` | vintage rows in a year-partitioned parquet (by `release_time`), keyed **(event, reference, as_of)** — every vintage kept |
| `cross-section` | vintage rows in a year-partitioned parquet (by `as_of`), keyed **(as_of, field)** — every vintage kept; the newest `as_of` is the live snapshot |

- **One shared store (resolved):** a single root `<root>/<provider>/<shape>/…`, one directory
  per handle, shared across all sessions — **no per-session tier**. Data is fetched once and
  reused everywhere; idempotent fetch + the single write path let the broker resolve any update
  race on a handle. *(This resolves the §8 "broker scope" open question — see the
  [`DataBroker` spec](./spec/components/data-broker.dog.md).)*
- **Atomicity:** write-temp-then-rename; single-process µ makes per-handle locking a simple
  in-process mutex (no DB-grade concurrency).
- **In-memory over durable disk:** parsed hot data is cached in memory for serving; parquet/json
  on disk is the durable layer and answers persistence — the shared store survives a restart,
  and bounded growth is handled by eviction (everything evicted is idempotently re-fetchable).

---

## 7. The DataBroker

A typed, inspectable store of named datasets — **one shared store**, no per-session data
(named *DataBroker* to stay distinct from a future brokerage connector). Responsibilities:

- **Ingest** — `ingest(handle, shape, payload, provenance)`: validate against the shape, dispatch
  to the **shape's merge** for that kind, store, index the catalog. The **single write path** —
  on-demand and cadence both go through it — and, with idempotent fetch + per-handle locking, the
  point at which all update races on a handle are resolved.
- **Resolve** — `resolve(handle)` for renderers, server-side, full data.
- **Catalog** — what's present, of what shape, how fresh (powers the dataset half of `data_list`).
- **Subscribe / notify** — **deferred**: a separate mechanism to be designed later *inside* the
  broker; v0 is resolve-on-render.

### Acquisition: agent-initiated, server-executed

The agent never calls a source directly. It calls `data_fetch`; the µ server's **acquisition
coordinator** routes to the right resource, runs `fetch` server-side, and the resource deposits
canonical data via `ingest`. The agent receives only a handle + summary. (Full rationale in
[agent-integration §1](./agent-integration.md).)

### Cadence vs. on-demand

- **Public reference data** (OHLCV, perhaps news) refreshes on a **cadence** — a scheduler
  triggers the same resource `fetch`es on a clock.
- **User-specific / sensitive data** (e.g. IBKR account) is fetched **on-demand at runtime**,
  short-lived, behind a tighter boundary.

Both terminate in the same `ingest`; cadence is just a different trigger of the same resources.

---

## 8. Open

- **Broker scope — resolved: one shared store.** No tiering and no per-session data; a handle is
  global. The broker resolves update races via idempotent fetch + a single write path. (The
  full broker/data-contract design now lives in [spec/](./spec/), validated under DOG.)
- **Persistence** — the disk layer is the shared store; the remaining open piece is the
  **eviction policy** (size cap / staleness TTL / memory budget) for that store. There is no
  "session scratch" to expire — sessions hold bindings, not data.
- **Subscribe/notify** — deferred; a separate mechanism to be designed later *inside* the broker.
  v0 is resolve-on-render.
- **`data_view` guard** — resolved as a *strict, small headroom* that refuses (summarizes)
  over-broad reads; the exact numeric budget is deliberately deferred. Per-shape merge mechanics
  are specified in [spec/](./spec/) (per-kind merge behaviors).
- **First concrete shapes** are catalogued in [shapes.md](./shapes.md) as **v0** — they refine as
  the renderers are built. Point-in-time is now **built** (`releases`: earnings + macro, the
  bitemporal kind), and `cross-section` is **built** as the accumulating key-value snapshot
  (`key_stats`). Still deferred: `metric` (single-value series), the whole-table `options_chain`
  cross-section variant, and a true ALFRED vintage backfill (today vintages accrue via refresh).
