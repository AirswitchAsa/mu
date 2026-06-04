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

  it("a canvas op replaces session state — message writes must target the fresh ref", async () => {
    const { sessionId } = (await json(`${server.url}/api/sessions`, { method: "POST" })) as { sessionId: string };
    const before = server.runtime.sessions.require(sessionId);
    before.messages.push({ role: "user", text: "hi", at: 1 });

    // an agent canvas op commits via clone-then-replace, swapping the stored object
    await json(`${server.url}/internal/tool/canvas_create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionID: sessionId, args: { type: "price_chart", handle: HANDLE } }),
    });

    const after = server.runtime.sessions.require(sessionId);
    expect(after).not.toBe(before); // the stored object was replaced
    expect(after.messages.map((m) => m.role)).toEqual(["user"]); // clone carried the user msg forward

    // the fix: the assistant reply must be pushed to the FRESH ref to reach the store
    after.messages.push({ role: "assistant", text: "done", at: 2 });
    const hist = (await json(`${server.url}/api/sessions/${sessionId}/messages`)) as { messages: { role: string }[] };
    expect(hist.messages.map((m) => m.role)).toEqual(["user", "assistant"]);

    // proof of the hazard: writes to the stale ref never reach the store
    before.messages.push({ role: "assistant", text: "ghost", at: 3 });
    const hist2 = (await json(`${server.url}/api/sessions/${sessionId}/messages`)) as { messages: { text: string }[] };
    expect(hist2.messages.some((m) => m.text === "ghost")).toBe(false);
  });

  it("serves chat history for a session (empty until messages flow), 404 for unknown", async () => {
    const { sessionId } = (await json(`${server.url}/api/sessions`, { method: "POST" })) as { sessionId: string };
    const hist = (await json(`${server.url}/api/sessions/${sessionId}/messages`)) as { messages: unknown[] };
    expect(Array.isArray(hist.messages)).toBe(true);
    expect(hist.messages).toHaveLength(0);

    const missing = await fetch(`${server.url}/api/sessions/does-not-exist/messages`);
    expect(missing.status).toBe(404);
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

type SSEvent = { type: string } & Record<string, unknown>;

async function readSSE(resp: Response, timeoutMs = 90_000): Promise<SSEvent[]> {
  const events: SSEvent[] = [];
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
        const evt = JSON.parse(line.slice(6)) as SSEvent;
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

    // chat history survives the turn's canvas op (regression: assistant reply must be
    // stored on the post-op session, not a stale pre-op reference) — for reload-restore.
    const hist = (await json(`${server.url}/api/sessions/${sessionId}/messages`)) as {
      messages: { role: string; ops?: { verb: string }[] }[];
    };
    expect(hist.messages.some((m) => m.role === "user")).toBe(true);
    const assistant = hist.messages.find((m) => m.role === "assistant");
    expect(assistant).toBeTruthy();
    // the ops-trace is persisted on the assistant turn, so it survives a reload
    // (data_fetch + canvas_create ran, so there is at least one line)
    expect(assistant!.ops?.some((o) => o.verb.startsWith("canvas.") || o.verb.startsWith("data_"))).toBe(true);
  }, 120_000);

  // The acceptance gate for the whole UI loop, tested through the API/SSE with a
  // real agent — no browser. Mirrors the design's scripted scenario:
  // AMZN price_chart → +SMA(50) overlay (spec update, no refetch) → AMZN vs MSFT
  // compare. Asserts the server-authoritative manifest grows correctly and that
  // bound handles resolve to real rows.
  type Win = { id: string; type: string; spec: Record<string, unknown>; bindings: string[] };
  const send = (sessionId: string, text: string) =>
    fetch(`${server.url}/api/sessions/${sessionId}/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    }).then((r) => readSSE(r, 150_000));
  const canvasOf = (sessionId: string) =>
    json(`${server.url}/api/sessions/${sessionId}/canvas`) as Promise<{ windows: Win[] }>;
  const rowsOf = async (handle: string) =>
    ((await json(`${server.url}/api/resolve?handle=${encodeURIComponent(handle)}`)) as { rows: unknown[] }).rows;

  it(
    "composes the scenario: AMZN price_chart → SMA(50) overlay → AMZN vs MSFT compare",
    async () => {
      const { sessionId } = (await json(`${server.url}/api/sessions`, { method: "POST" })) as { sessionId: string };

      // --- step 1: AMZN price chart ---
      const e1 = await send(
        sessionId,
        "Use data_fetch to get AMZN daily price history (range 1y), then canvas_create a price_chart window bound to that handle.",
      );
      // the canvas event carries the FULL server-authoritative manifest
      const canvasEvt = e1.find((e) => e.type === "canvas") as { state?: { windows: Win[] } } | undefined;
      expect(canvasEvt?.state?.windows?.length).toBeGreaterThan(0);
      // a data verb surfaced for the ops-trace
      expect(e1.some((e) => e.type === "tool")).toBe(true);

      const c1 = await canvasOf(sessionId);
      const amzn = c1.windows.find((w) => w.type === "price_chart" && w.bindings.some((h) => /:ohlcv:AMZN/i.test(h)));
      expect(amzn, "a price_chart bound to an AMZN ohlcv handle").toBeTruthy();
      expect((await rowsOf(amzn!.bindings[0]!)).length).toBeGreaterThan(0);

      // --- step 2: add a 50-day SMA indicator (spec update; same window, no refetch) ---
      await send(
        sessionId,
        `Add a 50-day simple moving average to the AMZN price chart by calling canvas_update on window ${amzn!.id} with spec {"indicators":[{"name":"sma","params":{"period":50}}]}.`,
      );
      const c2 = await canvasOf(sessionId);
      const amzn2 = c2.windows.find((w) => w.id === amzn!.id);
      expect(amzn2, "the AMZN window still exists (updated, not replaced)").toBeTruthy();
      const indicators = (amzn2!.spec["indicators"] ?? []) as { name?: string; params?: { period?: number } }[];
      expect(indicators.some((o) => o.name === "sma" && o.params?.period === 50)).toBe(true);
      expect(amzn2!.bindings).toEqual(amzn!.bindings); // binding unchanged → no re-resolve

      // --- step 3: compare AMZN with MSFT, indexed ---
      await send(
        sessionId,
        "Use data_fetch to get MSFT daily history, then canvas_create a 'compare' window bound to BOTH the AMZN and MSFT handles (handle can be an array).",
      );
      const c3 = await canvasOf(sessionId);
      const cmp = c3.windows.find((w) => w.type === "compare");
      expect(cmp, "a compare window").toBeTruthy();
      const joined = cmp!.bindings.join(" ");
      expect(/:ohlcv:AMZN/i.test(joined) && /:ohlcv:MSFT/i.test(joined)).toBe(true);
      for (const h of cmp!.bindings) expect((await rowsOf(h)).length).toBeGreaterThan(0);
    },
    300_000,
  );
});
