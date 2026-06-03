# Behavior: merge_event_list

## Condition

`!ingest` receives a payload for a dataset of kind `event-list` (e.g. `news`).

## Description

**Union items by event `id`, not by time.** Two distinct items sharing the same
`t` are both kept; an incoming item whose `id` already exists overwrites the
stored one (correction). The merged set is kept sorted by `t` for rendering as
markers.

## Outcome

An accumulating, id-deduplicated, time-sorted event list — no item is dropped
merely for colliding on a timestamp.

## Notes

- Keying on `id` rather than `t` is the defining difference from `!merge_series`
  and the reason `event-list` is its own kind (data-architecture.md §2).
- `id` is the event's own stable identity from the source; a resource that lacks
  one must synthesize a deterministic id in `fetch` so re-fetches dedupe.
