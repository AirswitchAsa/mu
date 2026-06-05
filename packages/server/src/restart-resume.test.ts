import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createMuServer, type MuServerHandle } from "./server.js";
import { ensureAgentKey, runTurn } from "./test-support.js";

// =============================================================================
// GATED live-agent suite (MU_LIVE_OPENCODE=1): proves the persistence design end to
// end against a REAL opencode + DeepSeek. µ pins opencode's data home under `dataRoot`
// (see OpencodeDriverOptions.dataHome), so opencode's own session/message storage
// survives a `serve` restart. The point this asserts: after a restart the agent's
// session is REUSED (sessionExists → true), not re-primed — reconcile-on-miss is the
// FALLBACK, exercised here by deleting the session and watching the next turn re-mint.
//
// Networked, slow (spawns opencode + drives DeepSeek), and needs the model key in the
// ENV (the relocated home can't see `opencode auth login`'s auth.json — ensureAgentKey
// bridges it from the default home for local runs, else the suite skips). The
// deterministic FakeDriver e2e in turn-loop.test.ts covers the same control flow with
// no LLM; this is the live drift-catcher for the storage/auth/reuse assumptions.
// =============================================================================

const LIVE = Boolean(process.env["MU_LIVE_OPENCODE"]) && ensureAgentKey();
const MODEL = process.env["MU_MODEL"] || "deepseek/deepseek-chat";
const RESOURCES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../resources");

const json = (url: string, init?: RequestInit) =>
  fetch(url, init).then((r) => r.json() as Promise<Record<string, unknown>>);
const newSession = async (s: MuServerHandle) =>
  ((await json(`${s.url}/api/sessions`, { method: "POST" })) as { sessionId: string }).sessionId;

// opencode's child is SIGTERM'd synchronously on close(); give the process a moment to
// exit and checkpoint its SQLite WAL before the next `serve` opens the same storage.
const settle = () => new Promise<void>((r) => setTimeout(r, 750));

describe.skipIf(!LIVE)("µ opencode session survives a serve restart (live DeepSeek)", () => {
  let root: string | undefined;
  const open: MuServerHandle[] = [];
  const boot = async (dataRoot: string): Promise<MuServerHandle> => {
    const s = await createMuServer({ dataRoot, resourcesDir: RESOURCES_DIR, model: MODEL });
    open.push(s);
    return s;
  };
  afterEach(async () => {
    while (open.length) await open.pop()?.close();
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    root = undefined;
  });

  it("reuses the SAME opencode session after a restart (no re-mint, no re-prime)", async () => {
    root = await mkdtemp(join(tmpdir(), "mu-restart-"));

    // --- boot #1: opencode storage pinned at <root>/opencode -------------------
    const s1 = await boot(root);
    const muId = await newSession(s1);
    const ocBefore = s1.runtime.resolveOpencodeId(muId);
    expect(ocBefore).toBeTruthy();
    expect(ocBefore).not.toBe(muId); // a real, distinct opencode id was minted + bound

    // a real turn so there is genuine agent state on disk (a bound canvas window)
    const t1 = await runTurn(s1.url, muId, "Fetch AMZN daily price history with data_fetch, then canvas_create a price_chart bound to that handle.");
    expect(t1.at(-1)?.type).toBe("done");
    const canvas1 = (await json(`${s1.url}/api/sessions/${muId}/canvas`)) as { windows: unknown[] };
    expect(canvas1.windows.length).toBeGreaterThan(0);

    await s1.close(); // simulate shutdown; <root> (incl. <root>/opencode) stays on disk
    open.length = 0;
    await settle();

    // --- boot #2: SAME root → µ sidecar AND opencode storage rehydrate ---------
    const s2 = await boot(root);

    // the µ session + its prior assistant turn came back from the sidecar
    const hist = (await json(`${s2.url}/api/sessions/${muId}/messages`)) as { messages: { role: string }[] };
    expect(hist.messages.some((m) => m.role === "assistant")).toBe(true);
    // the opencode binding rehydrated unchanged
    expect(s2.runtime.resolveOpencodeId(muId)).toBe(ocBefore);

    // a follow-up turn: reconcile finds the bound session still alive (sessionExists →
    // true) and REUSES it — same id, no re-mint. THIS is the property under test: after
    // a real restart we resume the agent's own session instead of re-priming a fresh one.
    const t2 = await runTurn(s2.url, muId, "In one word, which ticker did I just ask you to chart?");
    expect(t2.at(-1)?.type).toBe("done");
    expect(s2.runtime.resolveOpencodeId(muId)).toBe(ocBefore); // REUSED across the restart

    // and the canvas built before the restart is still there (µ sidecar)
    const canvas2 = (await json(`${s2.url}/api/sessions/${muId}/canvas`)) as { windows: unknown[] };
    expect(canvas2.windows.length).toBeGreaterThan(0);
  }, 300_000);

  it("falls back to a fresh opencode session when the bound one is gone (reconcile-on-miss)", async () => {
    root = await mkdtemp(join(tmpdir(), "mu-remint-"));
    const s = await boot(root);
    const muId = await newSession(s);
    const ocBefore = s.runtime.resolveOpencodeId(muId);

    // genuine loss: drop the bound opencode session out from under µ (what a prune /
    // different machine / cleared storage looks like). The next turn must NOT 404 —
    // reconcile re-mints, rebinds, and primes from the µ transcript.
    await s.driver!.deleteSession(ocBefore);

    const t = await runTurn(s.url, muId, "Say hello.");
    expect(t.at(-1)?.type).toBe("done");
    const ocAfter = s.runtime.resolveOpencodeId(muId);
    expect(ocAfter).toBeTruthy();
    expect(ocAfter).not.toBe(ocBefore); // a FRESH session was minted (re-mint, not reuse)
  }, 300_000);
});
