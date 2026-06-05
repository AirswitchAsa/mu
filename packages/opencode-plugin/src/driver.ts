import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk";
import { getPluginPath } from "./plugin-path.js";

export interface OpencodeDriverOptions {
  /** "provider/model", e.g. "deepseek/deepseek-chat". */
  model: string;
  /** the µ reverse-channel base URL the plugin's tools POST to. */
  callbackUrl: string;
  /** shared secret the plugin must present on the µ /internal callback. */
  callbackToken?: string;
  hostname?: string;
  port?: number;
  /** Per-turn deadline (ms). A `prompt` that exceeds it rejects with a
   *  `TurnTimeoutError` so the SSE stream always terminates instead of hanging
   *  the UI on "composing" forever. Default 180s; `0` disables. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 180_000;

/** Reject `p` if it doesn't settle within `ms`; the rejection's `name` is
 *  `TurnTimeoutError` so callers can map it to a clear error code. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const e = new Error(`agent turn timed out after ${Math.round(ms / 1000)}s`);
      e.name = "TurnTimeoutError";
      reject(e);
    }, ms);
    if (typeof timer.unref === "function") timer.unref();
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Parse "provider/model" into the prompt body's model shape. */
export function parseModel(model: string): { providerID: string; modelID: string } {
  const idx = model.indexOf("/");
  if (idx < 0) throw new Error(`model must be "provider/model", got '${model}'`);
  return { providerID: model.slice(0, idx), modelID: model.slice(idx + 1) };
}

/** Join the text parts of one message (ignoring tool/file/etc. parts). */
function textOfParts(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p): p is { type: string; text: string } => {
      const t = (p as { type?: unknown }).type;
      return t === "text" && typeof (p as { text?: unknown }).text === "string";
    })
    .map((p) => p.text)
    .join("");
}

function extractAssistantText(result: unknown): string {
  const data = (result as { data?: unknown }).data ?? result;
  const parts =
    (data as { parts?: unknown[] }).parts ??
    ((data as { info?: { parts?: unknown[] } }).info?.parts ?? []);
  return textOfParts(parts);
}

/**
 * OpencodeDriver — supervises a headless opencode and drives it over the SDK
 * (opencode-driver.dog.md). Spawns `opencode serve` with the µ plugin + model
 * configured; the plugin reaches µ via MU_CALLBACK_URL. opencode is a disposable
 * executor: µ binds a µ session to an opencode session id, but re-mints a fresh
 * one (reconcile-on-miss) whenever opencode has dropped it. Ids are no longer 1:1.
 */
export class OpencodeDriver {
  private constructor(
    private readonly server: { url: string; close(): void },
    private readonly client: ReturnType<typeof createOpencodeClient>,
    private readonly model: string,
    private readonly timeoutMs: number,
  ) {}

