# Data: ViewSlice

## Description

The optional second argument to `!data_view` — a bounded window request over a
materialized dataset, so the `@Agent` can reason over actual values without
bulk data entering its context. Absent → `!data_view` returns the `#Shape`'s
default summary instead of rows.

## Fields

- **timeRange?** — `{ start?, end? }` epoch-ms, for `series`/`event-list`:
  restrict to records in range.
- **last?** — integer N: the most recent N records (the common "latest close /
  five headlines" case).
- **asOf?** — for `point-in-time`/`cross-section`: a vintage cutoff (epoch-ms) —
  returns, per logical row, the latest vintage ≤ the cutoff ("as knowable as of D").
  Defaults to latest.
- **filter?** — shape-specific narrowing (e.g. one expiry of an options chain;
  a strike band).
- **fields?** — project a subset of record fields to shrink the response.

## Notes

- A slice is a *read request*, not a query language — it cannot join,
  aggregate, or compute; it only narrows. Reasoning math is the `@Agent`'s job
  over the returned values.
- The **bulk guard** in `!data_view` strictly caps what any slice can return; an
  over-broad slice is **refused** (it degrades to a summary), never
  truncated-and-dumped — raw data must not reach the agent's context. The exact
  numeric headroom is deferred; the strictness is not.
