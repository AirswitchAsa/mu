import { describe, expect, it } from "vitest";
import {
  validateCompareSpec,
  validateMemoSpec,
  validateNewsSpec,
  validatePriceChartSpec,
  validateReleasesSpec,
} from "./core-renderers.js";

describe("price_chart spec validation (catalog-driven indicators)", () => {
  it("accepts an empty spec and well-formed catalog indicators", () => {
    expect(validatePriceChartSpec({}).ok).toBe(true);
    expect(validatePriceChartSpec({ indicators: [{ name: "sma", params: { period: 50 } }, { name: "volume" }] }).ok).toBe(true);
    // params are optional (catalog defaults fill in); pane indicators like rsi/macd are valid
    expect(validatePriceChartSpec({ indicators: [{ name: "ema" }, { name: "rsi" }, { name: "macd", params: { fast: 12, slow: 26, signal: 9 } }] }).ok).toBe(true);
    expect(validatePriceChartSpec({ indicators: [{ name: "bollinger", params: { period: 20, mult: 2 } }] }).ok).toBe(true);
  });

  it("rejects unknown indicators, unknown/out-of-range/non-integer params, and bad shapes", () => {
    expect(validatePriceChartSpec({ indicators: "nope" }).ok).toBe(false);
    expect(validatePriceChartSpec({ indicators: [{ name: "nonsense" }] }).ok).toBe(false);
    expect(validatePriceChartSpec({ indicators: [{ name: "sma", params: { period: 0 } }] }).ok).toBe(false);
    expect(validatePriceChartSpec({ indicators: [{ name: "sma", params: { period: 12.5 } }] }).ok).toBe(false);
    expect(validatePriceChartSpec({ indicators: [{ name: "sma", params: { window: 50 } }] }).ok).toBe(false);
    expect(validatePriceChartSpec({ indicators: [{ name: "bollinger", params: { mult: 99 } }] }).ok).toBe(false);
    expect(validatePriceChartSpec({ indicators: [{ period: 50 }] }).ok).toBe(false);
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

describe("news spec validation", () => {
  it("accepts empty + string query + positive limit, rejects bad types", () => {
    expect(validateNewsSpec({}).ok).toBe(true);
    expect(validateNewsSpec({ query: "NVDA", limit: 20 }).ok).toBe(true);
    expect(validateNewsSpec({ query: 7 }).ok).toBe(false);
    expect(validateNewsSpec({ limit: 0 }).ok).toBe(false);
  });
});

describe("releases spec validation", () => {
  it("accepts empty + string scope, rejects non-string", () => {
    expect(validateReleasesSpec({}).ok).toBe(true);
    expect(validateReleasesSpec({ scope: "macro" }).ok).toBe(true);
    expect(validateReleasesSpec({ scope: 1 }).ok).toBe(false);
  });
});
