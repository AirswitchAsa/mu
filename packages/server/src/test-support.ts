import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// =============================================================================
// Test-only support for the gated live-agent suites (excluded from the dist build,
// like fake-driver.ts). No test bodies here — safe to import from a .test.ts without
// registering stray suites.
// =============================================================================

export interface SSEvent {
  type: string;
  [k: string]: unknown;
}

/**
 * Read a µ read-stream (GET /events) SSE response until a terminal `done`/`error`, then
 * close it. Parses `data:` frames, ignoring the `id:`/`retry:`/`:keepalive` lines the CQRS
 * stream interleaves.
 */
export async function readEvents(resp: Response): Promise<SSEvent[]> {
  const events: SSEvent[] = [];
  const reader = resp.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const frames = buf.split("\n\n");
      buf = frames.pop() ?? "";
      for (const f of frames) {
        const line = f.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const evt = JSON.parse(line.slice(5).trim()) as SSEvent;
        events.push(evt);
        if (evt.type === "done" || evt.type === "error") return events;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return events;
}

/**
 * Fire a turn (the COMMAND: POST /message) and drain its events from the read stream
 * (the QUERY: GET /events). Robust to the turn finishing before we connect — we replay
 * from the 202 ACK's `from` cursor, and the log retains the turn, so no event is missed
 * regardless of timing. This is the deterministic stand-in for what the web client does
 * (POST command + EventSource), exercising the real CQRS pathway end to end.
 */
export async function runTurn(baseUrl: string, id: string, text: string): Promise<SSEvent[]> {
  const ack = await fetch(`${baseUrl}/api/sessions/${id}/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!ack.ok) throw new Error(`turn command rejected: ${ack.status} ${await ack.text().catch(() => "")}`);
  const { from } = (await ack.json()) as { from: number };
  return readEvents(await fetch(`${baseUrl}/api/sessions/${id}/events?since=${from}`));
}

/**
 * Make the agent's model key reachable by the spawned `opencode serve`.
 *
 * µ now pins opencode's data home under `dataRoot` (so its sessions persist across a
 * restart), which means the user's `opencode auth login` — written to the DEFAULT
 * home's `auth.json` — is NOT visible to the relocated home. In production the key
 * therefore comes from the environment (the SDK spawns `serve` with `...process.env`,
 * so `DEEPSEEK_API_KEY` is inherited). This bridges the same thing for a LOCAL test
 * run: if `DEEPSEEK_API_KEY` isn't already set, lift it out of the default opencode
 * `auth.json` into `process.env` so the relocated home authenticates identically.
 *
 * Returns true once a key is available in the environment. In CI/Docker just set
 * `DEEPSEEK_API_KEY` and this is a no-op; if no key can be found the live suite skips.
 */
export function ensureAgentKey(provider = "deepseek", envVar = "DEEPSEEK_API_KEY"): boolean {
  if (process.env[envVar]) return true;
  try {
    // The login location, independent of any XDG_DATA_HOME a driver may have already
    // relocated in-process: `$XDG_DATA_HOME|~/.local/share`/opencode/auth.json.
    const base = process.env["XDG_DATA_HOME"] || join(homedir(), ".local", "share");
    const auth = JSON.parse(readFileSync(join(base, "opencode", "auth.json"), "utf8")) as Record<
      string,
      { type?: string; key?: string }
    >;
    const key = auth[provider]?.key;
    if (key) {
      process.env[envVar] = key;
      return true;
    }
  } catch {
    /* no auth.json / unreadable — fall through to "no key" */
  }
  return false;
}
