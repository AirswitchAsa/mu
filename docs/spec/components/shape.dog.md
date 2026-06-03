# Component: Shape

## Description

A **shape** is the unit that owns the generic behavior identical across every
source of a data type — the inversion of "resources are thin, shapes are smart"
(data-architecture.md §2). Not a running service but a registered bundle of pure
functions keyed by shape id, dispatched by the `#DataBroker`. Each shape declares
its **structural kind** (`series`, `event-list`, `cross-section`) and implements
**validate** (the `!ingest` gate), **view/summary** (for `!data_view`), and
**merge** (per kind: `!merge_series` / `!merge_event_list` /
`!merge_cross_section`).

The shape id is the lingua franca: `#Resource`s declare the shape they produce,
`#Renderer`s declare the shape they require (`&RendererManifest`), and validation
at `!ingest` *is* the "data fits the chart" guarantee. The v0 catalogue
(`ohlcv`, `metric`, `options_chain`, `news`) lives in shapes.md; new shapes are
minted on demand (dashboard-first).

## State

- **shapeId** — the canonical id; the second `&Handle` component.
- **kind** — the structural kind, selecting the merge behavior.
- **recordSchema** — the per-record field schema (the validate gate); versioned
  with the contract (the `contractVersion` of `&MetaJson`).
- **identitySpec** — the ordered identity components this shape requires (feeds
  `!encode_handle`).

## Events

- **validate(payload)** — invoked by `!ingest`; rejects off-spec payloads before
  storage.
- **summarize(dataset) / view(dataset, slice)** — invoked by `!data_view`.
- **merge(existing, incoming)** — invoked by `!ingest`, delegating to the
  kind-appropriate merge behavior.

## Notes

- Adding a shape is the **heavy** extension surface (data-architecture.md §4):
  validation + view + merge + identity spec, usually plus a `#Renderer`. Adding
  a `#Resource` (a new source of an existing shape) is the thin one.
- Concrete record schemas are **v0 / provisional** and refine as renderers are
  built; the *framework* (kind → merge, shape → validate/view) is what is
  settled.
- **`metric` identity rule (decided):** `provider : metric : entity : metricId
  [: resolution]`, where **`entity` is the subject the number is *about*** and
  **`metricId` is *which quantity*** about it. For equity-linked metrics the
  entity is the ticker and the metricId is the computed indicator
  (`tiingo:metric:AMZN:realized_vol_20d:1d`). For macro the entity is the
  upstream economic-series code and the metricId is the published/derived
  observation (`fred:metric:CPIAUCSL:level:1mo`, or `…:CPIAUCSL:yoy:1mo` for a
  transform). This keeps one consistent rule across equity and macro — entity =
  subject, metricId = quantity — and avoids a special macro case. `resolution`
  is optional and only present for time-resolved series.