  static async start(opts: OpencodeDriverOptions): Promise<OpencodeDriver> {
    // The plugin (in opencode's process) reads these to find + authenticate to µ.
    process.env["MU_CALLBACK_URL"] = opts.callbackUrl;
    if (opts.callbackToken) process.env["MU_CALLBACK_TOKEN"] = opts.callbackToken;
    // Only set hostname/port when provided — passing `undefined` makes the SDK
    // spawn `serve --hostname=undefined --port=0`, which fails to bind.
    const serverOpts: Parameters<typeof createOpencodeServer>[0] = {
      config: {
        plugin: [getPluginPath()],
        model: opts.model,
        // µ runs the agent "yolo": it drives opencode headless over the SDK, so an
        // interactive approval prompt would only hang. Allow every gate.
        permission: {
          edit: "allow",
          bash: "allow",
          webfetch: "allow",
          doom_loop: "allow",
          external_directory: "allow",
        },
        // Confine the agent to µ's own verbs (the plugin tools). The built-in
        // filesystem/shell tools have no role in µ and only widen the blast radius,
        // so disable them — the agent works the canvas through µ, nothing else.
        tools: {
          bash: false,
          edit: false,
          write: false,
          read: false,
          glob: false,
          grep: false,
          list: false,
          patch: false,
          webfetch: false,
          todowrite: false,
          todoread: false,
          task: false,
        },
      },
    };
    if (opts.hostname !== undefined) serverOpts.hostname = opts.hostname;
    if (opts.port !== undefined) serverOpts.port = opts.port;
    const server = await createOpencodeServer(serverOpts);
    const client = createOpencodeClient({ baseUrl: server.url });
    return new OpencodeDriver(server, client, opts.model, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }

  get url(): string {
    return this.server.url;
  }

  async createSession(): Promise<string> {
    const result = await this.client.session.create({ body: {} });
    const id = (result as { data?: { id?: string } }).data?.id;
    if (!id) throw new Error(`session.create returned no id: ${JSON.stringify(result)}`);
    return id;
  }

  async deleteSession(id: string): Promise<void> {
    await this.client.session.delete({ path: { id } }).catch(() => undefined);
  }

  /**
   * Reconcile-on-miss probe: does opencode still know this session id? After a
   * µ restart (or an opencode restart) a µ session's recorded `opencodeSessionId`
   * may point at a session opencode has dropped — opencode is a disposable
   * executor and µ never depends on it persisting anything. Returns false on a
   * 404 / any error, so the caller treats "can't confirm" as "gone" and re-mints.
   */
  async sessionExists(id: string): Promise<boolean> {
    try {
      const result = await this.client.session.get({ path: { id } });
      // session.get resolves with `data` on a hit; a 404 throws (→ caught below).
      const data = (result as { data?: unknown }).data;
      return data != null;
    } catch {
      return false;
    }
  }

  /**
   * Cancel an in-flight turn (best-effort). Called when the client disconnects mid-SSE
   * so the agent stops working — and stops spending — instead of running to completion
   * against a dead socket.
   */
  async abort(id: string): Promise<void> {
    await this.client.session.abort({ path: { id } }).catch(() => undefined);
  }

  /**
   * opencode auto-generates a session `title` from the conversation (via its small
   * summary model). Surface it so µ can name the session for the user. Returns
   * undefined if unset/blank or the lookup fails — the caller keeps its own name.
   */
  async getSessionTitle(id: string): Promise<string | undefined> {
    try {
      const result = await this.client.session.get({ path: { id } });
      const title = (result as { data?: { title?: string } }).data?.title;
      return title && title.trim().length > 0 ? title.trim() : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Send a user message (command). `extraParts` carries the appended canvas summary
   * (inject_canvas_state). Returns the assistant's text for the WHOLE turn; canvas
   * ops the agent emits flow through the tool callback, not this return value (CQRS).
   *
   * `onDelta`, when given, fires for every prose/reasoning token the agent streams
   * (cumulative `text` per `partId`) so the server can relay live deltas. The final
   * return value (from `collectTurnText`) stays authoritative — deltas are a UX
   * nicety, not the source of truth, so a dropped frame never loses text.
   */
  async prompt(
    sessionId: string,
    text: string,
    extraParts: string[] = [],
    onDelta?: (d: { partId: string; kind: "text" | "reasoning"; text: string }) => void,
  ): Promise<string> {
    const parts = [text, ...extraParts].map((t) => ({ type: "text" as const, text: t }));
    // Stream tokens by tailing the opencode event bus for the duration of the turn.
    // Only started when a consumer wants deltas; otherwise the old request/poll path
    // is unchanged. The subscription is torn down in `finally` so it never outlives
    // the turn (timeout or abort included).
    const stream = onDelta ? this.streamDeltas(sessionId, onDelta) : undefined;
    try {
      const call = this.client.session.prompt({
        path: { id: sessionId },
        body: { parts, model: parseModel(this.model) },
      });
      const result = this.timeoutMs > 0 ? await withTimeout(call, this.timeoutMs) : await call;
      // `prompt` returns only the FINAL assistant message, but opencode emits a
      // separate message per step — text the agent wrote *before* a tool call lives
      // in an earlier message. Collect every assistant message in the turn so none of
      // it is dropped (the "later block overwrites the earlier" bug). Fall back to the
      // returned message if the listing is unavailable.
      return (await this.collectTurnText(sessionId)) || extractAssistantText(result);
    } finally {
      stream?.stop();
    }
  }

  /**
   * Tail the opencode event stream for one turn, forwarding cumulative text/reasoning
   * part updates to `onDelta`. The `/event` stream is GLOBAL (every session), so we
   * MUST filter by `sessionID` — and we MUST exclude the user message we just sent,
   * since its part is also a `text` part. We track message roles from `message.updated`
   * events (keyed by messageID) and only forward parts whose owning message is known
   * to be an assistant message. Returns a `stop()` that ends the generator (closing the
   * HTTP stream) so the subscription can't leak past the turn.
   */
  private streamDeltas(
    sessionId: string,
    onDelta: (d: { partId: string; kind: "text" | "reasoning"; text: string }) => void,
  ): { stop(): void } {
    let generator: AsyncGenerator<unknown> | undefined;
    let stopped = false;
    // messageID → role, learned from `message.updated`. A part is forwarded only once
    // its message is confirmed assistant; parts of the just-sent user message stay out.
    const role = new Map<string, string>();
    void (async () => {
      try {
        const sub = await this.client.event.subscribe();
        if (stopped) return; // stop() raced ahead of subscribe resolving
        generator = sub.stream as AsyncGenerator<unknown>;
        for await (const raw of generator) {
          // The stream yields the `Event` union; code defensively against `unknown`.
          const ev = raw as { type?: string; properties?: Record<string, unknown> };
          if (ev.type === "message.updated") {
            const info = ev.properties?.["info"] as { id?: string; sessionID?: string; role?: string } | undefined;
            if (info?.sessionID === sessionId && typeof info.id === "string" && typeof info.role === "string") {
              role.set(info.id, info.role);
            }
            continue;
          }
          if (ev.type !== "message.part.updated") continue;
          const part = ev.properties?.["part"] as
            | { id?: string; sessionID?: string; messageID?: string; type?: string; text?: string }
            | undefined;
          if (!part || part.sessionID !== sessionId) continue; // global stream → filter is mandatory
          if (part.type !== "text" && part.type !== "reasoning") continue;
          if (typeof part.id !== "string" || typeof part.text !== "string") continue;
          // Only forward assistant prose, never the user message we just sent. If the
          // role isn't known yet, skip (it'll arrive cumulatively on a later frame).
          if (role.get(String(part.messageID)) !== "assistant") continue;
          onDelta({ partId: part.id, kind: part.type, text: part.text });
        }
      } catch {
        // A torn-down stream (stop → generator.return) or a transient subscribe error
        // must never fail the turn; deltas are best-effort over the authoritative text.
      }
    })();
    return {
      stop: () => {
        stopped = true;
        // End the async generator → closes the underlying SSE connection. Best-effort.
        void generator?.return(undefined).catch(() => undefined);
      },
    };
  }

  /** Concatenate every assistant message produced after the last user message. */
  private async collectTurnText(sessionId: string): Promise<string> {
    try {
      const res = await this.client.session.messages({ path: { id: sessionId } });
      const items = ((res as { data?: unknown }).data ?? res) as Array<{ info?: { role?: string }; parts?: unknown }>;
      if (!Array.isArray(items)) return "";
      let lastUser = -1;
      items.forEach((m, i) => {
        if (m.info?.role === "user") lastUser = i;
      });
      return items
        .slice(lastUser + 1)
        .filter((m) => m.info?.role === "assistant")
        .map((m) => textOfParts(m.parts))
        .filter((t) => t.length > 0)
        .join("\n\n");
    } catch {
      return "";
    }
  }

  close(): void {
    this.server.close();
  }
}
