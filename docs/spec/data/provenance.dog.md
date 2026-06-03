# Data: Provenance

## Description

The lineage stamp attached to every dataset and carried into citations. It
answers "where did this number come from?" — mandatory, not optional
(product.md §6). Produced by a `#Resource` inside its `&FetchResult` and
persisted by `!ingest` into the dataset's `&MetaJson`; a `#Renderer` and the
`#Canvas` surface it so any on-screen value traces back to a `#DataBroker` entry and
through it to a source.

## Fields

- **source** — the `#Resource` id that produced the data (e.g. `tiingo`,
  `orats`).
- **fetchedAt** — epoch-ms UTC timestamp of acquisition.
- **trigger** — `on_demand` (an `@Agent` `!data_fetch`) or `cadence` (a
  `#CadenceScheduler` tick); see `!cadence_refresh`.
- **queryParams** — the params the resource was called with (range, filters),
  for audit; not part of identity.
- **upstream?** — optional free-form source detail (vendor request id, URL,
  as-of) for deep citation.

## Notes

- Provenance accumulates: a dataset merged from several fetches keeps the most
  recent stamp at the dataset level. Per-record (per-row) provenance is **out of
  scope for v0** — flagged if a window ever needs it.
