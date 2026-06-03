import { describe, expect, it, vi } from "vitest";
import { RendererRegistry } from "./renderer-registry.js";
import { SessionStore } from "./session-store.js";
import { ToolSurface, type CanvasChange } from "./tool-surface.js";

function renderers(): RendererRegistry {
  const r = new RendererRegistry();
  r.register({ manifest: { type: "price_chart", specSchema: null, requiresShape: ["ohlcv"], title: "Price", description: "", trust: "core" } });
  return r;
}

const AMZN = "yfinance:ohlcv:AMZN:1d";

function surface() {
  const broker = { view: vi.fn(), resolve: vi.fn(), list: vi.fn(async () => []) };
  const coordinator = { acquire: vi.fn(async () => ({ handle: AMZN, summary: { rowCount: 2, latestClose: 102 } })) };
  const sessions = new SessionStore();
  sessions.create("s1", 0);
  const changes: CanvasChange[] = [];
  const ts = new ToolSurface({
    broker: broker as never,
    coordinator: coordinator as never,
    resources: { list: () => [] } as never,
    renderers: renderers(),
    sessions,
    onCanvasChange: (_sid, c) => changes.push(c),
    newWindowId: () => "w1",
    newProvId: () => "p1",
    now: () => 1,
  });
  return { ts, broker, coordinator, changes };
}

describe("ToolSurface dispatch", () => {
  it("data_fetch routes to the coordinator (shape defaults to ohlcv) and returns handle+summary", async () => {
    const { ts, coordinator } = surface();
    const res = await ts.invoke("s1", "data_fetch", { entity: "AMZN" });
    expect(res).toEqual({ handle: AMZN, summary: { rowCount: 2, latestClose: 102 } });
    expect(coordinator.acquire).toHaveBeenCalledWith(undefined, expect.objectContaining({ shape: "ohlcv", entity: "AMZN" }));
  });

  it("canvas_create applies the op, returns the new window id, and emits a canvas change", async () => {
    const { ts, changes } = surface();
    const res = (await ts.invoke("s1", "canvas_create", { type: "price_chart", handle: AMZN })) as { windowId: string };
    expect(res.windowId).toBe("w1");
    expect(changes).toHaveLength(1);
    expect(changes[0]!.summary.windowCount).toBe(1);
    expect(ts.getCanvasState("s1").windows).toHaveLength(1);
  });

  it("rejects an unknown verb with a typed error", async () => {
    const { ts } = surface();
    await expect(ts.invoke("s1", "frobnicate", {})).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});
