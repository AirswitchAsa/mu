import { describe, expect, it } from "vitest";
import { isLayoutOp, traceFromOp } from "./canvas-op.js";
import type { CanvasOp } from "./canvas-op.js";

describe("isLayoutOp", () => {
  it("treats move/resize/reorder as layout (user-only) and content ops otherwise", () => {
    expect(isLayoutOp({ op: "move", windowId: "w", placement: { col: 0, row: 0 } })).toBe(true);
    expect(isLayoutOp({ op: "resize", windowId: "w", placement: { colSpan: 2, rowSpan: 2 } })).toBe(true);
    expect(isLayoutOp({ op: "reorder", windowId: "a", targetId: "b", after: true })).toBe(true);
    expect(isLayoutOp({ op: "create", type: "memo" })).toBe(false);
    expect(isLayoutOp({ op: "update", windowId: "w", spec: {} })).toBe(false);
  });
});

describe("traceFromOp — one compact ops-trace line per op (shared client/server)", () => {
  it("create: shows the type and the bound handle", () => {
    expect(traceFromOp({ op: "create", type: "price_chart", handle: "yf:ohlcv:AMZN:1d" })).toEqual({
      verb: "canvas.create",
      arg: "price_chart → yf:ohlcv:AMZN:1d",
      ret: "bound",
    });
    // no handle → just the type
    expect(traceFromOp({ op: "create", type: "memo" })).toEqual({ verb: "canvas.create", arg: "memo", ret: "bound" });
  });

  it("update: shows the changed spec keys (falls back to windowId)", () => {
    expect(traceFromOp({ op: "update", windowId: "w1", spec: { overlays: [], volume: true } })).toEqual({
      verb: "canvas.update",
      arg: "overlays, volume",
      ret: "ok",
    });
    expect(traceFromOp({ op: "update", windowId: "w1", spec: {} })).toEqual({ verb: "canvas.update", arg: "w1", ret: "ok" });
  });

  it("bind/delete/and layout ops each render a line", () => {
    expect(traceFromOp({ op: "bind", windowId: "w1", handle: "yf:ohlcv:MSFT:1d" })).toMatchObject({ verb: "canvas.bind", ret: "bound" });
    expect(traceFromOp({ op: "delete", windowId: "w1" })).toEqual({ verb: "canvas.delete", arg: "w1", ret: "ok" });
    expect(traceFromOp({ op: "resize", windowId: "w1", placement: { colSpan: 2, rowSpan: 2 } })).toEqual({
      verb: "canvas.resize",
      arg: "w1",
      ret: "ok",
    });
    // reorder has no windowId-as-arg fallthrough issue: it carries windowId
    const reorder: CanvasOp = { op: "reorder", windowId: "a", targetId: "b", after: false };
    expect(traceFromOp(reorder)).toEqual({ verb: "canvas.reorder", arg: "a", ret: "ok" });
  });
});
