# Behavior: data_fetch

## Condition

The `@Agent` calls `data_fetch(source, params)` to acquire data into the broker.
`source` may name a provider or be omitted (let µ default it); `params` carries
entity, range, resolution, filters.

## Description

**Idempotent download-and-merge.** The `#AcquisitionCoordinator` resolves the
concrete `#Resource` via the `#ResourceRegistry` (defaulting the provider when
omitted), runs its `fetch` **server-side**, and the resulting `&FetchResult`
goes through the broker's `!ingest` (validate → merge → store → catalog →
provenance). Re-fetching the same identity is a cheap merge/no-op, so dedup is
automatic and overlapping ranges accumulate under one `&Handle`.

## Outcome

Returns a **`&Handle` + a small summary** (e.g. row count, covered range, latest
value, or a few headlines) — **never the payload**. The agent then binds a
window to the handle (`!apply_canvas_op`) or reads a bounded `!data_view`.

## Notes

- **Agent-initiated, server-executed** is the load-bearing rule: the agent
  decides *what*; µ executes the *how*; bulk never returns to context
  (agent-integration.md §1).
- Provider defaulting keeps the agent provider-agnostic, yet the returned handle
  is concrete and provider-qualified — provenance is baked into the name.
- Idempotency comes from identity → `&Handle` collapsing (`!encode_handle`):
  same identity, same dataset, merge not duplicate.
