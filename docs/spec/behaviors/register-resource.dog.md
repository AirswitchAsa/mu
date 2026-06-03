# Behavior: register_resource

## Condition

The `#MuServer` starts up, or a `@Maintainer` installs a new `#Resource` plugin.

## Description

The `#ResourceRegistry` loads the plugin, reads its `&ResourceManifest`, and
**validates** it: the declared shapes must exist in the `#Shape` registry; the
params and `configSchema` must be well-formed. It then records the resource,
indexes it by shape (for provider defaulting), and computes initial availability
via `!resource_availability`. The resource runs **in-process and trusted** (it
may hold credentials).

## Outcome

The resource appears in `!data_list`'s sources half and becomes a routing target
for `!data_fetch` / `!cadence_refresh`. Its config **values** never leave the
server.

## Notes

- This is the **thin** extension surface — a new *source* of *existing* shapes.
  Adding a new shape is the heavy one (`#Shape`).
- A manifest declaring an unknown shape is rejected at registration, not at
  fetch time — failures surface early.
- **Open — discovery/install mechanism:** how plugins are discovered (a plugins
  directory, package convention, config manifest) is unspecified; proposed: a
  configured list of plugin packages loaded at boot. Worker/sandbox isolation is
  a later option (`&PackageLayout`).
