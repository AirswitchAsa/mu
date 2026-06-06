import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FetchResult } from "@mu/protocol";
import { DataBroker } from "./broker.js";
import { positionsShape, type PositionRecord } from "./shapes/positions.js";

// =============================================================================
// `positions` shape — the cross-section that backs the holdings table. The logical
// within-snapshot row is `symbol`; vintages accrue by `as_of`. These exercise (1) the
// pure validate/summarize gate and (2) the real broker ingest→resolve path, proving the
// `(as_of, symbol)` dedupe holds end to end (a re-snapshot upserts a vintage; a new
// `as_of` keeps both; a closed name simply drops out of the newer snapshot).
// =============================================================================

function row(over: Partial<PositionRecord>): PositionRecord {
  return {
    symbol: "AAPL",
    qty: 10,
    side: "long",
    avg_entry: 180,
    price: 195,
    market_value: 1950,
    cost_basis: 1800,
    unrealized_pl: 150,
    unrealized_plpc: 0.0833,
    change_today: 0.012,
    asset_class: "us_equity",
    as_of: 1_000,
    ...over,
  };
}

describe("positionsShape.validate", () => {
  it("accepts well-formed long and short rows", () => {
    const ok = positionsShape.validate([row({}), row({ symbol: "TSLA", side: "short", qty: -5 })]);
    expect(ok.ok).toBe(true);
  });

  it("rejects a bad side, a non-finite number, a missing symbol, and a non-integer as_of", () => {
    const bad = positionsShape.validate([
      row({ side: "flat" }),
      row({ market_value: Number.NaN }),
      row({ symbol: "" }),
      row({ as_of: 1.5 }),
    ]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const paths = bad.errors.map((e) => e.path);
      expect(paths).toContain("[0].side");
      expect(paths).toContain("[1].market_value");
      expect(paths).toContain("[2].symbol");
      expect(paths).toContain("[3].as_of");
    }
  });

  it("rejects a non-array payload", () => {
    expect(positionsShape.validate({} as unknown).ok).toBe(false);
  });
});

describe("positionsShape.summarize", () => {
  it("counts distinct symbols and tracks the as_of span", () => {
    const s = positionsShape.summarize([
      row({ symbol: "AAPL", as_of: 1_000 }),
      row({ symbol: "MSFT", as_of: 1_000 }),
      row({ symbol: "AAPL", as_of: 2_000 }),
    ]);
    expect(s.rowCount).toBe(3);
    expect(s["positionCount"]).toBe(2);
    expect(s.firstT).toBe(1_000);
    expect(s.lastT).toBe(2_000);
  });
});

describe("positions ingest → resolve (cross-section vintages)", () => {
  let root: string;
  let broker: DataBroker;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mu-pos-"));
    broker = await DataBroker.create(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const fetchOf = (rows: PositionRecord[]): FetchResult => ({
    descriptor: {
      shape: "positions",
      identity: { provider: "alpaca", shape: "positions", entity: "PORTFOLIO", tail: [] },
      queryParams: { entity: "portfolio" },
    },
    provenance: { source: "alpaca", fetchedAt: rows[0]!.as_of, trigger: "on_demand", queryParams: { entity: "portfolio" } },
    payload: rows,
  });

  const snapshot = (asOf: number, price: number): PositionRecord[] => [
    row({ symbol: "AAPL", as_of: asOf, price, market_value: price * 10 }),
    row({ symbol: "MSFT", as_of: asOf, price, market_value: price * 10 }),
  ];

  it("mints the stable account handle (no as_of in the handle) and keeps each vintage", async () => {
    const { handle } = await broker.ingest(fetchOf(snapshot(1_000, 195)));
    expect(handle).toBe("alpaca:positions:PORTFOLIO");
    await broker.ingest(fetchOf(snapshot(2_000, 200))); // re-snapshot → new vintage

    const rows = (await broker.resolve(handle)) as unknown as PositionRecord[];
    expect(rows).toHaveLength(4); // 2 symbols × 2 vintages, both kept
    const latest = rows.filter((r) => r.as_of === Math.max(...rows.map((x) => x.as_of)));
    expect(latest).toHaveLength(2);
    expect(latest.every((r) => r.price === 200)).toBe(true);
  });

  it("re-snapshotting the same as_of upserts in place (no duplicate vintage)", async () => {
    const { handle } = await broker.ingest(fetchOf(snapshot(1_000, 195)));
    await broker.ingest(fetchOf(snapshot(1_000, 198))); // same vintage, revised marks
    const rows = (await broker.resolve(handle)) as unknown as PositionRecord[];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.price === 198)).toBe(true);
  });
});
