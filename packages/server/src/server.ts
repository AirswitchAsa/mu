import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve as resolvePath, sep } from "node:path";
import { MuErrorException, traceFromOp, emptyTimeline, applyTimelineEvent, type CanvasOp, type TraceLine } from "@mu/protocol";
import { MuRuntime, buildPrimingText, type MuEvent } from "@mu/runtime";
import { OpencodeDriver, type MuDriver } from "@mu/opencode-plugin";
import { coreRenderers } from "./core-renderers.js";

export interface MuServerOptions {
  /** root dir for the broker's shared store. */
  dataRoot: string;
  /** dir scanned for first-party resource plugins. */
  resourcesDir: string;
  /** "provider/model" (e.g. deepseek/deepseek-chat); when set, the opencode driver is
   *  started and /message works. The provider's key comes from `<PROVIDER>_API_KEY`. */
  model?: string;
  port?: number;
  hostname?: string;
  /** Per-turn deadline (ms) for the agent; see OpencodeDriverOptions.timeoutMs. */
  turnTimeoutMs?: number;
  /**
   * Where opencode keeps its own session/message storage (its `XDG_DATA_HOME`). Defaults
   * to `dataRoot`, so opencode data lands at `<dataRoot>/opencode/…` right beside the µ
   * session sidecars (`<dataRoot>/_sessions`) and the broker store — one `dataRoot`
   * relocates all µ state together (e.g. a canonical volume in the Docker image). Pinning
   * it is what lets opencode sessions resume after a `serve` restart instead of always
   * re-minting via reconcile-on-miss.
   */
  opencodeDataHome?: string;
  /** Stable opencode project the sessions are filed under; defaults to `dataRoot`. See
   *  OpencodeDriverOptions.projectDir. */
  opencodeProjectDir?: string;
  /**
   * Serve a built web client (the `packages/web/dist` directory) as static files at `/`,
   * with SPA fallback to `index.html`. Set in the Docker image (MU_WEB_DIR) so one process
   * serves both the API and the UI same-origin — the client then talks to a relative `/api`
   * and needs no CORS. Omitted in dev (Vite serves the web on :5173 against this API).
   */
  webDir?: string;
  /**
   * Inject the agent driver instead of starting opencode (tests). Receives the same
   * callback url + token the real plugin uses, so a fake can hit `/internal` exactly
   * as the agent does — exercising the whole turn pathway with no live LLM. Takes
   * precedence over `model`.
   */
  driverFactory?: (ctx: { callbackUrl: string; callbackToken: string; timeoutMs?: number }) => MuDriver | Promise<MuDriver>;
}

export interface MuServerHandle {
  url: string;
  runtime: MuRuntime;
  driver?: MuDriver;
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

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

/**
 * Serve `webDir` as a static SPA: stream the requested file if it resolves to a real file
 * inside `webDir`, otherwise fall back to `index.html` (client-side routing). Returns false
 * only if `index.html` itself is missing (misbuilt image) so the caller can 404 honestly.
 * Path traversal is blocked by confining the resolved path to `webDir`.
 */
async function serveStatic(webDir: string, pathname: string, res: ServerResponse): Promise<boolean> {
  const root = resolvePath(webDir);
  const indexHtml = join(root, "index.html");
  // Decode + normalize the request path, then confine it under root. Anything that escapes
  // (…/.. tricks) or that doesn't resolve to a real file degrades to the SPA index.
  let target = indexHtml;
  try {
    const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.(\/|\\|$))+/, "");
    const candidate = join(root, rel);
    if ((candidate === root || candidate.startsWith(root + sep)) && pathname !== "/") {
      const s = await stat(candidate).catch(() => undefined);
      if (s?.isFile()) target = candidate;
    }
  } catch {
    /* malformed URI → serve the index */
  }
  const ext = extname(target).toLowerCase();
  const type = CONTENT_TYPES[ext] ?? "application/octet-stream";
  // Hashed build assets are immutable; the HTML entrypoint must always re-validate so a
  // redeploy is picked up. (Vite emits content-hashed names under /assets.)
  const cacheControl =
    target === indexHtml ? "no-cache" : ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable";
  const exists = await stat(target).then((s) => s.isFile()).catch(() => false);
  if (!exists) return false; // not even index.html — misbuilt webDir
  res.writeHead(200, { "content-type": type, "cache-control": cacheControl });
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(target);
    stream.on("error", reject);
    stream.on("end", () => resolve());
    stream.pipe(res);
  });
  return true;
}

