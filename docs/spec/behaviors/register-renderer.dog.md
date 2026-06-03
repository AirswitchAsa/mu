# Behavior: register_renderer

## Condition

The `#WebClient` starts up, or a `@Maintainer` installs a new `#Renderer`.

## Description

The `#RendererRegistry` reads the renderer's `&RendererManifest` (`type`,
`specSchema`, `requiresShape`, `trust`), validates that `requiresShape` names a
known `#Shape`, registers it under its `type`, and **mirrors the `specSchema` to
the `#MuServer`** so agent-authored `&Window` specs can be validated server-side
before they enter `&SessionState`. The window type becomes available to the
`@Agent` (capability negotiation).

## Outcome

The `@Agent` may create windows of the new type the moment it is registered; the
runtime can validate and bind them; a bound `&Handle`'s shape is checked against
`requiresShape`.

## Notes

- **v0 = trusted, in-core renderers only.** µ ships a small set of trusted
  renderers built on **Lightweight Charts** (Apache-2.0); there is **no
  third-party renderer surface in v0** and therefore no sandbox to design yet.
  The `trust` field exists in `&RendererManifest` so the model is ready, but a
  third-party/untrusted-renderer trust & isolation boundary is explicitly **not
  being touched for v0** — it is later work.
- **Open — install mechanism:** how a renderer is discovered/loaded
  (config list, plugins dir, npm convention) mirrors `!register_resource`;
  for v0 this is just the in-core set, so a configured package list suffices.
- Renderers bind to a **shape, not a provider** — the modularity seam
  (`#Renderer`, `&RendererManifest`).
