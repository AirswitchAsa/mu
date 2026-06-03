# Data: RendererManifest

## Description

What a `#Renderer` declares to register itself with the `#RendererRegistry`
(`!register_renderer`). It is the capability-negotiation record: it tells the
runtime which window type the renderer serves, the spec schema it accepts, and
the `#Shape` it requires — so the runtime can both **validate** an `@Agent`'s
window spec and **advertise** the type as available to the agent. "The agent
knows exactly what it is allowed to ask for" (product.md §6).

## Fields

- **type** — the window type id this renderer serves (`price_chart`,
  `options_table`, …); unique in the registry.
- **specSchema** — the schema (e.g. Zod/JSON-Schema) for the `spec` of a
  `&Window` of this type; the runtime validates agent-authored specs against it.
- **requiresShape** — the shape id(s) (`#Shape`) the renderer binds to; the
  runtime checks a bound `&Handle`'s shape matches.
- **title / description** — human- and agent-facing summary, surfaced in
  `!data_list`-style capability negotiation so the agent picks the right type.
- **trust** — `core` (trusted, in-bundle) or `thirdParty` (subject to the
  sandbox model; see `!register_renderer`).

## Notes

- A renderer binds to a **shape, never a provider** — the one indirection that
  makes a new data source light up existing renderers automatically
  (product.md §6).
- `specSchema` is the contract the `@Agent` writes against; getting it tight is
  what makes "the contract, not a tutorial, is the documentation" true.
- **Lightweight Charts** (Apache-2.0) is the base charting primitive for the
  core chart renderers; proprietary renderers are `thirdParty`, user-installed
  only.
