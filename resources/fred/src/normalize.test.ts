import { describe, expect, it } from "vitest";
import { createFredResource } from "./index.js";

// =============================================================================
// FRED observations → point-in-time `releases` rows (offline; fetchJson injected).
// =============================================================================

const ctx = { trigger: "on_demand" as const, now: () => Date.UTC(2026, 5, 1) };

describe("fred resource", () => {
  it("is a keyed releases source", () => {
    const r = createFredResource({ fetchJson: async () => ({}), apiKey: "k" });
    expect(r.manifest.shapes).toEqual(["releases"]);
    expect(r.manifest.configSchema).toContain("FRED_API_KEY");
    expect(r.isConfigured?.()).toBe(true);
  });

  it("maps observations to releases, using realtime_start as the vintage, dropping missing values", async () => {
    const raw = {
      observations: [
        { realtime_start: "2026-06-01", realtime_end: "2026-06-01", date: "2026-01-01", value: "1.5" },
        { realtime_start: "2026-06-01", realtime_end: "2026-06-01", date: "2026-02-01", value: "." }, // missing → dropped
      ],
    };
    const r = createFredResource({ fetchJson: async () => raw, apiKey: "k" });
    const out = await r.fetch({ shape: "releases", entity: "gdp" }, ctx);
    expect(out.descriptor.identity).toMatchObject({ provider: "fred", shape: "releases", entity: "gdp" });
    expect(out.payload).toHaveLength(1);
    expect(out.payload[0]).toMatchObject({
      event: "GDP",
      name: "Gross Domestic Product", // reader-friendly, never the raw id
      reference_period: "2026-01-01",
      status: "released",
      actual: 1.5,
      unit: "Bil. of $",
      as_of: Date.parse("2026-06-01T12:00:00Z"),
    });
    expect(out.payload[0]!["forecast"]).toBeUndefined(); // FRED carries no consensus
  });

  it("carries the prior period as `previous` (FRED returns newest-first)", async () => {
    const raw = {
      observations: [
        { realtime_start: "2026-06-01", date: "2026-02-01", value: "2.0" },
        { realtime_start: "2026-06-01", date: "2026-01-01", value: "1.5" },
      ],
    };
    const r = createFredResource({ fetchJson: async () => raw, apiKey: "k" });
    const out = await r.fetch({ shape: "releases", entity: "CPIAUCSL" }, ctx);
    const byRef = Object.fromEntries(out.payload.map((p) => [p["reference_period"], p]));
    expect(byRef["2026-02-01"]).toMatchObject({ actual: 2.0, previous: 1.5 });
    expect(byRef["2026-01-01"]!["previous"]).toBeUndefined(); // oldest → no prior
  });

  it("auto-names an unknown series from FRED metadata (no raw code leaks)", async () => {
    const fetchJson = async (url: string) =>
      url.includes("/series/observations")
        ? { observations: [{ realtime_start: "2026-06-01", date: "2026-01-01", value: "3.3" }] }
        : { seriess: [{ id: "WXYZ", title: "Some Niche Indicator", units_short: "Pct." }] };
    const r = createFredResource({ fetchJson, apiKey: "k" });
    const out = await r.fetch({ shape: "releases", entity: "WXYZ" }, ctx);
    expect(out.payload[0]).toMatchObject({ event: "WXYZ", name: "Some Niche Indicator", unit: "Pct." });
    expect(out.payload[0]!["name"]).not.toBe("WXYZ");
  });

  it("surfaces a FRED JSON error envelope as FETCH_FAILED (HTTP 200 + error_message)", async () => {
    const fetchJson = async (url: string) =>
      url.includes("/series/observations") ? { error_code: 400, error_message: "Bad Request. Invalid series_id." } : {};
    const r = createFredResource({ fetchJson, apiKey: "k" });
    await expect(r.fetch({ shape: "releases", entity: "NOPE" }, ctx)).rejects.toThrow(/Bad Request/);
  });
});
