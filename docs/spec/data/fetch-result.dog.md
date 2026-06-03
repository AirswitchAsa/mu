# Data: FetchResult

## Description

The single return shape of a `#Resource`'s `fetch` — the entire output contract
of the resource SDK's acquisition half (data-architecture.md §4). The
`#AcquisitionCoordinator` hands it to `!ingest`, which derives the `&Handle`
from `descriptor.identity`, validates `payload` against the `#Shape`, merges,
and stamps `provenance`.

## Fields

- **descriptor** — a `&ResourceDescriptor`; its `identity` becomes the `&Handle`.
- **payload** — the canonical payload for `descriptor.shape`: an array of
  records for `series`/`event-list`, a full table for a `cross-section`
  snapshot. Shape-validated at ingest; off-spec payloads are rejected.
- **provenance** — a `&Provenance` stamp for this acquisition.

## Notes

- A resource returns canonical data only — normalization to the shape happens
  *inside* `fetch`, before the result is built. The `#DataBroker` never sees raw
  vendor formats.
- The payload is the *increment* fetched this call, not the merged dataset;
  merge is the `#Shape`'s job, invoked by `!ingest`.
