import { createServer } from "node:http";
import { MuErrorException } from "@mu/protocol";

/**
 * The µ-side reverse channel. opencode's plugin runs in opencode's Bun process,
 * so its tool `execute` cannot call into µ in-process — it POSTs to this tiny
 * localhost endpoint, which dispatches to real µ logic (broker/coordinator).
 * This is the "two links" seam: µ→opencode over the SDK, opencode-plugin→µ here.
 */

export interface ToolCall {
  tool: string;
  sessionID: string;
  args: Record<string, unknown>;
}

export type ToolHandler = (args: Record<string, unknown>, sessionID: string) => Promise<unknown>;

export interface MuEndpoint {
  url: string;
  /** every tool call received — the ground-truth that the agent drove a µ tool. */
  readonly calls: ToolCall[];
  close(): Promise<void>;
}

export async function startMuEndpoint(handlers: Record<string, ToolHandler>): Promise<MuEndpoint> {
  const calls: ToolCall[] = [];

  const server = createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/tool/")) {
      res.writeHead(404).end();
      return;
    }
    const name = decodeURIComponent(req.url.slice("/tool/".length));
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      void (async () => {
        const reply = (obj: unknown) =>
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(obj));
        try {
          const parsed = body ? (JSON.parse(body) as { sessionID?: string; args?: Record<string, unknown> }) : {};
          const sessionID = parsed.sessionID ?? "";
          const args = parsed.args ?? {};
          calls.push({ tool: name, sessionID, args });
          const handler = handlers[name];
          if (!handler) {
            reply({ error: { code: "UNKNOWN_TOOL", message: `no µ handler for '${name}'` } });
            return;
          }
          reply({ ok: await handler(args, sessionID) });
        } catch (err) {
          // typed errors pass their code through; everything else is FETCH_FAILED.
          const code = err instanceof MuErrorException ? err.code : "FETCH_FAILED";
          const message = err instanceof Error ? err.message : String(err);
          reply({ error: { code, message } });
        }
      })();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
