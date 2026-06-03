import { describe, expect, it } from "vitest";
import { compareBase, memoMarkdown, overlaysOf, showVolume, symbolOf } from "./specs";

describe("specs accessors (defensive reads of agent-authored specs)", () => {
  it("overlaysOf keeps only well-formed sma/ema overlays", () => {
    const spec = {
      overlays: [
        { kind: "sma", period: 50 },
        { kind: "ema", period: 12 },
        { kind: "bogus", period: 9 }, // wrong kind
        { kind: "sma", period: 0 }, // non-positive period
        { kind: "sma" }, // missing period
        "nope", // not an object
      ],
    };
    expect(overlaysOf(spec)).toEqual([
      { kind: "sma", period: 50 },
      { kind: "ema", period: 12 },
    ]);
    expect(overlaysOf(undefined)).toEqual([]);
    expect(overlaysOf({ overlays: "x" })).toEqual([]);
  });

  it("showVolume only on strict true; compareBase defaults to 100", () => {
    expect(showVolume({ volume: true })).toBe(true);
    expect(showVolume({ volume: 1 })).toBe(false);
    expect(showVolume(undefined)).toBe(false);
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
