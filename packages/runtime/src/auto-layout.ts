import type { Placement } from "@mu/protocol";

/** Column count of the canvas grid. The canvas scrolls down without bound. */
export const GRID_COLS = 12;

/** Per-type default window sizes (cols × rows). Unknown types get a sane default. */
const DEFAULT_SIZE: Record<string, { colSpan: number; rowSpan: number }> = {
  price_chart: { colSpan: 8, rowSpan: 4 },
  indicator_chart: { colSpan: 6, rowSpan: 3 },
  table: { colSpan: 6, rowSpan: 4 },
  memo: { colSpan: 4, rowSpan: 4 },
  news_timeline: { colSpan: 4, rowSpan: 5 },
};

const FALLBACK = { colSpan: 6, rowSpan: 3 };

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
