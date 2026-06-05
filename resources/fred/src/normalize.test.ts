import { describe, expect, it } from "vitest";
import { createFredResource } from "./index.js";

// =============================================================================
// FRED/ALFRED observations → point-in-time `releases` rows with the full revision
// trail (offline; fetchJson injected). Two calls: a `output_type=1` latest window
// to bound the periods, then an `output_type=2` ALFRED call for every vintage.
// =============================================================================

const ctx = { trigger: "on_demand" as const, now: () => Date.UTC(2026, 5, 1) };
const ms = (d: string): number => Date.parse(`${d}T12:00:00Z`);

/** Route the injected fetch: latest window (output_type=1) vs vintage trail vs metadata. */
function router(opts: {
  latest: unknown;
  vintage: unknown;
  meta?: unknown;
}): (url: string) => Promise<unknown> {
  return async (url: string) => {
    if (url.includes("/series/observations")) {
      return url.includes("output_type=2") ? opts.vintage : opts.latest;
    }
    return opts.meta ?? {};
  };
}

describe("fred resource", () => {
  it("is a keyed releases source", () => {
    const r = createFredResource({ fetchJson: async () => ({}), apiKey: "k" });
    expect(r.manifest.shapes).toEqual(["releases"]);
    expect(r.manifest.configSchema).toContain("FRED_API_KEY");
    expect(r.isConfigured?.()).toBe(true);
  });

  it("emits one row per genuine vintage; earliest 'released', later 'revised'; repeats collapse", async () => {
    const latest = {
      observations: [
        { date: "2026-01-01", value: "1.6", realtime_start: "2026-06-01" },
        { date: "2025-10-01", value: "2.1", realtime_start: "2026-06-01" },
      ],
    };
    // ALFRED wide pivot: a column per vintage date, value repeated until it changed.
    // 2025-10-01 never revised; 2026-01-01 revised twice (the trailing 1.4 repeat
    // must collapse — only genuine changes become rows).
    const vintage = {
      observations: [
        { date: "2025-10-01", GDP_20260130: "2.1" },
        { date: "2026-01-01", GDP_20260425: "1.6", GDP_20260530: "1.3", GDP_20260627: "1.4", GDP_20260725: "1.4" },
      ],
    };
    const r = createFredResource({ fetchJson: router({ latest, vintage }), apiKey: "k" });
    const out = await r.fetch({ shape: "releases", entity: "gdp" }, ctx);

    expect(out.descriptor.identity).toMatchObject({ provider: "fred", shape: "releases", entity: "gdp" });
    const trail = out.payload
      .filter((p) => p["reference_period"] === "2026-01-01")
      .sort((a, b) => (a["as_of"] as number) - (b["as_of"] as number));
    expect(trail).toHaveLength(3);
    expect(trail.map((p) => [p["actual"], p["status"], p["as_of"]])).toEqual([
      [1.6, "released", ms("2026-04-25")],
      [1.3, "revised", ms("2026-05-30")],
      [1.4, "revised", ms("2026-06-27")],
    ]);
    // names + units come from the curated catalog, not the raw id
    expect(trail[0]).toMatchObject({ event: "GDP", name: "Gross Domestic Product", unit: "Bil. of $" });
    expect(trail[0]!["forecast"]).toBeUndefined(); // FRED carries no consensus
  });

  it("carries the prior period's current value as `previous`", async () => {
    const latest = {
      observations: [
        { date: "2026-01-01", value: "1.4", realtime_start: "2026-06-01" },
        { date: "2025-10-01", value: "2.1", realtime_start: "2026-06-01" },
      ],
    };
    const vintage = {
      observations: [
        { date: "2025-10-01", CPIAUCSL_20260130: "2.0", CPIAUCSL_20260227: "2.1" }, // revised → current 2.1
        { date: "2026-01-01", CPIAUCSL_20260425: "1.4" },
      ],
    };
    const r = createFredResource({ fetchJson: router({ latest, vintage }), apiKey: "k" });
    const out = await r.fetch({ shape: "releases", entity: "CPIAUCSL" }, ctx);
    const jan = out.payload.find((p) => p["reference_period"] === "2026-01-01");
    expect(jan).toMatchObject({ actual: 1.4, previous: 2.1 }); // prior period's *latest* value
    const octOldest = out.payload
      .filter((p) => p["reference_period"] === "2025-10-01")
      .every((p) => p["previous"] === undefined);
    expect(octOldest).toBe(true); // oldest period → no predecessor
  });

  it("auto-names an unknown series from FRED metadata (no raw code leaks)", async () => {
    const latest = { observations: [{ date: "2026-01-01", value: "3.3", realtime_start: "2026-06-01" }] };
    const vintage = { observations: [{ date: "2026-01-01", WXYZ_20260515: "3.3" }] };
    const meta = { seriess: [{ id: "WXYZ", title: "Some Niche Indicator", units_short: "Pct." }] };
    const r = createFredResource({ fetchJson: router({ latest, vintage, meta }), apiKey: "k" });
    const out = await r.fetch({ shape: "releases", entity: "WXYZ" }, ctx);
    expect(out.payload[0]).toMatchObject({ event: "WXYZ", name: "Some Niche Indicator", unit: "Pct." });
    expect(out.payload[0]!["name"]).not.toBe("WXYZ");
  });

  it("returns an empty payload (not an error) for a series with no observations", async () => {
    const r = createFredResource({ fetchJson: router({ latest: { observations: [] }, vintage: {} }), apiKey: "k" });
    const out = await r.fetch({ shape: "releases", entity: "EMPTY" }, ctx);
    expect(out.payload).toEqual([]);
  });

  it("surfaces a FRED JSON error envelope as FETCH_FAILED (HTTP 200 + error_message)", async () => {
    const fetchJson = async (url: string) =>
      url.includes("/series/observations") ? { error_code: 400, error_message: "Bad Request. Invalid series_id." } : {};
    const r = createFredResource({ fetchJson, apiKey: "k" });
    await expect(r.fetch({ shape: "releases", entity: "NOPE" }, ctx)).rejects.toThrow(/Bad Request/);
  });
});
