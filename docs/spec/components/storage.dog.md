# Component: Storage

## Description

The durable layer: **folders + parquet/json, no database** (data-architecture.md
§6). A **dataset is a directory** whose layout maps onto the verbs — a
`&MetaJson` sidecar feeds the `#Catalog` / `!data_list` survey without cracking
open the data, and the data leaves feed `!data_view` and `!resolve`. The
directory path *is* the `&Handle` with `:` replaced by `/` (`!encode_handle`).

## State

- **root** — a **single** dataset root: `<root>/<provider>/<shape>/<entity>/…`,
  one directory per `&Handle`. There is **no `shared`/`session` split** — all
  data is shared (see `#DataBroker`), so a handle maps to exactly one directory
  for the whole instance.
- **per-kind layout** (one generalized merge → **year-partitioned parquet** for
  every kind; kinds differ only in dedupe keys + time key):
  - `series` → rows deduped by `t`, **sorted by `t`** (row-group min/max stats give
    range-scan efficiency — the "sparse index"); a merge rewrites only the affected
    year.
  - `event-list` → rows upserted by `id`, sorted by `published_at`.
  - `point-in-time` → vintage rows keyed `(event, reference, as_of)` — every vintage
    kept — sorted by `release_time`; the as-of read returns the latest vintage ≤ a
    cutoff.
  - `cross-section` → vintage rows keyed `(as_of, field)` — every vintage kept —
    sorted by `as_of`; the newest `as_of` is the live snapshot. *(Deferred whole-table
    `options_chain` variant: one parquet per `asOf`, `asOf` in the handle.)*
- **meta.json** — the `&MetaJson` sidecar in every dataset directory.

## Events

- **writeDataset(handle, kind, merged)** — atomic persist via `!atomic_write`
  (write-temp-then-rename), updating only the affected partition(s)/snapshot.
- **readLeaves(handle, slice)** — range-scan the parquet/json for `!data_view` /
  `!resolve`, using sort order + row-group stats to read only what's needed.
- **readMeta(handle)** — cheap sidecar read for the survey.
- **dropDataset(handle)** — remove a directory (eviction / session teardown).

## Notes

- Sparse storage is mandatory for `series`: a row per real observation, never a
  gap-filled grid. Low-frequency data (quarterly EPS, monthly CPI) is just a
  series with few rows.
- Atomicity is write-temp-then-rename; single-process µ makes a per-handle
  in-process mutex sufficient (no DB-grade concurrency) — see `!atomic_write`.
- The disk layer is the persistence answer: the one shared store survives a
  restart; bounded growth is handled by `!evict_shared_cache`, and everything
  evicted is re-fetchable (idempotently).
