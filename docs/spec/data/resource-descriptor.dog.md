# Data: ResourceDescriptor

## Description

What a `#Resource` declares *about a single dataset it can produce*, and what
`!data_fetch` returns inside a `&FetchResult`. It is the bridge between a fetch
request and a `&Handle`: its `identity` block feeds `!encode_handle`. Distinct
from `&ResourceManifest`, which describes the *resource as a whole* (its params
and the shapes it supplies) for `!data_list`.

## Fields

- **shape** — the shape id the payload conforms to (`ohlcv`, `metric`,
  `options_chain`, `news`). The `#DataBroker` validates payload against this
  `#Shape`'s schema at `!ingest`.
- **identity** — the ordered identity components for the shape's kind (provider,
  shape, entity, and the kind-specific tail). Feeds `!encode_handle`.
- **queryParams** — the params that drove the pull (`start`/`end`/`range` for
  series & event-list; expiry/strike filters for a chain). Recorded in
  `&Provenance`; **never** part of identity.

## Notes

- A descriptor describes *one* dataset; a `&ResourceManifest` advertises the
  *family* a resource can serve.
- `provider` in `identity` is concrete by the time a descriptor exists — even
  when the `@Agent` let `!data_fetch` default it, the returned descriptor names
  the resolved provider.
