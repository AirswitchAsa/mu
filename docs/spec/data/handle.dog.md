# Data: Handle

## Description

A **handle** is a dataset's stable *identity* — provider-qualified and
`:`-delimited — and the only thing the `@Agent` ever moves in place of data. It
names *which dataset*, never *which query window*: the fetch time range is a
query parameter that decides which records to pull and merge, not part of the
handle (data-architecture.md §3). That is what lets `1Y` and `6M` pulls
accumulate under one dataset instead of fragmenting.

A handle is produced by `!encode_handle` from the `identity` block of a
`&ResourceDescriptor`, and round-trips to an on-disk directory path. The
`@Agent` receives handles from `!data_fetch` and passes them to `!data_view`
and `!apply_canvas_op`; the `#Renderer` resolves them through `!resolve`.

## Fields

- **string** — the serialized form, e.g. `tiingo:ohlcv:AMZN:1d`,
  `tiingo:news:AMZN`, `orats:options_chain:AMZN:2026-06-03`.
- **provider** — first component; part of identity because different providers
  are genuinely different data (adjusted vs. raw closes, split handling),
  preventing unsafe cross-provider merges by construction.
- **shape** — second component; the shape id (`ohlcv`, `metric`,
  `options_chain`, `news`) the dataset conforms to (see `#Shape`).
- **entity** — third component; upper-cased (e.g. `AMZN`). The dot is literal,
  so `BRK.B` needs no special-casing — why `:` was chosen over `.`.
- **kind-specific tail** — per structural kind: `series` →
  `… : entity : <resolution|metricId[:resolution]>`; `event-list` →
  `… : entity`; `cross-section` → `… : entity : asOf`.

## Notes

- **Locked encoding** (data-architecture.md §3), applied by `!encode_handle`:
  delimiter `:`; fixed component order per kind; `entity` upper-cased; reserved
  characters (`:`, `/`, whitespace) percent-encoded, all else literal; handle ↔
  path replaces `:` with `/`.
- A handle is opaque to the `@Agent` as a string key; it should not parse it.
  Component structure is the `#DataBroker`'s and `#Storage`'s concern.
- **Open:** percent-encoding must run *before* the path mapping so an encoded
  `/` inside a component never yields an extra path segment; the encode/decode
  pair must be proven round-trip-stable in tests.
