import { describe, expect, it } from "vitest";
import { validateCompareSpec, validateMemoSpec, validatePriceChartSpec } from "./core-renderers.js";

describe("price_chart spec validation", () => {
  it("accepts an empty spec and a well-formed overlay + volume", () => {
    expect(validatePriceChartSpec({}).ok).toBe(true);
    expect(validatePriceChartSpec({ overlays: [{ kind: "sma", period: 50 }], volume: true }).ok).toBe(true);
    expect(validatePriceChartSpec({ overlays: [{ kind: "ema", period: 12 }, { kind: "sma", period: 200 }] }).ok).toBe(true);
  });

  it("rejects bad overlay kinds, non-integer/negative periods, and bad shapes", () => {
    expect(validatePriceChartSpec({ overlays: "nope" }).ok).toBe(false);
    expect(validatePriceChartSpec({ overlays: [{ kind: "rsi", period: 14 }] }).ok).toBe(false);
    expect(validatePriceChartSpec({ overlays: [{ kind: "sma", period: 0 }] }).ok).toBe(false);
    expect(validatePriceChartSpec({ overlays: [{ kind: "sma", period: 12.5 }] }).ok).toBe(false);
    expect(validatePriceChartSpec({ overlays: [{ kind: "sma" }] }).ok).toBe(false);
    expect(validatePriceChartSpec({ volume: "yes" }).ok).toBe(false);
  });
});

describe("compare spec validation", () => {
  it("accepts empty + positive base, rejects non-positive", () => {
    expect(validateCompareSpec({}).ok).toBe(true);
    expect(validateCompareSpec({ base: 100 }).ok).toBe(true);
    expect(validateCompareSpec({ base: 0 }).ok).toBe(false);
    expect(validateCompareSpec({ base: "100" }).ok).toBe(false);
  });
});

describe("memo spec validation", () => {
  it("accepts empty + string markdown, rejects non-string", () => {
    expect(validateMemoSpec({}).ok).toBe(true);
    expect(validateMemoSpec({ markdown: "# note" }).ok).toBe(true);
    expect(validateMemoSpec({ markdown: 42 }).ok).toBe(false);
  });
});
