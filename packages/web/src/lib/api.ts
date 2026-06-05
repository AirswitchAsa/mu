import type { CanvasOp, CanvasState, ChatMessage, RendererManifest } from "@mu/protocol";
import type { DataRow, MuStreamEvent } from "./types";

// =============================================================================
// µ — backend client. The contract is docs/backend-api.md (REST + SSE, CORS-open).
// The SSE decoder is split out as a pure function so it's unit-testable without
// a network or a browser.
// =============================================================================

// API origin. Build-time `VITE_MU_API` wins; UNSET → dev default (Vite :5173 → API :4000);
// set EMPTY (`VITE_MU_API=`) → same-origin relative `/api` (the single-image Docker build,
// where the µ server serves this bundle and the API off one origin — empty isn't nullish so
// `?? default` keeps it).
const BASE: string =
  (import.meta.env?.VITE_MU_API as string | undefined)?.replace(/\/$/, "") ?? "http://127.0.0.1:4000";

async function jsonOf<T>(resp: Response): Promise<T> {
  const body = (await resp.json()) as T & { error?: { code: string; message: string } };
  if (body && typeof body === "object" && "error" in body && body.error) {
    throw new Error(`${body.error.code}: ${body.error.message}`);
  }
  return body as T;
}

export async function createSession(): Promise<string> {
  const r = await fetch(`${BASE}/api/sessions`, { method: "POST" });
  return (await jsonOf<{ sessionId: string }>(r)).sessionId;
}

export async function deleteSession(id: string): Promise<void> {
  await fetch(`${BASE}/api/sessions/${id}`, { method: "DELETE" });
}

export async function getCanvas(id: string): Promise<CanvasState> {
  return jsonOf<CanvasState>(await fetch(`${BASE}/api/sessions/${id}/canvas`));
}

/** Stored chat history for a session (reload-restore; in-memory server-side). */
export async function getMessages(id: string): Promise<ChatMessage[]> {
  return (await jsonOf<{ messages: ChatMessage[] }>(await fetch(`${BASE}/api/sessions/${id}/messages`))).messages;
}

/** opencode's auto-generated session title (undefined if unset / no driver). */
export async function sessionTitle(id: string): Promise<string | undefined> {
  try {
    const r = await fetch(`${BASE}/api/sessions/${id}/title`);
    if (!r.ok) return undefined;
    const { title } = (await r.json()) as { title?: string | null };
    return title ?? undefined;
  } catch {
    return undefined;
  }
}

export async function listRenderers(): Promise<RendererManifest[]> {
  return (await jsonOf<{ renderers: RendererManifest[] }>(await fetch(`${BASE}/api/renderers`))).renderers;
}

/** Full data for a renderer (server-side, unguarded). Rows are shape-specific. */
export async function resolveHandle(handle: string): Promise<DataRow[]> {
  const r = await fetch(`${BASE}/api/resolve?handle=${encodeURIComponent(handle)}`);
  return (await jsonOf<{ handle: string; rows: DataRow[] }>(r)).rows;
}

/**
 * Manually re-acquire bound handles from their sources (the global refresh). With
 * no `handles`, the server refreshes every data-backed handle in the session.
 * Returns which handles were refreshed so the client re-resolves exactly those.
 */
export async function refreshSession(
  id: string,
  handles?: string[],
): Promise<{ refreshed: string[]; errors: { handle: string; code?: string; message: string }[] }> {
  const r = await fetch(`${BASE}/api/sessions/${id}/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(handles ? { handles } : {}),
  });
  return jsonOf<{ refreshed: string[]; errors: { handle: string; code?: string; message: string }[] }>(r);
}

/** User layout/content edits (move/resize/...). The server stays authoritative. */
export async function postUserOps(id: string, ops: CanvasOp[]): Promise<void> {
  await fetch(`${BASE}/api/sessions/${id}/canvas/ops`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ops }),
  });
}

/**
 * Start a turn (COMMAND). Resolves on the server's 202 ACK; the turn runs detached and
 * its events arrive on the session's read stream ({@link openEvents}), NOT here. Throws on
 * NO_DRIVER / BUSY / transport error so the caller can surface it. The user's prompt is
 * echoed back as a `chat` event on the stream, so we deliberately do NOT optimistically
 * render it here — every device (including this one) shows it from the one event source.
 */
export async function sendMessage(id: string, text: string): Promise<void> {
  const resp = await fetch(`${BASE}/api/sessions/${id}/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    let message = `message request failed (${resp.status})`;
    try {
      const parsed = JSON.parse(detail) as { error?: { code?: string; message?: string } };
      if (parsed.error) message = `${parsed.error.code ?? "ERROR"}: ${parsed.error.message ?? message}`;
    } catch {
      if (detail) message = detail;
    }
    throw new Error(message);
  }
}

/** Stop the in-flight turn (COMMAND). Best-effort; the stream delivers the STOPPED event. */
export async function cancelTurn(id: string): Promise<void> {
  await fetch(`${BASE}/api/sessions/${id}/cancel`, { method: "POST" }).catch(() => undefined);
}

/**
 * Open the session's read stream (QUERY) and call `onEvent` for each event as it lands.
 * This is the ONLY live channel: commands ({@link sendMessage}/{@link cancelTurn}) just
 * write to the log, and every reader tails it here. The browser's EventSource auto-
 * reconnects carrying Last-Event-ID, so a transient drop resumes with no gap; a full page
 * reload reconnects fresh and the server replays the in-flight turn from its start (so a
 * refresh mid-generation rejoins it). A second device opening the same stream mirrors it.
 * Returns a closer.
 */
export function openEvents(id: string, onEvent: (e: MuStreamEvent) => void): () => void {
  const es = new EventSource(`${BASE}/api/sessions/${id}/events`);
  es.onmessage = (m): void => {
    try {
      onEvent(JSON.parse(m.data) as MuStreamEvent);
    } catch {
      /* skip a malformed frame rather than break the stream */
    }
  };
  // onerror is expected on reconnect cycles; EventSource retries on its own, so we let it.
  return () => es.close();
}

/**
 * Pure SSE decoder: pull every COMPLETE event out of a buffer, returning the parsed
 * events plus the unconsumed remainder. Events are framed by a blank line (`\n\n`);
 * the trailing partial frame stays in `rest`. Per the SSE spec, multiple `data:`
 * lines in one frame are concatenated with `\n` before parsing (so a large payload
 * split across lines decodes correctly, not just the first line).
 */
export function decodeSSE(buffer: string): { events: unknown[]; rest: string } {
  const frames = buffer.split("\n\n");
  const rest = frames.pop() ?? "";
  const events: unknown[] = [];
  for (const frame of frames) {
    const payload = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, "")) // strip one optional leading space
      .join("\n");
    if (!payload) continue;
    try {
      events.push(JSON.parse(payload));
    } catch {
      /* skip a malformed frame rather than break the stream */
    }
  }
  return { events, rest };
}
