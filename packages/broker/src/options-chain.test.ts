import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FetchResult } from "@mu/protocol";
import { DataBroker } from "./broker.js";
import { optionsChainShape, type OptionsChainRecord } from "./shapes/options-chain.js";

// =============================================================================
// `options_chain` shape — the cross-section that backs the grid + curve cards. The
// logical within-snapshot row is `id = "{expiry}|{strike}|{right}"`; vintages accrue
// by `as_of`. These exercise (1) the pure validate/summarize gate and (2) the real
// broker ingest→resolve path, proving the composite-id `(as_of, id)` dedupe holds end
// to end (a re-snapshot upserts a vintage; a new `as_of` keeps both).
// =============================================================================

function row(over: Partial<OptionsChainRecord>): OptionsChainRecord {
  return {
    id: "2026-06-19|150|call",
    expiry: "2026-06-19",
    strike: 150,
    right: "call",
    bid: 5,
    ask: 5.2,
    mid: 5.1,
    iv: 0.3,
    smv: 0.31,
    delta: 0.55,
    gamma: 0.02,
    theta: -0.05,
    vega: 0.1,
    open_interest: 1200,
    volume: 80,
    underlying: 152.4,
    dte: 14,
    as_of: 1_000,
    ...over,
  };
}

describe("optionsChainShape.validate", () => {
  it("accepts a well-formed call+put pair", () => {
    const ok = optionsChainShape.validate([
      row({}),
      row({ id: "2026-06-19|150|put", right: "put", delta: -0.45 }),
    ]);
    expect(ok.ok).toBe(true);
  });

  it("rejects a bad right, a non-finite number, and a non-integer as_of", () => {
    const bad = optionsChainShape.validate([
      row({ right: "straddle" }),
      row({ iv: Number.NaN }),
      row({ as_of: 1.5 }),
    ]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const paths = bad.errors.map((e) => e.path);
      expect(paths).toContain("[0].right");
      expect(paths).toContain("[1].iv");
      expect(paths).toContain("[2].as_of");
    }
  });

  it("rejects a non-array payload", () => {
    expect(optionsChainShape.validate({} as unknown).ok).toBe(false);
  });
});

describe("optionsChainShape.summarize", () => {
  it("counts distinct strikes and expiries and tracks the as_of span", () => {
    const s = optionsChainShape.summarize([
      row({ as_of: 1_000 }),
      row({ id: "2026-06-19|160|call", strike: 160 }),
      row({ id: "2026-07-17|150|call", expiry: "2026-07-17", as_of: 2_000 }),
    ]);
    expect(s.rowCount).toBe(3);
    expect(s["strikeCount"]).toBe(2);
    expect(s["expiryCount"]).toBe(2);
    expect(s.firstT).toBe(1_000);
    expect(s.lastT).toBe(2_000);
  });
});

describe("options_chain ingest → resolve (cross-section vintages)", () => {
  let root: string;
  let broker: DataBroker;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mu-chain-"));
    broker = await DataBroker.create(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const fetchOf = (rows: OptionsChainRecord[]): FetchResult => ({
    descriptor: {
      shape: "options_chain",
      identity: { provider: "orats", shape: "options_chain", entity: "AMZN", tail: [] },
      queryParams: { entity: "AMZN" },
    },
    provenance: { source: "orats", fetchedAt: rows[0]!.as_of, trigger: "on_demand", queryParams: { entity: "AMZN" } },
    payload: rows,
  });

  const snapshot = (asOf: number, iv: number): OptionsChainRecord[] => [
    row({ id: "2026-06-19|150|call", right: "call", strike: 150, as_of: asOf, iv }),
    row({ id: "2026-06-19|150|put", right: "put", strike: 150, delta: -0.45, as_of: asOf, iv }),
  ];

  it("mints the stable handle (no as_of in the handle) and keeps each vintage", async () => {
    const { handle } = await broker.ingest(fetchOf(snapshot(1_000, 0.30)));
    expect(handle).toBe("orats:options_chain:AMZN");
    await broker.ingest(fetchOf(snapshot(2_000, 0.40))); // surface moved → new vintage

    const rows = (await broker.resolve(handle)) as unknown as OptionsChainRecord[];
    expect(rows).toHaveLength(4); // 2 ids × 2 vintages, both kept
    const latest = rows.filter((r) => r.as_of === Math.max(...rows.map((x) => x.as_of)));
    expect(latest).toHaveLength(2);
    expect(latest.every((r) => r.iv === 0.4)).toBe(true); // newest vintage is the v2 surface
  });

  it("re-snapshotting the same as_of upserts (does not duplicate the vintage)", async () => {
    const { handle } = await broker.ingest(fetchOf(snapshot(1_000, 0.30)));
    await broker.ingest(fetchOf(snapshot(1_000, 0.33))); // same vintage, revised values
    const rows = (await broker.resolve(handle)) as unknown as OptionsChainRecord[];
    expect(rows).toHaveLength(2); // still one vintage
    expect(rows.every((r) => r.iv === 0.33)).toBe(true); // upserted in place
  });
});
