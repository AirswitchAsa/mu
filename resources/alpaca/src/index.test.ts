import { describe, expect, it } from "vitest";
import {
  balanceRecords,
  createAlpacaResource,
  equityRecords,
  positionRecords,
  type AlpacaAccount,
  type AlpacaHistory,
  type AlpacaPosition,
} from "./index.js";

// =============================================================================
// Alpaca resource. The offline tests pin the three normalizers (positions →
// `positions`, account → `key_stats` balances, portfolio/history → degenerate `ohlcv`)
// and the resource's descriptor/identity, all with an injected `fetchJson` (no network).
// The final test is GATED on ALPACA_API_KEY_ID + ALPACA_API_SECRET: it hits the real
// paper Trading API and is skipped unless both keys are in the environment.
// =============================================================================

const POS: AlpacaPosition = {
  symbol: "AAPL",
  qty: "10",
  side: "long",
  avg_entry_price: "180.00",
  current_price: "195.00",
  market_value: "1950.00",
  cost_basis: "1800.00",
  unrealized_pl: "150.00",
  unrealized_plpc: "0.0833",
  change_today: "0.012",
  asset_class: "us_equity",
};

const ACCT: AlpacaAccount = {
  equity: "39993.24",
  last_equity: "41054.10",
  cash: "39993.24",
  buying_power: "159972.96",
  long_market_value: "0",
};

describe("positionRecords", () => {
  it("parses string numbers, normalizes side, and defaults asset_class", () => {
    const [r] = positionRecords([POS], 1_000);
    expect(r!["symbol"]).toBe("AAPL");
    expect(r!["qty"]).toBe(10);
    expect(r!["side"]).toBe("long");
    expect(r!["avg_entry"]).toBe(180);
    expect(r!["price"]).toBe(195);
    expect(r!["unrealized_pl"]).toBe(150);
    expect(r!["unrealized_plpc"]).toBeCloseTo(0.0833, 6);
    expect(r!["asset_class"]).toBe("us_equity");
    expect(r!["as_of"]).toBe(1_000);
    const [bare] = positionRecords([{ symbol: "X", side: "short" }], 5);
    expect(bare!["side"]).toBe("short");
    expect(bare!["price"]).toBe(0); // missing → 0
    expect(bare!["asset_class"]).toBe("us_equity"); // missing → default
  });

  it("drops rows missing a symbol", () => {
    expect(positionRecords([{ qty: "1" }, { symbol: "" }], 1)).toHaveLength(0);
  });
});

describe("balanceRecords", () => {
  it("emits key_stats rows with display strings, groups, and a derived day P/L", () => {
    const recs = balanceRecords(ACCT, 2_000);
    const byField = Object.fromEntries(recs.map((r) => [r["field"], r]));
    expect(byField["equity"]!["value"]).toBe("$39,993.24");
    expect(byField["equity"]!["group"]).toBe("balances");
    expect(byField["buying_power"]!["value"]).toBe("$159,972.96");
    // day P/L = equity − last_equity = 39993.24 − 41054.10 = −1060.86 (a loss)
    expect(byField["day_pl"]!["value"]).toBe("-$1,060.86");
    expect(byField["day_pl"]!["group"]).toBe("performance");
    expect(byField["day_pl_pct"]!["value"]).toBe("-2.58%");
    expect(recs.every((r) => r["as_of"] === 2_000)).toBe(true);
  });
});

describe("equityRecords", () => {
  it("maps equity history to degenerate ohlcv (ms time, close=equity) and drops pre-funding zeros", () => {
    const hist: AlpacaHistory = { timestamp: [1000, 2000, 3000], equity: [0, 40000, 41000] };
    const rows = equityRecords(hist);
    expect(rows).toHaveLength(2); // the equity=0 point is dropped
    expect(rows[0]).toMatchObject({ t: 2_000_000, open: 40000, high: 40000, low: 40000, close: 40000, volume: 0 });
    expect(rows[1]!["close"]).toBe(41000);
  });
});

