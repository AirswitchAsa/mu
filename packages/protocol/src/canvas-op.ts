import type { Handle } from "./handle.js";
import type { PlacementPatch } from "./window.js";

/** Who emitted an op — authorization is per-op-class by emitter (canvas-op.dog.md). */
export type Emitter = "agent" | "user";

/**
 * CanvasOp — the single declarative unit of change to the canvas (canvas-op.dog.md).
 * Content ops (`create`/`update`/`delete`/`focus`/`bind`) come from either party;
 * layout ops (`move`/`resize`/`reorder`) are user-only and rejected from the agent.
 */
export type CanvasOp =
  | { readonly op: "create"; readonly type: string; readonly spec?: Record<string, unknown>; readonly handle?: Handle | readonly Handle[]; readonly title?: string }
  | { readonly op: "update"; readonly windowId: string; readonly spec: Record<string, unknown> }
  | { readonly op: "delete"; readonly windowId: string }
  | { readonly op: "focus"; readonly windowId: string }
  | { readonly op: "bind"; readonly windowId: string; readonly handle: Handle | readonly Handle[] }
  | { readonly op: "move"; readonly windowId: string; readonly placement: PlacementPatch }
  | { readonly op: "resize"; readonly windowId: string; readonly placement: PlacementPatch }
  /** Move `windowId` directly before/after `targetId` in the window order (grid flow). */
  | { readonly op: "reorder"; readonly windowId: string; readonly targetId: string; readonly after: boolean };

export const LAYOUT_OPS = new Set(["move", "resize", "reorder"]);

export function isLayoutOp(op: CanvasOp): boolean {
  return LAYOUT_OPS.has(op.op);
}

/**
 * One line in the chat ops-trace — a compact, bulk-free record of something the
 * agent did this turn (a canvas op, or a data verb). Persisted on the assistant
 * `ChatMessage` so the trace survives a reload, and streamed live over SSE.
 */
export interface TraceLine {
  readonly verb: string;
  readonly arg: string;
  readonly ret: string;
}

/** Condense a canvas op into one ops-trace line. Shared by the client (live) and
 * the server (persisted), so the restored trace matches what was shown live. */
export function traceFromOp(op: CanvasOp): TraceLine {
  switch (op.op) {
    case "create":
      return { verb: "canvas.create", arg: `${op.type}${op.handle ? ` → ${String(op.handle)}` : ""}`, ret: "bound" };
    case "update":
      return { verb: "canvas.update", arg: Object.keys(op.spec ?? {}).join(", ") || op.windowId, ret: "ok" };
    case "bind":
      return { verb: "canvas.bind", arg: String(op.handle), ret: "bound" };
    case "delete":
      return { verb: "canvas.delete", arg: op.windowId, ret: "ok" };
    default:
      return { verb: `canvas.${op.op}`, arg: "windowId" in op ? op.windowId : "", ret: "ok" };
  }
}
