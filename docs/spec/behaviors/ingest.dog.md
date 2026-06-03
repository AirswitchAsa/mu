# Behavior: ingest

## Condition

A `&FetchResult` arrives at the `#DataBroker` from the `#AcquisitionCoordinator` —
the terminus of both on-demand (`!data_fetch`) and cadence (`!cadence_refresh`)
acquisition. This is the broker's **single write path**.

## Description

`ingest(handle, shape, payload, provenance)` runs, in order: (1) derive the
`&Handle` from `descriptor.identity` via `!encode_handle`; (2) **validate** the
`payload` against the `#Shape`'s record schema — an off-spec payload is
**rejected, not stored** (trust-but-verify); (3) dispatch to the shape's merge
for its kind (`!merge_series` / `!merge_event_list` / `!merge_cross_section`)
against any existing dataset; (4) persist via `#Storage` (`!atomic_write`),
rewriting only affected partitions/snapshots; (5) update the `#Catalog` and
write the `&MetaJson` sidecar with the new `&Provenance` and freshness. (A
later, separate notify step hangs off the deferred in-broker pub/sub; v0 has
none — see `#DataBroker`.)

## Outcome

The dataset under `handle` reflects the merged data; the catalog and `meta.json`
are current; provenance is stamped. The caller (coordinator) returns a `&Handle`
+ summary to the `@Agent` — never the payload.

## Notes

- Validation here *is* the "data fits the chart" guarantee — a `#Renderer`
  requiring the shape can trust any dataset of that shape.
- The whole ingest is atomic per handle (`!atomic_write` + in-process mutex): a
  reader either sees the pre-merge or post-merge dataset, never a torn write.
- It is the only mutator of broker state, which is what makes provenance and the
  catalog reliable.
