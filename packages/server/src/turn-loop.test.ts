import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTimeline, type FetchResult, type TimelineEventInput } from "@mu/protocol";
import { createMuServer, type MuServerHandle } from "./server.js";
import { FakeDriver } from "./fake-driver.js";
import { readEvents, runTurn } from "./test-support.js";

// =============================================================================
// End-to-end of the TURN LOOP through the real µ HTTP API + runtime + broker +
// persistence, with the AGENT FAKED (FakeDriver drives the real /internal callback).
// No LLM, fully deterministic. Exercises the CQRS contract the web client uses:
//   command  POST /api/sessions/:id/message  → 202 {from}; the turn runs DETACHED
//   query    GET  /api/sessions/:id/events    → SSE replay-from-cursor + live tail
//   cancel   POST /api/sessions/:id/cancel    → stops the turn, emits STOPPED
// This is the coverage a unit test can't reach: streaming, reconcile, tool dispatch +
// session translation, refresh-resume, multi-device, persistence.
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
/** Raw command: POST /message → the Response (202 / 409 / 400), no draining. */
const command = (server: MuServerHandle, id: string, text: string) =>
  fetch(`${server.url}/api/sessions/${id}/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
const events = (server: MuServerHandle, id: string, since?: number) =>
  fetch(`${server.url}/api/sessions/${id}/events${since === undefined ? "" : `?since=${since}`}`);
const tick = (ms = 25) => new Promise((r) => setTimeout(r, ms));

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

  it("streams prose token-by-token, runs a tool, and persists a timeline that matches the live fold", async () => {
    const id = await newSession(server);
    fake.setScript(async (t) => {
      t.emit("p1", "text", "Looking");
      t.emit("p1", "text", "Looking at AMZN…"); // cumulative upsert — a SEPARATE event over the wire
      await t.tool("canvas_create", { type: "price_chart", handle: HANDLE });
      t.emit("p2", "text", "Here is the chart.");
      return "Here is the chart.";
    });

    const evs = await runTurn(server.url, id, "show me AMZN");

    // The read stream leads with the echoed user prompt, then the live turn: deltas +
    // a canvas event + terminal chat + done, in receipt order.
    expect(evs.map((e) => e.type)).toEqual([
      "chat", "chat_delta", "chat_delta", "canvas", "chat_delta", "chat", "done",
    ]);
    expect(evs[0]).toMatchObject({ type: "chat", role: "user", text: "show me AMZN" });
    // STREAMING PROOF: each delta is delivered as its own event with growing cumulative
    // text — not coalesced into the final reply (the "prose appears all at once" bug).
    const deltas = evs.filter((e) => e.type === "chat_delta");
    expect(deltas.map((d) => d["text"])).toEqual(["Looking", "Looking at AMZN…", "Here is the chart."]);

    // the tool ACTUALLY mutated the right µ session (proves opencode-id → µ-id translation
    // in the /internal callback; without it the canvas stays empty)
    const canvas = (await json(`${server.url}/api/sessions/${id}/canvas`)) as { windows: { type: string; bindings: string[] }[] };
    expect(canvas.windows).toHaveLength(1);
    expect(canvas.windows[0]).toMatchObject({ type: "price_chart", bindings: [HANDLE] });

    // persisted assistant turn == the live fold of the same events (live≡reload)
    const hist = (await json(`${server.url}/api/sessions/${id}/messages`)) as {
      messages: { role: string; text?: string; items?: unknown[] }[];
    };
    expect(hist.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    const assistant = hist.messages.find((m) => m.role === "assistant")!;
    expect(assistant.text).toBe("Here is the chart.");
    const expected = buildTimeline(evs as TimelineEventInput[]);
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
    await runTurn(server.url, id, "hello there");
    expect(fake.prompts.at(-1)!.sessionId).toBe(firstOc); // drove the bound session

    // opencode forgets the session (restart / prune)
    fake.live.delete(firstOc);

    fake.setScript(async () => "second reply");
    await runTurn(server.url, id, "are you still there");

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
    const first = await command(server, id, "first"); // 202 immediately; the turn runs detached + blocked
    expect(first.status).toBe(202);
    const second = await command(server, id, "second");
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error?: { code: string } }).error?.code).toBe("BUSY");
    release();
    await readEvents(await events(server, id, 0)); // drain to release the turn lock
  });

  it("a reader disconnect does NOT abort the turn — it runs detached, and a reconnect replays it (refresh-resume)", async () => {
    const id = await newSession(server);
    const oc = server.runtime.resolveOpencodeId(id);
    let release!: () => void;
    fake.setScript(async (t) => {
      t.emit("p1", "text", "working");
      await new Promise<void>((r) => (release = r)); // stay in-flight across the disconnect
      return "finished by the detached turn";
    });
    const { from } = (await (await command(server, id, "long one")).json()) as { from: number };

    // a reader attaches, reads an event, then drops the connection (tab close / refresh)
    const dropped = await events(server, id, from);
    const reader = dropped.body!.getReader();
    await reader.read();
    await reader.cancel().catch(() => undefined);

    // the disconnect must NOT have aborted the agent — the turn keeps running
    await tick(40);
    expect(fake.aborted).not.toContain(oc);

    // release → the detached turn completes; a FRESH reconnect replays the whole turn to done
    release();
    const evs = await readEvents(await events(server, id, from));
    expect(evs.at(-1)!.type).toBe("done");
    expect(fake.aborted).not.toContain(oc); // never aborted by a socket close
    const hist = (await json(`${server.url}/api/sessions/${id}/messages`)) as { messages: { role: string; text?: string }[] };
    expect(hist.messages.find((m) => m.role === "assistant")!.text).toBe("finished by the detached turn");
  });

  it("two readers on the same session see the identical live stream (multi-device)", async () => {
    const id = await newSession(server);
    let release!: () => void;
    fake.setScript(async (t) => {
      t.emit("p1", "text", "hi");
      await new Promise<void>((r) => (release = r));
      return "hi there";
    });
    const { from } = (await (await command(server, id, "go")).json()) as { from: number };
    const a = readEvents(await events(server, id, from));
    const b = readEvents(await events(server, id, from));
    await tick();
    release();
    const [ea, eb] = await Promise.all([a, b]);
    expect(ea.map((e) => e.type)).toEqual(eb.map((e) => e.type));
    expect(ea.at(-1)!.type).toBe("done");
    expect(ea[0]).toMatchObject({ type: "chat", role: "user", text: "go" });
  });

  it("a fresh reader joining mid-turn (no cursor) replays the active turn from its start", async () => {
    const id = await newSession(server);
    let release!: () => void;
    fake.setScript(async (t) => {
      t.emit("p1", "text", "step one");
      await new Promise<void>((r) => (release = r));
      t.emit("p1", "text", "step one and two");
      return "step one and two";
    });
    await command(server, id, "begin"); // 202; turn now blocked after the first delta
    await tick();
    // a brand-new reader connects WITHOUT ?since (a page refresh) → server replays from
    // the active turn's start, so the prompt + prior deltas are not lost.
    const drainP = readEvents(await events(server, id)); // no cursor
    release();
    const evs = await drainP;
    expect(evs[0]).toMatchObject({ type: "chat", role: "user", text: "begin" });
    expect(evs.some((e) => e.type === "chat_delta")).toBe(true);
    expect(evs.at(-1)!.type).toBe("done");
  });

  it("explicit /cancel stops the turn, aborts the agent, and emits STOPPED with the partial prose persisted", async () => {
    const id = await newSession(server);
    const oc = server.runtime.resolveOpencodeId(id);
    let release!: () => void;
    fake.setScript(async (t) => {
      t.emit("p1", "text", "partial answer");
      await new Promise<void>((r) => (release = r)); // a real driver's prompt ends when aborted
      return "";
    });
    const { from } = (await (await command(server, id, "cancel me")).json()) as { from: number };
    await tick(); // let the first delta land

    const c = await fetch(`${server.url}/api/sessions/${id}/cancel`, { method: "POST" });
    expect(((await c.json()) as { cancelled: boolean }).cancelled).toBe(true);
    expect(fake.aborted).toContain(oc); // an EXPLICIT command aborted the agent

    release(); // the fake's prompt returns → the cancelled branch finalizes the turn
    const evs = await readEvents(await events(server, id, from));
    const last = evs.at(-1)!;
    expect(last.type).toBe("error");
    expect((last as { error?: { code?: string } }).error?.code).toBe("STOPPED");
    // the partial prose that streamed before the stop is persisted (survives a reload)
    const hist = (await json(`${server.url}/api/sessions/${id}/messages`)) as { messages: { role: string; text?: string }[] };
    expect(hist.messages.find((m) => m.role === "assistant")!.text).toContain("partial answer");
  });

  it("surfaces a typed terminal error and releases the turn lock", async () => {
    const id = await newSession(server);
    fake.setScript(async () => {
      throw new Error("agent exploded");
    });
    const evs = await runTurn(server.url, id, "boom");
    const last = evs.at(-1)!;
    expect(last.type).toBe("error");
    expect((last as { error?: { message?: string } }).error?.message).toContain("agent exploded");

    // the lock was released — a subsequent turn on the same session works
    fake.setScript(async () => "recovered");
    const ok = await runTurn(server.url, id, "again");
    expect(ok.at(-1)!.type).toBe("done");
  });
});
