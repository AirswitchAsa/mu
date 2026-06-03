import type { Handle } from "./handle.js";
import type { PlacementPatch } from "./window.js";

/** Who emitted an op — authorization is per-op-class by emitter (canvas-op.dog.md). */
export type Emitter = "agent" | "user";

/**
 * CanvasOp — the single declarative unit of change to the canvas (canvas-op.dog.md).
 * Content ops (`create`/`update`/`delete`/`focus`/`bind`) come from either party;
 * layout ops (`move`/`resize`) are user-only and rejected from the agent.
 */
export type CanvasOp =
  | { readonly op: "create"; readonly type: string; readonly spec?: Record<string, unknown>; readonly handle?: Handle | readonly Handle[]; readonly title?: string }
  | { readonly op: "update"; readonly windowId: string; readonly spec: Record<string, unknown> }
  | { readonly op: "delete"; readonly windowId: string }
  | { readonly op: "focus"; readonly windowId: string }
  | { readonly op: "bind"; readonly windowId: string; readonly handle: Handle | readonly Handle[] }
  | { readonly op: "move"; readonly windowId: string; readonly placement: PlacementPatch }
  | { readonly op: "resize"; readonly windowId: string; readonly placement: PlacementPatch };

export const LAYOUT_OPS = new Set(["move", "resize"]);

export function isLayoutOp(op: CanvasOp): boolean {
  return LAYOUT_OPS.has(op.op);
}
