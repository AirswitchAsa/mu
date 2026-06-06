import { describe, expect, it } from "vitest";
import { chainLadder, curveSeries, expiriesOf, latestSnapshot, type ChainRow } from "./options";

function row(over: Partial<ChainRow>): ChainRow {
  return {
    id: "x",
    expiry: "2026-06-19",
    strike: 150,
    right: "call",
    bid: 5,
    ask: 5.2,
    mid: 5.1,
    iv: 0.3,
    smv: 0.31,
    delta: 0.55,
    gamma: 0.02,
    theta: -0.05,
    vega: 0.1,
    open_interest: 1000,
    volume: 50,
    underlying: 151,
    dte: 14,
    as_of: 1_000,
    ...over,
  };
}

describe("latestSnapshot", () => {
  it("keeps only the newest as_of vintage", () => {
    const rows = [row({ as_of: 1_000, iv: 0.3 }), row({ as_of: 2_000, iv: 0.4 }), row({ as_of: 2_000, strike: 160 })];
    const latest = latestSnapshot(rows);
    expect(latest).toHaveLength(2);
    expect(latest.every((r) => r.as_of === 2_000)).toBe(true);
  });
});

describe("chainLadder", () => {
  const rows: ChainRow[] = [
    row({ strike: 145, right: "call", underlying: 151 }),
    row({ strike: 145, right: "put" }),
    row({ strike: 150, right: "call" }),
    row({ strike: 150, right: "put" }),
    row({ strike: 155, right: "call" }),
    row({ strike: 155, right: "put" }),
    row({ strike: 150, right: "call", expiry: "2026-07-17" }), // other expiry, excluded
  ];

  it("pairs call+put per strike, ascending, for the chosen expiry", () => {
    const l = chainLadder(rows, "2026-06-19");
    expect(l.rows.map((r) => r.strike)).toEqual([145, 150, 155]);
    expect(l.rows[0]!.call).toBeDefined();
    expect(l.rows[0]!.put).toBeDefined();
  });

  it("marks the ATM strike nearest the underlying", () => {
    const l = chainLadder(rows, "2026-06-19");
    expect(l.underlying).toBe(151);
    expect(l.atmStrike).toBe(150); // 150 is nearest to 151
  });
});

describe("expiriesOf", () => {
  it("returns distinct expiries ascending", () => {
    expect(expiriesOf([row({ expiry: "2026-07-17" }), row({ expiry: "2026-06-19" }), row({ expiry: "2026-06-19" })])).toEqual([
      "2026-06-19",
      "2026-07-17",
    ]);
  });
});

describe("curveSeries — projection (smile)", () => {
  const rows = [
    row({ strike: 145, right: "call", smv: 0.34, expiry: "2026-06-19" }),
    row({ strike: 150, right: "call", smv: 0.30, expiry: "2026-06-19" }),
    row({ strike: 155, right: "call", smv: 0.33, expiry: "2026-06-19" }),
    row({ strike: 150, right: "put", smv: 0.31, expiry: "2026-06-19" }),
    row({ strike: 150, right: "call", smv: 0.99, expiry: "2026-07-17" }), // filtered by where
  ] as unknown as Record<string, unknown>[];

  it("plots x vs y split by series, filtered by where, sorted by x", () => {
    const out = curveSeries(rows, { x: "strike", y: "smv", series: "right", where: { expiry: "2026-06-19" } });
    const call = out.find((s) => s.label === "call")!;
    const put = out.find((s) => s.label === "put")!;
    expect(call.points.map((p) => p.x)).toEqual([145, 150, 155]);
    expect(call.points.map((p) => p.y)).toEqual([0.34, 0.3, 0.33]);
    expect(put.points).toHaveLength(1);
    expect(put.points[0]).toEqual({ x: 150, y: 0.31 });
  });

  it("windows the curve with a numeric range predicate in where (smile near spot)", () => {
    const out = curveSeries(rows, {
      x: "strike",
      y: "smv",
      series: "right",
      where: { expiry: "2026-06-19", strike: { min: 148, max: 152 } },
    });
    const call = out.find((s) => s.label === "call")!;
    expect(call.points.map((p) => p.x)).toEqual([150]); // 145 and 155 excluded by the range
  });
});

describe("curveSeries — reduce (term structure)", () => {
  const rows = [
    // expiry A (dte 7): ATM strike nearest underlying 151 is 150
    row({ expiry: "A", dte: 7, strike: 145, smv: 0.40, underlying: 151 }),
    row({ expiry: "A", dte: 7, strike: 150, smv: 0.30, underlying: 151 }),
    // expiry B (dte 30): ATM 150
    row({ expiry: "B", dte: 30, strike: 150, smv: 0.28, underlying: 151 }),
    row({ expiry: "B", dte: 30, strike: 160, smv: 0.45, underlying: 151 }),
  ] as unknown as Record<string, unknown>[];

  it("picks the ATM (nearest-strike) row per expiry and plots dte vs y", () => {
    const out = curveSeries(rows, {
      x: "dte",
      y: "smv",
      reduce: { groupBy: "expiry", pick: { column: "strike", target: "underlying" } },
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.points).toEqual([
      { x: 7, y: 0.3 },
      { x: 30, y: 0.28 },
    ]);
  });
});