/** The env var opencode reads a provider's key from, by convention: `<PROVIDER>_API_KEY`
 *  (e.g. `deepseek` → `DEEPSEEK_API_KEY`). */
export function providerKeyEnvVar(model: string): string {
  return `${model.slice(0, model.indexOf("/")).toUpperCase().replace(/-/g, "_")}_API_KEY`;
}

/**
 * Fail-fast agent-config check, run at boot before opencode is started (a half-configured
 * agent should refuse to boot, not die on the first turn or silently fall back to
 * API-only). Verifies the model is `provider/model` AND the provider's key env var is set.
 * Throws a clear, actionable Error.
 */
export function assertAgentConfigured(model: string): void {
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) {
    throw new Error(`agent model must be "provider/model" (e.g. deepseek/deepseek-chat), got '${model}'`);
  }
  const provider = model.slice(0, slash);
  const keyVar = providerKeyEnvVar(model);
  if (!process.env[keyVar]) {
    throw new Error(
      `agent model '${model}' is set but its provider key '${keyVar}' is empty. Set ${keyVar} in .env.`,
    );
  }
}

/**
 * Boot the µ server (mu-server.dog.md): assemble the runtime (broker + resources +
 * renderers + sessions + tool surface), expose the HTTP/SSE API the web client
 * consumes plus the internal tool-callback the opencode plugin hits, and (when a
 * model is configured) supervise opencode. One process.
 */
