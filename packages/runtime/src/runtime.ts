import { EventEmitter } from "node:events";
import { join } from "node:path";
import {
  MuErrorException,
  type CanvasOp,
  type CanvasState,
  type CanvasSummary,
  type Handle,
  type SessionState,
  type ViewResult,
  type ViewSlice,
} from "@mu/protocol";
import { DataBroker } from "@mu/broker";
import { AcquisitionCoordinator, ResourceRegistry, loadResources } from "@mu/resource-sdk";
import { buildCanvasSummary } from "./canvas-summary.js";
import { RendererRegistry, type RendererDef } from "./renderer-registry.js";
import { SessionStore } from "./session-store.js";
import { ToolSurface } from "./tool-surface.js";

/** Events published per session — the CQRS read projection feeding the web client. */
export type MuEvent =
  // The canvas is server-authoritative: every change ships the FULL manifest
  // (canvas state). The client diffs it against what it renders and patches —
  // no per-update round trip, no client-side op replay. `op` rides along only as
  // a hint for the chat ops-trace.
  | { type: "canvas"; op: CanvasOp; state: CanvasState }
  // A data verb the agent ran this turn — surfaced for the ops-trace, never bulk.
  | { type: "tool"; verb: string; arg: string; ret: string }
  // Incremental prose/reasoning as the agent writes it (WS1 streaming). `text` is the
  // CUMULATIVE content of the part `partId` so an update is idempotent (a dropped frame
  // self-heals on the next one); the client upserts by `partId`, interleaving with
  // `tool`/`canvas` events in receipt order. The terminal `chat` event still carries
  // the authoritative final text for persistence.
  | { type: "chat_delta"; partId: string; kind: "text" | "reasoning"; text: string }
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
  /**
   * Where to persist session state so it survives a server restart. Defaults to
   * `<dataRoot>/_sessions`. Pass `null` to disable persistence (in-memory only).
   */
  sessionsDir?: string | null;
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
        // state is already committed (sessions.replace ran before this fires).
        this.publish(sid, { type: "canvas", op: change.op, state: this.getCanvasState(sid) }),
    });
  }

  static async create(opts: MuRuntimeOptions): Promise<MuRuntime> {
    const broker = await DataBroker.create(opts.dataRoot);
    const resources = new ResourceRegistry();
    await loadResources(opts.resourcesDir, resources);
    const coordinator = new AcquisitionCoordinator(resources, broker);
    const renderers = new RendererRegistry();
    for (const def of opts.renderers ?? []) renderers.register(def);
    const sessionsDir =
      opts.sessionsDir === null ? undefined : opts.sessionsDir ?? join(opts.dataRoot, "_sessions");
    const sessions = await SessionStore.load(sessionsDir);
    return new MuRuntime(broker, resources, renderers, sessions, coordinator);
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
  async handleToolCall(sessionId: string, verb: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.tools.invoke(sessionId, verb, args);
    // Canvas verbs already publish a `canvas` event via onCanvasChange; surface the
    // data verbs too so the chat ops-trace mirrors what the agent did (no bulk).
    if (verb === "data_fetch" || verb === "data_view" || verb === "data_list") {
      this.publish(sessionId, { type: "tool", ...summarizeToolCall(verb, args, result) });
    }
    return result;
  }

  // --- user path (web client canvas edits) ---
  applyUserOps(sessionId: string, ops: readonly CanvasOp[]): CanvasSummary {
    return this.tools.applyCanvasOps(sessionId, ops, "user").summary;
  }

  // --- user path (manual refresh) ---
  /**
   * Re-acquire one handle from its stored descriptor (meta.json) — the same
   * on-demand fetch+merge the agent's data_fetch runs. The handle string is
   * unchanged (same identity), so a bound card sees the updated rows on re-resolve.
   * For `releases` this is where a now-available actual lands as a new vintage.
   */
  async refreshHandle(handle: Handle): Promise<Handle> {
    const meta = await this.broker.describe(handle);
    if (!meta) throw new MuErrorException("HANDLE_NOT_FOUND", handle);
    const d = meta.descriptor;
    await this.coordinator.acquire(
      d.identity.provider,
      { ...d.queryParams, shape: d.shape, entity: d.identity.entity },
      "on_demand",
    );
    return handle;
  }

  /**
   * Refresh the data-backed handles of a session (the global "refresh" button).
   * With no `handles`, refreshes every distinct bound handle in the canvas. Each
   * handle is isolated: one failure (rate-limit, unconfigured key) is reported but
   * never blocks the others. Returns which handles were refreshed (the client
   * re-resolves exactly those).
   */
  async refreshSession(
    sessionId: string,
    handles?: readonly Handle[],
  ): Promise<{ refreshed: Handle[]; errors: { handle: Handle; code?: string; message: string }[] }> {
    const session = this.sessions.require(sessionId);
    const targets =
      handles && handles.length > 0
        ? [...handles]
        : [...new Set(session.windows.flatMap((w) => w.bindings))];
    const refreshed: Handle[] = [];
    const errors: { handle: Handle; code?: string; message: string }[] = [];
    await Promise.all(
      targets.map(async (h) => {
        try {
          await this.refreshHandle(h);
          refreshed.push(h);
        } catch (err) {
          errors.push({
            handle: h,
            code: err instanceof MuErrorException ? err.code : undefined,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
    return { refreshed, errors };
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

/** Condense a data verb into one ops-trace line ({arg, ret}); never carries bulk. */
function summarizeToolCall(
  verb: string,
  args: Record<string, unknown>,
  result: unknown,
): { verb: string; arg: string; ret: string } {
  const r = (result ?? {}) as Record<string, unknown>;
  if (verb === "data_fetch") {
    const entity = String(args["entity"] ?? "");
    const res = args["resolution"] ? ` · ${String(args["resolution"])}` : "";
    const summary = (r["summary"] ?? {}) as Record<string, unknown>;
    const rows = summary["rowCount"];
    return { verb, arg: `${entity}${res}`, ret: typeof rows === "number" ? `${String(r["handle"])} · ${rows} rows` : String(r["handle"] ?? "ok") };
  }
  if (verb === "data_view") {
    const rows = Array.isArray(r["rows"]) ? (r["rows"] as unknown[]).length : undefined;
    return { verb, arg: String(args["handle"] ?? ""), ret: rows !== undefined ? `${rows} rows` : "summary" };
  }
  // data_list
  const datasets = Array.isArray(r["datasets"]) ? (r["datasets"] as unknown[]).length : 0;
  const sources = Array.isArray(r["sources"]) ? (r["sources"] as unknown[]).length : 0;
  return { verb, arg: "", ret: `${sources} sources · ${datasets} datasets` };
}
