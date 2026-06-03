import { describe, expect, it } from "vitest";
import { ema, indexNormalize, lastClose, pctChange, sma, toCandles, toVolume } from "./indicators";
import type { OhlcvRow } from "./types";

// Closes 1..6 on consecutive UTC days; epoch-ms in, epoch-sec out.
const DAY = 86_400_000;
const rows: OhlcvRow[] = [1, 2, 3, 4, 5, 6].map((c, i) => ({
  t: i * DAY,
  open: c - 0.5,
  high: c + 0.5,
  low: c - 0.6,
  close: c,
  volume: 100 + i,
}));

describe("toCandles", () => {
  it("maps OHLC and converts epoch-ms → epoch-sec", () => {
    const c = toCandles(rows);
    expect(c[0]).toEqual({ time: 0, open: 0.5, high: 1.5, low: 0.4, close: 1 });
    expect(c[1]!.time).toBe(DAY / 1000);
  });
});

describe("sma", () => {
  it("emits once the window fills, averaging the trailing closes", () => {
    const out = sma(rows, 3);
    // first value at index 2: mean(1,2,3)=2 ; then mean(2,3,4)=3 ...
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({ time: (2 * DAY) / 1000, value: 2 });
    expect(out.map((p) => p.value)).toEqual([2, 3, 4, 5]);
  });
  it("returns empty for a non-positive period", () => {
    expect(sma(rows, 0)).toEqual([]);
  });
});

describe("ema", () => {
  it("seeds at the first close and trends toward later closes", () => {
    const out = ema(rows, 3);
    expect(out).toHaveLength(rows.length);
    expect(out[0]!.value).toBe(1); // seeded at first close
    // k = 0.5: ema1 = 2*0.5 + 1*0.5 = 1.5
    expect(out[1]!.value).toBe(1.5);
    expect(out.at(-1)!.value).toBeGreaterThan(out[0]!.value);
  });
});

describe("indexNormalize", () => {
  it("rebases the close series to the given base", () => {
    const out = indexNormalize(rows, 100);
    expect(out[0]!.value).toBe(100);
    expect(out.at(-1)!.value).toBe(600); // close 6 / close 1 * 100
  });
});

describe("toVolume / legend helpers", () => {
  it("tints volume bars by direction and reads last close + pct change", () => {
    const v = toVolume(rows, "#0f0", "#f00");
    expect(v[0]).toMatchObject({ time: 0, value: 100, color: "#0f0" }); // close>=open → up
    expect(lastClose(rows)).toBe(6);
    expect(pctChange(rows)).toBeCloseTo(500, 5); // 1 → 6
  });
});