export async function createMuServer(opts: MuServerOptions): Promise<MuServerHandle> {
  // Fail fast on a misconfigured agent BEFORE allocating the runtime/server — a half-set
  // agent should never boot. Skipped when a `driverFactory` (tests) supplies a fake agent.
  const model = opts.model;
  if (!opts.driverFactory && model) assertAgentConfigured(model);

  const runtime = await MuRuntime.create({
    dataRoot: opts.dataRoot,
    resourcesDir: opts.resourcesDir,
    renderers: coreRenderers,
  });
  let driver: MuDriver | undefined;
  // Shared secret for the opencode plugin's tool callback. Any other local process —
  // or a browser page (CORS is open) — that POSTs /internal without it is rejected,
  // so it can't drive the canvas or hammer rate-limited upstreams as if it were the agent.
  const internalToken = randomUUID();
  // The in-flight agent turn per session (at most one — a second /message is refused
  // 409). The turn runs DETACHED from any HTTP socket: it appends events to the
  // runtime's per-session log, and readers (GET /events) replay + tail that log. So a
  // browser refresh or a second device never starts, stops, or duplicates a turn —
  // they just (re)attach to the stream. `from` is the stream head when the turn began,
  // so a fresh reader replays the WHOLE turn; `cancelled` lets /cancel short-circuit.
  interface TurnState {
    from: number;
    opencodeId: string;
    cancelled: boolean;
  }
  const turns = new Map<string, TurnState>();

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
        // The agent runs in the opencode session, so its callbacks carry the opencode
        // id; sessions are keyed by µ id. Translate before dispatch (no-op for the
        // legacy 1:1 / API-only case where the two ids coincide).
        const muId = runtime.muIdForOpencode(String(sessionID));
        const ok = await runtime.handleToolCall(muId, seg[2], (args as Record<string, unknown>) ?? {});
        sendJson(res, 200, { ok });
      } catch (err) {
        const code = err instanceof MuErrorException ? err.code : "FETCH_FAILED";
        sendJson(res, 200, { error: { code, message: err instanceof Error ? err.message : String(err) } });
      }
      return;
    }

    if (seg[0] !== "api") {
      // Non-API path. When a built web client is mounted (Docker image), serve it as a
      // static SPA; the API stays on /api so the client is same-origin. `/internal` was
      // already handled above. In dev (no webDir) every non-API path is a 404.
      if (opts.webDir && (method === "GET" || method === "HEAD") && seg[0] !== "internal") {
        const served = await serveStatic(opts.webDir, url.pathname, res).catch(() => false);
        if (served) return;
      }
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
      // GET /api/sessions/:id/events  (CQRS read stream: SSE, replay + live tail)
      if (method === "GET" && seg[3] === "events") {
        streamEvents(id, url, req, res);
        return;
      }
      // POST /api/sessions/:id/message  (command: start a turn; runs detached, ACK 202)
      if (method === "POST" && seg[3] === "message") {
        await startTurn(id, await readJson(req), res);
        return;
      }
      // POST /api/sessions/:id/cancel  (command: stop the in-flight turn)
      if (method === "POST" && seg[3] === "cancel") {
        cancelTurn(id, res);
        return;
      }
    }

    sendJson(res, 404, { error: { code: "NOT_FOUND", message: url.pathname } });
  }

  // --- command: start a turn (POST /message) ------------------------------------
  // Validates + reconciles, marks the turn in flight, broadcasts the user prompt, ACKs
  // 202, and runs the turn DETACHED (runTurn). The HTTP request that triggered it owns
  // nothing — the turn streams into the event log regardless of who is (or isn't) reading.
  async function startTurn(id: string, body: Record<string, unknown>, res: ServerResponse): Promise<void> {
    if (!driver) {
      sendJson(res, 400, { error: { code: "NO_DRIVER", message: "server started without a model; /message disabled" } });
      return;
    }
    if (turns.has(id)) {
      sendJson(res, 409, { error: { code: "BUSY", message: "a turn is already in progress for this session" } });
      return;
    }
    const text = String(body["text"] ?? "");
    // --- reconcile-on-miss (Workstream 3) -----------------------------------
    // µ is the authoritative record; opencode is a disposable executor. Resolve the bound
    // opencode id and confirm opencode still knows it; if it's gone, mint a fresh session,
    // rebind + persist, and prime it with the stored transcript so the agent keeps context.
    let opencodeId = runtime.resolveOpencodeId(id);
    const hadBinding = Boolean(runtime.sessions.get(id)?.opencodeSessionId);
    let primingText: string | undefined;
    if (!hadBinding || !(await driver.sessionExists(opencodeId))) {
      opencodeId = await driver.createSession();
      runtime.bindOpencodeSession(id, opencodeId);
      primingText = buildPrimingText(runtime.sessions.require(id).messages);
    }
    // Record the turn at the PRE-turn stream head, so a reader that (re)connects fresh
    // replays from here and sees the whole turn from its first event.
    const turn: TurnState = { from: runtime.streamHead(id), opencodeId, cancelled: false };
    turns.set(id, turn);
    // The prompt is part of the live turn: broadcast it so every connected device shows
    // the bubble. It is persisted to the transcript only at turn END (in runTurn), so an
    // in-flight prompt lives solely in the event log — getMessages never double-counts it
    // against the replay a refreshing/just-joined client gets.
    runtime.publish(id, { type: "chat", role: "user", text });
    sendJson(res, 202, { from: turn.from });
    void runTurn(id, text, primingText, turn);
  }

  // The detached turn worker: drives opencode, streaming events into the log; persists the
  // completed turn to the transcript. Bound to no socket, so a refresh/disconnect can't
  // abort or duplicate it — only an explicit /cancel (turn.cancelled) stops it early.
  async function runTurn(id: string, text: string, primingText: string | undefined, turn: TurnState): Promise<void> {
    const activeDriver = driver!;
    // Rebuild the interleaved timeline + ops-trace from the SAME log the client reads (we
    // subscribe to our own stream), so the persisted assistant message renders identically
    // to the live stream (live≡reload) without a second, divergent fold.
    const timeline = emptyTimeline();
    const ops: TraceLine[] = [];
    const unsubscribe = runtime.subscribeFrom(id, turn.from, ({ event }) => {
      if (event.type === "tool") ops.push({ verb: event.verb, arg: event.arg, ret: event.ret });
      else if (event.type === "canvas") ops.push(traceFromOp(event.op));
      applyTimelineEvent(timeline, event);
    });
    const timelineText = (): string => timeline.items.flatMap((it) => (it.kind === "text" ? [it.text] : [])).join("\n\n");
    const pushUser = (): void => {
      runtime.sessions.require(id).messages.push({ role: "user", text, at: Date.now() });
    };
    const pushAssistant = (t: string): void => {
      runtime.sessions.require(id).messages.push({
        role: "assistant",
        text: t,
        at: Date.now(),
        ops: [...ops],
        ...(timeline.items.length ? { items: [...timeline.items] } : {}),
      });
    };
    try {
      const summary = runtime.canvasSummary(id);
      const extraParts = [`\n\n[µ canvas state] ${JSON.stringify(summary)}`];
      if (primingText) extraParts.push(`\n\n${primingText}`);
      // Drive the BOUND opencode session. onDelta publishes each cumulative prose/reasoning
      // part into the log as a chat_delta; the read stream relays it the instant it lands.
      const reply = await activeDriver.prompt(
        turn.opencodeId,
        text,
        extraParts,
        (d) => runtime.publish(id, { type: "chat_delta", partId: d.partId, kind: d.kind, text: d.text }),
      );
      // Persist user + assistant TOGETHER at the end (completed-turns-only transcript).
      pushUser();
      if (turn.cancelled) {
        pushAssistant(reply.trim() ? reply : timelineText());
        runtime.sessions.persist(id);
        runtime.publish(id, { type: "error", error: { code: "STOPPED", message: "stopped by user" } });
      } else {
        pushAssistant(reply);
        runtime.sessions.persist(id);
        runtime.publish(id, { type: "chat", role: "assistant", text: reply });
        runtime.publish(id, { type: "done" });
      }
    } catch (err) {
      pushUser(); // record the prompt even on a failed/stopped turn (matches prior behavior)
      if (turn.cancelled) {
        pushAssistant(timelineText());
        runtime.sessions.persist(id);
        runtime.publish(id, { type: "error", error: { code: "STOPPED", message: "stopped by user" } });
      } else {
        runtime.sessions.persist(id);
        const code =
          err instanceof MuErrorException ? err.code : err instanceof Error && err.name === "TurnTimeoutError" ? "TIMEOUT" : "FETCH_FAILED";
        runtime.publish(id, { type: "error", error: { code, message: err instanceof Error ? err.message : String(err) } });
      }
    } finally {
      unsubscribe();
      turns.delete(id);
    }
  }

  // --- query: the read stream (GET /events) -------------------------------------
  // SSE that replays the log from a cursor then tails it live — the property that makes a
  // refresh rejoin a running turn and a second device mirror it. Owns NO turn: closing it
  // (refresh, tab close) never aborts the agent.
  function streamEvents(id: string, url: URL, req: IncomingMessage, res: ServerResponse): void {
    // Cursor precedence: explicit ?since, else the SSE auto-reconnect header
    // (Last-Event-ID), else a FRESH connect → the active turn's `from` (rejoin the running
    // turn from its first event) or the head (idle: only new events; completed turns come
    // from getMessages, never replayed here → no double render).
    const cursor = url.searchParams.get("since") ?? (req.headers["last-event-id"] as string | undefined);
    const active = turns.get(id);
    const sinceRaw = cursor != null && cursor !== "" ? Number(cursor) : active ? active.from : runtime.streamHead(id);
    const since = Number.isFinite(sinceRaw) ? sinceRaw : 0;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      ...CORS,
    });
    res.write("retry: 1000\n\n"); // browser auto-reconnect backoff hint
    const unsubscribe = runtime.subscribeFrom(id, since, ({ seq, event }) => {
      if (!res.writableEnded) res.write(`id: ${seq}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    // Keepalive so an idle stream (no turn running) isn't dropped by a proxy/timeout.
    const keepalive = setInterval(() => {
      if (!res.writableEnded) res.write(":ka\n\n");
    }, 15_000);
    res.on("close", () => {
      clearInterval(keepalive);
      unsubscribe();
    });
  }

  // --- command: cancel the in-flight turn (POST /cancel) ------------------------
  function cancelTurn(id: string, res: ServerResponse): void {
    const turn = turns.get(id);
    if (turn) {
      turn.cancelled = true;
      void driver?.abort(turn.opencodeId);
    }
    sendJson(res, 200, { ok: true, cancelled: Boolean(turn) });
  }

  await listen(httpServer, opts.port ?? 0, opts.hostname ?? "127.0.0.1");
  const addr = httpServer.address();
  const port = typeof addr === "object" && addr ? addr.port : opts.port ?? 0;
  const url = `http://127.0.0.1:${port}`;

  // The driver's tools call back to this same server's /internal endpoint, presenting
  // `internalToken` as the shared secret. An injected `driverFactory` (tests) takes
  // precedence over starting opencode, so the turn pathway runs with a fake agent.
  // (`model` was resolved + validated at the top of this function.)
  if (opts.driverFactory) {
    driver = await opts.driverFactory({ callbackUrl: url, callbackToken: internalToken, timeoutMs: opts.turnTimeoutMs });
  } else if (model) {
    driver = await OpencodeDriver.start({
      model,
      callbackUrl: url,
      callbackToken: internalToken,
      timeoutMs: opts.turnTimeoutMs,
      // Keep opencode's storage under `dataRoot` (overridable) so its sessions persist
      // and resume across a `serve` restart; reconcile-on-miss stays the fallback.
      dataHome: opts.opencodeDataHome ?? opts.dataRoot,
      projectDir: opts.opencodeProjectDir ?? opts.dataRoot,
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
