import { describe, expect, it } from "vitest";
import { RendererRegistry } from "./renderer-registry.js";
import { SessionStore } from "./session-store.js";
import { ToolSurface } from "./tool-surface.js";

// =============================================================================
// Every canvas change carries its emitter as `source` on onCanvasChange, so the read
// stream can tell an AGENT content op (drives the chat timeline + "thinking") from a
// USER layout op (resize/reorder/delete — sync the canvas only). Regression guard: a
// user resize must NOT be published as an agent edit, else the client flips into
// "thinking" and a plain resize looks like the agent started a turn.
// =============================================================================

describe("applyCanvasOps source tagging", () => {
  it("tags an agent content op 'agent' and a user layout op 'user'", () => {
    const sessions = new SessionStore();
    sessions.create("s1", 0);
    const renderers = new RendererRegistry();
    renderers.register({
      manifest: { type: "memo", specSchema: {}, requiresShape: [], title: "Memo", description: "", trust: "core" },
      validateSpec: () => ({ ok: true }),
    });

    const changes: { op: string; source: string }[] = [];
    const tools = new ToolSurface({
      broker: {} as never,
      coordinator: {} as never,
      resources: {} as never,
      renderers,
      sessions,
      onCanvasChange: (_sid, c) => changes.push({ op: c.op.op, source: c.source }),
      newWindowId: () => "w1",
    });

    // agent creates a card, then the user resizes it (a user-only layout op)
    tools.applyCanvasOps("s1", [{ op: "create", type: "memo", spec: {} }], "agent");
    tools.applyCanvasOps("s1", [{ op: "resize", windowId: "w1", placement: { colSpan: 2, rowSpan: 2 } }], "user");

    expect(changes).toEqual([
      { op: "create", source: "agent" },
      { op: "resize", source: "user" },
    ]);
  });
});
