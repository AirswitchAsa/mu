import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { MuErrorException, traceFromOp, type CanvasOp, type TraceLine } from "@mu/protocol";
import { MuRuntime, buildPrimingText, type MuEvent } from "@mu/runtime";
import { OpencodeDriver } from "@mu/opencode-plugin";
import { coreRenderers } from "./core-renderers.js";

export interface MuServerOptions {
  /** root dir for the broker's shared store. */
  dataRoot: string;
  /** dir scanned for first-party resource plugins. */
  resourcesDir: string;
  /** "provider/model"; when set, the opencode driver is started and /message works. */
  model?: string;
  port?: number;
  hostname?: string;
  /** Per-turn deadline (ms) for the agent; see OpencodeDriverOptions.timeoutMs. */
  turnTimeoutMs?: number;
}

export interface MuServerHandle {
  url: string;
  runtime: MuRuntime;
  driver?: OpencodeDriver;
  /** shared secret required on the internal tool-callback endpoint. */
  internalToken: string;
  close(): Promise<void>;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", ...CORS });
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof MuErrorException) {
    sendJson(res, err.code === "HANDLE_NOT_FOUND" ? 404 : 400, { error: err.toMuError() });
    return;
  }
  sendJson(res, 500, { error: { code: "INTERNAL", message: err instanceof Error ? err.message : String(err) } });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new MuErrorException("VALIDATION_FAILED", "request body is not valid JSON");
  }
}

function listen(server: Server, port: number, hostname: string): Promise<void> {
  return new Promise((resolve) => server.listen(port, hostname, resolve));
}

/**
 * Boot the µ server (mu-server.dog.md): assemble the runtime (broker + resources +
 * renderers + sessions + tool surface), expose the HTTP/SSE API the web client
 * consumes plus the internal tool-callback the opencode plugin hits, and (when a
 * model is configured) supervise opencode. One process.
 */
