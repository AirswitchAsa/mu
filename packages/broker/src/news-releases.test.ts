import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FetchResult } from "@mu/protocol";
import { DataBroker } from "./broker.js";

// =============================================================================
// News (event-list) + releases (point-in-time / bitemporal) merge semantics.
// Proves: news upserts by id; releases append vintages (revisions are NEW rows)
// and the as-of read returns what was known on/before a cutoff date.
// =============================================================================

let root: string;
let broker: DataBroker;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mu-np-"));
  broker = await DataBroker.create(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const T = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;

function newsFetch(rows: Record<string, unknown>[]): FetchResult {
  return {
    descriptor: { shape: "news", identity: { provider: "yahoo", shape: "news", entity: "AMZN", tail: [] }, queryParams: {} },
    payload: rows,
    provenance: { source: "yahoo", fetchedAt: T, trigger: "on_demand", queryParams: {} },
  };
}
function releasesFetch(rows: Record<string, unknown>[]): FetchResult {
  return {
    descriptor: { shape: "releases", identity: { provider: "finnhub", shape: "releases", entity: "AMZN", tail: [] }, queryParams: {} },
    payload: rows,
    provenance: { source: "finnhub", fetchedAt: T, trigger: "on_demand", queryParams: {} },
  };
}
function keyStatsFetch(rows: Record<string, unknown>[]): FetchResult {
  return {
    descriptor: { shape: "key_stats", identity: { provider: "finnhub", shape: "key_stats", entity: "AMZN", tail: [] }, queryParams: {} },
    payload: rows,
    provenance: { source: "finnhub", fetchedAt: T, trigger: "on_demand", queryParams: {} },
  };
}

describe("news — event-list merge (upsert by id)", () => {
  it("dedupes by id (a correction overwrites), unions new ids, orders by time", async () => {
    await broker.ingest(
      newsFetch([
        { id: "a", published_at: T, source: "reuters", headline: "first" },
        { id: "b", published_at: T + DAY, source: "cnbc", headline: "second" },
      ]),
    );
    const { handle } = await broker.ingest(
      newsFetch([
        { id: "b", published_at: T + DAY, source: "cnbc", headline: "second (corrected)" },
        { id: "c", published_at: T + 2 * DAY, source: "ft", headline: "third" },
      ]),
    );
    const rows = await broker.resolve(handle);
    expect(rows).toHaveLength(3); // a, b, c — b upserted not duplicated
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]); // ascending by published_at
    expect(rows.find((r) => r.id === "b")!.headline).toBe("second (corrected)");
  });

  it("latest-N read returns the most recent headlines", async () => {
    const { handle } = await broker.ingest(
      newsFetch(Array.from({ length: 5 }, (_, i) => ({ id: `n${i}`, published_at: T + i * DAY, source: "x", headline: `h${i}` }))),
    );
    const rows = await broker.resolve(handle, { last: 2 });
    expect(rows.map((r) => r.id)).toEqual(["n3", "n4"]);
  });
});

describe("releases — point-in-time (bitemporal) merge", () => {
  const event = { event: "AMZN-EPS", name: "Amazon EPS", reference_period: "2026 Q1", release_time: T + 10 * DAY };

  it("a revision is a NEW vintage row, never an overwrite", async () => {
    // vintage 1: only a forecast is known (scheduled).
    await broker.ingest(releasesFetch([{ ...event, as_of: T, status: "scheduled", forecast: 0.98 }]));
    // vintage 2: the actual prints (released) — same logical row, later as_of.
    const { handle } = await broker.ingest(
      releasesFetch([{ ...event, as_of: T + 11 * DAY, status: "released", forecast: 0.98, actual: 1.12 }]),
    );
    const all = await broker.resolve(handle);
    expect(all).toHaveLength(2); // both vintages preserved
  });

  it("the as-of read returns what was known on/before a cutoff", async () => {
    await broker.ingest(releasesFetch([{ ...event, as_of: T, status: "scheduled", forecast: 0.98 }]));
    const { handle } = await broker.ingest(
      releasesFetch([{ ...event, as_of: T + 11 * DAY, status: "released", forecast: 0.98, actual: 1.12 }]),
    );

    // as of T+1d: only the scheduled forecast was known.
    const early = await broker.resolve(handle, { asOf: String(T + DAY) });
    expect(early).toHaveLength(1);
    expect(early[0]!.status).toBe("scheduled");
    expect(early[0]!.actual ?? null).toBeNull();

    // as of T+20d: the released actual is the latest known vintage.
    const late = await broker.resolve(handle, { asOf: String(T + 20 * DAY) });
    expect(late).toHaveLength(1);
    expect(late[0]!.status).toBe("released");
    expect(late[0]!.actual).toBe(1.12);
  });
});

describe("key_stats — cross-section (accumulating snapshot) merge", () => {
  it("upserts by (as_of, field): re-snapshot overwrites a field, a new as_of adds a vintage", async () => {
    // vintage 1: two fields.
    await broker.ingest(
      keyStatsFetch([
        { field: "peTTM", label: "P/E (TTM)", value: "40.00", as_of: T, group: "valuation" },
        { field: "sector", label: "Sector", value: "Retail", as_of: T, group: "profile" },
      ]),
    );
    // vintage 2: pe revised (new as_of) + sector unchanged (new as_of) — both new vintages.
    const { handle } = await broker.ingest(
      keyStatsFetch([
        { field: "peTTM", label: "P/E (TTM)", value: "42.00", as_of: T + DAY, group: "valuation" },
        { field: "sector", label: "Sector", value: "Retail", as_of: T + DAY, group: "profile" },
      ]),
    );
    const all = await broker.resolve(handle);
    expect(all).toHaveLength(4); // 2 fields × 2 vintages, all preserved

    // re-ingesting the SAME vintage (same as_of) upserts in place (no growth).
    await broker.ingest(
      keyStatsFetch([{ field: "peTTM", label: "P/E (TTM)", value: "42.50", as_of: T + DAY, group: "valuation" }]),
    );
    const after = await broker.resolve(handle);
    expect(after).toHaveLength(4);
    const v2pe = after.filter((r) => r.field === "peTTM" && r.as_of === T + DAY);
    expect(v2pe).toHaveLength(1);
    expect(v2pe[0]!.value).toBe("42.50"); // incoming won
  });

  it("the as-of read returns, per field, the latest vintage on/before a cutoff", async () => {
    await broker.ingest(keyStatsFetch([{ field: "peTTM", label: "P/E (TTM)", value: "40.00", as_of: T, group: "valuation" }]));
    const { handle } = await broker.ingest(
      keyStatsFetch([{ field: "peTTM", label: "P/E (TTM)", value: "42.00", as_of: T + 5 * DAY, group: "valuation" }]),
    );
    const early = await broker.resolve(handle, { asOf: String(T + DAY) });
    expect(early).toHaveLength(1);
    expect(early[0]!.value).toBe("40.00");

    const late = await broker.resolve(handle, { asOf: String(T + 10 * DAY) });
    expect(late).toHaveLength(1);
    expect(late[0]!.value).toBe("42.00");
  });
});
