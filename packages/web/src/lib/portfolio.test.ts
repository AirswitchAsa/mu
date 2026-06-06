import { describe, expect, it } from "vitest";
import { fmtSignedPct, fmtSignedUsd, fmtUsd, holdings, latestPositions } from "./portfolio";
import type { PositionsRow } from "./types";

function row(over: Partial<PositionsRow>): PositionsRow {
  return {
    symbol: "AAPL",
    qty: 10,
    side: "long",
    avg_entry: 180,
    price: 195,
    market_value: 1950,
    cost_basis: 1800,
    unrealized_pl: 150,
    unrealized_plpc: 0.0833,
    change_today: 0.012,
    asset_class: "us_equity",
    as_of: 1_000,
    ...over,
  };
}

describe("latestPositions", () => {
  it("keeps only the newest as_of vintage", () => {
    const rows = [row({ as_of: 1_000 }), row({ symbol: "MSFT", as_of: 2_000 }), row({ symbol: "TSLA", as_of: 2_000 })];
    const latest = latestPositions(rows);
    expect(latest).toHaveLength(2);
    expect(latest.every((r) => r.as_of === 2_000)).toBe(true);
  });
});

describe("holdings", () => {
  const rows: PositionsRow[] = [
    row({ symbol: "AAPL", market_value: 1950, cost_basis: 1800, unrealized_pl: 150 }),
    row({ symbol: "NVDA", market_value: 5000, cost_basis: 4000, unrealized_pl: 1000 }),
    row({ symbol: "F", market_value: 300, cost_basis: 400, unrealized_pl: -100 }),
  ];

  it("sorts by market value descending", () => {
    const { rows: sorted } = holdings(rows);
    expect(sorted.map((r) => r.symbol)).toEqual(["NVDA", "AAPL", "F"]);
  });

  it("totals market value, cost, and P/L, with the aggregate return from the summed basis", () => {
    const { totals } = holdings(rows);
    expect(totals.market_value).toBe(7250);
    expect(totals.cost_basis).toBe(6200);
    expect(totals.unrealized_pl).toBe(1050);
    expect(totals.unrealized_plpc).toBeCloseTo(1050 / 6200, 6); // not an average of per-position percents
  });

  it("only folds the latest snapshot", () => {
    const withOld = [...rows, row({ symbol: "OLD", as_of: 0, market_value: 9999 })];
    // newest as_of is 1_000 (the default), so the OLD vintage row is excluded
    const { rows: sorted } = holdings(withOld);
    expect(sorted.find((r) => r.symbol === "OLD")).toBeUndefined();
  });
});

describe("formatters", () => {
  it("formats money and signed money/percent", () => {
    expect(fmtUsd(1234.5)).toBe("$1,234.50");
    expect(fmtUsd(-99.6)).toBe("-$99.60");
    expect(fmtSignedUsd(582.44)).toBe("+$582.44");
    expect(fmtSignedUsd(-99.6)).toBe("-$99.60");
    expect(fmtSignedPct(0.0144)).toBe("+1.44%");
    expect(fmtSignedPct(-0.0024)).toBe("-0.24%");
  });
});