describe("createAlpacaResource (offline)", () => {
  const resource = createAlpacaResource({
    keyId: "PK_test",
    secret: "secret",
    fetchJson: async (path) => {
      if (path === "/v2/positions") return [POS];
      if (path === "/v2/account") return ACCT;
      if (path.startsWith("/v2/account/portfolio/history")) return { timestamp: [2000], equity: [40000] };
      throw new Error(`unexpected path ${path}`);
    },
  });

  it("declares the three-shape manifest and is configured only with both keys", () => {
    expect(resource.manifest.id).toBe("alpaca");
    expect(resource.manifest.shapes).toEqual(["positions", "key_stats", "ohlcv"]);
    expect(resource.isConfigured?.()).toBe(true);
    expect(createAlpacaResource({ keyId: "PK", secret: "" }).isConfigured?.()).toBe(false);
    expect(createAlpacaResource({ keyId: "", secret: "s" }).isConfigured?.()).toBe(false);
  });

  it("normalizes the handle identity to the account, even if a stray entity is passed", async () => {
    // the agent fat-fingers a ticker — alpaca still returns THE account, and the handle
    // identity must be the stable account label (never `AAPL`), so it dedupes + can't lie.
    const out = await resource.fetch({ shape: "positions", entity: "AAPL" }, { trigger: "on_demand", now: () => 12_345 });
    expect(out.descriptor.identity).toEqual({ provider: "alpaca", shape: "positions", entity: "portfolio", tail: [] });
    expect(out.payload).toHaveLength(1);
    expect((out.payload[0] as Record<string, unknown>)["as_of"]).toBe(12_345);
  });

  it("fetches balances as key_stats and the equity curve as ohlcv, pinned to the daily series", async () => {
    const bal = await resource.fetch({ shape: "key_stats", entity: "portfolio" }, { trigger: "on_demand", now: () => 7 });
    expect(bal.descriptor.shape).toBe("key_stats");
    expect(bal.descriptor.identity.entity).toBe("portfolio");
    expect((bal.payload[0] as Record<string, unknown>)["field"]).toBe("equity");

    // a stray resolution must not make the handle claim non-daily data (the API is always 1D)
    const eq = await resource.fetch({ shape: "ohlcv", entity: "portfolio", resolution: "1W" }, { trigger: "on_demand", now: () => 7 });
    expect(eq.descriptor.identity.tail).toEqual(["1D"]);
    expect((eq.payload[0] as Record<string, unknown>)["close"]).toBe(40000);
  });

  it("rejects an unknown shape", async () => {
    await expect(resource.fetch({ shape: "news", entity: "x" }, { trigger: "on_demand", now: () => 0 })).rejects.toThrow();
  });
});

// --- GATED live test (needs ALPACA_API_KEY_ID + ALPACA_API_SECRET in the env) -------
describe.skipIf(!(process.env["ALPACA_API_KEY_ID"] && process.env["ALPACA_API_SECRET"]))("Alpaca live Trading API", () => {
  it("fetches a real account whose balances normalize to valid key_stats", async () => {
    const resource = createAlpacaResource();
    const out = await resource.fetch({ shape: "key_stats", entity: "portfolio" }, { trigger: "on_demand", now: () => Date.now() });
    expect(out.payload.length).toBeGreaterThan(0);
    const equity = (out.payload.find((r) => (r as Record<string, unknown>)["field"] === "equity") ?? {}) as Record<string, unknown>;
    expect(typeof equity["value"]).toBe("string");
    expect((equity["value"] as string).startsWith("$") || (equity["value"] as string).startsWith("-$")).toBe(true);
  }, 30_000);

  it("fetches the real equity curve as ohlcv rows", async () => {
    const resource = createAlpacaResource();
    const out = await resource.fetch({ shape: "ohlcv", entity: "portfolio" }, { trigger: "on_demand", now: () => Date.now() });
    for (const r of out.payload as Record<string, unknown>[]) {
      expect(Number.isFinite(r["close"] as number)).toBe(true);
      expect((r["close"] as number) > 0).toBe(true);
    }
  }, 30_000);
});
