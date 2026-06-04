import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk";
import { getPluginPath } from "./plugin-path.js";

export interface OpencodeDriverOptions {
  /** "provider/model", e.g. "deepseek/deepseek-chat". */
  model: string;
  /** the µ reverse-channel base URL the plugin's tools POST to. */
  callbackUrl: string;
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

function extractAssistantText(result: unknown): string {
  const data = (result as { data?: unknown }).data ?? result;
  const parts =
    (data as { parts?: unknown[] }).parts ??
    ((data as { info?: { parts?: unknown[] } }).info?.parts ?? []);
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p): p is { type: string; text: string } => {
      const t = (p as { type?: unknown }).type;
      return t === "text" && typeof (p as { text?: unknown }).text === "string";
    })
    .map((p) => p.text)
    .join("");
}

/**
 * OpencodeDriver — supervises a headless opencode and drives it over the SDK
 * (opencode-driver.dog.md). Spawns `opencode serve` with the µ plugin + model
 * configured; the plugin reaches µ via MU_CALLBACK_URL. One opencode session per
 * µ session (ids shared 1:1).
 */
export class OpencodeDriver {
  private constructor(
    private readonly server: { url: string; close(): void },
    private readonly client: ReturnType<typeof createOpencodeClient>,
    private readonly model: string,
    private readonly timeoutMs: number,
  ) {}

  static async start(opts: OpencodeDriverOptions): Promise<OpencodeDriver> {
    // The plugin (in opencode's process) reads this to find the µ endpoint.
    process.env["MU_CALLBACK_URL"] = opts.callbackUrl;
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
   * Send a user message (command). `extraParts` carries the appended canvas summary
   * (inject_canvas_state). Returns the assistant's final text; canvas ops the agent
   * emits flow through the tool callback, not this return value (CQRS).
   */
  async prompt(sessionId: string, text: string, extraParts: string[] = []): Promise<string> {
    const parts = [text, ...extraParts].map((t) => ({ type: "text" as const, text: t }));
    const call = this.client.session.prompt({
      path: { id: sessionId },
      body: { parts, model: parseModel(this.model) },
    });
    const result = this.timeoutMs > 0 ? await withTimeout(call, this.timeoutMs) : await call;
    return extractAssistantText(result);
  }

  close(): void {
    this.server.close();
  }
}
