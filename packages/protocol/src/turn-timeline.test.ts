import { describe, expect, it } from "vitest";
import type { CanvasOp } from "./canvas-op.js";
import { buildTimeline, type TimelineEventInput } from "./turn-timeline.js";

// The fold reads only `op` off a canvas event (mapped via traceFromOp), nothing else.
const canvas = (op: CanvasOp): TimelineEventInput => ({ type: "canvas", op });

// The ONE shared fold (server-persist == web-live). Each case pins a locked rule.
describe("turn timeline fold", () => {
  it("orders parts in first-seen receipt order", () => {
    const items = buildTimeline([
      { type: "chat_delta", partId: "a", kind: "text", text: "He" },
      { type: "chat_delta", partId: "b", kind: "reasoning", text: "th" },
    ]);
    expect(items).toEqual([
      { kind: "text", id: "a", text: "He" },
      { kind: "reasoning", id: "b", text: "th" },
    ]);
  });

  it("upserts a part by id with the cumulative text (replace, not append)", () => {
    const items = buildTimeline([
      { type: "chat_delta", partId: "a", kind: "text", text: "Hel" },
      { type: "chat_delta", partId: "a", kind: "text", text: "Hello" },
      { type: "chat_delta", partId: "a", kind: "text", text: "Hello world" },
    ]);
    expect(items).toEqual([{ kind: "text", id: "a", text: "Hello world" }]);
  });

  it("a later delta updates in place, preserving the slot before a tool", () => {
    const items = buildTimeline([
      { type: "chat_delta", partId: "a", kind: "text", text: "x" },
      { type: "tool", verb: "data_fetch", arg: "GDP", ret: "h · 12 rows" },
      { type: "chat_delta", partId: "a", kind: "text", text: "xyz" },
    ]);
    // 'a' stays first (first-seen fixes position); the tool stays after it.
    expect(items).toEqual([
      { kind: "text", id: "a", text: "xyz" },
      { kind: "tool", verb: "data_fetch", arg: "GDP", ret: "h · 12 rows" },
    ]);
  });

  it("interleaves tool rows between text parts in arrival order", () => {
    const items = buildTimeline([
      { type: "chat_delta", partId: "a", kind: "text", text: "first" },
      { type: "tool", verb: "data_view", arg: "h", ret: "30 rows" },
      { type: "chat_delta", partId: "b", kind: "text", text: "second" },
    ]);
    expect(items).toEqual([
      { kind: "text", id: "a", text: "first" },
      { kind: "tool", verb: "data_view", arg: "h", ret: "30 rows" },
      { kind: "text", id: "b", text: "second" },
    ]);
  });

  it("maps a canvas op to a tool item via the shared traceFromOp", () => {
    const items = buildTimeline([canvas({ op: "create", type: "line", handle: "fred:GDP" })]);
    expect(items).toEqual([{ kind: "tool", verb: "canvas.create", arg: "line → fred:GDP", ret: "bound" }]);
  });

  it("records reasoning as its own kind, upserted like text", () => {
    const items = buildTimeline([
      { type: "chat_delta", partId: "r", kind: "reasoning", text: "let me" },
      { type: "chat_delta", partId: "r", kind: "reasoning", text: "let me think" },
    ]);
    expect(items).toEqual([{ kind: "reasoning", id: "r", text: "let me think" }]);
  });

  it("ignores chat/done/error (they carry no timeline content)", () => {
    const items = buildTimeline([
      { type: "chat_delta", partId: "a", kind: "text", text: "hi" },
      { type: "chat", role: "assistant", text: "hi" } as TimelineEventInput,
      { type: "done" },
    ]);
    expect(items).toEqual([{ kind: "text", id: "a", text: "hi" }]);
  });
});
