import { beforeEach, describe, expect, it } from "vitest";
import { loadSessions, saveSessions, type SessionMeta } from "./sessionStore";

// =============================================================================
// Client session list persistence: legacy migration + defensive normalization.
// =============================================================================

// Minimal localStorage shim for the node test env.
const store = new Map<string, string>();
beforeEach(() => store.clear());
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
} as Storage;

describe("sessionStore", () => {
  it("round-trips through the versioned envelope", () => {
    const list: SessionMeta[] = [{ id: "a", name: "one", renamed: true }, { id: "b", name: "two", unread: true }];
    saveSessions(list);
    expect(JSON.parse(store.get("mu.sessions")!)).toMatchObject({ v: 1 });
    expect(loadSessions()).toEqual(list);
  });

  it("migrates the legacy bare-array shape", () => {
    store.set("mu.sessions", JSON.stringify([{ id: "a", name: "legacy" }]));
    expect(loadSessions()).toEqual([{ id: "a", name: "legacy" }]);
  });

  it("drops malformed entries and unknown keys (schema drift is non-fatal)", () => {
    store.set(
      "mu.sessions",
      JSON.stringify({ v: 1, list: [{ id: "a", name: "ok", status: "ghost", unread: true }, { id: 5 }, null, "nope"] }),
    );
    expect(loadSessions()).toEqual([{ id: "a", name: "ok", unread: true }]); // `status` stripped, junk dropped
  });

  it("returns [] for absent or corrupt storage", () => {
    expect(loadSessions()).toEqual([]);
    store.set("mu.sessions", "{not json");
    expect(loadSessions()).toEqual([]);
  });
});
