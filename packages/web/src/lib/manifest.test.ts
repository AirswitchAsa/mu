import { describe, expect, it } from "vitest";
import type { CanvasState, Placement, Window } from "@mu/protocol";
import { handlesToResolve, reconcile, stableEqual } from "./manifest";

const placement = (col: number, row: number): Placement => ({ col, row, colSpan: 8, rowSpan: 4, pinned: false });

function win(id: string, opts: Partial<Window> = {}): Window {
  return {
    id,
    type: opts.type ?? "price_chart",
    title: opts.title ?? id,
    spec: opts.spec ?? {},
    bindings: opts.bindings ?? ["yfinance:ohlcv:AMZN:1d"],
    provenanceRefs: opts.provenanceRefs ?? [],
  };
}

function state(windows: Window[], focusedWindowId?: string): CanvasState {
  const layout: Record<string, Placement> = {};
  windows.forEach((w, i) => (layout[w.id] = placement(0, i * 4)));
  return { id: "s1", windows, layout, focusedWindowId };
}

describe("reconcile", () => {
  it("treats a null prev as all-added", () => {
    const next = state([win("w1"), win("w2")]);
    const diff = reconcile(null, next);
    expect(diff.added.map((w) => w.id)).toEqual(["w1", "w2"]);
    expect(handlesToResolve(diff)).toEqual(["yfinance:ohlcv:AMZN:1d"]);
  });

  it("detects an added window and resolves only its handle", () => {
    const prev = state([win("w1")]);
    const next = state([win("w1"), win("w2", { bindings: ["yfinance:ohlcv:MSFT:1d"] })]);
    const diff = reconcile(prev, next);
    expect(diff.added.map((w) => w.id)).toEqual(["w2"]);
    expect(diff.updated).toEqual([]);
    expect(handlesToResolve(diff)).toEqual(["yfinance:ohlcv:MSFT:1d"]);
  });

  it("a spec-only change is updated but needs NO re-resolve", () => {
    const prev = state([win("w1", { spec: {} })]);
    const next = state([win("w1", { spec: { overlays: [{ kind: "sma", period: 50 }] } })]);
    const diff = reconcile(prev, next);
    expect(diff.updated).toHaveLength(1);
    expect(diff.updated[0]).toMatchObject({ id: "w1", specChanged: true, bindingsChanged: false });
    expect(handlesToResolve(diff)).toEqual([]); // the key win: unchanged binding never re-resolves
  });

  it("a binding change requires a re-resolve", () => {
    const prev = state([win("w1", { bindings: ["yfinance:ohlcv:AMZN:1d"] })]);
    const next = state([win("w1", { bindings: ["yfinance:ohlcv:AMZN:1d", "yfinance:ohlcv:MSFT:1d"] })]);
    const diff = reconcile(prev, next);
    expect(diff.updated[0]).toMatchObject({ bindingsChanged: true });
    expect(handlesToResolve(diff)).toEqual(["yfinance:ohlcv:AMZN:1d", "yfinance:ohlcv:MSFT:1d"]);
  });

  it("detects removed windows and layout/focus changes", () => {
    const prev = state([win("w1"), win("w2")], "w1");
    const moved = state([win("w1")], "w2");
    (moved.layout as Record<string, Placement>)["w1"] = { ...placement(3, 0), pinned: true };
    const diff = reconcile(prev, moved);
    expect(diff.removed).toEqual(["w2"]);
    expect(diff.layoutChanged).toContain("w1");
    expect(diff.focusChanged).toBe(true);
  });
});

describe("stableEqual", () => {
  it("is key-order independent", () => {
    expect(stableEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(stableEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(stableEqual([1, { x: 1 }], [1, { x: 1 }])).toBe(true);
  });
});
