# Data: MetaJson

## Description

The `meta.json` sidecar that sits in every dataset directory under `#Storage`.
It is the dataset's **survey card**: it lets `!data_list` report a dataset
(handle, shape, freshness, size) *without cracking open the parquet/json data
leaves*, and it carries the descriptor and `&Provenance` for citation. Written
atomically by `!ingest` alongside the data files (see `!atomic_write`).

## Fields

- **handle** — the `&Handle` string this directory materializes (redundant with
  the path, stored for direct read).
- **shape** — the shape id (`#Shape`) the data conforms to.
- **kind** — structural kind (`series` / `event-list` / `cross-section`).
- **descriptor** — the `&ResourceDescriptor` of the most recent fetch (identity
  + last queryParams).
- **provenance** — the latest `&Provenance` stamp.
- **freshness** — `{ firstT, lastT, fetchedAt }`: the time span the dataset
  covers and when it was last refreshed (drives staleness checks and
  `!cadence_refresh`).
- **rowCount** — logical rows in the dataset's current view: rows for
  series/event-list, latest-vintage rows for point-in-time/cross-section
  (one per `(event, reference)` / per field) — not the total accrued vintages.
- **sizeBytes** — on-disk size, for the `!data_list` survey and
  `!evict_shared_cache`.
- **contractVersion** — the data-contract version the records were written
  under, for forward migration.

## Notes

- `meta.json` is the **only** thing `!data_list` reads for the dataset half of
  its overview — never the data leaves. This is the storage-layout-maps-to-verbs
  property (data-architecture.md §6).
- It is derived state: it can be rebuilt by scanning a dataset's data files, so
  a corrupt sidecar is recoverable.
