import { describe, expect, it, vi } from "vitest";
import { MuErrorException, type FetchResult } from "@mu/protocol";
import { ResourceRegistry } from "./registry.js";
import { AcquisitionCoordinator } from "./coordinator.js";
import type { FetchContext, FetchParams, IngestSink, Resource } from "./resource.js";

function fetchResult(id: string, params: FetchParams): FetchResult {
  return {
    descriptor: {
      shape: params.shape,
      identity: { provider: id, shape: params.shape, entity: params.entity.toUpperCase(), tail: ["1d"] },
      queryParams: {},
    },
    payload: [],
    provenance: { source: id, fetchedAt: 1, trigger: "on_demand", queryParams: {} },
  };
}

function mockResource(
  id: string,
  opts: {
    shapes?: string[];
    configSchema?: string[];
    configured?: boolean;
    fetchImpl?: (p: FetchParams, c: FetchContext) => Promise<FetchResult>;
  } = {},
): Resource {
  return {
    manifest: {
      id,
      shapes: opts.shapes ?? ["ohlcv"],
      params: [{ name: "entity", required: true }],
      configSchema: opts.configSchema,
    },
    isConfigured: opts.configSchema ? () => opts.configured ?? false : undefined,
    fetch: opts.fetchImpl ?? ((p) => Promise.resolve(fetchResult(id, p))),
  };
}

const sink = (): IngestSink & { calls: FetchResult[] } => {
  const calls: FetchResult[] = [];
  return {
    calls,
    async ingest(result) {
      calls.push(result);
      return { handle: "yfinance:ohlcv:AMZN:1d", summary: { rowCount: 0 } };
    },
  };
};

describe("ResourceRegistry availability", () => {
  it("zero-config resources are always available; configured ones gate on config presence", () => {
    const reg = new ResourceRegistry();
    reg.register(mockResource("yfinance"));
    reg.register(mockResource("orats", { configSchema: ["apiKey"], configured: false }));
    reg.register(mockResource("tiingo", { configSchema: ["apiKey"], configured: true }));
    const byId = Object.fromEntries(reg.list().map((l) => [l.manifest.id, l.availability]));
    expect(byId).toEqual({
      yfinance: "available",
      orats: "listed_but_unavailable",
      tiingo: "available",
    });
  });
});

describe("ResourceRegistry resolveProvider", () => {
  it("routes an explicit provider", () => {
    const reg = new ResourceRegistry();
    reg.register(mockResource("yfinance"));
    expect(reg.resolveProvider("ohlcv", "AMZN", "yfinance").manifest.id).toBe("yfinance");
  });

  it("defaults to the first available producer when provider omitted", () => {
    const reg = new ResourceRegistry();
    reg.register(mockResource("orats", { configSchema: ["apiKey"], configured: false })); // unavailable
    reg.register(mockResource("yfinance")); // available
    expect(reg.resolveProvider("ohlcv", "AMZN").manifest.id).toBe("yfinance");
  });

  it("typed errors: unknown source, shape mismatch, unconfigured, none-for-shape", () => {
    const reg = new ResourceRegistry();
    reg.register(mockResource("orats", { shapes: ["options_chain"], configSchema: ["apiKey"], configured: false }));
    expect(() => reg.resolveProvider("ohlcv", "AMZN", "nope")).toThrow(
      expect.objectContaining({ code: "UNKNOWN_SOURCE" }),
    );
    expect(() => reg.resolveProvider("ohlcv", "AMZN", "orats")).toThrow(
      expect.objectContaining({ code: "UNKNOWN_SOURCE" }), // orats doesn't produce ohlcv
    );
    expect(() => reg.resolveProvider("options_chain", "AMZN", "orats")).toThrow(
      expect.objectContaining({ code: "NOT_CONFIGURED" }),
    );
    expect(() => reg.resolveProvider("news", "AMZN")).toThrow(
      expect.objectContaining({ code: "UNKNOWN_SOURCE" }),
    );
  });

  it("rejects duplicate registration", () => {
    const reg = new ResourceRegistry();
    reg.register(mockResource("yfinance"));
    expect(() => reg.register(mockResource("yfinance"))).toThrow(/duplicate/);
  });
});

describe("AcquisitionCoordinator", () => {
  const params: FetchParams = { shape: "ohlcv", entity: "AMZN", resolution: "1d" };

  it("routes fetch → ingest and returns handle + summary (never payload)", async () => {
    const reg = new ResourceRegistry();
    reg.register(mockResource("yfinance"));
    const broker = sink();
    const coord = new AcquisitionCoordinator(reg, broker, () => 123);
    const res = await coord.acquire(undefined, params);
    expect(res.handle).toBe("yfinance:ohlcv:AMZN:1d");
    expect(broker.calls).toHaveLength(1);
    expect(res).not.toHaveProperty("payload");
  });

  it("classifies fetch failures into typed errors (vendor text stays out of context)", async () => {
    const reg = new ResourceRegistry();
    reg.register(mockResource("yfinance", { fetchImpl: () => Promise.reject(new Error("HTTP 429 rate limit exceeded")) }));
    const coord = new AcquisitionCoordinator(reg, sink());
    await expect(coord.acquire(undefined, params)).rejects.toMatchObject({ code: "RATE_LIMITED" });

    const reg2 = new ResourceRegistry();
    reg2.register(mockResource("yfinance", { fetchImpl: () => Promise.reject(new Error("socket hang up")) }));
    const coord2 = new AcquisitionCoordinator(reg2, sink());
    const err = await coord2.acquire(undefined, params).catch((e) => e as MuErrorException);
    expect(err).toBeInstanceOf(MuErrorException);
    expect(err.code).toBe("FETCH_FAILED");
    expect(err.message).not.toMatch(/socket hang up/); // raw vendor text not leaked
  });

  it("coalesces concurrent identical fetches via the inflight map", async () => {
    const fetchImpl = vi.fn(async (p: FetchParams) => {
      await new Promise((r) => setTimeout(r, 20));
      return fetchResult("yfinance", p);
    });
    const reg = new ResourceRegistry();
    reg.register(mockResource("yfinance", { fetchImpl }));
    const coord = new AcquisitionCoordinator(reg, sink());
    await Promise.all([coord.acquire(undefined, params), coord.acquire(undefined, params)]);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // two callers, one underlying fetch
  });
});
