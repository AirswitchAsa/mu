import { describe, expect, it } from "vitest";
import { createFinnhubResource } from "./index.js";

// =============================================================================
// Finnhub news + earnings normalization (offline; fetchJson injected, apiKey set).
// =============================================================================

const ctx = { trigger: "on_demand" as const, now: () => Date.UTC(2026, 5, 1) };

describe("finnhub resource", () => {
  it("declares its shapes and is keyed", () => {
    const r = createFinnhubResource({ fetchJson: async () => [], apiKey: "k" });
    expect(r.manifest.shapes).toEqual(["news", "releases", "key_stats"]);
    expect(r.manifest.configSchema).toContain("FINNHUB_API_KEY");
    expect(r.isConfigured?.()).toBe(true);
  });

  it("isConfigured is false without a key", () => {
    const saved = process.env["FINNHUB_API_KEY"];
    delete process.env["FINNHUB_API_KEY"];
    const r = createFinnhubResource({ fetchJson: async () => [] });
    expect(r.isConfigured?.()).toBe(false);
    if (saved !== undefined) process.env["FINNHUB_API_KEY"] = saved;
  });

  it("normalizes company-news to canonical news rows", async () => {
    const raw = [
      { id: 7, datetime: Math.floor(Date.UTC(2026, 4, 30) / 1000), headline: "AWS update", source: "Reuters", summary: "s", url: "u", related: "AMZN", image: "img" },
      { id: 8, headline: "no datetime dropped" },
    ];
    const r = createFinnhubResource({ fetchJson: async () => raw, apiKey: "k" });
    const out = await r.fetch({ shape: "news", entity: "AMZN" }, ctx);
    expect(out.descriptor.identity.tail).toEqual(["ticker"]); // company-news is per-ticker
    expect(out.payload).toHaveLength(1);
    expect(out.payload[0]).toMatchObject({
      id: "7",
      source: "Reuters",
      headline: "AWS update",
      tickers: "AMZN",
      image_url: "img",
      published_at: Date.UTC(2026, 4, 30),
    });
  });

  it("merges historical surprises + upcoming calendar into PIT releases (est vs actual)", async () => {
    const hist = [
      { period: "2026-03-31", quarter: 1, year: 2026, actual: 1.61, estimate: 1.67 },
      { period: "2025-12-31", quarter: 4, year: 2025, actual: 1.95, estimate: 2.01 },
    ];
    const cal = { earningsCalendar: [{ date: "2026-07-29", epsEstimate: 1.85, quarter: 2, year: 2026, symbol: "AMZN" }] };
    const fetchJson = async (url: string) => (url.includes("/stock/earnings") ? hist : cal);
    const r = createFinnhubResource({ fetchJson, apiKey: "k" });
    const out = await r.fetch({ shape: "releases", entity: "AMZN" }, ctx);
    expect(out.payload).toHaveLength(3); // 2 historical + 1 upcoming

    const byRef = Object.fromEntries(out.payload.map((p) => [p["reference_period"], p]));
    expect(byRef["2026 Q1"]).toMatchObject({ event: "AMZN-EPS", status: "released", forecast: 1.67, actual: 1.61, unit: "EPS", as_of: ctx.now() });
    expect(byRef["2026 Q2"]).toMatchObject({ status: "scheduled", forecast: 1.85 });
    expect((byRef["2026 Q2"] as Record<string, unknown>)["actual"]).toBeUndefined();
  });

  it("emits a revenue (-REV) PIT row alongside EPS when the calendar carries revenue", async () => {
    const cal = {
      earningsCalendar: [
        { date: "2026-07-29", epsEstimate: 1.85, revenueEstimate: 1.6e11, revenueActual: 1.67e11, quarter: 2, year: 2026, symbol: "AMZN" },
      ],
    };
    const fetchJson = async (url: string) => (url.includes("/stock/earnings") ? [] : cal);
    const r = createFinnhubResource({ fetchJson, apiKey: "k" });
    const out = await r.fetch({ shape: "releases", entity: "AMZN" }, ctx);
    const byEvent = Object.fromEntries(out.payload.map((p) => [p["event"], p]));
    expect(byEvent["AMZN-EPS"]).toMatchObject({ reference_period: "2026 Q2", forecast: 1.85 });
    expect(byEvent["AMZN-REV"]).toMatchObject({
      name: "AMZN revenue",
      reference_period: "2026 Q2",
      unit: "USD",
      forecast: 1.6e11,
      actual: 1.67e11,
      status: "released",
    });
  });

  it("fills `previous` per event from the prior period's actual", async () => {
    const hist = [
      { period: "2026-03-31", quarter: 1, year: 2026, actual: 1.61, estimate: 1.67 },
      { period: "2025-12-31", quarter: 4, year: 2025, actual: 1.95, estimate: 2.01 },
    ];
    const cal = { earningsCalendar: [{ date: "2026-07-29", epsEstimate: 1.85, quarter: 2, year: 2026, symbol: "AMZN" }] };
    const fetchJson = async (url: string) => (url.includes("/stock/earnings") ? hist : cal);
    const r = createFinnhubResource({ fetchJson, apiKey: "k" });
    const out = await r.fetch({ shape: "releases", entity: "AMZN" }, ctx);
    const byRef = Object.fromEntries(out.payload.map((p) => [p["reference_period"], p]));
    expect(byRef["2026 Q1"]).toMatchObject({ actual: 1.61, previous: 1.95 }); // prior quarter actual
    expect(byRef["2026 Q2"]).toMatchObject({ status: "scheduled", previous: 1.61 }); // last reported number
  });

  it("surfaces a finnhub {error} envelope (HTTP 200) as FETCH_FAILED", async () => {
    const r = createFinnhubResource({ fetchJson: async () => ({ error: "API limit reached" }), apiKey: "k" });
    await expect(r.fetch({ shape: "news", entity: "AMZN" }, ctx)).rejects.toThrow(/API limit reached/);
  });

  it("builds a key_stats cross-section snapshot from profile2 + metric (friendly + formatted)", async () => {
    const profile = {
      name: "Amazon.com Inc",
      finnhubIndustry: "Retail",
      exchange: "NASDAQ",
      marketCapitalization: 2_100_000, // $millions → $2.10T
      shareOutstanding: 10_500, // millions → 10.5B
    };
    const metric = { metric: { peTTM: 42.314, "52WeekHigh": 250.5, beta: 1.23, dividendYieldIndicatedAnnual: 0.5 } };
    const fetchJson = async (url: string) => (url.includes("/stock/profile2") ? profile : metric);
    const r = createFinnhubResource({ fetchJson, apiKey: "k" });
    const out = await r.fetch({ shape: "key_stats", entity: "AMZN" }, ctx);
    const byField = Object.fromEntries(out.payload.map((p) => [p["field"], p]));
    expect(byField["name"]).toMatchObject({ label: "Company", value: "Amazon.com Inc", group: "profile", as_of: ctx.now() });
    expect((byField["marketCapitalization"] as Record<string, unknown>)["value"]).toBe("$2.10T");
    expect((byField["shareOutstanding"] as Record<string, unknown>)["value"]).toBe("10.5B");
    expect((byField["peTTM"] as Record<string, unknown>)["value"]).toBe("42.31");
    expect((byField["52WeekHigh"] as Record<string, unknown>)["value"]).toBe("$250.50");
    expect((byField["dividendYieldIndicatedAnnual"] as Record<string, unknown>)["value"]).toBe("0.50%");
    expect(byField["psTTM"]).toBeUndefined(); // absent upstream → skipped, no empty row
  });
});
