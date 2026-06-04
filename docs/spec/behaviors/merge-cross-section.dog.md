# Behavior: merge_cross_section

## Condition

`!ingest` receives a payload for a dataset of kind `cross-section` (v0: `key_stats`)
— a tall key-value snapshot of a single entity's fields, each row stamped with an
`as_of` vintage.

## Description

**Upsert by `(as_of, field)`; accumulate vintages under one handle.** A cross-section
is a snapshot of `field → value` rows fetched together and stamped with a common
`as_of`. Re-snapshotting the same `as_of` overwrites each field inside that vintage
(incoming wins); a *new* `as_of` adds a fresh vintage, so a field's history is the set
of vintages present. This rides the **one generalized SQL merge** (union incoming +
existing → `row_number()` over the dedupe keys `[as_of, field]`, incoming wins →
year-partitioned parquet by `as_of`) — there is no cross-section-specific storage path.

The **as-of read** (mirroring `point-in-time`) returns, per `field`, the latest vintage
on/before a cutoff — i.e. "the snapshot as it was knowable as of D". With no cutoff, the
reader returns all vintages and the card collapses to the newest `as_of`.

## Outcome

One accumulating dataset under a stable handle (`provider:key_stats:entity`, no `as_of`
in the handle) whose newest `as_of` is the live snapshot and whose older vintages remain
queryable.

## Notes

- This is `point-in-time` with the `reference_period` dimension collapsed (logical row =
  `field`, value revised over `as_of`). Same merge engine, one fewer key.
- Mixed value types (a number, a price, a string sector) coexist because `value` is stored
  **display-ready as a string** — formatting is the resource's job, the card stays dumb.
- **Deferred — whole-table variant:** an `options_chain` (strikes × expiries × greeks)
  is fetched and written *whole* per `as_of`. That variant would put `as_of` in the handle
  (one immutable dataset per snapshot) and skip within-snapshot upsert; it is out of v0
  (needs ORATS) and may reuse this kind's `as_of` axis or split into its own kind then.
