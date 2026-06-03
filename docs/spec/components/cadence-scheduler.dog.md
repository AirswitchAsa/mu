# Component: CadenceScheduler

## Description

The clock that keeps public reference data fresh without an `@Agent` in the
loop. It triggers the *same* `#Resource` `fetch`es as on-demand acquisition,
just on a schedule, and they terminate in the *same* `!ingest` — cadence is "a
different trigger of the same resources" (data-architecture.md §7). It writes
the one shared store of the `#DataBroker`, like any other fetch.

## State

- **schedules** — per-dataset (or per-resource) cadence entries derived from
  the `cadence` field of `&ResourceManifest`: which handles refresh, how often,
  and the last run time.
- **scope** — operates on **public reference data** (OHLCV, perhaps news).
  User-specific / sensitive data is *not* scheduled — it is fetched on-demand,
  short-lived (see `#AcquisitionCoordinator`).

## Events

- **tick()** — on schedule, enqueue `!cadence_refresh` for due datasets via the
  `#AcquisitionCoordinator` (`trigger = cadence`).
- **schedule(handle, cadence) / unschedule(handle)** — register or remove a
  cadence entry.

## Notes

- Cadence refresh is idempotent the same way `!data_fetch` is: it re-fetches a
  range and merges, so a tick is a cheap no-op when nothing changed.
- **Open — v1 scope:** whether the scheduler ships in v1 or whether on-demand
  fetch alone is enough to start (the build sequence wires the agent loop before
  cadence). Proposed: scaffold the interface in v1, enable schedules later.
- **Open — what gets a cadence:** the default refresh policy (e.g. daily OHLCV
  after market close) is per-`@Maintainer` config, not hardcoded.
