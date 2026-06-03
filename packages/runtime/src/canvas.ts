import {
  decodeHandle,
  isLayoutOp,
  MuErrorException,
  type CanvasOp,
  type Emitter,
  type Handle,
  type SessionState,
  type Window,
} from "@mu/protocol";
import { placeWindow } from "./auto-layout.js";
import type { RendererRegistry } from "./renderer-registry.js";

export interface CanvasDeps {
  renderers: RendererRegistry;
  newWindowId: () => string;
  newProvId: () => string;
  now: () => number;
}

function asHandles(handle: Handle | readonly Handle[] | undefined): Handle[] {
  if (handle === undefined) return [];
  return Array.isArray(handle) ? [...(handle as readonly Handle[])] : [handle as Handle];
}

function requireWindow(state: SessionState, id: string): Window {
  const w = state.windows.find((win) => win.id === id);
  if (!w) throw new MuErrorException("VALIDATION_FAILED", `unknown window '${id}'`);
  return w;
}

function replaceWindow(state: SessionState, win: Window): void {
  const i = state.windows.findIndex((w) => w.id === win.id);
  state.windows[i] = win;
}

function defaultTitle(type: string, handles: Handle[]): string {
  const label = type.replace(/_/g, " ");
  if (handles.length > 0) return `${decodeHandle(handles[0]!).entity} ${label}`;
  return label;
}

function recordProvenance(state: SessionState, windowId: string, handle: Handle, deps: CanvasDeps): string {
  const id = deps.newProvId();
  // The window↔handle link is recorded now; full provenance lives in the broker's
  // meta.json and is hydrated on demand (kept null here to keep apply pure/sync).
  state.provenanceLog.push({ id, windowId, handle, provenance: null, at: deps.now() });
  return id;
}

function checkShape(renderers: RendererRegistry, type: string, handle: Handle): void {
  const shape = decodeHandle(handle).shape;
  if (!renderers.acceptsShape(type, shape)) {
    throw new MuErrorException(
      "VALIDATION_FAILED",
      `window type '${type}' does not accept shape '${shape}' (handle ${handle})`,
    );
  }
}

function applyOne(state: SessionState, op: CanvasOp, deps: CanvasDeps): void {
  switch (op.op) {
    case "create": {
      const spec = op.spec ?? {};
      deps.renderers.validateSpec(op.type, spec);
      const handles = asHandles(op.handle);
      for (const h of handles) checkShape(deps.renderers, op.type, h);
      const id = deps.newWindowId();
      const provenanceRefs = handles.map((h) => recordProvenance(state, id, h, deps));
      const win: Window = {
        id,
        type: op.type,
        title: op.title ?? defaultTitle(op.type, handles),
        spec,
        bindings: handles,
        provenanceRefs,
      };
      state.windows.push(win);
      state.layout[id] = placeWindow(state.layout, op.type);
      return;
    }
    case "update": {
      const w = requireWindow(state, op.windowId);
      const spec = { ...w.spec, ...op.spec };
      deps.renderers.validateSpec(w.type, spec);
      replaceWindow(state, { ...w, spec });
      return;
    }
    case "delete": {
      requireWindow(state, op.windowId);
      state.windows = state.windows.filter((w) => w.id !== op.windowId);
      delete state.layout[op.windowId];
      if (state.focusedWindowId === op.windowId) state.focusedWindowId = undefined;
      return;
    }
    case "focus": {
      requireWindow(state, op.windowId);
      state.focusedWindowId = op.windowId;
      return;
    }
    case "bind": {
      const w = requireWindow(state, op.windowId);
      const handles = asHandles(op.handle);
      for (const h of handles) checkShape(deps.renderers, w.type, h);
      const provenanceRefs = [...w.provenanceRefs, ...handles.map((h) => recordProvenance(state, w.id, h, deps))];
      replaceWindow(state, { ...w, bindings: [...w.bindings, ...handles], provenanceRefs });
      return;
    }
    case "move":
    case "resize": {
      const w = requireWindow(state, op.windowId);
      const cur = state.layout[op.windowId] ?? placeWindow(state.layout, w.type);
      state.layout[op.windowId] = {
        col: op.placement.col ?? cur.col,
        row: op.placement.row ?? cur.row,
        colSpan: op.placement.colSpan ?? cur.colSpan,
        rowSpan: op.placement.rowSpan ?? cur.rowSpan,
        pinned: true,
      };
      return;
    }
  }
}

/**
 * apply_canvas_op (apply-canvas-op.dog.md): the single applier. Authorizes each op
 * by class (layout ops are user-only), validates specs/shapes/references, then
 * applies the whole list **transactionally** to a clone — all-or-nothing — so an
 * invalid op leaves state untouched.
 */
export function applyCanvasOps(
  state: SessionState,
  ops: readonly CanvasOp[],
  emitter: Emitter,
  deps: CanvasDeps,
): SessionState {
  const next = structuredClone(state) as SessionState;
  for (const op of ops) {
    if (isLayoutOp(op) && emitter !== "user") {
      throw new MuErrorException(
        "VALIDATION_FAILED",
        `agent may not emit layout op '${op.op}' — the agent authors content, not layout`,
      );
    }
    applyOne(next, op, deps);
  }
  next.updatedAt = deps.now();
  return next;
}
