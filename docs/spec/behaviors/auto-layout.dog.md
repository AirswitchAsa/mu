# Behavior: auto_layout

## Condition

A new `&Window` is created (`!apply_canvas_op` `create`) and has no `@User`-set
placement, or content arrives that needs a slot on the grid.

## Description

**Manual placement is sticky; auto-layout fills gaps on an infinitely
scrolling canvas.** The canvas is a column-based grid that **scrolls down without
bound** — there is no fixed viewport to pack into, so new content always has
somewhere to go. The engine never moves a window the `@User` has placed or
resized. For a new, unplaced window it flows top-to-bottom into the next free
slot (row-major gap-fill, per-type default sizes), extending the scroll region
downward as needed, and writes the placement into the `layout` of
`&SessionState`. User-pinned windows are fixed points the flow goes *around*.

## Outcome

New agent-authored content always lands somewhere sensible — appended into the
infinite scroll-down when no gap is open — without disturbing the `@User`'s
arrangement; the `@User` retains exclusive, durable layout authority.

## Notes

- This encodes the content/layout split from the `@User` side: the `@Agent`
  produces a `&Window` (content), and auto-layout — not the agent — decides
  where an *unplaced* one goes.
- **Infinite scroll-down is the decided model:** the canvas grows vertically
  without a packing ceiling, so auto-layout never has to evict or overlap to
  make room — it fills gaps, then appends below.
- Settled policy: row-major gap-fill, per-type default sizes, **no reflow of
  pinned windows**. Once the `@User` touches a window's placement it is pinned
  and auto-layout leaves it alone thereafter.
- **Grid model (as built):** the backend grid is `GRID_COLS = 3` and per-type
  defaults use the S/M/L/XL ladder (charts → L = 2×2, list cards → M = 1×2). The
  `#WebClient` re-derives the *displayed* column count from viewport width (2–4)
  and flows the cards from their sizes, so absolute `col`/`row` are advisory for
  the dashboard layout; size (`colSpan`×`rowSpan`) and window order are what drive
  the visible grid.
