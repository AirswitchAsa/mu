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
      reference_period: "2026-01-01",
      status: "released",
      actual: 1.5,
      as_of: Date.parse("2026-06-01T12:00:00Z"),
    });
    expect(out.payload[0]!["forecast"]).toBeUndefined(); // FRED carries no consensus
  });
});
