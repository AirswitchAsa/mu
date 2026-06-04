import { describe, expect, it } from "vitest";
import { INDICATORS, resolveIndicatorParams } from "@mu/protocol";
import { getIndicatorOutputs, type IndHistPoint, type IndPoint } from "./indicator-compute";
import type { OhlcvRow } from "./types";

// =============================================================================
// Indicator compute — exact math for the core indicators, plus structural
// coverage that EVERY catalog indicator computes finite, drawable outputs.
// =============================================================================

const T0 = Date.UTC(2024, 0, 1);
const DAY = 86_400_000;

/** Build rows from closes; high/low default to a small band around close. */
function rowsFromCloses(closes: number[], vols?: number[]): OhlcvRow[] {
  return closes.map((c, i) => ({
    t: T0 + i * DAY,
    open: i === 0 ? c : closes[i - 1]!,
    high: c + 1,
    low: c - 1,
    close: c,
    volume: vols?.[i] ?? 1000,
  }));
}

const vals = (data: readonly IndPoint[] | readonly IndHistPoint[]): number[] => data.map((d) => d.value);

describe("indicator compute — exact values", () => {
  it("sma: trailing mean once the window fills", () => {
    const out = getIndicatorOutputs("sma", rowsFromCloses([1, 2, 3, 4, 5]), { period: 3 });
    expect(out).toHaveLength(1);
    expect(vals(out[0]!.data)).toEqual([2, 3, 4]);
  });

  it("wma: linearly weighted mean", () => {
    const out = getIndicatorOutputs("wma", rowsFromCloses([1, 2, 3]), { period: 3 });
    // (1*1 + 2*2 + 3*3) / (1+2+3) = 14/6 = 2.333 → 2.33
    expect(vals(out[0]!.data)).toEqual([2.33]);
  });

  it("ema: recursively smoothed, seeded at the first close", () => {
    const out = getIndicatorOutputs("ema", rowsFromCloses([1, 2, 3]), { period: 2 });
    // k=2/3: e0=1, e1=2*2/3+1/3=1.667, e2=3*2/3+1.667/3=2.556 → [1, 1.67, 2.56]
    expect(vals(out[0]!.data)).toEqual([1, 1.67, 2.56]);
  });

  it("bollinger: basis is the SMA, with symmetric bands", () => {
    const out = getIndicatorOutputs("bollinger", rowsFromCloses([1, 2, 3, 4, 5]), { period: 3, mult: 2 });
    expect(out.map((o) => o.key)).toEqual(["upper", "basis", "lower"]);
    const basis = vals(out[1]!.data);
    expect(basis).toEqual([2, 3, 4]);
    const upper = vals(out[0]!.data);
    const lower = vals(out[2]!.data);
    // band = 2 * std([1,2,3]) = 2 * 0.8165 = 1.633 → upper 3.63, lower 0.37
    expect(upper[0]).toBeCloseTo(3.63, 2);
    expect(lower[0]).toBeCloseTo(0.37, 2);
  });

  it("vwap: first point equals the first bar's typical price", () => {
    const rows = rowsFromCloses([10, 11, 12]);
    const out = getIndicatorOutputs("vwap", rows, {});
    const tp0 = (rows[0]!.high + rows[0]!.low + rows[0]!.close) / 3;
    expect(out[0]!.data[0]!.value).toBeCloseTo(Math.round(tp0 * 100) / 100, 2);
  });

  it("volume: a histogram tinted by bar direction", () => {
    const rows = rowsFromCloses([10, 9, 11], [100, 200, 300]); // bar2 down (9<10 open), bar3 up
    const out = getIndicatorOutputs("volume", rows, {});
    expect(out[0]!.kind).toBe("histogram");
    const data = out[0]!.data as IndHistPoint[];
    expect(data.map((d) => d.value)).toEqual([100, 200, 300]);
    expect(data[1]!.dir).toBe(-1); // close 9 < open 10
    expect(data[2]!.dir).toBe(1); // close 11 >= open 9
  });

  it("macd: emits macd line, signal line, and a signed histogram", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i);
    const out = getIndicatorOutputs("macd", rowsFromCloses(closes), { fast: 12, slow: 26, signal: 9 });
    expect(out.map((o) => o.key).sort()).toEqual(["hist", "macd", "signal"]);
    expect(out.find((o) => o.key === "hist")!.kind).toBe("histogram");
  });

  it("rsi: stays within [0, 100]", () => {
    const closes = [44, 44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    const out = getIndicatorOutputs("rsi", rowsFromCloses(closes), { period: 14 });
    const r = vals(out[0]!.data);
    expect(r.length).toBeGreaterThan(0);
    for (const v of r) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(100);
  });
});

describe("indicator compute — structural coverage of the whole catalog", () => {
  // a deterministic, non-trivial 80-bar series (no RNG: a drifting sine).
  const closes = Array.from({ length: 80 }, (_, i) => 100 + 10 * Math.sin(i / 5) + i * 0.3);
  const rows: OhlcvRow[] = closes.map((c, i) => ({
    t: T0 + i * DAY,
    open: i === 0 ? c : closes[i - 1]!,
    high: Math.max(c, closes[i - 1] ?? c) + 1.5,
    low: Math.min(c, closes[i - 1] ?? c) - 1.5,
    close: c,
    volume: 1000 + (i % 7) * 130,
  }));

  it("every catalog indicator computes finite, drawable outputs with default params", () => {
    for (const def of INDICATORS) {
      const params = resolveIndicatorParams(def);
      const outs = getIndicatorOutputs(def.name, rows, params);
      expect(outs.length, `${def.name} produced no outputs`).toBeGreaterThan(0);
      for (const o of outs) {
        expect(["line", "histogram"]).toContain(o.kind);
        expect(o.data.length, `${def.name}.${o.key} is empty`).toBeGreaterThan(0);
        for (const pt of o.data) {
          expect(Number.isFinite(pt.value), `${def.name}.${o.key} has a non-finite value`).toBe(true);
          expect(Number.isFinite(pt.time)).toBe(true);
        }
      }
    }
  });

  it("placement matches the catalog (price overlays vs. pane indicators are both covered)", () => {
    const price = INDICATORS.filter((d) => d.placement === "price").map((d) => d.name);
    const pane = INDICATORS.filter((d) => d.placement === "pane").map((d) => d.name);
    expect(price).toContain("sma");
    expect(price).toContain("bollinger");
    expect(pane).toContain("volume");
    expect(pane).toContain("rsi");
    expect(pane).toContain("macd");
  });

  it("returns [] for an unknown indicator, and an empty-data skeleton for no rows", () => {
    expect(getIndicatorOutputs("nonsense", rows, {})).toEqual([]);
    // a known indicator with no rows still yields its output(s), with empty data,
    // so the renderer can create series/panes before data resolves.
    const skeleton = getIndicatorOutputs("macd", [], { fast: 12, slow: 26, signal: 9 });
    expect(skeleton.map((o) => o.key).sort()).toEqual(["hist", "macd", "signal"]);
    for (const o of skeleton) expect(o.data).toEqual([]);
  });
});
