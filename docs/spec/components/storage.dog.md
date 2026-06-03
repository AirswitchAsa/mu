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
- **per-kind layout:**
  - `series` → volume-partitioned parquet (high-freq partitioned by year/month
    so a merge rewrites only the affected chunk; low-freq a single small file),
    **sorted by `t`** (row-group min/max stats give range-scan efficiency — the
    "sparse index").
  - `event-list` → a json (or json-lines) file of items, sorted by `t`.
  - `cross-section` → **one parquet per `asOf` snapshot**; the directory of
    dated files *is* the surface history.
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
