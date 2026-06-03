import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DataBroker } from "@mu/broker";
import { AcquisitionCoordinator, ResourceRegistry } from "@mu/resource-sdk";
import { createYahooResource, type ChartFn } from "@mu-resource/yahoo-finance";
import { startMuEndpoint, type MuEndpoint } from "./mu-endpoint.js";
import { parseModel, startOpencode, type OpencodeHandle } from "./supervisor.js";

// Live tests are gated: keyless CI skips them; opt in with MU_LIVE_OPENCODE=1.
const LIVE = Boolean(process.env["MU_LIVE_OPENCODE"]);
const STRESS = Boolean(process.env["MU_OPENCODE_STRESS"]);
const MODEL = process.env["MU_OPENCODE_MODEL"] ?? "deepseek/deepseek-chat";
const PROMPT = "Fetch the daily price history for AMZN. Use the data_fetch tool to do it.";

// Deterministic, offline OHLCV so the data plane never flakes — only the model does.
const fakeChart: ChartFn = async () => ({
  quotes: [
    { date: new Date("2024-01-02T00:00:00Z"), open: 100, high: 102, low: 99, close: 101, adjclose: 100.5, volume: 1000 },
    { date: new Date("2024-01-03T00:00:00Z"), open: 101, high: 103, low: 100, close: 102, adjclose: 101.5, volume: 2000 },
  ],
});

interface Ctx {
  root: string;
  broker: DataBroker;
  mu: MuEndpoint;
  oc: OpencodeHandle;
}

async function setup(): Promise<Ctx> {
  const root = await mkdtemp(join(tmpdir(), "mu-spike-"));
  const broker = await DataBroker.create(root);
  const reg = new ResourceRegistry();
  reg.register(createYahooResource({ chart: fakeChart }));
  const coord = new AcquisitionCoordinator(reg, broker, () => 1_700_000_000_000);

  const mu = await startMuEndpoint({
    data_fetch: (args) =>
      coord.acquire(typeof args["source"] === "string" ? (args["source"] as string) : undefined, {
        shape: "ohlcv",
        entity: String(args["entity"]),
      }),
  });

  const pluginPath = join(dirname(fileURLToPath(import.meta.url)), "plugin.ts");
  const oc = await startOpencode({ pluginPath, model: MODEL, callbackUrl: mu.url });
  return { root, broker, mu, oc };
}

/** Run one full turn; return whether the agent drove the data_fetch tool. */
async function runTurn(ctx: Ctx): Promise<boolean> {
  const created = await ctx.oc.client.session.create({ body: {} });
  const id = (created as { data?: { id?: string } }).data?.id;
  if (!id) throw new Error(`session.create returned no id: ${JSON.stringify(created)}`);
  const before = ctx.mu.calls.length;
  await ctx.oc.client.session.prompt({
    path: { id },
    body: { parts: [{ type: "text", text: PROMPT }], model: parseModel(MODEL) },
  });
  return ctx.mu.calls.slice(before).some((c) => c.tool === "data_fetch");
}

describe.skipIf(!LIVE)("opencode CQRS round-trip (live DeepSeek)", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup();
  }, 120_000);
  afterAll(async () => {
    await ctx?.oc?.close();
    await ctx?.mu?.close();
    if (ctx?.root) await rm(ctx.root, { recursive: true, force: true });
  });

  it("a prompt (command) drives data_fetch; result is observed via the event projection (query)", async () => {
    const created = await ctx.oc.client.session.create({ body: {} });
    const id = (created as { data?: { id?: string } }).data?.id!;

    // CQRS read side: the event stream is the source of truth, not the prompt return.
    const events: { type?: string }[] = [];
    const sub = await ctx.oc.client.event.subscribe();
    let stop = false;
    const collector = (async () => {
      for await (const e of sub.stream) {
        events.push(e as { type?: string });
        if (stop || (e as { type?: string }).type === "session.idle") break;
      }
    })();

    // command side: fire-and-acknowledge
    await ctx.oc.client.session.prompt({
      path: { id },
      body: { parts: [{ type: "text", text: PROMPT }], model: parseModel(MODEL) },
    });
    stop = true;
    await Promise.race([collector, new Promise((r) => setTimeout(r, 3000))]);

    // ground truth: the agent drove a real µ tool over the localhost callback
    const fetchCalls = ctx.mu.calls.filter((c) => c.tool === "data_fetch");
    expect(fetchCalls.length).toBeGreaterThanOrEqual(1);
    expect(String(fetchCalls[0]!.args["entity"]).toUpperCase()).toBe("AMZN");
    // ...which materialized the dataset in the broker (data-path discipline held)
    expect(await ctx.broker.resolve("yfinance:ohlcv:AMZN:1d")).not.toHaveLength(0);
    // ...and the read-side projection actually received events
    expect(events.length).toBeGreaterThan(0);
  }, 120_000);

  // The "99 out of 100" guarantee. Expensive + slow → opt in with MU_OPENCODE_STRESS=1.
  // MU_OPENCODE_ITERS controls the count (default 100).
  it.skipIf(!STRESS)(
    "forces the tool call ≥99% of the time",
    async () => {
      const iters = Number(process.env["MU_OPENCODE_ITERS"] ?? 100);
      let ok = 0;
      for (let i = 0; i < iters; i++) {
        if (await runTurn(ctx)) ok++;
      }
      // eslint-disable-next-line no-console
      console.log(`[spike] data_fetch driven ${ok}/${iters}`);
      expect(ok / iters).toBeGreaterThanOrEqual(0.99);
    },
    60 * 60_000,
  );
});
