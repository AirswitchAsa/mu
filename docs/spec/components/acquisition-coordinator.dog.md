# Component: AcquisitionCoordinator

## Description

The server-side broker between *the decision to fetch* and *the fetch itself* —
the embodiment of **agent-initiated, server-executed** acquisition
(agent-integration.md §1, §4). The `@Agent` never calls a source directly; it
calls `!data_fetch`, and the coordinator routes through the `#ResourceRegistry`
to the right `#Resource`, runs its `fetch` server-side, and hands the
`&FetchResult` to the `#DataBroker`'s `!ingest`. The agent gets back only a
`&Handle` + summary.

## State

- **inflight** — dedup map of in-progress fetches keyed by `&Handle`, so two
  concurrent fetches of the same identity coalesce into one (reinforcing
  `!data_fetch` idempotency).
- **policy** — per-trigger boundary: `on_demand` (agent) vs. `cadence`
  (scheduler) acquisitions can carry different timeouts/limits; user-specific
  sensitive sources (e.g. an IBKR account) run short-lived behind a tighter
  boundary.

## Events

- **acquire(source, params, trigger)** — resolve the resource, run `fetch`
  server-side, `!ingest` the result, return handle + summary. Shared by
  `!data_fetch` and `!cadence_refresh`.

## Notes

- This is *the* place the data-path discipline is enforced on acquisition: the
  payload flows resource → broker, never resource → agent.
- It is the single funnel both triggers pass through, so retry/timeout/error
  handling lives in one place rather than scattered across resources.
- **Failure surfacing = typed errors.** A failed `fetch` (rate-limit, auth,
  network, not-configured) returns a **typed error** in the tool result —
  a small, structured `{ code, message }` the `@Agent` can branch on — never a
  raw vendor error or stack trace dumped into context. The coordinator catches
  and classifies; it does not leak the upstream payload.
