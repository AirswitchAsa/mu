# Behavior: merge_cross_section

## Condition

`!ingest` receives a payload for a dataset of kind `cross-section` (e.g.
`options_chain`) for a given `asOf`.

## Description

**Add or overwrite the whole snapshot keyed by `asOf`; never merge within a
snapshot.** A cross-section is fetched whole and written whole: re-fetching an
existing `asOf` replaces that snapshot's file; a new `asOf` adds a file. The
history-of-surface is the directory of dated snapshot files (glob them).

## Outcome

A directory of immutable-per-`asOf` snapshots under one handle's family; the
surface's time evolution is the set of `asOf`s present.

## Notes

- No within-snapshot row merge means a chain is atomic — partial chains are not
  stitched, avoiding a surface that is half one fetch and half another.
- A `Panel` (cross-section over time as one addressable object) is **deferred**
  (shapes.md); for now history is assembled by globbing snapshots.
