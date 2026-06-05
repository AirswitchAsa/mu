import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTimeline, type FetchResult, type TimelineEventInput } from "@mu/protocol";
import { createMuServer, type MuServerHandle } from "./server.js";
import { FakeDriver } from "./fake-driver.js";

// =============================================================================
// End-to-end of the /message TURN LOOP through the real µ HTTP/SSE API + runtime +
// broker + persistence, with the AGENT FAKED (FakeDriver drives the real /internal
// callback). No LLM, fully deterministic. This is the coverage that was previously
// live-only (MU_LIVE_OPENCODE) — the whole WS1 streaming / WS3 reconcile / tool
// dispatch / persistence pathway, none of which a unit test can reach.
// =============================================================================

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
const newSession = async (server: MuServerHandle) =>
  ((await json(`${server.url}/api/sessions`, { method: "POST" })) as { sessionId: string }).sessionId;

type SSEvent = { type: string } & Record<string, unknown>;
async function readSSE(resp: Response, signal?: AbortSignal): Promise<SSEvent[]> {
  const events: SSEvent[] = [];
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const frames = buf.split("\n\n");
      buf = frames.pop() ?? "";
      for (const f of frames) {
        const line = f.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const evt = JSON.parse(line.slice(5).trim()) as SSEvent;
        events.push(evt);
        if (evt.type === "done" || evt.type === "error") return events;
      }
    }
  } catch {
    /* aborted mid-stream — return what we have */
  } finally {
    if (signal?.aborted) await reader.cancel().catch(() => undefined);
  }
  return events;
}
const send = (server: MuServerHandle, id: string, text: string, signal?: AbortSignal) =>
  fetch(`${server.url}/api/sessions/${id}/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });

describe("µ turn loop (real API/runtime/broker, faked agent)", () => {
  let server: MuServerHandle;
  let fake: FakeDriver;
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "mu-turn-"));
    server = await createMuServer({
      dataRoot: root,
      resourcesDir: RESOURCES_DIR,
      driverFactory: ({ callbackUrl, callbackToken }) => {
        fake = new FakeDriver(callbackUrl, callbackToken);
        return fake;
      },
    });
    await server.runtime.broker.ingest(fixture); // data already materialized; agent binds it
  });
  afterAll(async () => {
    await server?.close();
    // best-effort fire-and-forget sidecar writes may still be settling — retry past
    // the ENOTEMPTY race rather than flaking the suite on teardown.
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  beforeEach(() => fake.setScript(async () => "ok"));

  it("streams prose, runs a tool, and persists an interleaved timeline that matches the live fold", async () => {
    const id = await newSession(server);
    fake.setScript(async (t) => {
      t.emit("p1", "text", "Looking");
      t.emit("p1", "text", "Looking at AMZN…"); // cumulative upsert
      await t.tool("canvas_create", { type: "price_chart", handle: HANDLE });
      t.emit("p2", "text", "Here is the chart.");
      return "Here is the chart.";
    });

    const events = await readSSE(await send(server, id, "show me AMZN"));

    // event stream: deltas + a canvas event + terminal chat + done, in order
    expect(events.map((e) => e.type)).toEqual([
      "chat_delta", "chat_delta", "canvas", "chat_delta", "chat", "done",
    ]);

    // the tool ACTUALLY mutated the right µ session (proves opencode-id → µ-id
    // translation in the /internal callback; without it the canvas stays empty)
    const canvas = (await json(`${server.url}/api/sessions/${id}/canvas`)) as { windows: { type: string; bindings: string[] }[] };
    expect(canvas.windows).toHaveLength(1);
    expect(canvas.windows[0]).toMatchObject({ type: "price_chart", bindings: [HANDLE] });

    // persisted assistant turn == the live fold of the same events (live≡reload)
    const hist = (await json(`${server.url}/api/sessions/${id}/messages`)) as {
      messages: { role: string; text?: string; items?: unknown[] }[];
    };
    const assistant = hist.messages.find((m) => m.role === "assistant")!;
    expect(assistant.text).toBe("Here is the chart.");
    const expected = buildTimeline(events as TimelineEventInput[]);
    expect(assistant.items).toEqual(expected);
    expect(expected).toEqual([
      { kind: "text", id: "p1", text: "Looking at AMZN…" },
      { kind: "tool", verb: "canvas.create", arg: "price_chart → " + HANDLE, ret: "bound" },
      { kind: "text", id: "p2", text: "Here is the chart." },
    ]);
  });

  it("reconcile-on-miss: re-mints a dropped opencode session and primes it with the transcript", async () => {
    const id = await newSession(server);
    const firstOc = fake.created.at(-1)!; // the opencode id minted at session creation

    // turn 1 records dialogue in the µ transcript
    fake.setScript(async () => "first reply");
    await readSSE(await send(server, id, "hello there"));
    expect(fake.prompts.at(-1)!.sessionId).toBe(firstOc); // drove the bound session

    // opencode forgets the session (restart / prune)
    fake.live.delete(firstOc);

    fake.setScript(async () => "second reply");
    await readSSE(await send(server, id, "are you still there"));

    // a FRESH opencode session was minted, bound, and persisted; µ id is unchanged
    const newOc = fake.created.at(-1)!;
    expect(newOc).not.toBe(firstOc);
    expect(server.runtime.resolveOpencodeId(id)).toBe(newOc);
    const last = fake.prompts.at(-1)!;
    expect(last.sessionId).toBe(newOc);
    // the prior transcript was replayed as a priming part on the re-mint turn
    expect(last.extraParts.some((p) => p.includes("[µ session resumed]") && p.includes("hello there"))).toBe(true);
  });

  it("refuses a concurrent turn for the same session with 409 BUSY", async () => {
    const id = await newSession(server);
    let release!: () => void;
    fake.setScript(async () => {
      await new Promise<void>((r) => (release = r));
      return "done";
    });
    const inflight = send(server, id, "first"); // holds the turn lock
    await new Promise((r) => setTimeout(r, 30));
    const second = await send(server, id, "second");
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error?: { code: string } }).error?.code).toBe("BUSY");
    release();
    await readSSE(await inflight);
  });

  it("a client disconnect mid-turn aborts the agent (stops spending on a dead socket)", async () => {
    const id = await newSession(server);
    const oc = server.runtime.resolveOpencodeId(id);
    let release!: () => void;
    fake.setScript(async (t) => {
      t.emit("p1", "text", "working");
      await new Promise<void>((r) => (release = r)); // stay in-flight until aborted
      return "done";
    });
    const ac = new AbortController();
    const resp = await send(server, id, "long one", ac.signal);
    // read the first delta, then drop the connection
    const reader = resp.body!.getReader();
    await reader.read();
    await reader.cancel().catch(() => undefined);
    ac.abort();
    // the server's res 'close' handler cancels the agent turn
    await expect.poll(() => fake.aborted.includes(oc)).toBe(true);
    release();
  });

  it("surfaces a typed terminal error and releases the turn lock", async () => {
    const id = await newSession(server);
    fake.setScript(async () => {
      throw new Error("agent exploded");
    });
    const events = await readSSE(await send(server, id, "boom"));
    const last = events.at(-1)!;
    expect(last.type).toBe("error");
    expect((last as { error?: { message?: string } }).error?.message).toContain("agent exploded");

    // the lock was released — a subsequent turn on the same session works
    fake.setScript(async () => "recovered");
    const ok = await readSSE(await send(server, id, "again"));
    expect(ok.at(-1)!.type).toBe("done");
  });
});
