# Behavior: evict_shared_cache

## Condition

The `#DataBroker`'s in-memory hot cache and/or the on-disk shared store grows
past its bound and must shed datasets.

## Description

Evict in two layers. **Hot cache (memory):** an **LRU** keyed by `#Catalog`
`lastAccess` — parsed datasets are dropped from memory under memory pressure;
they are re-readable from `#Storage` on next `!resolve`/`!data_view`, so eviction
is lossless for the hot cache. **Disk (the shared store):** a bounded reference
cache governed by a size cap and/or staleness — least-recently-accessed, stale
datasets are deleted from disk; they can be re-fetched on demand (`!data_fetch`)
because the store is a *cache* of re-acquirable data, not a system of record.

## Outcome

Memory and disk footprints stay bounded; nothing irreplaceable is lost
(everything evicted is re-derivable by an idempotent re-fetch). The `#Catalog`
entry is dropped when a dataset leaves disk.

## Notes

- Hot-cache eviction (memory→disk) and store eviction (disk→gone) are distinct:
  the first is always safe; the second loses local data until the next fetch.
- **Open — policy & thresholds:** exact memory budget, store size cap, and
  staleness TTL are unspecified. Proposed: configurable size caps with LRU +
  freshness; **never evict a dataset currently bound by a live `&Window`**.
  Resolve with the `@Maintainer`.
- This is the only lifecycle the shared store has — there is no per-session data
  to expire, because there is no per-session data (see `#DataBroker`).
