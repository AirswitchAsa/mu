import { describe, expect, it, vi } from "vitest";
import { RendererRegistry } from "./renderer-registry.js";
import { MuRuntime } from "./runtime.js";
import { SessionStore } from "./session-store.js";

// =============================================================================
// refreshSession — the global "refresh" button. Each bound handle is re-acquired
// from its stored descriptor in isolation: one failure (unconfigured key, rate
// limit, missing meta) is reported but never blocks the others.
// =============================================================================

const H1 = "yfinance:ohlcv:AMZN:1d";
const H2 = "fred:releases:NOPE"; // no meta on disk → refreshHandle throws, isolated

describe("refreshSession", () => {
  it("refreshes each handle independently; one failure is reported, the rest still run", async () => {
    const meta1 = {
      descriptor: { shape: "ohlcv", identity: { provider: "yfinance", entity: "AMZN" }, queryParams: { resolution: "1d" } },
    };
    const broker = { describe: vi.fn(async (h: string) => (h === H1 ? meta1 : null)) };
    const acquire = vi.fn(async () => ({ handle: H1, summary: {} }));
    const coordinator = { acquire };
    const sessions = new SessionStore();
    sessions.create("s1", 0);

    const runtime = new MuRuntime(
      broker as never,
      { list: () => [] } as never,
      new RendererRegistry(),
      sessions,
      coordinator as never,
    );

    const out = await runtime.refreshSession("s1", [H1, H2]);
    expect(out.refreshed).toEqual([H1]);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]!.handle).toBe(H2);
    expect(out.errors[0]!.code).toBe("HANDLE_NOT_FOUND");
    // the successful handle re-acquired exactly once, via its stored descriptor
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenCalledWith(
      "yfinance",
      expect.objectContaining({ shape: "ohlcv", entity: "AMZN", resolution: "1d" }),
      "on_demand",
    );
  });
});
