import { describe, expect, it } from "vitest";
import { compareBase, indicatorsOf, memoMarkdown, symbolOf } from "./specs";

describe("specs accessors (defensive reads of agent-authored specs)", () => {
  it("indicatorsOf resolves catalog indicators, fills default params, and drops unknowns", () => {
    const spec = {
      indicators: [
        { name: "sma", params: { period: 50 } },
        { name: "ema" }, // no params → catalog default (20)
        { name: "volume" },
        { name: "bogus" }, // unknown → dropped
        "nope", // not an object → dropped
      ],
    };
    const out = indicatorsOf(spec);
    expect(out.map((i) => i.name)).toEqual(["sma", "ema", "volume"]);
    expect(out[0]!.params).toEqual({ period: 50 });
    expect(out[0]!.key).toBe("sma:50");
    expect(out[0]!.label).toBe("SMA 50");
    expect(out[1]!.params).toEqual({ period: 20 }); // default filled
    expect(out[2]!.label).toBe("Vol"); // no params → bare label
    expect(indicatorsOf(undefined)).toEqual([]);
    expect(indicatorsOf({ indicators: "x" })).toEqual([]);
  });

  it("compareBase defaults to 100 for missing/invalid base", () => {
    expect(compareBase({ base: 50 })).toBe(50);
    expect(compareBase({ base: -5 })).toBe(100);
    expect(compareBase(undefined)).toBe(100);
  });

  it("memoMarkdown returns the string or empty", () => {
    expect(memoMarkdown({ markdown: "# hi" })).toBe("# hi");
    expect(memoMarkdown({ markdown: 7 })).toBe("");
    expect(memoMarkdown(undefined)).toBe("");
  });

  it("symbolOf extracts the entity and never throws on a malformed handle", () => {
    expect(symbolOf("yfinance:ohlcv:AMZN:1d")).toBe("AMZN");
    expect(symbolOf("MSFT")).toBe("MSFT"); // too few components — falls back to raw
    expect(symbolOf("")).toBe("—");
  });
});
