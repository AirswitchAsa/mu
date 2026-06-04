import type { Placement } from "@mu/protocol";

/**
 * Column count of the canvas grid. The client re-derives the *displayed* column
 * count from viewport width (2–4) and lays cards out by flow; the backend grid is
 * the small-column model the size ladder maps onto (max span = XL = 3). The canvas
 * scrolls down without bound.
 */
export const GRID_COLS = 3;

/**
 * Per-type default window sizes on the S/M/L/XL ladder (cols × row-units):
 *   S = 1×1 · M = 1×2 · L = 2×2 · XL = 3×3. Charts default to L (the comfortable
 * 2-up tile); list cards (news/releases) default to M (one column, double height).
 */
const DEFAULT_SIZE: Record<string, { colSpan: number; rowSpan: number }> = {
  price_chart: { colSpan: 2, rowSpan: 2 }, // L
  compare: { colSpan: 2, rowSpan: 2 }, // L
  indicator_chart: { colSpan: 2, rowSpan: 2 }, // L
  table: { colSpan: 2, rowSpan: 2 }, // L
  memo: { colSpan: 1, rowSpan: 2 }, // M
  news: { colSpan: 1, rowSpan: 2 }, // M
  releases: { colSpan: 1, rowSpan: 2 }, // M
  key_stats: { colSpan: 1, rowSpan: 2 }, // M
  news_timeline: { colSpan: 1, rowSpan: 2 }, // M
};

const FALLBACK = { colSpan: 2, rowSpan: 2 }; // L

function overlaps(a: Placement, col: number, row: number, colSpan: number, rowSpan: number): boolean {
  return (
    col < a.col + a.colSpan &&
    col + colSpan > a.col &&
    row < a.row + a.rowSpan &&
    row + rowSpan > a.row
  );
}

/**
 * Place a new, unplaced window (auto_layout.dog.md): row-major gap-fill on the
 * column grid, then append below. Never disturbs existing placements (the user's
 * pinned windows are fixed points the flow goes around). Returns the placement;
 * `pinned` is false (auto-placed).
 */
export function placeWindow(
  existing: Readonly<Record<string, Placement>>,
  type: string,
): Placement {
  const size = DEFAULT_SIZE[type] ?? FALLBACK;
  const colSpan = Math.min(size.colSpan, GRID_COLS);
  const { rowSpan } = size;
  const placed = Object.values(existing);

  // Row-major scan for the first free slot.
  const maxRow = placed.reduce((m, p) => Math.max(m, p.row + p.rowSpan), 0);
  for (let row = 0; row <= maxRow; row++) {
    for (let col = 0; col + colSpan <= GRID_COLS; col++) {
      if (!placed.some((p) => overlaps(p, col, row, colSpan, rowSpan))) {
        return { col, row, colSpan, rowSpan, pinned: false };
      }
    }
  }
  // No gap: append below everything.
  return { col: 0, row: maxRow, colSpan, rowSpan, pinned: false };
}
