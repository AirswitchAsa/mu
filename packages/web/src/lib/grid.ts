// =============================================================================
// µ — grid size model (pure, headless-testable).
// The playground is a responsive grid: the column count is decided first from the
// available width, then each card maps onto it via a universal S/M/L/XL ladder.
//   S  = 1 col · 1 row-unit
//   M  = 1 col · 2 row-units
//   L  = 2 cols · 2 row-units   (the comfortable default tile)
//   XL = 3 cols · 3 row-units   (a fixed 3-col hero, never "all cols")
// A card's size lives in its backend Placement (colSpan × rowSpan); the size
// control (− / +) emits a `resize` op carrying the next preset's spans. This
// mirrors the backend GRID_COLS=3 model so a server-placed window reads back to a
// size index cleanly.
// =============================================================================

export interface SizeSpan {
  colSpan: number;
  rowSpan: number;
}

export const SIZE_PRESETS: readonly SizeSpan[] = [
  { colSpan: 1, rowSpan: 1 }, // S
  { colSpan: 1, rowSpan: 2 }, // M
  { colSpan: 2, rowSpan: 2 }, // L
  { colSpan: 3, rowSpan: 3 }, // XL
];
export const SIZE_LABELS = ["s", "m", "l", "xl"] as const;
export const MAX_SIZE = SIZE_PRESETS.length - 1;
/** The comfortable default tile (L) when a placement is missing or unrecognized. */
export const DEFAULT_SIZE_INDEX = 2;

const clampIndex = (i: number): number => Math.max(0, Math.min(MAX_SIZE, i | 0));

/** The {colSpan, rowSpan} for a size index (clamped into range). */
export function presetForSize(i: number): SizeSpan {
  return SIZE_PRESETS[clampIndex(i)]!;
}

/** Step a size index by ±1, clamped to [0, MAX_SIZE]. */
export function stepSize(i: number, dir: number): number {
  return clampIndex((i | 0) + (dir < 0 ? -1 : 1));
}

/**
 * Map a placement's spans back to a size index. Exact match wins; otherwise pick
 * the preset whose area is closest, so a legacy/odd placement still reads as a
 * sensible size rather than blanking the sizer.
 */
export function sizeIndexOf(span: { colSpan?: number; rowSpan?: number } | null | undefined): number {
  if (!span || span.colSpan == null || span.rowSpan == null) return DEFAULT_SIZE_INDEX;
  const exact = SIZE_PRESETS.findIndex((p) => p.colSpan === span.colSpan && p.rowSpan === span.rowSpan);
  if (exact >= 0) return exact;
  const area = span.colSpan * span.rowSpan;
  let best = DEFAULT_SIZE_INDEX;
  let bestDelta = Infinity;
  SIZE_PRESETS.forEach((p, i) => {
    const d = Math.abs(p.colSpan * p.rowSpan - area);
    if (d < bestDelta) {
      bestDelta = d;
      best = i;
    }
  });
  return best;
}

/**
 * Decide the displayed column count from the grid's content width. Wide columns
 * (target ~400px) → typically 3 on a desktop, clamped to [2, 4]. `gap` and `pad`
 * are the column gap and the grid's horizontal padding (both sides).
 */
export function colsForWidth(width: number, opts?: { target?: number; gap?: number; pad?: number }): number {
  const target = opts?.target ?? 400;
  const gap = opts?.gap ?? 16;
  const pad = opts?.pad ?? 0;
  const usable = Math.max(0, width - pad);
  return Math.max(2, Math.min(4, Math.floor((usable + gap) / (target + gap)) || 0));
}
