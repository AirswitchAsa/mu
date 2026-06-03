# Data: ResourceManifest

## Description

What a `#Resource` declares to register itself with the `#ResourceRegistry`
(`!register_resource`) — describing the *resource as a whole*, as opposed to
`&ResourceDescriptor` which describes one dataset it can produce. It is the
source half of `!data_list`: the installed-sources overview the `@Agent` reads
to know what it can fetch.

## Fields

- **id** — the resource id; the `provider` component of every `&Handle` it
  produces (e.g. `tiingo`, `orats`, `yfinance`).
- **shapes** — the shape id(s) (`#Shape`) this resource can supply.
- **params** — the parameters its `fetch` accepts (entity, range, resolution,
  filters), with which are required, for capability negotiation.
- **configSchema** — the configuration the `@Maintainer` must supply (e.g. an
  API key); used by `!resource_availability` to decide configured-vs-not. The
  **values** (secrets) live server-side and are never part of any manifest sent
  to the `@Agent`.
- **availability** — derived: `available` / `listed_but_unavailable` (see
  `!resource_availability`).
- **cadence?** — optional refresh schedule for `!cadence_refresh` (which
  datasets refresh on a clock, and how often).

## Notes

- The split is deliberate: a manifest advertises the *family* of datasets a
  resource serves; a `&ResourceDescriptor` names *one* concrete dataset within
  it.
- `configSchema` declares *what* config exists (so `data_list` can say
  "needs a key"); it never carries the secret value — that is the credential
  boundary (`@Maintainer`).
