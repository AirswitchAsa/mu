import { describe, expect, it } from "vitest";
import { encodeHandle } from "@mu/protocol";
import { createYahooResource, type ChartFn } from "./index.js";

const fakeChart: ChartFn = async () => ({
  quotes: [
    { date: new Date("2024-01-02T00:00:00Z"), open: 100, high: 102, low: 99, close: 101, adjclose: 100.5, volume: 1000 },
    // no adjclose → falls back to close; volume present
    { date: new Date("2024-01-03T00:00:00Z"), open: 101, high: 103, low: 100, close: 102, volume: 2000 },
    // holiday/halt: null OHLC → dropped
    { date: new Date("2024-01-04T00:00:00Z"), open: null, high: null, low: null, close: null, volume: null },
  ],
});

describe("yfinance normalization", () => {
  it("maps quotes to canonical ohlcv, dropping incomplete bars", async () => {
    const res = createYahooResource({ chart: fakeChart });
    const fr = await res.fetch(
      { shape: "ohlcv", entity: "amzn", resolution: "1d", range: "1mo" },
      { trigger: "on_demand", now: () => 1_700_000_000_000 },
    );

    expect(fr.payload).toHaveLength(2); // null bar dropped
    expect(fr.payload[0]).toEqual({
      t: Date.parse("2024-01-02T00:00:00Z"),
      open: 100,
      high: 102,
      low: 99,
      close: 101,
      adjClose: 100.5,
      volume: 1000,
    });
    // adjClose falls back to close when absent
    expect(fr.payload[1]!.adjClose).toBe(102);
    // time is epoch-ms
    expect(typeof fr.payload[0]!.t).toBe("number");
  });

  it("bakes a concrete, provider-qualified identity (entity upper-cased)", async () => {
    const res = createYahooResource({ chart: fakeChart });
    const fr = await res.fetch(
      { shape: "ohlcv", entity: "brk.b" },
      { trigger: "on_demand", now: () => 42 },
    );
    expect(encodeHandle(fr.descriptor.identity)).toBe("yfinance:ohlcv:BRK.B:1d");
    expect(fr.provenance).toMatchObject({ source: "yfinance", fetchedAt: 42, trigger: "on_demand" });
  });
});
