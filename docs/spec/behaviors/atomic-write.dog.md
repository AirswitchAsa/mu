# Behavior: atomic_write

## Condition

`!ingest` must persist a merged dataset (data leaves + `&MetaJson`) to
`#Storage`, possibly while a `#Renderer` is resolving the same `&Handle`.

## Description

**Write-temp-then-rename, under a per-handle in-process mutex.** Write new/
changed partition files (and the updated `meta.json`) to temp paths, fsync, then
atomically rename them into place; the rename is the commit point. A per-`&Handle`
mutex serializes writers — single-process µ needs no DB-grade concurrency, just
this in-memory lock (data-architecture.md §6). Readers (`!resolve`, `!data_view`)
take no lock and always see a consistent pre- or post-commit state.

## Outcome

No torn datasets: a reader sees either the old or the new dataset, never a half-
written merge. Only affected partitions/snapshots are rewritten, so a merge is
cheap.

## Notes

- The mutex is **per handle**, not global, so unrelated datasets ingest
  concurrently.
- `meta.json` is renamed last (or together) so the `#Catalog`'s view never points
  at data that isn't committed yet.
- Because the disk layer is durable, a crash mid-write leaves the prior committed
  dataset intact; orphaned temp files are swept on the next write or at startup.
