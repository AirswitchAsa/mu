import { describe, expect, it } from "vitest";
import { chainRecords, createOratsResource, snapshotAsOf, type OratsStrike } from "./index.js";

// =============================================================================
// ORATS resource. The offline tests pin the normalization contract (one provider
// strike-row → a call row + a put row, delta parity, mid, IV/SMV fallbacks) and the
// resource's descriptor/provenance, all with an injected `fetchJson` (no network).
// The final test is GATED on ORATS_API_KEY: it hits the real /datav2/strikes endpoint
// and is skipped unless the key is in the environment.
// =============================================================================

const STRIKE: OratsStrike = {
  expirDate: "2026-06-19",
  strike: 150,
  stockPrice: 152.4,
  dte: 14,
  callBidPrice: 5,
  callAskPrice: 5.4,
  callMidIv: 0.30,
  callSmvVol: 0.305,
  callOpenInterest: 1200,
  callVolume: 80,
  putBidPrice: 2,
  putAskPrice: 2.2,
  putMidIv: 0.34,
  putSmvVol: 0.345,
  putOpenInterest: 900,
  putVolume: 40,
  smvVol: 0.32,
  delta: 0.6,
  gamma: 0.02,
  theta: -0.05,
  vega: 0.1,
  snapShotDate: "2026-06-05T20:00:00Z",
};

describe("chainRecords", () => {
  it("splits a strike into a call row and a put row", () => {
    const rows = chainRecords([STRIKE], 1_000);
    expect(rows).toHaveLength(2);
    const call = rows.find((r) => r["right"] === "call")!;
    const put = rows.find((r) => r["right"] === "put")!;
    expect(call["id"]).toBe("2026-06-19|150|call");
    expect(put["id"]).toBe("2026-06-19|150|put");
  });

  it("computes mid, picks side IV/SMV, and applies put-call delta parity", () => {
    const [call, put] = chainRecords([STRIKE], 1_000);
    expect(call!["mid"]).toBeCloseTo(5.2, 6); // (5 + 5.4)/2
    expect(put!["mid"]).toBeCloseTo(2.1, 6); // (2 + 2.2)/2
    expect(call!["iv"]).toBe(0.30);
    expect(put!["iv"]).toBe(0.34);
    expect(call!["smv"]).toBe(0.305);
    expect(put!["smv"]).toBe(0.345);
    expect(call!["delta"]).toBe(0.6);
    expect(put!["delta"]).toBeCloseTo(-0.4, 6); // call delta − 1
    // shared greeks
    expect(call!["gamma"]).toBe(put!["gamma"]);
    expect(call!["vega"]).toBe(put!["vega"]);
    expect(call!["underlying"]).toBe(152.4);
    expect(call!["dte"]).toBe(14);
  });

  it("falls back to smvVol when a side smv is absent, and 0 for missing prices", () => {
    const bare: OratsStrike = { expirDate: "2026-07-17", strike: 200, smvVol: 0.5, delta: 0.4 };
    const [call, put] = chainRecords([bare], 5);
    expect(call!["smv"]).toBe(0.5);
    expect(put!["smv"]).toBe(0.5);
    expect(call!["bid"]).toBe(0);
    expect(call!["mid"]).toBe(0);
    expect(put!["delta"]).toBeCloseTo(-0.6, 6);
  });

  it("drops rows missing an expiry or strike", () => {
    expect(chainRecords([{ strike: 150 }, { expirDate: "2026-06-19" }], 1)).toHaveLength(0);
  });
});

describe("snapshotAsOf", () => {
  it("parses the provider snapshot stamp", () => {
    expect(snapshotAsOf([STRIKE], 999)).toBe(Date.parse("2026-06-05T20:00:00Z"));
  });
  it("falls back to now when no stamp is present", () => {
    expect(snapshotAsOf([{ expirDate: "x", strike: 1 }], 777)).toBe(777);
  });
});

describe("createOratsResource (offline)", () => {
  const resource = createOratsResource({
    apiKey: "test-key",
    fetchJson: async () => ({ data: [STRIKE] }),
  });

  it("declares the options_chain manifest and is configured with a key", () => {
    expect(resource.manifest.id).toBe("orats");
    expect(resource.manifest.shapes).toEqual(["options_chain"]);
    expect(resource.isConfigured?.()).toBe(true);
    expect(createOratsResource({ apiKey: "" }).isConfigured?.()).toBe(false);
  });

  it("fetches into a stable handle identity with a provider-stamped as_of", async () => {
    const out = await resource.fetch(
      { shape: "options_chain", entity: "AMZN" },
      { trigger: "on_demand", now: () => 12_345 },
    );
    expect(out.descriptor.identity).toEqual({ provider: "orats", shape: "options_chain", entity: "AMZN", tail: [] });
    expect(out.provenance.source).toBe("orats");
    expect(out.payload).toHaveLength(2);
    const asOf = (out.payload[0] as Record<string, unknown>)["as_of"];
    expect(asOf).toBe(Date.parse("2026-06-05T20:00:00Z"));
  });

  it("rejects an unknown shape", async () => {
    await expect(
      resource.fetch({ shape: "ohlcv", entity: "AMZN" }, { trigger: "on_demand", now: () => 0 }),
    ).rejects.toThrow();
  });
});

// --- GATED live test (needs ORATS_API_KEY in the env) ------------------------
describe.skipIf(!process.env["ORATS_API_KEY"])("ORATS live /datav2/strikes", () => {
  it("fetches a real AAPL chain that normalizes to valid call/put records", async () => {
    const resource = createOratsResource();
    const out = await resource.fetch(
      { shape: "options_chain", entity: "AAPL" },
      { trigger: "on_demand", now: () => Date.now() },
    );
    expect(out.payload.length).toBeGreaterThan(0);
    const r = out.payload[0] as Record<string, unknown>;
    expect(["call", "put"]).toContain(r["right"]);
    expect(typeof r["strike"]).toBe("number");
    expect(Number.isFinite(r["iv"] as number)).toBe(true);
    // both sides present for the same strike
    const rights = new Set(out.payload.map((x) => (x as Record<string, unknown>)["right"]));
    expect(rights).toEqual(new Set(["call", "put"]));
  }, 30_000);
});
