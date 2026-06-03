import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleToPath, MuErrorException, type Handle } from "@mu/protocol";
import { DataBroker, VIEW_GUARD_MAX_ROWS } from "./broker.js";
import { bars, ohlcvFetch } from "./test-fixtures.js";

const datasetDir = (handle: Handle): string => join(root, handleToPath(handle));

let root: string;
let broker: DataBroker;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mu-broker-"));
  broker = await DataBroker.create(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("ingest → resolve", () => {
  it("returns the full series, sorted by t, with numeric (not bigint) t", async () => {
    const { handle, summary } = await broker.ingest(ohlcvFetch(bars("2024-01-01", 5)));
    expect(handle).toBe("yfinance:ohlcv:AMZN:1d");
    expect(summary.rowCount).toBe(5);
    const rows = await broker.resolve(handle);
    expect(rows).toHaveLength(5);
    expect(typeof rows[0]!.t).toBe("number");
    expect(rows.map((r) => r.t)).toEqual([...rows].sort((a, b) => (a.t as number) - (b.t as number)).map((r) => r.t));
    expect(rows[4]!.close).toBe(104);
  });
});

describe("idempotency", () => {
  it("re-ingesting the same identity collapses to a no-op merge (content-stable)", async () => {
    const fr = ohlcvFetch(bars("2024-01-01", 10));
    const a = await broker.ingest(fr);
    const rowsA = await broker.resolve(a.handle);
    const b = await broker.ingest(fr);
    const rowsB = await broker.resolve(b.handle);
    expect(b.summary.rowCount).toBe(a.summary.rowCount);
    expect(rowsB).toHaveLength(10);
    // idempotent: identical rows, byte-for-byte content (parquet bytes themselves
    // are not canonical, so we assert the resolved content, not file size).
    expect(rowsB).toEqual(rowsA);
  });
});

describe("merge_series", () => {
  it("converges overlapping ranges into one deduped, sorted dataset", async () => {
    await broker.ingest(ohlcvFetch(bars("2024-01-01", 30))); // Jan 1..30
    const { handle } = await broker.ingest(ohlcvFetch(bars("2024-01-20", 30))); // overlaps 20..30, extends
    const rows = await broker.resolve(handle);
    // union of [0..29] and [19..48] days = 49 unique days
    expect(rows).toHaveLength(49);
    const ts = rows.map((r) => r.t as number);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(new Set(ts).size).toBe(49); // no dupes
  });

  it("overwrites on t collision (a re-fetch corrects prior data)", async () => {
    const first = bars("2024-01-01", 3); // closes 100,101,102
    await broker.ingest(ohlcvFetch(first));
    const corrected = first.map((r) => ({ ...r, close: r.close + 1000 }));
    const { handle } = await broker.ingest(ohlcvFetch(corrected));
    const rows = await broker.resolve(handle);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.close)).toEqual([1100, 1101, 1102]); // incoming won
  });

  it("unions across year partitions, rewriting only affected years", async () => {
    await broker.ingest(ohlcvFetch(bars("2024-12-30", 4))); // spans 2024→2025
    const { handle } = await broker.ingest(ohlcvFetch(bars("2023-12-30", 2))); // 2023→2024
    const files = (await readdir(datasetDir(handle))).filter((f) => f.endsWith(".parquet"));
    expect(files.sort()).toEqual(["2023.parquet", "2024.parquet", "2025.parquet"]);
    const rows = await broker.resolve(handle);
    expect(rows).toHaveLength(6);
  });
});

