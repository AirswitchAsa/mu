import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DataBroker } from "@mu/broker";
import {
  AcquisitionCoordinator,
  ResourceRegistry,
  discoverResources,
  loadResources,
} from "@mu/resource-sdk";
import { createYahooResource, type ChartFn } from "./index.js";

const fakeChart: ChartFn = async () => ({
  quotes: [
    { date: new Date("2024-01-02T00:00:00Z"), open: 100, high: 102, low: 99, close: 101, adjclose: 100.5, volume: 1000 },
    { date: new Date("2024-01-03T00:00:00Z"), open: 101, high: 103, low: 100, close: 102, adjclose: 101.5, volume: 2000 },
  ],
});

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mu-yf-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("full pipeline: fetch → ingest → resolve", () => {
  it("acquires through the coordinator and resolves canonical rows from the broker", async () => {
    const broker = await DataBroker.create(root);
    const reg = new ResourceRegistry();
    reg.register(createYahooResource({ chart: fakeChart }));
    const coord = new AcquisitionCoordinator(reg, broker, () => 1_700_000_000_000);

    const { handle, summary } = await coord.acquire("yfinance", { shape: "ohlcv", entity: "AMZN" });
    expect(handle).toBe("yfinance:ohlcv:AMZN:1d");
    expect(summary.rowCount).toBe(2);
    expect(summary.latestClose).toBe(102);

    const rows = await broker.resolve(handle);
    expect(rows).toHaveLength(2);
    expect(typeof rows[0]!.t).toBe("number");
    expect(rows[1]!.adjClose).toBe(101.5);

    // idempotent: re-acquiring the same identity does not duplicate rows
    await coord.acquire("yfinance", { shape: "ohlcv", entity: "AMZN" });
    expect(await broker.resolve(handle)).toHaveLength(2);
  });
});

describe("runtime discovery (the dogfooded plugin-host path)", () => {
  it("discovers and loads the first-party resource from the resources/ folder", async () => {
    const resourcesDir = join(dirname(fileURLToPath(import.meta.url)), "../../");
    const found = await discoverResources(resourcesDir);
    expect(found.some((f) => f.name === "@mu-resource/yahoo-finance")).toBe(true);

    const reg = new ResourceRegistry();
    const ids = await loadResources(resourcesDir, reg);
    expect(ids).toContain("yfinance");
    expect(reg.get("yfinance")?.manifest.shapes).toEqual(["ohlcv"]);
  });
});
