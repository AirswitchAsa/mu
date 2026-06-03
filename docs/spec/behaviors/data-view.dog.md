# Behavior: data_view

## Condition

The `@Agent` calls `data_view(handle, slice?)` to read values from a
materialized dataset in order to reason over them.

## Description

Resolve the `&Handle` to its dataset, then dispatch to the `#Shape`'s `view`
(view logic lives on the shape, so every source of a shape reads identically).
With no `&ViewSlice`, return the shape's **default summary** (a compact,
reasoning-relevant digest — e.g. for `ohlcv`: first/last bar, latest close,
count, min/max). With a slice, return the narrowed records — **subject to the
bulk guard**.

**The bulk guard** is the load-bearing rule, and it is **strict by design**: the
whole point is to never contaminate the agent's context with raw data. Two
responsibilities meet here. (1) The `#Shape` developer authors a *sensible,
small* default summary and view — keeping the view sensible is the developer's
responsibility, not the guard's. (2) The runtime then enforces a **hard, small
length headroom** on whatever a `view`/`slice` would return: if the result would
exceed it, do **not** return rows — return the summary plus a notice that the
slice was too broad, nudging the agent to narrow it or bind a `#Renderer`
instead (the renderer path gets full data via `!resolve`, server-side). The
guard never trims-and-returns a giant blob; it refuses and summarizes.

## Outcome

Either a small bounded read (within the strict headroom) or a summary. Bulk data
**never** enters the `@Agent`'s context; the renderer data path is unaffected.

## Notes

- **No data-size budget is fixed yet.** The exact numeric headroom is a tuning
  detail deferred until there's a real model + real renderers to measure
  against. What *is* settled now is the posture: the cap is small and strictly
  enforced, and a too-broad request is refused, not truncated-and-dumped.
- The developer keeps the view sensible; the runtime keeps it *safe*. Both must
  hold — a sensible summary that is still too long is still refused.
- Small reasoning-relevant scalars (latest close, a few headlines) ride back
  inline by design — the sanctioned exception to data-path discipline
  (agent-integration.md §1).
- The summary shape is per-`#Shape`; `data_view` only orchestrates and enforces
  the headroom.
