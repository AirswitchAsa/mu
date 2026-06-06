import type { PositionsRow } from "./types";

// =============================================================================
// µ — pure transforms for the `positions` cross-section, used by the holdings table
// (PositionsCard). Pure + value-based so they unit-test without a DOM
// (portfolio.test.ts), like lib/cards and lib/options. The card stays thin: fold the
// resolved rows into the latest snapshot + a totals row here, render there.
// =============================================================================

/** Keep only the newest `as_of` vintage — the card shows the latest snapshot. */
export function latestPositions(rows: readonly PositionsRow[]): PositionsRow[] {
  if (rows.length === 0) return [];
  const maxAsOf = rows.reduce((m, r) => (r.as_of > m ? r.as_of : m), rows[0]!.as_of);
  return rows.filter((r) => r.as_of === maxAsOf);
}

export interface PortfolioTotals {
  market_value: number;
  cost_basis: number;
  unrealized_pl: number;
  /** open P/L as a fraction of total cost basis (0 when basis is 0). */
  unrealized_plpc: number;
}
export interface Holdings {
  rows: PositionsRow[];
  totals: PortfolioTotals;
}

/**
 * Fold the latest snapshot into the table view: rows sorted by market value descending
 * (largest holding first), plus a totals row (summed market value / cost / open P/L,
 * with the aggregate return computed from the summed basis — not an average of percents).
 */
export function holdings(rows: readonly PositionsRow[]): Holdings {
  const latest = latestPositions(rows);
  const sorted = [...latest].sort((a, b) => b.market_value - a.market_value);
  let mv = 0;
  let cost = 0;
  let pl = 0;
  for (const r of sorted) {
    mv += r.market_value;
    cost += r.cost_basis;
    pl += r.unrealized_pl;
  }
  return {
    rows: sorted,
    totals: { market_value: mv, cost_basis: cost, unrealized_pl: pl, unrealized_plpc: cost !== 0 ? pl / cost : 0 },
  };
}

// --- formatters (renderer display) ------------------------------------------

/** "$1,234.56" / "-$1,234.56". */
export const fmtUsd = (v: number): string => {
  if (!Number.isFinite(v)) return "—";
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `-$${s}` : `$${s}`;
};
/** "+$582.44" / "-$99.60" — signed, for P/L. */
export const fmtSignedUsd = (v: number): string => (Number.isFinite(v) && v >= 0 ? `+${fmtUsd(v)}` : fmtUsd(v));
/** "+1.44%" / "-0.24%" — a fraction rendered as a signed percent. */
export const fmtSignedPct = (frac: number): string => (Number.isFinite(frac) ? `${frac >= 0 ? "+" : ""}${(frac * 100).toFixed(2)}%` : "—");
/** Share quantity: integers plain, fractionals to 4 dp trimmed. */
export const fmtQty = (v: number): string => {
  if (!Number.isFinite(v)) return "—";
  return Number.isInteger(v) ? v.toLocaleString("en-US") : v.toFixed(4).replace(/\.?0+$/, "");
};