describe("concurrency", () => {
  it("serializes concurrent ingests on one handle to a correct union", async () => {
    const fetches = [
      ohlcvFetch(bars("2024-01-01", 20)),
      ohlcvFetch(bars("2024-01-10", 20)),
      ohlcvFetch(bars("2024-01-15", 20)),
    ];
    await Promise.all(fetches.map((f) => broker.ingest(f)));
    const rows = await broker.resolve("yfinance:ohlcv:AMZN:1d");
    // union of [0..19],[9..28],[14..33] = 34 unique days
    expect(rows).toHaveLength(34);
    expect(new Set(rows.map((r) => r.t)).size).toBe(34);
  });

  it("ingests different handles concurrently without interference", async () => {
    await Promise.all([
      broker.ingest(ohlcvFetch(bars("2024-01-01", 5), { entity: "AMZN" })),
      broker.ingest(ohlcvFetch(bars("2024-01-01", 7), { entity: "GOOGL" })),
      broker.ingest(ohlcvFetch(bars("2024-01-01", 9), { entity: "MSFT" })),
    ]);
    expect(await broker.resolve("yfinance:ohlcv:AMZN:1d")).toHaveLength(5);
    expect(await broker.resolve("yfinance:ohlcv:GOOGL:1d")).toHaveLength(7);
    expect(await broker.resolve("yfinance:ohlcv:MSFT:1d")).toHaveLength(9);
  });
});

describe("crash atomicity", () => {
  it("ignores orphaned temp files on read and sweeps them on next ingest", async () => {
    const { handle } = await broker.ingest(ohlcvFetch(bars("2024-01-01", 5)));
    const dir = datasetDir(handle);
    // simulate a crashed write: a torn temp partition left behind
    await writeFile(join(dir, "2024.parquet.tmp"), "GARBAGE NOT PARQUET", "utf8");
    // readers ignore .tmp (glob is *.parquet) — resolve still works
    expect(await broker.resolve(handle)).toHaveLength(5);
    // next ingest sweeps the orphan and commits cleanly
    await broker.ingest(ohlcvFetch(bars("2024-01-06", 3)));
    const files = await readdir(dir);
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
    expect(await broker.resolve(handle)).toHaveLength(8);
  });
});

describe("view + bulk guard", () => {
  it("no slice → summary only, no rows", async () => {
    const { handle } = await broker.ingest(ohlcvFetch(bars("2024-01-01", 50)));
    const v = await broker.view(handle);
    expect(v.degraded).toBe(false);
    expect(v.rows).toBeUndefined();
    expect(v.summary.rowCount).toBe(50);
    expect(v.summary.latestClose).toBe(149);
  });

  it("a slice within the headroom returns bounded rows", async () => {
    const { handle } = await broker.ingest(ohlcvFetch(bars("2024-01-01", 50)));
    const v = await broker.view(handle, { last: 3 });
    expect(v.degraded).toBe(false);
    expect(v.rows).toHaveLength(3);
    expect(v.rows!.map((r) => r.close)).toEqual([147, 148, 149]);
  });

  it("refuses an over-broad slice (degrades to summary), never dumps bulk", async () => {
    const { handle } = await broker.ingest(ohlcvFetch(bars("2020-01-01", VIEW_GUARD_MAX_ROWS + 50)));
    const v = await broker.view(handle, {}); // empty slice = whole dataset
    expect(v.degraded).toBe(true);
    expect(v.rows).toBeUndefined();
    expect(v.reason).toMatch(/max 500/);
    expect(v.summary.rowCount).toBe(VIEW_GUARD_MAX_ROWS + 50);
  });
});

describe("typed errors", () => {
  it("rejects an off-spec payload with VALIDATION_FAILED", async () => {
    const bad = ohlcvFetch(bars("2024-01-01", 2));
    (bad.payload as { high: number }[])[0]!.high = -999; // high < low
    await expect(broker.ingest(bad)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("resolve/view of a missing handle → HANDLE_NOT_FOUND", async () => {
    await expect(broker.resolve("yfinance:ohlcv:NOPE:1d")).rejects.toBeInstanceOf(MuErrorException);
    await expect(broker.resolve("yfinance:ohlcv:NOPE:1d")).rejects.toMatchObject({
      code: "HANDLE_NOT_FOUND",
    });
  });
});
