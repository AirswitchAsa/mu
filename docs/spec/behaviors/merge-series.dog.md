# Behavior: merge_series

## Condition

`!ingest` receives a payload for a dataset of structural kind `series` (e.g.
`ohlcv`, `metric`) under an existing or new `&Handle`.

## Description

**Union rows by time key `t`, overwriting on collision.** New `t` values are
inserted; an incoming row whose `t` already exists replaces the stored row (a
re-fetch corrects prior data). The merged set is kept **sorted by `t`** and
written sparse — a row per actual observation, never a gap-filled grid. Because
`#Storage` is volume-partitioned, a merge rewrites only the affected
partition(s).

## Outcome

One accumulating, time-sorted, deduplicated `series` dataset under the stable
handle, regardless of how many overlapping ranges were fetched.

## Notes

- Overwrite-on-`t` (not keep-both) is correct for series: an instant has one
  true observation per provider. Cross-provider safety is handled upstream by
  provider-in-`&Handle`, so a merge never mixes providers.
- Low-frequency series (quarterly EPS, monthly CPI) use the same merge — they
  are just series with few rows.
