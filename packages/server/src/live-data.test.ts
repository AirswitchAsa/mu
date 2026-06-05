import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMuServer, type MuServerHandle } from "./server.js";
import { FakeDriver } from "./fake-driver.js";
import { runTurn } from "./test-support.js";

// =============================================================================
// GATED real-upstream suite (MU_LIVE_DATA=1). Same faked agent + real µ pathway as
// turn-loop.test.ts, but the agent's data_fetch goes all the way out to the REAL
// providers (no injected fetch, no seeded broker) — so it catches UPSTREAM drift:
// a feed that moved, a JSON shape that changed, an endpoint that 404s. Networked +
// flaky by nature, so it never runs in the default suite. Keyless providers always;
// keyed ones (finnhub/fred) only when their env key is present.
// =============================================================================

const LIVE = Boolean(process.env["MU_LIVE_DATA"]);
const RESOURCES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../resources");
const json = (url: string, init?: RequestInit) => fetch(url, init).then((r) => r.json() as Promise<Record<string, unknown>>);

describe.skipIf(!LIVE)("µ data plane (real providers, faked agent)", () => {
  let server: MuServerHandle;
  let fake: FakeDriver;
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "mu-live-data-"));
    server = await createMuServer({
      dataRoot: root,
      resourcesDir: RESOURCES_DIR,
      driverFactory: ({ callbackUrl, callbackToken }) => {
        fake = new FakeDriver(callbackUrl, callbackToken);
        return fake;
      },
    });
  }, 60_000);
  afterAll(async () => {
    await server?.close();
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  /** Run a turn whose agent fetches `args` then binds the handle to a window; return
   *  the resolved rows from the real broker (the full fetch→merge→resolve pathway). */
  async function fetchAndResolve(text: string, fetchArgs: Record<string, unknown>): Promise<unknown[]> {
    const { sessionId } = (await json(`${server.url}/api/sessions`, { method: "POST" })) as { sessionId: string };
    let handle = "";
    fake.setScript(async (t) => {
      const r = await t.tool("data_fetch", fetchArgs);
      if (r.error) throw new Error(`data_fetch failed: ${r.error.code}`);
      handle = (r.ok as { handle: string }).handle;
      await t.tool("canvas_create", { type: fetchArgs["shape"] === "ohlcv" ? "price_chart" : "news", handle });
      return "done";
    });
    await runTurn(server.url, sessionId, text); // command + drain the read stream to done
    expect(handle, "data_fetch produced a handle").toBeTruthy();
    return ((await json(`${server.url}/api/resolve?handle=${encodeURIComponent(handle)}`)) as { rows: unknown[] }).rows;
  }

  it("yfinance ohlcv: real AMZN daily bars resolve through the broker", async () => {
    const rows = await fetchAndResolve("get AMZN daily price history", { source: "yfinance", shape: "ohlcv", entity: "AMZN", resolution: "1d", range: "1mo" });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("close");
  }, 60_000);

  it("yahoo news (keyless RSS, ticker namespace): real headlines resolve", async () => {
    const rows = await fetchAndResolve("latest AMZN headlines", { source: "yahoo", shape: "news", entity: "AMZN", kind: "ticker" });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("headline");
  }, 60_000);

  it.skipIf(!process.env["FRED_API_KEY"])("fred releases: real macro vintages resolve with a revision trail", async () => {
    const rows = await fetchAndResolve("US GDP releases", { source: "fred", shape: "releases", entity: "GDP" });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("as_of");
  }, 60_000);

  it.skipIf(!process.env["FINNHUB_API_KEY"])("finnhub news: real company news resolves", async () => {
    const rows = await fetchAndResolve("AMZN company news", { source: "finnhub", shape: "news", entity: "AMZN", kind: "ticker" });
    expect(rows.length).toBeGreaterThan(0);
  }, 60_000);
});
