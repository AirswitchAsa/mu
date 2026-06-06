import { randomUUID } from "node:crypto";
import {
  MuErrorException,
  type CanvasOp,
  type CanvasState,
  type CanvasSummary,
  type Emitter,
  type Handle,
  type ViewResult,
  type ViewSlice,
} from "@mu/protocol";
import type { DataBroker } from "@mu/broker";
import type { AcquisitionCoordinator, ResourceRegistry } from "@mu/resource-sdk";
import { applyCanvasOps, type CanvasDeps } from "./canvas.js";
import { buildCanvasState, buildCanvasSummary } from "./canvas-summary.js";
import type { RendererRegistry } from "./renderer-registry.js";
import type { SessionStore } from "./session-store.js";

export interface CanvasChange {
  readonly op: CanvasOp;
  readonly summary: CanvasSummary;
  /** who made the edit — `agent` ops drive the chat timeline + "thinking"; `user`
   *  layout ops (resize/reorder/delete) only sync the canvas, never the agent. */
  readonly source: Emitter;
}
export type CanvasChangeListener = (sessionId: string, change: CanvasChange) => void;

export interface ToolSurfaceDeps {
  broker: DataBroker;
  coordinator: AcquisitionCoordinator;
  resources: ResourceRegistry;
  renderers: RendererRegistry;
  sessions: SessionStore;
  onCanvasChange?: CanvasChangeListener;
  now?: () => number;
  newWindowId?: () => string;
  newProvId?: () => string;
}

/**
 * ToolSurface — the µ-native verb interface (tool-surface.dog.md), the real agent
 * boundary. Two families: data verbs (list/fetch/view) → broker/coordinator, and
 * canvas verbs (apply_canvas_op + canvas_* + get_canvas_state) → the canvas. Holds
 * no session state; every call carries a sessionId. Never returns bulk payloads.
 */
export class ToolSurface {
  private readonly canvasDeps: CanvasDeps;

  constructor(private readonly deps: ToolSurfaceDeps) {
    this.canvasDeps = {
      renderers: deps.renderers,
      newWindowId: deps.newWindowId ?? (() => `w_${randomUUID().slice(0, 8)}`),
      newProvId: deps.newProvId ?? (() => `p_${randomUUID().slice(0, 8)}`),
      now: deps.now ?? (() => Date.now()),
    };
  }

  /** data_list — sources (capabilities) + datasets (catalog metadata), bounded, no bulk. */
  async dataList(filter?: { provider?: string; shape?: string; entity?: string }): Promise<{
    sources: ReturnType<ResourceRegistry["list"]>;
    datasets: Array<{ handle: Handle; shape: string; kind: string; freshness: unknown; rowCount?: number; sizeBytes: number }>;
  }> {
    const metas = await this.deps.broker.list();
    const datasets = metas
      .filter((m) => (!filter?.shape || m.shape === filter.shape))
      .filter((m) => (!filter?.provider || m.handle.startsWith(`${filter.provider}:`)))
      .filter((m) => (!filter?.entity || m.handle.toUpperCase().includes(filter.entity.toUpperCase())))
      .map((m) => ({
        handle: m.handle,
        shape: m.shape,
        kind: m.kind,
        freshness: m.freshness,
        rowCount: m.rowCount,
        sizeBytes: m.sizeBytes,
      }));
    return { sources: this.deps.resources.list(), datasets };
  }

  /** data_fetch — idempotent acquire into the broker; returns handle + summary. */
  async dataFetch(args: {
    source?: string;
    shape?: string;
    entity?: string;
    resolution?: string;
    range?: string;
    start?: number;
    end?: number;
    kind?: string;
  }): Promise<{ handle: Handle; summary: unknown }> {
    if (!args.entity) throw new MuErrorException("FETCH_FAILED", "data_fetch requires an 'entity'");
    return this.deps.coordinator.acquire(args.source, {
      shape: args.shape ?? "ohlcv",
      entity: args.entity,
      resolution: args.resolution,
      range: args.range,
      start: args.start,
      end: args.end,
      // News namespace (ticker | sector | market); resource-defaulted when omitted.
      kind: args.kind,
    });
  }

  /** data_view — bounded read for the agent; bulk guard refuses over-broad slices. */
  async dataView(handle: Handle, slice?: ViewSlice): Promise<ViewResult> {
    return this.deps.broker.view(handle, slice);
  }

  /** Apply an ordered list of ops from a given emitter; emits per-op canvas changes. */
  applyCanvasOps(sessionId: string, ops: readonly CanvasOp[], emitter: Emitter): { summary: CanvasSummary; createdWindowIds: string[] } {
    const session = this.deps.sessions.require(sessionId);
    const before = new Set(session.windows.map((w) => w.id));
    const next = applyCanvasOps(session, ops, emitter, this.canvasDeps);
    this.deps.sessions.replace(next);
    const summary = buildCanvasSummary(next);
    const createdWindowIds = next.windows.filter((w) => !before.has(w.id)).map((w) => w.id);
    for (const op of ops) this.deps.onCanvasChange?.(sessionId, { op, summary, source: emitter });
    return { summary, createdWindowIds };
  }

  getCanvasState(sessionId: string): CanvasState {
    return buildCanvasState(this.deps.sessions.require(sessionId));
  }

  /**
   * Dispatch a Level-1 verb by name — the entry point the opencode plugin's tools
   * call (over the localhost callback). Canvas verbs are emitted as the agent.
   */
  async invoke(sessionId: string, verb: string, args: Record<string, unknown>): Promise<unknown> {
    switch (verb) {
      case "data_list":
        return this.dataList(args as { provider?: string; shape?: string; entity?: string });
      case "data_fetch":
        return this.dataFetch(args);
      case "data_view":
        return this.dataView(args["handle"] as Handle, args["slice"] as ViewSlice | undefined);
      case "get_canvas_state":
        return this.getCanvasState(sessionId);
      case "renderer_list":
        // The capability catalog: window types the agent may create, their spec
        // options, and the data shape each requires. Discovery for canvas_create.
        return { renderers: this.deps.renderers.list() };
      case "canvas_create": {
        const { createdWindowIds, summary } = this.applyCanvasOps(
          sessionId,
          [{ op: "create", type: String(args["type"]), spec: (args["spec"] as Record<string, unknown>) ?? {}, handle: args["handle"] as Handle | Handle[] | undefined, title: args["title"] as string | undefined }],
          "agent",
        );
        return { windowId: createdWindowIds[0], summary };
      }
      case "canvas_update":
        return { summary: this.applyCanvasOps(sessionId, [{ op: "update", windowId: String(args["windowId"]), spec: (args["spec"] as Record<string, unknown>) ?? {} }], "agent").summary };
      case "canvas_delete":
        return { summary: this.applyCanvasOps(sessionId, [{ op: "delete", windowId: String(args["windowId"]) }], "agent").summary };
      case "canvas_focus":
        return { summary: this.applyCanvasOps(sessionId, [{ op: "focus", windowId: String(args["windowId"]) }], "agent").summary };
      case "canvas_bind":
        return { summary: this.applyCanvasOps(sessionId, [{ op: "bind", windowId: String(args["windowId"]), handle: args["handle"] as Handle | Handle[] }], "agent").summary };
      default:
        throw new MuErrorException("VALIDATION_FAILED", `unknown verb '${verb}'`);
    }
  }
}
