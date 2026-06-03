# Component: DataBroker

## Description

The typed, inspectable store of *named* datasets — the heart of the data plane
(data-architecture.md §7). It is named **DataBroker** (not just "Broker") to
keep it distinct from a future *brokerage* connector — an actual trading-broker
MCP/resource a `@Maintainer` might one day configure is a `#Resource`, not this
component.

**There is exactly one shared store.** Data is never session-private: a dataset
is global, addressed by its provider-qualified `&Handle`, and visible to every
session. This *is* the point of having a broker — datasets are fetched once and
reused everywhere, and the broker, as the **single write path**, **resolves
every race** on a handle. Both on-demand (`!data_fetch`) and cadence
(`!cadence_refresh`) acquisitions terminate in its `!ingest`; because fetch is
idempotent and merge is deterministic, concurrent writers to the same handle
(two sessions fetching the same series, or a cadence tick racing an on-demand
fetch) serialize and converge rather than corrupt. It owns ingest-validate,
merge dispatch, resolve, and the catalog, and delegates per-shape behavior to
the `#Shape` registry and per-kind durability to `#Storage`. The `@Agent`
reaches it only through the data verbs; `#Renderer`s reach it through
`!resolve`, server-side, for full data.

## State

- **single shared store** — one global, handle-keyed namespace; **no per-session
  overlay and no tiering**. A handle resolves to the same dataset for everyone.
  Cross-session reuse is the default, not an opt-in.
- **hot cache** — parsed datasets held in memory for fast serving (in-memory
  over durable disk; data-architecture.md §6). Bounded; governed by
  `!evict_shared_cache`.
- **catalog** — the `#Catalog` index of what is present, of what shape, how
  fresh.
- **durable layer** — `#Storage` (folders + parquet/json); the disk layer is the
  source of truth and survives restart.

## Events

- **ingest(handle, shape, payload, provenance)** — `!ingest`: validate → merge →
  store → index. The only mutator, and the point at which races on a handle are
  serialized (`!atomic_write`).
- **resolve(handle, slice?)** — `!resolve`: full-data read for `#Renderer`s,
  server-side.
- **catalog query** — powers the dataset half of `!data_list`.

## Notes

- **Idempotency + single write path = the concurrency model.** Re-fetching an
  identity is a cheap merge/no-op (`!data_fetch`), and a per-handle mutex
  (`!atomic_write`) serializes overlapping writes, so the broker resolves all
  update races itself — no session isolation is needed, and none is provided.
- **Live updates (subscribe/notify) are deferred** — a *separate* mechanism to
  be designed later, living **inside** the DataBroker. v0 is resolve-on-render
  only: a `#Renderer` `!resolve`s when it draws. When that internal pub/sub is
  designed, auto-refreshing windows hang off it without changing the verbs or
  the `#WebClient` contract.
- Single-process µ means DataBroker concurrency is in-process: a per-handle
  mutex, not DB-grade locking (see `!atomic_write`).
