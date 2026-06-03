# Data: CanvasOp

## Description

The single declarative unit of change to a `#Canvas` — the "patch" of
product.md §3, applied by `!apply_canvas_op`. Both the `@Agent` and the `@User`
emit `CanvasOp`s into the *same* vocabulary; the runtime is the single applier
and authorizer. A turn's worth of ops is an ordered list applied
transactionally.

## Fields

- **op** — the verb: one of `create`, `update`, `delete`, `focus`, `bind`
  (content ops, agent- or user-emitted) or `move`, `resize` (layout ops,
  `@User`-only).
- **windowId?** — the `&Window` the op targets (absent for `create`, which
  mints one).
- **type?** — for `create`: the window/renderer type.
- **spec?** — for `create`/`update`: the renderer-validated spec fragment
  (content only; no layout).
- **handle?** — for `bind`/`create`: the `&Handle`(s) to bind.
- **placement?** — for `move`/`resize`: grid coordinates; **rejected if the
  emitter is the `@Agent`**.

## Notes

- **Authorization is per-op-class, not per-field:** the runtime accepts layout
  ops only from the `@User`. An `@Agent`-emitted `move`/`resize` is rejected,
  enforcing "agent authors content, not layout".
- Ops are validated before application (`!apply_canvas_op`); an op naming an
  unknown window, an unregistered type, or an off-schema spec is rejected — the
  list applies atomically or not at all.
