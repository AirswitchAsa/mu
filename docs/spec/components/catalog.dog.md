# Component: Catalog

## Description

The `#DataBroker`'s index of materialized datasets — "what's present, of what shape,
how fresh" (data-architecture.md §7). It answers the dataset half of
`!data_list` and locates datasets for `!resolve` without scanning the disk on
every call. It is built from the `&MetaJson` sidecars and kept in sync on every
`!ingest`.

## State

- **entries** — one record per `&Handle`: shape, kind, freshness
  (`firstT`/`lastT`/`fetchedAt`), `rowCount`/`snapshotCount`, `sizeBytes` —
  i.e. the survey fields of `&MetaJson`, never the data leaves. One flat,
  instance-wide index — no per-session partition (all data is shared).
- **lastAccess** — per-entry access timestamp, feeding `!evict_shared_cache`.

## Events

- **register(handle, meta)** — on every `!ingest`, upsert the entry.
- **drop(handle)** — on eviction (`!evict_shared_cache`).
- **survey(filter?)** — read path for `!data_list`.
- **rebuild()** — reconstruct from `&MetaJson` files on startup (the index is
  derived state; disk is source of truth).

## Notes

- The catalog is **bounded by filter on read**, not by session: `!data_list`
  returns matching datasets by filter and never enumerates the whole store —
  preventing a large shared store from flooding the agent's context. What a
  session is *using* is known from its `&SessionState` window bindings, not from
  the catalog.
- Because it is rebuildable from sidecars, a lost or stale catalog is recovered
  by `rebuild()` on boot; it is a cache, not a database of record.
