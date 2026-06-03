# Component: RendererRegistry

## Description

The registry of installed `#Renderer`s, primarily frontend-side in the
`#WebClient`, with its manifests mirrored to the `#MuServer` so the runtime can
validate agent-authored `&Window` specs and advertise available window types to
the `@Agent`. This is capability negotiation: the `@Agent` may use a window type
the moment its `&RendererManifest` appears here.

## State

- **renderers** — type id → `#Renderer` + `&RendererManifest`.
- **specSchemas** — the per-type validation schemas the `#MuServer` checks
  `&CanvasOp` specs against (so an invalid spec is rejected before it enters
  `&SessionState`).
- **shapeIndex** — required-shape per type, so a `bind` op can be checked: the
  `&Handle`'s shape must match the renderer's `requiresShape`.

## Events

- **register(renderer)** — `!register_renderer`: validate manifest, install,
  mirror the schema to the server.
- **advertise()** — the available-types surface the `@Agent` reads when choosing
  a window type.
- **validateSpec(type, spec)** — the runtime hook used by `!apply_canvas_op`.

## Notes

- Manifests are mirrored to the server precisely so spec validation happens
  server-side (untrusted agent output is validated before it touches state) — the
  rendering itself stays in the `#WebClient`.
- **v0 holds only trusted, in-core renderers** (Lightweight Charts–based); the
  install mechanism and third-party sandbox/trust model are deliberately **not
  designed for v0** — see `!register_renderer`.