export async function createMuServer(opts: MuServerOptions): Promise<MuServerHandle> {
  const runtime = await MuRuntime.create({
    dataRoot: opts.dataRoot,
    resourcesDir: opts.resourcesDir,
    renderers: coreRenderers,
  });
  let driver: OpencodeDriver | undefined;
  // Shared secret for the opencode plugin's tool callback. Any other local process —
  // or a browser page (CORS is open) — that POSTs /internal without it is rejected,
  // so it can't drive the canvas or hammer rate-limited upstreams as if it were the agent.
  const internalToken = randomUUID();
  // One in-flight agent turn per session: a second concurrent /message is refused
  // (409) rather than interleaving two turns' chat history and ops-traces.
  const turnsInFlight = new Set<string>();

  const httpServer = createServer((req, res) => {
    void handle(req, res).catch((err) => sendError(res, err));
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://localhost");
    const seg = url.pathname.split("/").filter(Boolean);

    if (method === "OPTIONS") {
      res.writeHead(204, CORS).end();
      return;
    }

    // --- internal: opencode plugin tool callback ---
    if (method === "POST" && seg[0] === "internal" && seg[1] === "tool" && seg[2]) {
      if (req.headers["x-mu-internal-token"] !== internalToken) {
        sendJson(res, 403, { error: { code: "FORBIDDEN", message: "internal endpoint requires the µ callback token" } });
        return;
      }
      const { sessionID, args } = await readJson(req);
      try {
        const ok = await runtime.handleToolCall(String(sessionID), seg[2], (args as Record<string, unknown>) ?? {});
        sendJson(res, 200, { ok });
      } catch (err) {
        const code = err instanceof MuErrorException ? err.code : "FETCH_FAILED";
        sendJson(res, 200, { error: { code, message: err instanceof Error ? err.message : String(err) } });
      }
      return;
    }

    if (seg[0] !== "api") {
      sendJson(res, 404, { error: { code: "NOT_FOUND", message: url.pathname } });
      return;
    }

    // --- public API ---
    // GET /api/renderers
    if (method === "GET" && seg[1] === "renderers") {
      sendJson(res, 200, { renderers: runtime.renderers.list() });
      return;
    }
    // GET /api/data/list
    if (method === "GET" && seg[1] === "data" && seg[2] === "list") {
      const out = await runtime.dataList({
        provider: url.searchParams.get("provider") ?? undefined,
        shape: url.searchParams.get("shape") ?? undefined,
        entity: url.searchParams.get("entity") ?? undefined,
      });
      sendJson(res, 200, out);
      return;
    }
    // GET /api/resolve?handle=...
    if (method === "GET" && seg[1] === "resolve") {
      const handleParam = url.searchParams.get("handle");
      if (!handleParam) {
        sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "missing ?handle" } });
        return;
      }
      const rows = await runtime.resolve(handleParam);
      sendJson(res, 200, { handle: handleParam, rows });
      return;
    }
    // POST /api/sessions
    if (method === "POST" && seg[1] === "sessions" && seg.length === 2) {
      // µ owns its identity: the µ id is ALWAYS a fresh uuid, never the opencode
      // id. When a driver exists we ALSO mint an opencode session as the
      // (disposable) executor and record it as `opencodeSessionId`; API-only
      // servers leave it undefined (resolveOpencodeId then falls back to the µ id).
      const id = randomUUID();
      const opencodeSessionId = driver ? await driver.createSession() : undefined;
      runtime.createSession(id, opencodeSessionId);
      sendJson(res, 201, { sessionId: id });
      return;
    }
    if (seg[1] === "sessions" && seg[2]) {
      const id = seg[2];
      // DELETE /api/sessions/:id
      if (method === "DELETE" && seg.length === 3) {
        // Tear down the BOUND opencode session (resolved µ-id → opencode-id), not
        // the µ id, which is no longer the opencode id.
        if (driver) await driver.deleteSession(runtime.resolveOpencodeId(id));
        runtime.deleteSession(id);
        sendJson(res, 200, { ok: true });
        return;
      }
      // GET /api/sessions/:id/canvas
      if (method === "GET" && seg[3] === "canvas") {
        sendJson(res, 200, runtime.getCanvasState(id));
        return;
      }
      // GET /api/sessions/:id/title  (opencode's auto-generated session title)
      if (method === "GET" && seg[3] === "title") {
        const title = driver ? await driver.getSessionTitle(runtime.resolveOpencodeId(id)) : undefined;
        sendJson(res, 200, { title: title ?? null });
        return;
      }
      // GET /api/sessions/:id/messages  (chat history, for reload-restore)
      if (method === "GET" && seg[3] === "messages") {
        sendJson(res, 200, { messages: runtime.sessions.require(id).messages });
        return;
      }
      // POST /api/sessions/:id/canvas/ops  (user layout/content edits)
      if (method === "POST" && seg[3] === "canvas" && seg[4] === "ops") {
        const { ops } = await readJson(req);
        const summary = runtime.applyUserOps(id, (ops as CanvasOp[]) ?? []);
        sendJson(res, 200, { summary });
        return;
      }
      // POST /api/sessions/:id/refresh  (manual re-acquire of bound handles)
      if (method === "POST" && seg[3] === "refresh") {
        const { handles } = await readJson(req);
        const out = await runtime.refreshSession(id, Array.isArray(handles) ? (handles as string[]) : undefined);
        sendJson(res, 200, out);
        return;
      }
      // POST /api/sessions/:id/message  (SSE)
      if (method === "POST" && seg[3] === "message") {
        await handleMessage(id, await readJson(req), res);
        return;
      }
    }

    sendJson(res, 404, { error: { code: "NOT_FOUND", message: url.pathname } });
  }

  async function handleMessage(id: string, body: Record<string, unknown>, res: ServerResponse): Promise<void> {
    if (!driver) {
      sendJson(res, 400, { error: { code: "NO_DRIVER", message: "server started without a model; /message disabled" } });
      return;
    }
    if (turnsInFlight.has(id)) {
      sendJson(res, 409, { error: { code: "BUSY", message: "a turn is already in progress for this session" } });
      return;
    }
    turnsInFlight.add(id);
    const activeDriver = driver;
    const text = String(body["text"] ?? "");
    // --- reconcile-on-miss (Workstream 3) -----------------------------------
    // µ is the authoritative record; opencode is a disposable executor. Resolve
    // the µ session's bound opencode id and confirm opencode still knows it. If
    // it's missing (API-only session that grew a driver, or a sidecar rehydrated
    // after opencode dropped the session), mint a FRESH opencode session, rebind
    // + persist, and prime it with the stored transcript so the agent has the
    // prior dialogue. Best-effort: a failed prime must not block the turn. Canvas
    // state needs no replay — inject_canvas_state re-injects it every turn below.
    // (Localized block; the streaming loop further down is untouched.)
    let opencodeId = runtime.resolveOpencodeId(id);
    const hadBinding = Boolean(runtime.sessions.get(id)?.opencodeSessionId);
    let primingText: string | undefined;
    if (!hadBinding || !(await activeDriver.sessionExists(opencodeId))) {
      opencodeId = await activeDriver.createSession();
      runtime.bindOpencodeSession(id, opencodeId);
      // Only prime when there's prior dialogue to carry across the re-mint.
      primingText = buildPrimingText(runtime.sessions.require(id).messages);
    }
    // ------------------------------------------------------------------------
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      ...CORS,
    });
    // Accumulate the turn's ops-trace as it streams, so we can persist it on the
    // assistant message — otherwise the trace (a live-only SSE artifact) is lost
    // on reload. Mirrors exactly what the client builds from the same events.
    const ops: TraceLine[] = [];
    let settled = false; // the turn finished normally → ignore the end-of-stream close
    let aborted = false; // the client went away mid-turn → stop writing + cancel the agent
    const send = (event: MuEvent): void => {
      if (aborted) return;
      if (event.type === "tool") ops.push({ verb: event.verb, arg: event.arg, ret: event.ret });
      else if (event.type === "canvas") ops.push(traceFromOp(event.op));
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const unsubscribe = runtime.subscribe(id, send);
    // Client disconnect (tab close, navigation, network drop): unsubscribe and cancel
    // the agent turn so it stops working — and stops spending — against a dead socket.
    res.on("close", () => {
      if (settled || aborted) return;
      aborted = true;
      unsubscribe();
      void activeDriver.abort(opencodeId);
    });
    try {
      // Re-`require` the session at each push: a canvas op during the turn replaces
      // the stored SessionState (clone-then-commit), so a reference captured earlier
      // goes stale and writes to it would be dropped from the store (lost on reload).
      runtime.sessions.require(id).messages.push({ role: "user", text, at: Date.now() });
      runtime.sessions.persist(id);
      // inject_canvas_state: the cheap summary rides along as an extra prompt part.
      const summary = runtime.canvasSummary(id);
      const extraParts = [`\n\n[µ canvas state] ${JSON.stringify(summary)}`];
      // After a reconcile re-mint, replay the prior transcript on THIS first
      // prompt so the fresh opencode session has conversational context.
      if (primingText) extraParts.push(`\n\n${primingText}`);
      // Drive the BOUND opencode session (post-reconcile), not the µ id.
      const reply = await activeDriver.prompt(opencodeId, text, extraParts);
      if (aborted) return; // client gone — don't record/publish a turn nobody is listening to
      runtime.sessions.require(id).messages.push({ role: "assistant", text: reply, at: Date.now(), ops: [...ops] });
      runtime.sessions.persist(id);
      runtime.publish(id, { type: "chat", role: "assistant", text: reply });
      runtime.publish(id, { type: "done" });
    } catch (err) {
      if (!aborted) {
        const code =
          err instanceof MuErrorException ? err.code : err instanceof Error && err.name === "TurnTimeoutError" ? "TIMEOUT" : "FETCH_FAILED";
        runtime.publish(id, { type: "error", error: { code, message: err instanceof Error ? err.message : String(err) } });
      }
    } finally {
      settled = true;
      turnsInFlight.delete(id);
      unsubscribe();
      if (!res.writableEnded) res.end();
    }
  }

  await listen(httpServer, opts.port ?? 0, opts.hostname ?? "127.0.0.1");
  const addr = httpServer.address();
  const port = typeof addr === "object" && addr ? addr.port : opts.port ?? 0;
  const url = `http://127.0.0.1:${port}`;

  if (opts.model) {
    // The plugin's tools call back to this same server's /internal endpoint, presenting
    // `internalToken` as the shared secret.
    driver = await OpencodeDriver.start({
      model: opts.model,
      callbackUrl: url,
      callbackToken: internalToken,
      timeoutMs: opts.turnTimeoutMs,
    });
  }

  return {
    url,
    runtime,
    driver,
    internalToken,
    close: async () => {
      driver?.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
