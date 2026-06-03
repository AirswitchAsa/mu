import { describe, expect, it } from "vitest";
import { MuErrorException, type Placement, type SessionState } from "@mu/protocol";
import { applyCanvasOps, type CanvasDeps } from "./canvas.js";
import { RendererRegistry } from "./renderer-registry.js";

function renderers(): RendererRegistry {
  const r = new RendererRegistry();
  r.register({
    manifest: { type: "price_chart", specSchema: null, requiresShape: ["ohlcv"], title: "Price", description: "", trust: "core" },
    validateSpec: (spec) => (spec["bad"] === true ? { ok: false, errors: [{ path: "bad", message: "no" }] } : { ok: true }),
  });
  r.register({
    manifest: { type: "memo", specSchema: null, requiresShape: [], title: "Memo", description: "", trust: "core" },
  });
  return r;
}

let seq = 0;
function deps(): CanvasDeps {
  return { renderers: renderers(), newWindowId: () => `w${++seq}`, newProvId: () => `p${++seq}`, now: () => 1000 };
}

function empty(): SessionState {
  return { id: "s1", windows: [], layout: {}, messages: [], provenanceLog: [], createdAt: 0, updatedAt: 0 };
}

const overlap = (a: Placement, b: Placement): boolean =>
  a.col < b.col + b.colSpan && a.col + a.colSpan > b.col && a.row < b.row + b.rowSpan && a.row + a.rowSpan > b.row;

const AMZN = "yfinance:ohlcv:AMZN:1d";

describe("apply_canvas_op — content", () => {
  it("agent creates a window, auto-places it, records provenance, derives a title", () => {
    const s = applyCanvasOps(empty(), [{ op: "create", type: "price_chart", spec: {}, handle: AMZN }], "agent", deps());
    expect(s.windows).toHaveLength(1);
    const w = s.windows[0]!;
    expect(w.type).toBe("price_chart");
    expect(w.bindings).toEqual([AMZN]);
    expect(w.title).toContain("AMZN");
    expect(s.layout[w.id]?.pinned).toBe(false);
    expect(s.provenanceLog).toHaveLength(1);
    expect(s.provenanceLog[0]?.handle).toBe(AMZN);
    expect(w.provenanceRefs).toEqual([s.provenanceLog[0]?.id]);
  });

  it("update merges + revalidates the spec; delete clears layout + focus", () => {
    const d = deps();
    const s = applyCanvasOps(empty(), [{ op: "create", type: "price_chart", spec: { a: 1 }, handle: AMZN }], "agent", d);
    const id = s.windows[0]!.id;
    const s2 = applyCanvasOps(s, [{ op: "update", windowId: id, spec: { b: 2 } }], "agent", d);
    expect(s2.windows[0]!.spec).toEqual({ a: 1, b: 2 });
    const s3 = applyCanvasOps(s2, [{ op: "focus", windowId: id }], "agent", d);
    expect(s3.focusedWindowId).toBe(id);
    const s4 = applyCanvasOps(s3, [{ op: "delete", windowId: id }], "agent", d);
    expect(s4.windows).toHaveLength(0);
    expect(s4.focusedWindowId).toBeUndefined();
    expect(s4.layout[id]).toBeUndefined();
  });
});

describe("apply_canvas_op — authorization (content vs layout)", () => {
  it("rejects an agent-emitted layout op; accepts it from the user and pins", () => {
    const d = deps();
    const s = applyCanvasOps(empty(), [{ op: "create", type: "memo" }], "agent", d);
    const id = s.windows[0]!.id;
    expect(() => applyCanvasOps(s, [{ op: "move", windowId: id, placement: { col: 3, row: 1 } }], "agent", d)).toThrow(
      MuErrorException,
    );
    const moved = applyCanvasOps(s, [{ op: "move", windowId: id, placement: { col: 3, row: 1 } }], "user", d);
    expect(moved.layout[id]).toMatchObject({ col: 3, row: 1, pinned: true });
  });
});

describe("apply_canvas_op — validation", () => {
  it("rejects unknown type, shape-mismatched bind, and off-schema spec", () => {
    expect(() => applyCanvasOps(empty(), [{ op: "create", type: "nope" }], "agent", deps())).toThrow(/unknown window type/);
    expect(() =>
      applyCanvasOps(empty(), [{ op: "create", type: "price_chart", handle: "tiingo:news:AMZN" }], "agent", deps()),
    ).toThrow(/does not accept shape/);
    expect(() =>
      applyCanvasOps(empty(), [{ op: "create", type: "price_chart", spec: { bad: true } }], "agent", deps()),
    ).toThrow(/invalid/);
  });
});

describe("apply_canvas_op — transactional", () => {
  it("applies all-or-nothing; a bad op in the batch leaves prior state untouched", () => {
    const d = deps();
    const base = applyCanvasOps(empty(), [{ op: "create", type: "memo" }], "agent", d);
    expect(() =>
      applyCanvasOps(
        base,
        [
          { op: "create", type: "price_chart", handle: AMZN },
          { op: "update", windowId: "does-not-exist", spec: {} },
        ],
        "agent",
        d,
      ),
    ).toThrow(/unknown window/);
    // input state is never mutated (clone-then-commit), so base still has exactly 1 window
    expect(base.windows).toHaveLength(1);
  });
});

describe("auto_layout", () => {
  it("gap-fills row-major without overlapping existing windows", () => {
    const d = deps();
    const s = applyCanvasOps(
      empty(),
      [
        { op: "create", type: "price_chart" }, // 8 wide
        { op: "create", type: "price_chart" }, // 8 wide → can't share the 12-col row
      ],
      "agent",
      d,
    );
    const [a, b] = s.windows;
    expect(overlap(s.layout[a!.id]!, s.layout[b!.id]!)).toBe(false);
    expect(s.layout[b!.id]!.row).toBeGreaterThanOrEqual(s.layout[a!.id]!.row + s.layout[a!.id]!.rowSpan);
  });
});
