# Behavior: data_list

## Condition

The `@Agent` calls `data_list` (optionally filtered) to learn what it can fetch
and what already exists — capability negotiation *and* "what do you already
have?".

## Description

Return a dense, **manual-like overview** of the data surface in two halves:
(1) **installed sources** — from the `#ResourceRegistry`: each `#Resource`'s
params, the `#Shape`s it supplies, and its availability (`available` /
`listed_but_unavailable`, per `!resource_availability`); (2) **materialized
datasets** — from the `#Catalog`: metadata only (handle, shape, kind, freshness,
size, optional one-line headline), read from `&MetaJson`, never the data leaves.
All datasets are shared (`#DataBroker`), so this half surveys the one global
store.

Kept **bounded by filter**: `data_list` returns matching datasets and **never
enumerates the whole store**. The agent narrows by provider/shape/entity; what
*this* session is already using it knows from its own `&Window` bindings. Never
returns bulk data.

## Outcome

The agent knows which sources are usable and which datasets already exist —
enough to choose between `!data_fetch` (acquire) and `!data_view` (read) — for a
small, bounded context cost.

## Notes

- Secrets are never included: sources report *whether* they are configured, not
  their config values (credential boundary, `@Maintainer`).
- The "never enumerate-all" rule keeps a large shared store from flooding the
  agent's context; an unfiltered `data_list` summarizes the store (counts by
  provider/shape) rather than listing every handle.
