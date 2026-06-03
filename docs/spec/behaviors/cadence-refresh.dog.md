# Behavior: cadence_refresh

## Condition

The `#CadenceScheduler` fires for a due dataset (public reference data with a
configured cadence), with no `@Agent` in the loop.

## Description

For each due handle, the scheduler asks the `#AcquisitionCoordinator` to
`acquire(source, params, trigger = cadence)` — the **same** `#Resource` `fetch`
and the **same** `!ingest` an on-demand `!data_fetch` uses, only clock-triggered.
It writes the one shared store like any other fetch (there is no separate tier).
The pull range is derived from the dataset's
the `&MetaJson` `freshness` (fetch since `lastT`), and the merge accumulates
into the
existing dataset.

## Outcome

Shared reference datasets stay current without user/agent action; the
`&Provenance` `trigger` records `cadence`. A tick with no new data is a cheap
merge/no-op.

## Notes

- Cadence and on-demand are *the same acquisition* with different triggers
  (data-architecture.md §7) — there is no second code path to keep in sync.
- Scope is **public reference data only**; user-specific/sensitive data is never
  scheduled (it is on-demand, short-lived; `#AcquisitionCoordinator`).
- **Open — v1 scope** (see `#CadenceScheduler`): the agent loop is wired before
  cadence in the build sequence; cadence may be scaffolded-then-enabled.
