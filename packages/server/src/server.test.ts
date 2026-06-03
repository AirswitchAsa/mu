import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FetchResult } from "@mu/protocol";
import { createMuServer, type MuServerHandle } from "./server.js";

const RESOURCES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../resources");
const HANDLE = "yfinance:ohlcv:AMZN:1d";

const fixture: FetchResult = {
  descriptor: { shape: "ohlcv", identity: { provider: "yfinance", shape: "ohlcv", entity: "AMZN", tail: ["1d"] }, queryParams: {} },
  payload: [
    { t: Date.parse("2024-01-02T00:00:00Z"), open: 100, high: 102, low: 99, close: 101, adjClose: 100.5, volume: 1000 },
    { t: Date.parse("2024-01-03T00:00:00Z"), open: 101, high: 103, low: 100, close: 102, adjClose: 101.5, volume: 2000 },
  ],
  provenance: { source: "yfinance", fetchedAt: 1, trigger: "on_demand", queryParams: {} },
};

const json = (url: string, init?: RequestInit) => fetch(url, init).then((r) => r.json() as Promise<Record<string, unknown>>);

describe("µ server HTTP API (deterministic, no model)", () => {
  let server: MuServerHandle;
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "mu-server-"));
    server = await createMuServer({ dataRoot: root, resourcesDir: RESOURCES_DIR });
    await server.runtime.broker.ingest(fixture); // seed a dataset (data_fetch path tested in Track A)
  });
  afterAll(async () => {
    await server?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("advertises core renderers and the catalogued dataset", async () => {
    const renderers = (await json(`${server.url}/api/renderers`)) as { renderers: { type: string }[] };
    expect(renderers.renderers.map((r) => r.type)).toContain("price_chart");
    const list = (await json(`${server.url}/api/data/list`)) as { datasets: { handle: string }[] };
    expect(list.datasets.some((d) => d.handle === HANDLE)).toBe(true);
  });

  it("runs the agent canvas path (internal tool callback) and reflects it in canvas + resolve", async () => {
    const { sessionId } = (await json(`${server.url}/api/sessions`, { method: "POST" })) as { sessionId: string };
    expect(sessionId).toBeTruthy();

    // simulate the opencode plugin calling back
    const created = (await json(`${server.url}/internal/tool/canvas_create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionID: sessionId, args: { type: "price_chart", handle: HANDLE } }),
    })) as { ok?: { windowId: string }; error?: unknown };
    expect(created.error).toBeUndefined();
    const windowId = created.ok!.windowId;

    const canvas = (await json(`${server.url}/api/sessions/${sessionId}/canvas`)) as {
      windows: { id: string; type: string; bindings: string[] }[];
    };
    expect(canvas.windows).toHaveLength(1);
    expect(canvas.windows[0]).toMatchObject({ id: windowId, type: "price_chart", bindings: [HANDLE] });

    // renderer data path: full data, server-side
    const resolved = (await json(`${server.url}/api/resolve?handle=${encodeURIComponent(HANDLE)}`)) as {
      rows: unknown[];
    };
    expect(resolved.rows).toHaveLength(2);

    // user layout edit pins placement
    await json(`${server.url}/api/sessions/${sessionId}/canvas/ops`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ops: [{ op: "move", windowId, placement: { col: 2, row: 0 } }] }),
    });
    const after = (await json(`${server.url}/api/sessions/${sessionId}/canvas`)) as {
      layout: Record<string, { col: number; pinned: boolean }>;
    };
    expect(after.layout[windowId]).toMatchObject({ col: 2, pinned: true });
  });

  it("returns a typed error for an unknown verb (raw text never leaks)", async () => {
    const { sessionId } = (await json(`${server.url}/api/sessions`, { method: "POST" })) as { sessionId: string };
    const res = (await json(`${server.url}/internal/tool/frobnicate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionID: sessionId, args: {} }),
    })) as { error?: { code: string } };
    expect(res.error?.code).toBe("VALIDATION_FAILED");
  });
});

// Full live loop: a real message drives the agent to fetch + build a window.
const LIVE = Boolean(process.env["MU_LIVE_OPENCODE"]);

async function readSSE(resp: Response, timeoutMs = 90_000): Promise<{ type: string }[]> {
  const events: { type: string }[] = [];
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let buf = "";
  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";
    for (const c of chunks) {
      const line = c.split("\n").find((l) => l.startsWith("data: "));
      if (line) {
        const evt = JSON.parse(line.slice(6)) as { type: string };
        events.push(evt);
        if (evt.type === "done" || evt.type === "error") return events;
      }
    }
  }
  return events;
}

describe.skipIf(!LIVE)("µ server full loop (live DeepSeek + live Yahoo)", () => {
  let server: MuServerHandle;
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "mu-server-live-"));
    server = await createMuServer({ dataRoot: root, resourcesDir: RESOURCES_DIR, model: "deepseek/deepseek-chat" });
  }, 120_000);
  afterAll(async () => {
    await server?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("a user message grows the canvas: agent fetches AMZN and creates a price_chart", async () => {
    const { sessionId } = (await json(`${server.url}/api/sessions`, { method: "POST" })) as { sessionId: string };
    const resp = await fetch(`${server.url}/api/sessions/${sessionId}/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "Fetch AMZN daily price history with data_fetch, then create a price_chart window bound to that handle with canvas_create.",
      }),
    });
    const events = await readSSE(resp);
    expect(events.some((e) => e.type === "canvas")).toBe(true);
    expect(events.at(-1)?.type).toBe("done");

    const canvas = (await json(`${server.url}/api/sessions/${sessionId}/canvas`)) as {
      windows: { type: string; bindings: string[] }[];
    };
    const chart = canvas.windows.find((w) => w.type === "price_chart");
    expect(chart).toBeTruthy();
    expect(chart!.bindings[0]).toMatch(/^yfinance:ohlcv:AMZN/);

    const resolved = (await json(`${server.url}/api/resolve?handle=${encodeURIComponent(chart!.bindings[0]!)}`)) as {
      rows: unknown[];
    };
    expect(resolved.rows.length).toBeGreaterThan(0);
  }, 120_000);
});
