# Component: Resource

## Description

A data source, deliberately **thin** (data-architecture.md §4). It owns exactly
two things: a `&ResourceManifest` it *declares* (id, params, shapes,
config/availability) and a **`fetch`** it *implements* — source-specific
acquisition that returns a `&FetchResult` of canonical, normalized data. It does
**not** implement `list` (the runtime aggregates manifests), `view`, or `merge`
(those belong to the `#Shape`). "Declare yourself, and know how to fetch +
normalize" is the entire resource SDK surface.

## State

- **manifest** — the `&ResourceManifest` (registered via `!register_resource`).
- **config** — `@Maintainer`-supplied configuration (API keys, endpoints), held
  **server-side**; never reaches the `@Agent` or browser.
- **availability** — `available` / `listed_but_unavailable`, derived by
  `!resource_availability` from whether required config is present.

## Events

- **fetch(params)** — acquire from the external source → normalize to the
  declared `#Shape`, returning a `&FetchResult` (`{ descriptor, payload,
  provenance }`).
  Run server-side by the `#AcquisitionCoordinator`; the broker `!ingest`s the
  result.

## Notes

- **In-process and trusted** for now: resources load into the `#MuServer` with
  its privileges and may hold credentials — acceptable for a self-hosted,
  self-installed tool. Worker/sandbox isolation is a later option
  (`&PackageLayout` notes).
- **Escape hatch:** a resource may proxy an external MCP server or shell out to
  a CLI when a source needs isolation or a non-TS runtime (e.g. yfinance via
  Python) — not the default path, but it keeps any source reachable.
- **Starter resources:** `yfinance` (zero-config on-ramp, no key — `yahoo-
  finance2` in TS or a Python shell-out), `tiingo` / `orats` (configurable). orats
  proves the thesis (real options/vol data) and should work early.
