# Actor: User

## Description

The single human operator of a self-hosted µ instance. The User talks to the
`#Canvas` through a chat panel and reads the windows the conversation produces.
They never write a UI spec, a query, or a key. Their authorities are
**conversing** (messages the `#OpencodeDriver` relays to the `@Agent`) and
**owning layout** — moving, resizing, and closing windows on the grid. Layout
edits the User makes flow through the same `&CanvasOp` vocabulary the `@Agent`
uses and land in the same `&SessionState`, so the next agent turn sees them
(via `!inject_canvas_state`).

Because µ is single-user and self-hosted, the User is also implicitly the
`@Maintainer`, but the two roles stay distinct: the User operates the running
system; the `@Maintainer` installs and configures it.

## Notes

- Single-user is a **locked scope decision** (product.md §7): no auth,
  multi-tenancy, or RBAC in early life. "User" is singular by design.
- The User's layout authority is exclusive — the `@Agent` authors *content*, not
  *placement* (see `!apply_canvas_op`, `!auto_layout`). Manual placement is
  sticky; auto-layout only fills gaps.
- Session save/share is future work; the model is built for it, v1 does not ship
  it.
