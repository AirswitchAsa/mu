import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatMessage } from "@mu/protocol";
import { RendererRegistry } from "./renderer-registry.js";
import { MuRuntime } from "./runtime.js";
import { SessionStore } from "./session-store.js";
import { buildPrimingText } from "./transcript-priming.js";

// =============================================================================
// Workstream 3: µ identity is decoupled from the opencode session. µ owns a
// stable id; the opencode session it drives is recorded as opencodeSessionId and
// is re-mintable. These cover the resolution helper, rebind, the priming builder,
// and the sidecar round-tripping the new field.
// =============================================================================

const newRuntime = (sessions: SessionStore) =>
  new MuRuntime(
    { describe: async () => null } as never,
    { list: () => [] } as never,
    new RendererRegistry(),
    sessions,
    { acquire: async () => ({}) } as never,
  );

describe("µ-id → opencode-id resolution", () => {
  it("returns opencodeSessionId when set; falls back to the µ id when absent (legacy)", () => {
    const sessions = new SessionStore();
    const runtime = newRuntime(sessions);

    // legacy / API-only: no opencodeSessionId → falls back to the µ id (1:1)
    runtime.createSession("mu-legacy");
    expect(runtime.resolveOpencodeId("mu-legacy")).toBe("mu-legacy");

    // decoupled: distinct opencode id is recorded and resolved
    runtime.createSession("mu-1", "oc-1");
    expect(runtime.resolveOpencodeId("mu-1")).toBe("oc-1");
    expect(sessions.require("mu-1").opencodeSessionId).toBe("oc-1");

    // unknown id falls back to itself (no throw — callers tolerate it)
    expect(runtime.resolveOpencodeId("nope")).toBe("nope");
  });

  it("createSession keeps the µ id stable while recording/updating opencodeSessionId; bindOpencodeSession rebinds", () => {
    const sessions = new SessionStore();
    const runtime = newRuntime(sessions);

    const s = runtime.createSession("mu-2", "oc-old");
    expect(s.id).toBe("mu-2");
    expect(s.opencodeSessionId).toBe("oc-old");

    // reconcile-on-miss re-mint: rebind to a fresh opencode session, µ id unchanged
    const rebound = runtime.bindOpencodeSession("mu-2", "oc-new");
    expect(rebound.id).toBe("mu-2");
    expect(rebound.opencodeSessionId).toBe("oc-new");
    expect(runtime.resolveOpencodeId("mu-2")).toBe("oc-new");
  });
});

describe("buildPrimingText (transcript replay)", () => {
  const mk = (role: ChatMessage["role"], text: string, at = 0): ChatMessage => ({ role, text, at });

  it("returns undefined when there is no prior dialogue", () => {
    expect(buildPrimingText([])).toBeUndefined();
    expect(buildPrimingText([mk("user", "   ")])).toBeUndefined(); // whitespace-only dropped
  });

  it("formats oldest→newest with User:/µ: prefixes inside a priming header", () => {
    const out = buildPrimingText([mk("user", "show AMZN"), mk("assistant", "done"), mk("user", "add SMA")])!;
    expect(out).toContain("[µ session resumed]");
    const userIdx = out.indexOf("User: show AMZN");
    const asstIdx = out.indexOf("µ: done");
    const lastIdx = out.indexOf("User: add SMA");
    expect(userIdx).toBeGreaterThan(-1);
    expect(asstIdx).toBeGreaterThan(userIdx); // ordered oldest→newest
    expect(lastIdx).toBeGreaterThan(asstIdx);
  });

  it("is bounded: keeps only the most recent turns (oldest dropped)", () => {
    const many = Array.from({ length: 30 }, (_, i) => mk(i % 2 === 0 ? "user" : "assistant", `m${i}`));
    const out = buildPrimingText(many)!;
    // last 10 entries survive; the very first does not
    expect(out).toContain("m29");
    expect(out).toContain("m20");
    expect(out).not.toContain("m0\n");
    expect(out).not.toContain("User: m0");
  });

  it("is char-capped: a long history is trimmed from the front but keeps the freshest", () => {
    const big = "x".repeat(2_000);
    const out = buildPrimingText([mk("user", big), mk("assistant", big), mk("user", "freshest")])!;
    expect(out).toContain("freshest"); // newest always survives
    expect(out.length).toBeLessThan(6_000); // under cap + header
  });
});

describe("SessionStore round-trips opencodeSessionId", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mu-session-id-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("persists the field to the sidecar and rehydrates it on reload", async () => {
    const store = await SessionStore.load(dir);
    const s = store.create("mu-3");
    s.opencodeSessionId = "oc-persisted";
    store.persist("mu-3");
    // let the fire-and-forget write settle
    await new Promise((r) => setTimeout(r, 20));

    const revived = await SessionStore.load(dir);
    expect(revived.require("mu-3").opencodeSessionId).toBe("oc-persisted");
  });
});
