import { describe, expect, it } from "vitest";
import { decodeSSE } from "./api";

describe("decodeSSE", () => {
  it("pulls complete data: frames and keeps the partial remainder", () => {
    const buf = `data: ${JSON.stringify({ type: "tool", verb: "data_fetch" })}\n\n` + `data: {"type":"can`;
    const { events, rest } = decodeSSE(buf);
    expect(events).toEqual([{ type: "tool", verb: "data_fetch" }]);
    expect(rest).toBe('data: {"type":"can');
  });

  it("decodes the full event vocabulary in order", () => {
    const buf = [
      `data: {"type":"canvas","op":{"op":"create"},"state":{"id":"s","windows":[],"layout":{}}}`,
      `data: {"type":"chat","role":"assistant","text":"hi"}`,
      `data: {"type":"done"}`,
      ``,
    ].join("\n\n");
    const { events } = decodeSSE(buf);
    expect(events.map((e) => (e as { type: string }).type)).toEqual(["canvas", "chat", "done"]);
  });

  it("skips a malformed frame without throwing", () => {
    const { events } = decodeSSE(`data: {not json}\n\ndata: {"type":"done"}\n\n`);
    expect(events).toEqual([{ type: "done" }]);
  });

  it("joins multiple data: lines in one frame before parsing (SSE multi-line payload)", () => {
    const buf = `data: {"type":"chat",\ndata: "role":"assistant",\ndata: "text":"hi"}\n\n`;
    const { events } = decodeSSE(buf);
    expect(events).toEqual([{ type: "chat", role: "assistant", text: "hi" }]);
  });
});
