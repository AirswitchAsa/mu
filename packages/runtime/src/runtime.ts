import { EventEmitter } from "node:events";
import type {
  CanvasOp,
  CanvasState,
  CanvasSummary,
  Handle,
  SessionState,
  ViewResult,
  ViewSlice,
} from "@mu/protocol";
import { DataBroker } from "@mu/broker";
import { AcquisitionCoordinator, ResourceRegistry, loadResources } from "@mu/resource-sdk";
import { buildCanvasSummary } from "./canvas-summary.js";
import { RendererRegistry, type RendererDef } from "./renderer-registry.js";
import { SessionStore } from "./session-store.js";
import { ToolSurface } from "./tool-surface.js";

/** Events published per session — the CQRS read projection feeding the web client. */
export type MuEvent =
  | { type: "canvas"; op: CanvasOp; summary: CanvasSummary }
  | { type: "chat"; role: "assistant" | "user"; text: string }
  | { type: "done" }
  | { type: "error"; error: { code?: string; message: string } };

export interface MuRuntimeOptions {
  /** root dir for the broker's shared store. */
  dataRoot: string;
  /** dir scanned for first-party resource plugins. */
  resourcesDir: string;
  /** core renderer manifests + validators (the frontend supplies these). */
  renderers?: RendererDef[];
}

/**
 * MuRuntime — the in-process composition of the data + canvas planes, plus the
 * per-session event bus. The server adds HTTP + the opencode driver on top.
 * Canvas changes from the tool surface are republished on the bus so the message
 * SSE can stream them live.
 */
export class MuRuntime {
  private readonly bus = new EventEmitter();
  readonly tools: ToolSurface;

  constructor(
    readonly broker: DataBroker,
    readonly resources: ResourceRegistry,
    readonly renderers: RendererRegistry,
    readonly sessions: SessionStore,
    readonly coordinator: AcquisitionCoordinator,
  ) {
    this.bus.setMaxListeners(0);
    this.tools = new ToolSurface({
      broker,
      coordinator,
      resources,
      renderers,
      sessions,
      onCanvasChange: (sid, change) =>
        this.publish(sid, { type: "canvas", op: change.op, summary: change.summary }),
    });
  }

  static async create(opts: MuRuntimeOptions): Promise<MuRuntime> {
    const broker = await DataBroker.create(opts.dataRoot);
    const resources = new ResourceRegistry();
    await loadResources(opts.resourcesDir, resources);
    const coordinator = new AcquisitionCoordinator(resources, broker);
    const renderers = new RendererRegistry();
    for (const def of opts.renderers ?? []) renderers.register(def);
    return new MuRuntime(broker, resources, renderers, new SessionStore(), coordinator);
  }

  // --- session lifecycle (id == opencode session id; bind_sessions) ---
  createSession(id: string): SessionState {
    return this.sessions.create(id);
  }
  deleteSession(id: string): boolean {
    this.bus.removeAllListeners(`s:${id}`);
    return this.sessions.delete(id);
  }

  // --- agent path (opencode plugin → localhost callback → here) ---
  handleToolCall(sessionId: string, verb: string, args: Record<string, unknown>): Promise<unknown> {
    return this.tools.invoke(sessionId, verb, args);
  }

  // --- user path (web client canvas edits) ---
  applyUserOps(sessionId: string, ops: readonly CanvasOp[]): CanvasSummary {
    return this.tools.applyCanvasOps(sessionId, ops, "user").summary;
  }

  // --- reads ---
  getCanvasState(sessionId: string): CanvasState {
    return this.tools.getCanvasState(sessionId);
  }
  canvasSummary(sessionId: string): CanvasSummary {
    return buildCanvasSummary(this.sessions.require(sessionId));
  }
  resolve(handle: Handle, slice?: ViewSlice): Promise<Record<string, unknown>[]> {
    return this.broker.resolve(handle, slice);
  }
  dataView(handle: Handle, slice?: ViewSlice): Promise<ViewResult> {
    return this.broker.view(handle, slice);
  }
  dataList(filter?: { provider?: string; shape?: string; entity?: string }) {
    return this.tools.dataList(filter);
  }

  // --- event bus (per session) ---
  publish(sessionId: string, event: MuEvent): void {
    this.bus.emit(`s:${sessionId}`, event);
  }
  subscribe(sessionId: string, listener: (event: MuEvent) => void): () => void {
    const channel = `s:${sessionId}`;
    this.bus.on(channel, listener);
    return () => this.bus.off(channel, listener);
  }
}
