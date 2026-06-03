# Component: ResourceRegistry

## Description

The in-process registry of installed `#Resource` plugins. It loads resources at
`#MuServer` startup, holds their `&ResourceManifest`s, evaluates availability,
and is the lookup the `#AcquisitionCoordinator` uses to route a `!data_fetch`
to the right resource. It is the source half of `!data_list`.

## State

- **resources** — id → `#Resource` instance + `&ResourceManifest`.
- **byShape** — shape id → resources producing it. When the `@Agent` omits a
  provider in `!data_fetch`, the registry resolves a configured source for the
  requested shape+entity; when more than one qualifies, **the choice is the
  agent's** — `!data_list` surfaces the available providers and the agent picks
  the one it wants (it can always pass an explicit provider). The registry's own
  default is a simple deterministic pick (e.g. first configured), not a curated
  ranking.
- **availability** — per-resource `available` / `listed_but_unavailable`,
  recomputed by `!resource_availability` when config changes.

## Events

- **register(resource)** — `!register_resource`: validate the manifest, load the
  plugin, record it.
- **resolveProvider(shape, entity, provider?)** — pick the concrete resource for
  a fetch, defaulting the provider when omitted.
- **list()** — the installed-sources overview for `!data_list` (params, shapes,
  availability) — secrets excluded.

## Notes

- Registration is the **thin** extension surface: a new source of existing
  shapes. Contrast the heavy one — adding a `#Shape`.
- The registry never exposes config **values** to callers; it reports only
  *whether* a resource is configured (the credential boundary, `@Maintainer`).
- **Provider selection is the agent's design choice, not a maintainer-curated
  ranking.** µ defaults deterministically when the agent doesn't care; when it
  does, it sees the options in `!data_list` and chooses. This keeps µ from
  baking finance opinions into routing (a non-goal).
